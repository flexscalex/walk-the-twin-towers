// scripts/generate-context.ts
// Extrudes the cleaned NYC building footprints (data/context/buildings-standing-in-2001.json,
// written by scripts/fetch-context.ts) into flat-shaded massing, one node per building:
//   public/geometry/context.glb        (gitignored, meshopt-compressed, one material)
// The nodes are named context_000, context_001, ... in file order and carry no identifier
// (no BIN, no address). One mesh per building lets the viewer fade a building that blocks
// the camera and keep the eye out of its footprint (P-069) without touching the others.
// and records it under `context` in public/geometry/manifest.json, which
// scripts/generate-geometry.ts must have written first (the build script runs them in order).
//
// Run:  node --experimental-strip-types scripts/generate-context.ts
//
// Every number here comes from the cleaned file: polygon vertices in local metres about the
// documented site origin, height_roof_ft converted at 0.3048 m/ft. No building is added,
// moved, or resized. The set is incomplete by construction (only buildings that stood in
// 2001 AND still stand today; see the file's sources notes and GAPS.md), and the roof
// heights are today's. The mesh is unlabeled gray massing: no names, no addresses.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { ShapeUtils, Vector2 } from "three";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IN_FILE = resolve(ROOT, "data/context/buildings-standing-in-2001.json");
const OUT_DIR = resolve(ROOT, "public/geometry");
const MANIFEST = join(OUT_DIR, "manifest.json");
const SCRATCH = process.env.GEOMETRY_SCRATCH ?? resolve(ROOT, ".geometry-build");
const M_PER_FT = 0.3048;

// Paradata rows in data/paradata.exterior.json that document the choices here.
const PARADATA = { dataset: "P-064", origin: "P-065", groundPlane: "P-067", material: "P-062", perBuilding: "P-069" } as const;

interface Ring extends Array<[number, number]> {}
interface Building {
  bin: string;
  construction_year: number;
  height_roof_ft: number;
  ground_elevation_ft: number;
  feature_code: number | null;
  polygons: { outer: Ring; holes: Ring[] }[];
}
interface ContextFile {
  meta: { generated_at: string; generator: string; what: string; bbox_wgs84: unknown; filter: string; count: number; frame: unknown; origin: unknown; local_extent_m: unknown };
  sources: unknown[];
  buildings: Building[];
}

class ContextError extends Error {}

/** Drop a closing vertex equal to the first, and consecutive duplicates. */
function clean(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) out.pop();
  }
  return out;
}

function centroid(ring: Ring): [number, number] {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

interface MeshBuffers { pos: number[]; nrm: number[]; idx: number[]; triangles: number }

/** Appends one extruded polygon (outer ring + holes) from y = 0 to y = h. */
function extrude(out: MeshBuffers, outer: Ring, holes: Ring[], h: number): void {
  const walls = (ring: Ring, facingOut: boolean) => {
    const c = centroid(ring);
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const ex = q[0] - p[0], ez = q[1] - p[1];
      const len = Math.hypot(ex, ez);
      if (len < 1e-6) continue;
      // candidate normal, 90 degrees from the edge in the x-z plane
      let nx = ez / len, nz = -ex / len;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const toC = (c[0] - mx) * nx + (c[1] - mz) * nz; // > 0 when n points toward the ring centroid
      const wantInward = !facingOut; // hole walls face into the hole (toward its centroid)
      if (toC > 0 !== wantInward) { nx = -nx; nz = -nz; }
      const base = out.pos.length / 3;
      // p0 (p, 0), p1 (q, 0), p2 (q, h), p3 (p, h)
      out.pos.push(p[0], 0, p[1], q[0], 0, q[1], q[0], h, q[1], p[0], h, p[1]);
      for (let k = 0; k < 4; k++) out.nrm.push(nx, 0, nz);
      // winding so the geometric normal matches n: cross(p1 - p0, p3 - p0) = cross((e, 0), (0, h, 0)) = (-h*ez, 0, h*ex)... check sign
      const gx = -h * ez, gz = h * ex; // cross((ex,0,ez),(0,h,0)) = (0*0 - ez*h, ez*0 - ex*0, ex*h - 0*0) = (-ez*h, 0, ex*h)
      const same = gx * nx + gz * nz > 0;
      if (same) out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else out.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      out.triangles += 2;
    }
  };
  walls(outer, true);
  for (const hole of holes) walls(hole, false);

  // roof cap
  const contour = outer.map((p) => new Vector2(p[0], p[1]));
  const holePaths = holes.map((r) => r.map((p) => new Vector2(p[0], p[1])));
  const faces = ShapeUtils.triangulateShape(contour, holePaths);
  const all = [...outer, ...holes.flat()];
  const base = out.pos.length / 3;
  for (const p of all) { out.pos.push(p[0], h, p[1]); out.nrm.push(0, 1, 0); }
  for (const [a, b, c] of faces) {
    // geometric normal y component of (a, b, c) in the x-z plane; keep it pointing up
    const ax = all[a][0], az = all[a][1], bx = all[b][0], bz = all[b][1], cx = all[c][0], cz = all[c][1];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // cross((b-a),(c-a)).y with (x,0,z) vectors: = (bz-az)*(cx-ax) - (bx-ax)*(cz-az)
    if (ny > 0) out.idx.push(base + a, base + b, base + c);
    else out.idx.push(base + a, base + c, base + b);
    out.triangles += 1;
  }
}

async function main(): Promise<void> {
  if (!existsSync(IN_FILE)) throw new ContextError(`${IN_FILE} is missing; run scripts/fetch-context.ts`);
  if (!existsSync(MANIFEST)) throw new ContextError(`${MANIFEST} is missing; run scripts/generate-geometry.ts first`);
  const file = JSON.parse(readFileSync(IN_FILE, "utf8")) as ContextFile;
  const paradata = [
    ...(JSON.parse(readFileSync(resolve(ROOT, "data/paradata.json"), "utf8")) as { id: string }[]),
    ...(existsSync(resolve(ROOT, "data/paradata.exterior.json")) ? (JSON.parse(readFileSync(resolve(ROOT, "data/paradata.exterior.json"), "utf8")) as { id: string }[]) : []),
  ].map((r) => r.id);
  for (const id of Object.values(PARADATA)) if (!paradata.includes(id)) throw new ContextError(`paradata row ${id} is missing`);

  // One MeshBuffers per building, in file order. Buildings with no height or no usable ring
  // are skipped and counted; nothing is added, moved or resized.
  const perBuilding: MeshBuffers[] = [];
  let built = 0, skipped = 0;
  let maxH = 0;
  for (const b of file.buildings) {
    const h = b.height_roof_ft * M_PER_FT;
    if (!(h > 0)) { skipped++; continue; }
    const buf: MeshBuffers = { pos: [], nrm: [], idx: [], triangles: 0 };
    for (const poly of b.polygons) {
      const outer = clean(poly.outer);
      if (outer.length < 3) { skipped++; continue; }
      const holes = poly.holes.map(clean).filter((r) => r.length >= 3);
      extrude(buf, outer, holes, h);
    }
    if (buf.triangles === 0) { skipped++; continue; }
    perBuilding.push(buf);
    built++;
    maxH = Math.max(maxH, h);
  }
  const totals = perBuilding.reduce((a, b) => ({ triangles: a.triangles + b.triangles, vertices: a.vertices + b.pos.length / 3 }), { triangles: 0, vertices: 0 });

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene("context");
  // One flat light-gray material shared by every building: unlabeled massing, lighter than the
  // towers' cladding so the towers read as the subject (rendering choice, P-062 / P-064). The
  // roughness is a little under 1 so the viewer's sky environment gives the faces a faint sheen.
  const mat = doc.createMaterial("context_massing").setBaseColorFactor([0.9, 0.88, 0.84, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
  const root = doc.createNode("context_buildings");
  scene.addChild(root);
  // One POSITION and one NORMAL accessor for the whole set (meshopt compresses one long
  // vertex stream far better than 208 short ones), and one 16-bit index accessor per
  // building pointing into it. The viewer computes each building's bounds from its own
  // indices, since a shared attribute's bounds would be the whole city's.
  if (totals.vertices > 65535) throw new ContextError(`${totals.vertices} vertices do not fit 16-bit indices`);
  const allPos = new Float32Array(totals.vertices * 3), allNrm = new Float32Array(totals.vertices * 3);
  let vOff = 0;
  const indexArrays: Uint16Array<ArrayBuffer>[] = [];
  for (const buf of perBuilding) {
    allPos.set(buf.pos, vOff * 3);
    allNrm.set(buf.nrm, vOff * 3);
    indexArrays.push(new Uint16Array(buf.idx.map((k) => k + vOff)));
    vOff += buf.pos.length / 3;
  }
  const position = doc.createAccessor("context_position").setType("VEC3").setArray(allPos).setBuffer(buffer);
  const normal = doc.createAccessor("context_normal").setType("VEC3").setArray(allNrm).setBuffer(buffer);
  perBuilding.forEach((_buf, i) => {
    const indices = doc.createAccessor().setType("SCALAR").setArray(indexArrays[i]).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(indices).setMaterial(mat);
    const name = `context_${String(i).padStart(3, "0")}`;
    root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  });

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  const rawPath = join(SCRATCH, "context.raw.glb");
  await new NodeIO().write(rawPath, doc);
  await MeshoptEncoder.ready;
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const outPath = join(OUT_DIR, "context.glb");
  await new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.encoder": MeshoptEncoder }).write(outPath, doc);

  // read back: one node per building in order, and the same triangles. The meshopt encoder
  // reorders vertices and triangles for cache locality (the geometry is unchanged, the index
  // order is not), so each building is compared as a set of triangles keyed on their vertex
  // positions rounded to 1 mm, the precision of the input. A key that does not match, or a
  // decoded value more than 0.5 mm from its 1 mm grid, is a real loss and fails the build.
  await MeshoptDecoder.ready;
  const back = await new NodeIO().registerExtensions([EXTMeshoptCompression]).registerDependencies({ "meshopt.decoder": MeshoptDecoder }).read(outPath);
  const backNodes = back.getRoot().listNodes().filter((n) => n.getMesh());
  if (backNodes.length !== perBuilding.length) throw new ContextError(`context.glb has ${backNodes.length} building nodes, expected ${perBuilding.length}`);
  const mm = (v: number) => Math.round(v * 1000);
  const triangleKeys = (pos: ArrayLike<number>, idx: ArrayLike<number>): string => {
    const keys: string[] = [];
    for (let k = 0; k < idx.length; k += 3) {
      const corners = [0, 1, 2].map((j) => { const a = idx[k + j] * 3; return `${mm(pos[a])},${mm(pos[a + 1])},${mm(pos[a + 2])}`; });
      keys.push(corners.sort().join("|"));
    }
    return keys.sort().join("\n");
  };
  let worst = 0;
  backNodes.forEach((n, i) => {
    const buf = perBuilding[i];
    if (n.getName() !== `context_${String(i).padStart(3, "0")}`) throw new ContextError(`context.glb node ${i} is named ${n.getName()}`);
    const bp = n.getMesh()!.listPrimitives()[0];
    const bpos = bp.getAttribute("POSITION")!.getArray()!;
    const bidx = bp.getIndices()!.getArray()!;
    if (bidx.length !== buf.idx.length) throw new ContextError(`context.glb building ${i} changed size after compression`);
    if (triangleKeys(bpos, bidx) !== triangleKeys(Float32Array.from(buf.pos), buf.idx)) throw new ContextError(`context.glb building ${i} does not carry the triangles that were emitted`);
    for (let k = 0; k < bidx.length; k++) { const a = bidx[k] * 3; for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(bpos[a + c] - mm(bpos[a + c]) / 1000)); }
  });
  const TOLERANCE_M = 0.0005;
  if (worst > TOLERANCE_M) throw new ContextError(`context.glb compression moved a position ${worst} m off the 1 mm grid (tolerance ${TOLERANCE_M})`);

  const rawBytes = statSync(rawPath).size, packedBytes = statSync(outPath).size;
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;
  manifest.context = {
    file: "context.glb",
    url: "/geometry/context.glb",
    generator: "scripts/generate-context.ts",
    data_file: "data/context/buildings-standing-in-2001.json",
    what: file.meta.what,
    filter: file.meta.filter,
    bbox_wgs84: file.meta.bbox_wgs84,
    buildings: built,
    buildings_skipped: skipped,
    frame: file.meta.frame,
    origin: file.meta.origin,
    tallest_m: Math.round(maxH * 10) / 10,
    sources: file.sources,
    gap: "Only buildings that stood in 2001 and still stand today are shown; neighbours demolished since 2001, and the seven World Trade Center buildings, are absent from the source and therefore from the model. Roof heights are the current roof heights. Massing is unlabeled and carries no names or addresses.",
    material: "context_massing: one flat light warm gray shared by every building, a rendering choice so the towers read as the subject",
    nodes: "context_NNN, one node and one mesh per building in the data file's order, no identifier carried (P-069: the viewer fades a building that blocks the camera and keeps the eye out of its footprint). All meshes share one POSITION and one NORMAL accessor; each has its own index accessor, so a building's bounds must be computed from its indices.",
    paradata: Object.values(PARADATA),
    stats: { buildings: built, triangles: totals.triangles, vertices: totals.vertices, raw_bytes: rawBytes, packed_bytes: packedBytes, max_round_trip_error_m: worst, extensions: ["EXT_meshopt_compression"] },
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`context: ${built} buildings (${skipped} skipped), ${totals.triangles} triangles, ${totals.vertices} vertices, ${rawBytes} B raw -> ${packedBytes} B packed (${(packedBytes / 1024).toFixed(1)} KiB), tallest ${maxH.toFixed(1)} m`);
}

main().catch((err) => {
  console.error(err instanceof ContextError ? `generate-context: ${err.message}` : err);
  process.exit(1);
});
