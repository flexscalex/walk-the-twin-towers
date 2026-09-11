// scripts/generate-geometry.ts
// Phase 1 geometry generator. Reads data/geometry-params.json and emits
//   public/geometry/wtc1.glb, public/geometry/wtc2.glb   (gitignored, meshopt-compressed)
//   public/geometry/manifest.json                        (provenance for every node)
//
// Run:  node --experimental-strip-types scripts/generate-geometry.ts
// Deps: @gltf-transform/core, @gltf-transform/extensions, meshoptimizer (encoder + read-back check).
//
// Compression: EXT_meshopt_compression, encoded with the meshoptimizer package's own
// MeshoptEncoder through gltf-transform (the same codec three.js's MeshoptDecoder
// reads). gltfpack is NOT run on these files: it rewrites any EXT_mesh_gpu_instancing
// input into one unnamed node per mesh at the scene root, whatever -kn / -mi say
// (verified 2026-09-11), which destroys the per-story wtc1_columns_NNN nodes the
// viewer hides per floor. Draco is banned (CLAUDE.md). No textures yet, so no KTX2.
//
// Rules (CLAUDE.md hard rule 3, BUILD-PLAN 3.2):
//   * Every number in the output comes from a parameter in the params file, looked
//     up by id. Referencing an id that does not exist, or that lacks a source and a
//     locator, throws and the process exits non-zero.
//   * No dimension literal is typed here. The only constants are unit definitions
//     (12 in per ft, 0.3048 m per ft) and the floor / level labels that name params.
//   * Nothing is scaled, rounded or averaged. Sums of cited intervals are computed;
//     undivided intervals are never subdivided (those floors are omitted and listed).
//   * Every interpretive choice is a paradata row (data/paradata.json, P-030 onward);
//     the manifest cites the row ids.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, type Material, type Primitive, type Buffer as GltfBuffer } from "@gltf-transform/core";
import { EXTMeshGPUInstancing, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARAMS_FILE = resolve(ROOT, "data/geometry-params.json");
const PARADATA_FILE = resolve(ROOT, "data/paradata.json");
// Exterior (facade) decisions live in a second file while data/paradata.json is owned by another
// session; same row format, ids P-060 onward. Both files are read for the id check below.
const PARADATA_EXTERIOR_FILE = resolve(ROOT, "data/paradata.exterior.json");
const OUT_DIR = resolve(ROOT, "public/geometry");
const SCRATCH = process.env.GEOMETRY_SCRATCH ?? resolve(ROOT, ".geometry-build");

// Unit definitions only. These are not dimensions of the building.
const IN_PER_FT = 12;
const M_PER_FT = 0.3048;
const ftToM = (ft: number) => ft * M_PER_FT;

// Paradata rows that document the choices made below. Checked against data/paradata.json.
const PARADATA = {
  wtc2Schedule: "P-030",
  wtc2Assumed: "P-046",
  planSide: "P-031",
  cornerChamfer: "P-032",
  floor2Conflict: "P-033",
  floor9Conflict: "P-034",
  omittedFloors: "P-035",
  wtc2Roof: "P-036",
  columnSection: "P-037",
  columnExtent: "P-038",
  baseColumns: "P-039",
  corePlacement: "P-040",
  plateThickness: "P-041",
  sublevels: "P-042",
  frame: "P-043",
  antenna: "P-044",
  columnLayout: "P-045",
  // exterior realism (data/paradata.exterior.json)
  spandrels: "P-060",
  glass: "P-061",
  materials: "P-062",
} as const;

// ---------------------------------------------------------------------------
// Parameter registry: the only way a number enters the geometry.
// ---------------------------------------------------------------------------

type TowerId = "wtc1" | "wtc2";
type Value = number | string | boolean | unknown[];

interface Locator { pdf_page: number; printed_page: string; section: string; quote: string }
interface Param {
  id: string;
  applies_to: "wtc1" | "wtc2" | "towers" | "complex";
  value: Value;
  value_raw?: string;
  unit: string | null;
  evidence: "documented" | "corroborated" | "reported" | "unknown";
  source_id: string;
  locator: Locator;
  notes: string | null;
}
interface Source { id: string; citation: string; url: string; retrieved_at: string }
interface ParamsFile { meta: unknown; sources: Source[]; params: Param[]; unresolved: { id: string; why: string; where_to_look: string }[] }

class GeometryError extends Error {}

class Registry {
  private readonly byId = new Map<string, Param>();
  readonly sources = new Map<string, Source>();
  /** param id -> set of building ids it was used for */
  readonly used = new Map<string, Set<TowerId>>();

  constructor(file: ParamsFile) {
    for (const s of file.sources) this.sources.set(s.id, s);
    for (const p of file.params) this.byId.set(p.id, p);
  }

  /** Look a parameter up by id and record the use. Throws if it cannot be cited. */
  /** Read a param without the scope check and without recording use (for evidence roll-ups only). */
  peek(id: string): Param {
    const p = this.byId.get(id);
    if (!p) throw new GeometryError(`param ${id} does not exist in data/geometry-params.json`);
    return p;
  }

  get(id: string, tower: TowerId): Param {
    const p = this.byId.get(id);
    if (!p) throw new GeometryError(`param ${id} does not exist in data/geometry-params.json`);
    const loc = p.locator;
    if (!loc || !Number.isInteger(loc.pdf_page) || typeof loc.quote !== "string" || loc.quote.trim() === "")
      throw new GeometryError(`param ${id} lacks a locator (pdf_page + verbatim quote)`);
    if (!this.sources.has(p.source_id)) throw new GeometryError(`param ${id}: source ${p.source_id} not in sources`);
    if (p.evidence === "unknown") throw new GeometryError(`param ${id} has evidence "unknown" and cannot be built from`);
    if (p.applies_to !== "towers" && p.applies_to !== "complex" && p.applies_to !== tower)
      throw new GeometryError(`param ${id} applies to ${p.applies_to}, not ${tower}`);
    let set = this.used.get(id);
    if (!set) this.used.set(id, (set = new Set()));
    set.add(tower);
    return p;
  }

  /** Numeric value in feet (unit ft or in). */
  ft(id: string, tower: TowerId): number {
    const p = this.get(id, tower);
    if (typeof p.value !== "number") throw new GeometryError(`param ${id} is not numeric`);
    if (p.unit === "ft") return p.value;
    if (p.unit === "in") return p.value / IN_PER_FT;
    throw new GeometryError(`param ${id} has unit ${p.unit}; expected ft or in`);
  }

  /** Dimensionless count (unit is a noun such as "columns" or "stories"). */
  count(id: string, tower: TowerId): number {
    const p = this.get(id, tower);
    if (typeof p.value !== "number" || !Number.isInteger(p.value)) throw new GeometryError(`param ${id} is not an integer count`);
    return p.value;
  }

  str(id: string, tower: TowerId): string {
    const p = this.get(id, tower);
    if (typeof p.value !== "string") throw new GeometryError(`param ${id} is not a string`);
    return p.value;
  }

  has(id: string): boolean { return this.byId.has(id); }
  raw(id: string): Param | undefined { return this.byId.get(id); }
  ids(): string[] { return [...this.byId.keys()]; }
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-6;
function check(cond: boolean, msg: string): void { if (!cond) throw new GeometryError(`consistency check failed: ${msg}`); }

// ---------------------------------------------------------------------------
// Story-height schedule. Built only from params named
//   <tower>.(story|height)_(concourse|flN)_to_(flM|roof)
// A run lettered "K @ 12'" fills K stories at the typical story height; an
// undivided dimension (no "@") places only its end floor and lists the floors
// inside it as omitted.
// ---------------------------------------------------------------------------

interface Level { elevation_ft: number; params: string[] }
interface Omission { what: string; why: string; params: string[]; paradata: string[] }
interface Schedule { floors: Map<number, Level>; roof: Level | null; omitted: Omission[]; edges: string[] }

const EDGE_RE = /^(wtc[12])\.(story|height)_(concourse|fl(\d+))_to_(fl(\d+)|roof)$/;
const RUN_RE = /^(\d+) @ (\d+)'/;

function buildSchedule(reg: Registry, tower: TowerId): Schedule {
  const floors = new Map<number, Level>();
  const omitted: Omission[] = [];
  const edges: string[] = [];

  // Floor 1 (Concourse) is the datum line of Figure 2-2 and is lettered on Figure 2-3 for both towers.
  floors.set(1, { elevation_ft: reg.ft("towers.floor_1_elevation", tower), params: ["towers.floor_1_elevation"] });
  // Floor 2: NCSTAR 1-1 Figure 2-3 floor line, chosen over the 1-2A spandrel-splice elevation (P-033).
  floors.set(2, { elevation_ft: reg.ft("towers.floor_2_elevation", tower), params: ["towers.floor_2_elevation"] });

  const typical = reg.ft("towers.typical_story_height", tower);
  const byFrom = new Map<string, { id: string; to: string }>();
  for (const id of reg.ids()) {
    const m = EDGE_RE.exec(id);
    if (!m || m[1] !== tower) continue;
    const from = m[3] === "concourse" ? "fl1" : m[3];
    if (byFrom.has(from)) throw new GeometryError(`two schedule params start at ${from}: ${byFrom.get(from)!.id}, ${id}`);
    byFrom.set(from, { id, to: m[5] });
  }

  let roof: Level | null = null;
  let cur = "fl1";
  let curElev = floors.get(1)!.elevation_ft;
  while (byFrom.has(cur)) {
    const { id, to } = byFrom.get(cur)!;
    edges.push(id);
    const p = reg.get(id, tower);
    const span = reg.ft(id, tower);
    const fromFloor = Number(cur.slice(2));
    if (to === "roof") {
      roof = { elevation_ft: curElev + span, params: [id] };
      break;
    }
    const toFloor = Number(to.slice(2));
    const run = p.value_raw ? RUN_RE.exec(p.value_raw) : null;
    if (run) {
      const k = Number(run[1]);
      const per = Number(run[2]);
      check(k === toFloor - fromFloor, `${id}: "${p.value_raw}" letters ${k} stories but spans ${toFloor - fromFloor} floors`);
      check(eq(per, typical), `${id}: per-story ${per} ft differs from towers.typical_story_height`);
      check(eq(k * typical, span), `${id}: ${k} x ${typical} != ${span}`);
      for (let f = fromFloor + 1; f <= toFloor; f++) {
        curElev += typical;
        floors.set(f, { elevation_ft: curElev, params: [id, "towers.typical_story_height"] });
      }
    } else {
      curElev += span;
      for (let f = fromFloor + 1; f < toFloor; f++) {
        if (floors.has(f)) continue; // floor 2 is cited separately
        omitted.push({
          what: `${tower}_floor_${String(f).padStart(3, "0")}`,
          why: `floor ${f} has no cited elevation: it lies inside the undivided ${p.value_raw ?? p.value + " " + p.unit} dimension ${id} and the figure does not subdivide it`,
          params: [id],
          paradata: [PARADATA.omittedFloors],
        });
      }
      floors.set(toFloor, { elevation_ft: curElev, params: [id] });
    }
    cur = to;
  }
  return { floors, roof, omitted, edges };
}

// ---------------------------------------------------------------------------
// Box geometry (24 vertices, flat normals, 12 triangles).
// ---------------------------------------------------------------------------

function boxPrimitive(doc: Document, buffer: GltfBuffer, sx: number, sy: number, sz: number, y0: number, material: Material): Primitive {
  const hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
  const faces: { n: [number, number, number]; v: [number, number, number][] }[] = [
    { n: [0, 0, 1], v: [[-hx, y0, hz], [hx, y0, hz], [hx, y1, hz], [-hx, y1, hz]] },
    { n: [0, 0, -1], v: [[hx, y0, -hz], [-hx, y0, -hz], [-hx, y1, -hz], [hx, y1, -hz]] },
    { n: [1, 0, 0], v: [[hx, y0, hz], [hx, y0, -hz], [hx, y1, -hz], [hx, y1, hz]] },
    { n: [-1, 0, 0], v: [[-hx, y0, -hz], [-hx, y0, hz], [-hx, y1, hz], [-hx, y1, -hz]] },
    { n: [0, 1, 0], v: [[-hx, y1, hz], [hx, y1, hz], [hx, y1, -hz], [-hx, y1, -hz]] },
    { n: [0, -1, 0], v: [[-hx, y0, -hz], [hx, y0, -hz], [hx, y0, hz], [-hx, y0, hz]] },
  ];
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  faces.forEach((f, i) => {
    for (const v of f.v) { pos.push(...v); nrm.push(...f.n); }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer);
  const normal = doc.createAccessor().setType("VEC3").setArray(new Float32Array(nrm)).setBuffer(buffer);
  const indices = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(idx)).setBuffer(buffer);
  return doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(indices).setMaterial(material);
}

/** A single quad in the x-y plane (4 vertices, 2 triangles), normal +z, bottom edge at y0. Used for glass. */
function quadPrimitive(doc: Document, buffer: GltfBuffer, sx: number, sy: number, y0: number, material: Material): Primitive {
  const hx = sx / 2, y1 = y0 + sy;
  const pos = new Float32Array([-hx, y0, 0, hx, y0, 0, hx, y1, 0, -hx, y1, 0]);
  const nrm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const position = doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer);
  const normal = doc.createAccessor().setType("VEC3").setArray(nrm).setBuffer(buffer);
  const indices = doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buffer);
  return doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(indices).setMaterial(material);
}


/** Weakest evidence level among a node's params: "reported" if any param is reported, else "documented". */
function evidenceOf(reg: Registry, ids: string[], tower: TowerId): "documented" | "reported" {
  void tower;
  return ids.some((id) => reg.peek(id).evidence === "reported") ? "reported" : "documented";
}

// ---------------------------------------------------------------------------
// One tower.
// ---------------------------------------------------------------------------

interface NodeRecord {
  name: string;
  kind: "floor_plate" | "roof_plate" | "sublevel_plate" | "core_segment" | "column_story" | "spandrel_line" | "glass_story";
  /** weakest evidence level among the params behind this node */
  evidence?: "documented" | "reported";
  /** numeric floor the node belongs to (plates: the floor line; segments: the floor line at the bottom) */
  floor?: number;
  /** drawing-index label for below-grade levels */
  level?: string;
  elevation_ft: number;
  y_m: number;
  /** for segments: the cited level whose line the segment reaches */
  spans_to?: string;
  spans_to_elevation_ft?: number;
  instances?: number;
  params: string[];
  paradata: string[];
  note?: string;
}

/** A cited horizontal line the model is built between. */
interface Line {
  /** name suffix: "042" for numeric floors, "sublevel_5" / "service_level" below grade, "roof" */
  key: string;
  floor?: number;
  level?: string;
  elevation_ft: number;
  params: string[];
  paradata: string[];
}

interface TowerResult {
  id: TowerId;
  file: string;
  nodes: NodeRecord[];
  omitted: Omission[];
  triangles: number;
  instances: number;
  schedule_edges: string[];
}

async function buildTower(reg: Registry, tower: TowerId): Promise<{ result: TowerResult; doc: Document }> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(tower);
  const root = doc.createNode(tower);
  scene.addChild(root);
  const instancing = doc.createExtension(EXTMeshGPUInstancing).setRequired(true);

  const matPlate = doc.createMaterial("plate").setBaseColorFactor([0.82, 0.8, 0.76, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
  const matCore = doc.createMaterial("core").setBaseColorFactor([0.55, 0.55, 0.57, 1]).setMetallicFactor(0).setRoughnessFactor(0.9);
  // Exterior materials (P-062). The material is cited (aluminum sheet cladding, glass infill:
  // towers.exterior_cladding_material, towers.window_infill); the colours are rendering choices.
  reg.get("towers.exterior_cladding_material", tower);
  reg.get("towers.window_infill", tower);
  const matColumn = doc.createMaterial("column_cladding").setBaseColorFactor([0.86, 0.84, 0.78, 1]).setMetallicFactor(0.15).setRoughnessFactor(0.55);
  const matSpandrel = doc.createMaterial("spandrel_cladding").setBaseColorFactor([0.7, 0.68, 0.63, 1]).setMetallicFactor(0.15).setRoughnessFactor(0.6);
  const matGlass = doc
    .createMaterial("glass")
    .setBaseColorFactor([0.3, 0.36, 0.42, 0.55])
    .setMetallicFactor(0)
    .setRoughnessFactor(0.25)
    .setAlphaMode("BLEND")
    .setDoubleSided(true);

  const nodes: NodeRecord[] = [];
  const omitted: Omission[] = [];
  let triangles = 0;
  let instances = 0;

  // ---- datum and plan
  const datumId = "towers.floor_1_elevation";
  const datum = reg.ft(datumId, tower);
  const y = (elevFt: number) => ftToM(elevFt - datum);

  // Plan side: the exact column-reference-line spacing, not the "approximately 207 ft" (P-031).
  const sideId = "towers.column_reference_line_spacing";
  const side = reg.ft(sideId, tower);
  check(Math.round(reg.ft("towers.plan_side_approx", tower)) === Math.round(side), "plan_side_approx disagrees with column_reference_line_spacing by more than rounding");

  // ---- schedule
  const sched = buildSchedule(reg, tower);
  omitted.push(...sched.omitted);

  // Roof
  let roof: Level;
  if (tower === "wtc1") {
    if (!sched.roof) throw new GeometryError("wtc1 schedule did not reach the roof");
    roof = sched.roof;
    check(eq(roof.elevation_ft, datum + reg.ft("wtc1.roof_height_above_concourse", tower)), "Figure 2-2 intervals do not sum to wtc1.roof_height_above_concourse");
    check(eq(roof.elevation_ft, datum + reg.ft("wtc1.total_height_fig2_2", tower)), "Figure 2-2 intervals do not sum to wtc1.total_height_fig2_2");
    roof.params.push("wtc1.roof_height_above_concourse", "wtc1.total_height_fig2_2");
  } else if (sched.roof) {
    // WTC 2 modeled under the P-046 assumption (12 ft typical, evidence reported). The assumed
    // schedule must land exactly on the cited roof: 1-1 (1,368 - 6) and 1-2A (1,362).
    const aboveConcourse = reg.ft("wtc1.roof_height_above_concourse", "wtc1") - reg.ft("wtc1.roof_height_minus_wtc2", "wtc1");
    check(eq(aboveConcourse, reg.ft("wtc2.roof_height_above_ground", tower)), "1-1 (1,368 - 6) and 1-2A (1,362) disagree on the WTC 2 roof");
    check(eq(sched.roof.elevation_ft, datum + aboveConcourse), "assumed WTC 2 schedule does not land on the cited 1,362 ft roof");
    roof = sched.roof;
    roof.params.push("wtc1.roof_height_above_concourse", "wtc1.roof_height_minus_wtc2", "wtc2.roof_height_above_ground");
    reg.used.get("wtc1.roof_height_above_concourse")!.add(tower);
    reg.used.get("wtc1.roof_height_minus_wtc2")!.add(tower);
  } else {
    // WTC 2 has no story schedule (unresolved wtc2.story_height_schedule, P-030). Its roof is the
    // one cited height: NCSTAR 1-1 gives it only as 6 ft below WTC 1's 1,368 ft above the
    // Concourse; NCSTAR 1-2A gives 1,362 ft "above ground". Both must agree (P-036).
    const aboveConcourse = reg.ft("wtc1.roof_height_above_concourse", "wtc1") - reg.ft("wtc1.roof_height_minus_wtc2", "wtc1");
    check(eq(aboveConcourse, reg.ft("wtc2.roof_height_above_ground", tower)), "1-1 (1,368 - 6) and 1-2A (1,362) disagree on the WTC 2 roof");
    roof = { elevation_ft: datum + aboveConcourse, params: ["wtc1.roof_height_above_concourse", "wtc1.roof_height_minus_wtc2", "wtc2.roof_height_above_ground"] };
    // record the 1-1 params as used for wtc2 too
    reg.used.get("wtc1.roof_height_above_concourse")!.add(tower);
    reg.used.get("wtc1.roof_height_minus_wtc2")!.add(tower);
    const storiesAbove = reg.count("towers.stories_above_concourse", tower);
    for (let f = 3; f <= storiesAbove; f++) {
      omitted.push({
        what: `wtc2_floor_${String(f).padStart(3, "0")}`,
        why: "no WTC 2 story-height schedule is cited (unresolved wtc2.story_height_schedule); only floors 1, 2 and the roof have cited elevations for this tower",
        params: ["towers.stories_above_concourse", "wtc2.roof_height_above_ground"],
        paradata: [PARADATA.wtc2Schedule],
      });
    }
  }

  // ---- sub-levels (below the Concourse), named per the drawing-index labels (P-042)
  const sublevels: [string, string][] = tower === "wtc1"
    ? [["sublevel_5", "wtc1.sublevel_5_elevation_drawing_index"], ["sublevel_4", "towers.level_b5_elevation"], ["sublevel_3", "wtc1.sublevel_3_elevation_drawing_index"], ["sublevel_2", "wtc1.sublevel_2_elevation_drawing_index"], ["sublevel_1", "wtc1.sublevel_1_elevation_drawing_index"], ["service_level", "wtc1.service_level_elevation_drawing_index"]]
    : [["sublevel_5", "wtc2.sublevel_5_elevation_drawing_index"], ["sublevel_4", "wtc2.sublevel_4_elevation_drawing_index"], ["sublevel_3", "wtc2.sublevel_3_elevation_drawing_index"], ["sublevel_2", "wtc2.sublevel_2_elevation_drawing_index"], ["sublevel_1", "wtc2.sublevel_1_elevation_drawing_index"], ["service_level", "wtc2.service_level_elevation_drawing_index"]];
  const foundationId = "towers.foundation_level_elevation";
  const foundation = reg.ft(foundationId, tower);
  check(eq(foundation, reg.ft(sublevels[0][1], tower)), "foundation level (Fig. 2-3) differs from the drawing-index sub-level 5 elevation");
  check(eq(reg.ft("towers.bracing_top_elevation", tower), reg.ft(sublevels[5][1], tower)), "bracing top EL. 294 differs from the drawing-index service level");

  // ---- the ordered list of cited horizontal lines: sub-levels, floors, roof
  const pad3 = (f: number) => String(f).padStart(3, "0");
  const lines: Line[] = [];
  for (const [label, id] of sublevels) {
    lines.push({ key: label, level: label, elevation_ft: reg.ft(id, tower), params: [id], paradata: [PARADATA.sublevels] });
  }
  for (const f of [...sched.floors.keys()].sort((a, b) => a - b)) {
    const level = sched.floors.get(f)!;
    const paradata: string[] = [];
    if (f === 2) paradata.push(PARADATA.floor2Conflict);
    if (f === 9) paradata.push(PARADATA.floor9Conflict);
    if (tower === "wtc2" && f > 2) paradata.push(PARADATA.wtc2Assumed);
    lines.push({ key: pad3(f), floor: f, elevation_ft: level.elevation_ft, params: level.params, paradata });
  }
  lines.push({ key: "roof", elevation_ft: roof.elevation_ft, params: roof.params, paradata: tower === "wtc2" ? [PARADATA.wtc2Roof] : [] });
  for (let i = 1; i < lines.length; i++) check(lines[i].elevation_ft > lines[i - 1].elevation_ft, `lines out of order at ${lines[i].key}`);

  // ---- plates: one thin box per cited line, top face on the line (P-041)
  const plateT = reg.ft("towers.truss_floor_slab_thickness", tower);
  const plateParams = [sideId, "towers.truss_floor_slab_thickness", datumId];
  const plateMesh = doc.createMesh("plate").addPrimitive(boxPrimitive(doc, buffer, ftToM(side), ftToM(plateT), ftToM(side), -ftToM(plateT), matPlate));
  for (const line of lines) {
    const name = line.floor !== undefined ? `${tower}_floor_${line.key}` : `${tower}_${line.key}`;
    const kind: NodeRecord["kind"] = line.floor !== undefined ? "floor_plate" : line.key === "roof" ? "roof_plate" : "sublevel_plate";
    const plateEvidence = evidenceOf(reg, line.params, tower);
    root.addChild(doc.createNode(name).setMesh(plateMesh).setTranslation([0, y(line.elevation_ft), 0]).setExtras({ evidence: plateEvidence }));
    triangles += 12;
    nodes.push({
      name, kind, floor: line.floor, level: line.level, elevation_ft: line.elevation_ft, y_m: y(line.elevation_ft),
      params: [...new Set([...line.params, ...plateParams])],
      evidence: plateEvidence,
      paradata: [...line.paradata, PARADATA.plateThickness, PARADATA.planSide, PARADATA.cornerChamfer, PARADATA.frame],
    });
  }

  // ---- core: one box segment between each pair of consecutive cited lines, long axis per the
  //      cited orientation, centred in plan, foundation to roof (P-040). Named <tower>_core_<key>
  //      for the line at its bottom so the viewer can treat it as that floor's detail node.
  const coreLong = reg.ft("towers.core_plan_long_approx", tower);
  const coreShort = reg.ft("towers.core_plan_short_approx", tower);
  const orientation = reg.str(`${tower}.core_long_axis_orientation`, tower);
  const gapShort = reg.ft("towers.core_to_exterior_wall_distance_short_approx", tower);
  const gapLong = reg.ft("towers.core_to_exterior_wall_distance_long_approx", tower);
  check(Math.round(coreLong + 2 * gapShort) === Math.round(side) && Math.round(coreShort + 2 * gapLong) === Math.round(side), "core plan + core-to-wall gaps do not fill the plan side (centering assumption fails)");
  let coreX: number, coreZ: number;
  if (orientation === "east-west") { coreX = coreLong; coreZ = coreShort; }
  else if (orientation === "north-south") { coreX = coreShort; coreZ = coreLong; }
  else throw new GeometryError(`unrecognised core orientation ${orientation}`);
  check(eq(lines[0].elevation_ft, foundation), "lowest line is not the foundation level");
  const coreParams = ["towers.core_plan_long_approx", "towers.core_plan_short_approx", `${tower}.core_long_axis_orientation`, "towers.core_to_exterior_wall_distance_short_approx", "towers.core_to_exterior_wall_distance_long_approx", foundationId, datumId];
  const coreMeshByHeight = new Map<number, ReturnType<Document["createMesh"]>>();
  for (let i = 0; i + 1 < lines.length; i++) {
    const lo = lines[i], hi = lines[i + 1];
    const h = hi.elevation_ft - lo.elevation_ft;
    let mesh = coreMeshByHeight.get(h);
    if (!mesh) coreMeshByHeight.set(h, (mesh = doc.createMesh(`core_${h}ft`).addPrimitive(boxPrimitive(doc, buffer, ftToM(coreX), ftToM(h), ftToM(coreZ), 0, matCore))));
    const name = `${tower}_core_${lo.key}`;
    root.addChild(doc.createNode(name).setMesh(mesh).setTranslation([0, y(lo.elevation_ft), 0]).setExtras({ evidence: evidenceOf(reg, lo.params, tower) }));
    triangles += 12;
    nodes.push({
      name, kind: "core_segment", floor: lo.floor, level: lo.level, elevation_ft: lo.elevation_ft, y_m: y(lo.elevation_ft),
      spans_to: hi.key, spans_to_elevation_ft: hi.elevation_ft,
      params: [...new Set([...coreParams, ...lo.params, ...hi.params])],
      paradata: [PARADATA.corePlacement, PARADATA.frame, ...lo.paradata],
      note: i === 0 ? "Core segments are one centred box per pair of consecutive cited lines. Core columns, walls and shafts are not modelled (no plan dimensions cited beyond the approximate 135 ft by 87 ft)." : undefined,
    });
  }

  // ---- perimeter columns: one instanced node per story between consecutive cited floor lines,
  //      floor 9 to floor 107 (P-037, P-038, P-045). Named <tower>_columns_<NNN> for the floor
  //      at the bottom of the story.
  const rangeStr = reg.str("towers.framed_tube_box_column_floor_range", tower);
  check(rangeStr === "9 to 107", `unexpected framed-tube floor range "${rangeStr}"`);
  const columnLines = lines.filter((l) => l.floor !== undefined && l.floor >= 9 && l.floor <= 107);
  if (columnLines.length >= 2 && columnLines[0].floor === 9 && columnLines[columnLines.length - 1].floor === 107) {
    const perFace = reg.count("towers.perimeter_columns_per_face", tower);
    const pitch = reg.ft("towers.perimeter_column_spacing_oc", tower);
    const endOffset = reg.ft("towers.corner_chamfer", tower);
    check(eq(endOffset, reg.ft("towers.fig2_15_col401_offset", tower)), "corner chamfer 6'-11\" differs from the Figure 2-15 corner column offset");
    check(reg.count("towers.perimeter_face_bays_above_floor_9", tower) === perFace - 1, "58 bays != 59 columns - 1");
    check(eq(reg.ft("towers.perimeter_face_column_run_above_floor_9", tower), (perFace - 1) * pitch), "193'-4\" != 58 x 3'-4\"");
    check(eq(endOffset + (perFace - 1) * pitch + endOffset, side), "6'-11\" + 193'-4\" + 6'-11\" != 207'-2\"");
    const w = reg.ft("towers.perimeter_column_outer_web_width", tower);
    const d = reg.ft("towers.perimeter_column_depth", tower);
    check(eq(pitch, reg.ft("towers.perimeter_column_pitch_fig2_7", tower)), "Fig. 2-7 pitch differs from the 3 ft 4 in. spacing");

    // The plan layout is identical for every story, so one TRANSLATION / ROTATION pair is shared.
    const t: number[] = [], r: number[] = [];
    const half = side / 2;
    const s = Math.SQRT1_2; // quaternion for a 90 degree turn about +y (math, not a dimension)
    for (let k = 0; k < perFace; k++) {
      const a = -half + endOffset + k * pitch;
      t.push(ftToM(a), 0, ftToM(half)); r.push(0, 0, 0, 1);      // south face (+z)
      t.push(ftToM(a), 0, ftToM(-half)); r.push(0, 0, 0, 1);     // north face (-z)
      t.push(ftToM(half), 0, ftToM(a)); r.push(0, s, 0, s);      // east face (+x)
      t.push(ftToM(-half), 0, ftToM(a)); r.push(0, s, 0, s);     // west face (-x)
    }
    const perStory = t.length / 3;
    const tAcc = doc.createAccessor("column_translation").setType("VEC3").setArray(new Float32Array(t)).setBuffer(buffer);
    const rAcc = doc.createAccessor("column_rotation").setType("VEC4").setArray(new Float32Array(r)).setBuffer(buffer);
    const columnParams = [
      "towers.perimeter_columns_per_face", "towers.perimeter_column_spacing_oc", "towers.perimeter_column_pitch_fig2_7", "towers.corner_chamfer", "towers.fig2_15_col401_offset",
      "towers.perimeter_face_bays_above_floor_9", "towers.perimeter_face_column_run_above_floor_9", "towers.perimeter_column_outer_web_width", "towers.perimeter_column_depth",
      "towers.framed_tube_box_column_floor_range", sideId, datumId,
    ];
    const columnMeshByHeight = new Map<number, ReturnType<Document["createMesh"]>>();
    for (let i = 0; i + 1 < columnLines.length; i++) {
      const lo = columnLines[i], hi = columnLines[i + 1];
      const h = hi.elevation_ft - lo.elevation_ft;
      let mesh = columnMeshByHeight.get(h);
      if (!mesh) columnMeshByHeight.set(h, (mesh = doc.createMesh(`column_${h}ft`).addPrimitive(boxPrimitive(doc, buffer, ftToM(w), ftToM(h), ftToM(d), 0, matColumn))));
      const batch = instancing.createInstancedMesh().setAttribute("TRANSLATION", tAcc).setAttribute("ROTATION", rAcc);
      const name = `${tower}_columns_${lo.key}`;
      const node = doc.createNode(name).setMesh(mesh).setTranslation([0, y(lo.elevation_ft), 0]).setExtras({ evidence: evidenceOf(reg, lo.params, tower) });
      node.setExtension("EXT_mesh_gpu_instancing", batch);
      root.addChild(node);
      triangles += 12 * perStory;
      instances += perStory;
      nodes.push({
        name, kind: "column_story", floor: lo.floor, elevation_ft: lo.elevation_ft, y_m: y(lo.elevation_ft), instances: perStory,
        spans_to: hi.key, spans_to_elevation_ft: hi.elevation_ft,
        params: [...new Set([...columnParams, ...lo.params, ...hi.params])],
        paradata: [PARADATA.columnSection, PARADATA.columnExtent, PARADATA.columnLayout, PARADATA.frame, ...lo.paradata],
        note: i === 0 ? "EXT_mesh_gpu_instancing: one box per column per story, 59 per face at 3 ft 4 in. on centre starting 6 ft 11 in. from each column reference line; a story spanning an undivided dimension (41 to 43) is one taller box. Cladding projection and corner members are not modelled (see spandrels and glass nodes for the infill)." : undefined,
      });
    }

    // ---- spandrels: one box per face on every column line 9 to 107, 52 in. deep, centred on
    //      the floor line, running the cited 193'-4" plus one column width, as deep as the
    //      column (P-060). Four instances per line share one mesh.
    const spandrelDepth = reg.ft("towers.spandrel_depth_typical", tower);
    const run = reg.ft("towers.perimeter_face_column_run_above_floor_9", tower);
    const spandrelMesh = doc.createMesh("spandrel").addPrimitive(boxPrimitive(doc, buffer, ftToM(run + w), ftToM(spandrelDepth), ftToM(d), -ftToM(spandrelDepth / 2), matSpandrel));
    const st: number[] = [], sr: number[] = [];
    st.push(0, 0, ftToM(half)); sr.push(0, 0, 0, 1);      // south face (+z)
    st.push(0, 0, ftToM(-half)); sr.push(0, 0, 0, 1);     // north face (-z)
    st.push(ftToM(half), 0, 0); sr.push(0, s, 0, s);      // east face (+x)
    st.push(ftToM(-half), 0, 0); sr.push(0, s, 0, s);     // west face (-x)
    const stAcc = doc.createAccessor("spandrel_translation").setType("VEC3").setArray(new Float32Array(st)).setBuffer(buffer);
    const srAcc = doc.createAccessor("spandrel_rotation").setType("VEC4").setArray(new Float32Array(sr)).setBuffer(buffer);
    const spandrelParams = ["towers.spandrel_depth_typical", "towers.perimeter_face_column_run_above_floor_9", "towers.perimeter_column_outer_web_width", "towers.perimeter_column_depth", "towers.framed_tube_box_column_floor_range", "towers.exterior_cladding_material", sideId, datumId];
    columnLines.forEach((line, i) => {
      const batch = instancing.createInstancedMesh().setAttribute("TRANSLATION", stAcc).setAttribute("ROTATION", srAcc);
      const name = `${tower}_spandrels_${line.key}`;
      const node = doc.createNode(name).setMesh(spandrelMesh).setTranslation([0, y(line.elevation_ft), 0]).setExtras({ evidence: evidenceOf(reg, line.params, tower) });
      node.setExtension("EXT_mesh_gpu_instancing", batch);
      root.addChild(node);
      triangles += 12 * 4;
      instances += 4;
      nodes.push({
        name, kind: "spandrel_line", floor: line.floor, elevation_ft: line.elevation_ft, y_m: y(line.elevation_ft), instances: 4,
        params: [...new Set([...spandrelParams, ...line.params])],
        evidence: evidenceOf(reg, line.params, tower),
        paradata: [PARADATA.spandrels, PARADATA.materials, PARADATA.frame, ...line.paradata],
        note: i === 0 ? "One box per face, 52 in. deep, centred vertically on the cited floor line; length 193 ft 4 in. plus one 14 in. column width; depth equals the column depth so the cladding reads as one surface. Plate thickness and cladding projection are not modelled." : undefined,
      });
    });

    // ---- glass: one quad per bay per story, width = pitch - column width (a derived clear gap;
    //      towers.window_width is unresolved), height = story - spandrel depth, on the column
    //      reference line between the spandrel below and the spandrel above (P-061).
    const gap = pitch - w;
    check(gap > 0, "column pitch is not wider than the column");
    const gt: number[] = [], gr: number[] = [];
    for (let k = 0; k + 1 < perFace; k++) {
      const a = -half + endOffset + k * pitch + pitch / 2;
      gt.push(ftToM(a), 0, ftToM(half)); gr.push(0, 0, 0, 1);
      gt.push(ftToM(a), 0, ftToM(-half)); gr.push(0, 0, 0, 1);
      gt.push(ftToM(half), 0, ftToM(a)); gr.push(0, s, 0, s);
      gt.push(ftToM(-half), 0, ftToM(a)); gr.push(0, s, 0, s);
    }
    const glassPerStory = gt.length / 3;
    const gtAcc = doc.createAccessor("glass_translation").setType("VEC3").setArray(new Float32Array(gt)).setBuffer(buffer);
    const grAcc = doc.createAccessor("glass_rotation").setType("VEC4").setArray(new Float32Array(gr)).setBuffer(buffer);
    const glassParams = ["towers.perimeter_column_spacing_oc", "towers.perimeter_column_outer_web_width", "towers.spandrel_depth_typical", "towers.perimeter_columns_per_face", "towers.corner_chamfer", "towers.framed_tube_box_column_floor_range", "towers.window_infill", sideId, datumId];
    const glassMeshByHeight = new Map<number, ReturnType<Document["createMesh"]>>();
    for (let i = 0; i + 1 < columnLines.length; i++) {
      const lo = columnLines[i], hi = columnLines[i + 1];
      const h = hi.elevation_ft - lo.elevation_ft - spandrelDepth;
      check(h > 0, `${tower}: story ${lo.key} is not taller than the spandrel`);
      let mesh = glassMeshByHeight.get(h);
      if (!mesh) glassMeshByHeight.set(h, (mesh = doc.createMesh(`glass_${h}ft`).addPrimitive(quadPrimitive(doc, buffer, ftToM(gap), ftToM(h), ftToM(spandrelDepth / 2), matGlass))));
      const batch = instancing.createInstancedMesh().setAttribute("TRANSLATION", gtAcc).setAttribute("ROTATION", grAcc);
      const name = `${tower}_glass_${lo.key}`;
      const node = doc.createNode(name).setMesh(mesh).setTranslation([0, y(lo.elevation_ft), 0]).setExtras({ evidence: evidenceOf(reg, lo.params, tower) });
      node.setExtension("EXT_mesh_gpu_instancing", batch);
      root.addChild(node);
      triangles += 2 * glassPerStory;
      instances += glassPerStory;
      nodes.push({
        name, kind: "glass_story", floor: lo.floor, elevation_ft: lo.elevation_ft, y_m: y(lo.elevation_ft), instances: glassPerStory,
        spans_to: hi.key, spans_to_elevation_ft: hi.elevation_ft,
        params: [...new Set([...glassParams, ...lo.params, ...hi.params])],
        evidence: evidenceOf(reg, lo.params, tower),
        paradata: [PARADATA.glass, PARADATA.materials, PARADATA.frame, ...lo.paradata],
        note: i === 0 ? `One quad per bay, 58 per face: width ${gap * IN_PER_FT} in. is the derived clear gap between steel column faces (40 in. pitch minus 14 in. column), not a cited window width (unresolved towers.window_width; the aluminum column covers made the visible window narrower). Height is the story minus the 52 in. spandrel. The quad stands on the column reference line.` : undefined,
      });
    }
  } else {
    omitted.push({
      what: `${tower}_columns`,
      why: "the framed-tube columns, spandrels and glass run from floor 9 to floor 107, and this tower has no cited elevation for those floors",
      params: ["towers.framed_tube_box_column_floor_range"],
      paradata: [PARADATA.wtc2Schedule, PARADATA.columnExtent],
    });
  }

  // ---- things deliberately not built (record why, with the params that would have been needed)
  const treeTop = "towers.tree_panel_top_elevation";
  const treeBottom = "towers.tree_column_splice_elevation";
  reg.get(treeTop, tower); reg.get(treeBottom, tower);
  omitted.push({
    what: `${tower}_base_columns`,
    why: "the base columns below the tree splice (10 ft on centre, 6 ft 8 in. end bay, 6 ft 11 in. to the corner) have cited positions but no cited plan section; a box cannot be drawn without a width, so nothing is emitted below the tree. The tree transition itself (elevation 363 ft to 418 ft 11 1/2 in.) is also not modelled: no branching geometry, no columns",
    params: ["towers.base_column_spacing_oc", "towers.base_face_bays", "towers.base_face_end_bay", "towers.corner_chamfer", treeBottom, treeTop],
    paradata: [PARADATA.baseColumns],
  });
  for (const id of ["towers.base_column_spacing_oc", "towers.base_face_bays", "towers.base_face_end_bay"]) reg.get(id, tower);
  omitted.push({
    what: `${tower}_hat_truss_zone_columns`,
    why: "exterior columns between floor 107 and the roof exist in the record (hat-truss zone) but their count and spacing there are not parameters in the file",
    params: ["towers.hat_truss_floor_range", "towers.framed_tube_box_column_floor_range"],
    paradata: [PARADATA.columnExtent],
  });
  reg.get("towers.hat_truss_floor_range", tower);
  if (tower === "wtc1") {
    reg.get("wtc1.antenna_height", "wtc1");
    omitted.push({
      what: "wtc1_antenna",
      why: "only the antenna height (360 ft) is cited; base elevation, radius, taper and plan position are not (unresolved wtc1.antenna_geometry)",
      params: ["wtc1.antenna_height"],
      paradata: [PARADATA.antenna],
    });
  } else {
    reg.get("wtc2.antenna_built", tower);
    omitted.push({ what: "wtc2_antenna", why: "WTC 2 had no antenna (wtc2.antenna_built = false)", params: ["wtc2.antenna_built"], paradata: [PARADATA.antenna] });
  }

  return { result: { id: tower, file: `${tower}.glb`, nodes, omitted, triangles, instances, schedule_edges: sched.edges }, doc };
}

// ---------------------------------------------------------------------------
// Encode (uncompressed GLB for the size comparison, then meshopt) + read-back verification
// ---------------------------------------------------------------------------

const MESHOPT_METHOD = "QUANTIZE" as const; // lossless meshopt on the float32 data as emitted; no quantize() pass, so values stay exact

async function encode(doc: Document, tower: TowerId, outPath: string): Promise<{ before: number; after: number; rawPath: string }> {
  mkdirSync(SCRATCH, { recursive: true });
  const rawPath = join(SCRATCH, `${tower}.raw.glb`);
  await new NodeIO().registerExtensions([EXTMeshGPUInstancing]).write(rawPath, doc);

  await MeshoptEncoder.ready;
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod[MESHOPT_METHOD] });
  const io = new NodeIO()
    .registerExtensions([EXTMeshGPUInstancing, EXTMeshoptCompression])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  await io.write(outPath, doc);
  return { before: statSync(rawPath).size, after: statSync(outPath).size, rawPath };
}

interface Inspection { nodes: number; namedNodes: string[]; triangles: number; instances: number; extensions: string[]; arrays: Map<string, Float32Array> }

/** Reads a GLB back through the meshopt decoder and tallies what a viewer would see. */
async function inspect(path: string): Promise<Inspection> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, EXTMeshGPUInstancing])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(path);
  const root = doc.getRoot();
  let triangles = 0, instances = 0;
  const namedNodes: string[] = [];
  const arrays = new Map<string, Float32Array>();
  for (const node of root.listNodes()) {
    if (node.getName()) namedNodes.push(node.getName());
    const mesh = node.getMesh();
    if (!mesh) continue;
    const batch = node.getExtension("EXT_mesh_gpu_instancing") as { getAttribute(s: string): { getCount(): number; getArray(): ArrayLike<number> | null } | null } | null;
    const tAcc = batch ? batch.getAttribute("TRANSLATION") : null;
    const n = tAcc ? tAcc.getCount() : 1;
    if (batch) instances += n;
    if (tAcc && node.getName()) arrays.set(`${node.getName()}:TRANSLATION`, Float32Array.from(tAcc.getArray() ?? []));
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION")!;
      const count = idx ? idx.getCount() : pos.getCount();
      triangles += (count / 3) * n;
      if (node.getName()) arrays.set(`${node.getName()}:POSITION`, Float32Array.from(pos.getArray() ?? []));
    }
  }
  return { nodes: root.listNodes().length, namedNodes, triangles, instances, extensions: root.listExtensionsUsed().map((e) => e.extensionName), arrays };
}

/** Largest absolute difference between the raw and packed copies of every named node's arrays. */
function maxRoundTripError(raw: Inspection, packed: Inspection): number {
  let worst = 0;
  for (const [key, a] of raw.arrays) {
    const b = packed.arrays.get(key);
    if (!b || b.length !== a.length) throw new GeometryError(`${key}: array missing or resized after compression`);
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  }
  return worst;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const file = JSON.parse(readFileSync(PARAMS_FILE, "utf8")) as ParamsFile;
  const reg = new Registry(file);
  const paradata = [
    ...(JSON.parse(readFileSync(PARADATA_FILE, "utf8")) as { id: string }[]),
    ...(existsSync(PARADATA_EXTERIOR_FILE) ? (JSON.parse(readFileSync(PARADATA_EXTERIOR_FILE, "utf8")) as { id: string }[]) : []),
  ];
  const paradataIds = new Set(paradata.map((r) => r.id));
  for (const id of Object.values(PARADATA)) if (!paradataIds.has(id)) throw new GeometryError(`paradata row ${id} is missing from data/paradata.json and data/paradata.exterior.json`);

  mkdirSync(OUT_DIR, { recursive: true });
  const buildings: Record<string, unknown> = {};
  const sizes: Record<string, { raw_bytes: number; packed_bytes: number; max_round_trip_error_m: number }> = {};
  const totals = { raw: 0, packed: 0 };

  for (const tower of ["wtc1", "wtc2"] as TowerId[]) {
    const { result, doc } = await buildTower(reg, tower);
    const outPath = join(OUT_DIR, result.file);
    const size = await encode(doc, tower, outPath);
    const raw = await inspect(size.rawPath);
    const seen = await inspect(outPath);
    // The packed file must still carry every named node, the same counts, and the same numbers.
    for (const n of result.nodes) if (!seen.namedNodes.includes(n.name)) throw new GeometryError(`${tower}: node ${n.name} lost in compressed output`);
    check(seen.instances === result.instances, `${tower}: instances ${seen.instances} after compression != ${result.instances} emitted`);
    check(seen.triangles === result.triangles, `${tower}: triangles ${seen.triangles} after compression != ${result.triangles} emitted`);
    check(seen.extensions.includes("EXT_meshopt_compression"), `${tower}: output is not meshopt-compressed`);
    const err = maxRoundTripError(raw, seen);
    check(err === 0, `${tower}: compression changed a value by ${err} m; the encode must be lossless`);
    sizes[tower] = { raw_bytes: size.before, packed_bytes: size.after, max_round_trip_error_m: err };
    totals.raw += size.before; totals.packed += size.after;

    const usedHere = [...reg.used.entries()].filter(([, s]) => s.has(tower)).map(([id]) => id).sort();
    const citations = [...new Set(usedHere.map((id) => reg.sources.get(reg.raw(id)!.source_id)!.citation))];
    buildings[tower] = {
      id: tower,
      file: result.file,
      url: `/geometry/${result.file}`,
      params: usedHere,
      citations,
      nodes: result.nodes,
      omitted: result.omitted,
      schedule_edges: result.schedule_edges,
      stats: { nodes: seen.nodes, triangles: seen.triangles, instances: seen.instances, raw_bytes: size.before, packed_bytes: size.after, extensions: seen.extensions },
    };
    console.log(`${tower}: ${result.nodes.length} named nodes, ${seen.triangles} triangles, ${seen.instances} instances, ${size.before} B raw -> ${size.after} B packed (${(size.after / 1024).toFixed(1)} KiB)`);
  }

  const params: Record<string, unknown> = {};
  for (const id of [...reg.used.keys()].sort()) {
    const p = reg.raw(id)!;
    params[id] = {
      value: p.value, value_raw: p.value_raw ?? null, unit: p.unit, evidence: p.evidence, applies_to: p.applies_to,
      source_id: p.source_id, citation: reg.sources.get(p.source_id)!.citation, url: reg.sources.get(p.source_id)!.url, locator: p.locator, notes: p.notes,
      used_for: [...reg.used.get(id)!].sort(),
    };
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    generator: "scripts/generate-geometry.ts",
    rule: "Every number in wtc1.glb and wtc2.glb comes from a parameter listed under `params`, by id. Nothing was estimated, scaled, rounded or averaged. Floors and members with no cited dimension are listed under each building's `omitted`.",
    params_file: "data/geometry-params.json",
    paradata_file: "data/paradata.json (P-030 to P-046) and data/paradata.exterior.json (P-060 onward, facade decisions)",
    paradata: Object.values(PARADATA),
    units: {
      gltf: "metres",
      conversion: `1 ft = ${M_PER_FT} m and 1 ft = ${IN_PER_FT} in, exactly. Source values are feet or inches as recorded per param.`,
    },
    frame: {
      x: "east", y: "up", z: "south (north is -z)",
      origin: "centre of the column-reference-line square in plan; y = 0 at the floor 1 (Concourse) line, param towers.floor_1_elevation",
      elevations: "elevation_ft on each node is the drawing datum of NCSTAR 1-1 Figure 2-2 / 2-3 (Concourse = 310 ft), not sea level",
      tower_positions: "unresolved (complex.tower_positions_and_spacing): each file is in its own local frame; the viewer places the two towers",
      paradata: PARADATA.frame,
    },
    node_naming: {
      floor_plate: "<building>_floor_<NNN>  (three-digit floor number, e.g. wtc1_floor_042); one thin box per cited floor line, top face on the floor line",
      roof_plate: "<building>_roof",
      sublevel_plate: "<building>_sublevel_<n> and <building>_service_level, labelled per the NCSTAR 1-2A drawing index (B1 in Table G-1 = service level EL. 294; see P-042)",
      core_segment: "<building>_core_<key>  (one centred box between consecutive cited lines; key is the three-digit floor at the bottom of the segment, e.g. wtc1_core_042, or the sub-level label below grade, e.g. wtc1_core_sublevel_5)",
      column_story: "<building>_columns_<NNN>  (one EXT_mesh_gpu_instancing node per story from the floor NNN line to the next cited floor line, 236 instances each; instances are not individually named)",
      spandrel_line: "<building>_spandrels_<NNN>  (one EXT_mesh_gpu_instancing node per column line 9 to 107, 4 instances: one 52 in. deep box per face centred on the floor line; P-060)",
      glass_story: "<building>_glass_<NNN>  (one EXT_mesh_gpu_instancing node per story 9 to 107, 232 quads: one per bay per face, standing on the column reference line between spandrels; P-061)",
      detail_nodes: "core_<NNN>, columns_<NNN>, spandrels_<NNN> and glass_<NNN> match parseDetailNodeName() in lib/geometry-naming.ts, so the viewer can hide them per floor on a reduced tier",
      building_root: "<building>",
      materials: "plate, core, column_cladding, spandrel_cladding, glass (named; the viewer replaces plate materials per floor). Cladding and infill materials are cited (towers.exterior_cladding_material, towers.window_infill); the colours are rendering choices, P-062.",
    },
    derived: {
      window_clear_gap_in: IN_PER_FT * (reg.ft("towers.perimeter_column_spacing_oc", "wtc1") - reg.ft("towers.perimeter_column_outer_web_width", "wtc1")),
      derived_from: ["towers.perimeter_column_spacing_oc", "towers.perimeter_column_outer_web_width"],
      note: "The glass quads are this wide. It is the clear gap between steel column faces, computed here from two cited values; the window width itself is unresolved (towers.window_width) and the visible opening was narrower because the aluminum column covers were wider than the steel (towers.spandrel_cover_and_cladding_dimensions, unresolved). Paradata P-061.",
    },
    pipeline: {
      writer: "@gltf-transform/core NodeIO",
      compression: `EXT_meshopt_compression, method ${MESHOPT_METHOD}, encoded with meshoptimizer's MeshoptEncoder (no quantize() pass, so every value is the float32 the generator computed). Draco is not used.`,
      gltfpack: "not run. gltfpack rewrites EXT_mesh_gpu_instancing input into one unnamed node per mesh at the scene root regardless of -kn / -mi (verified 2026-09-11), which would drop the per-story wtc1_columns_NNN nodes the viewer hides per floor. Use it later for KTX2 (-tc) on textured assets that carry no instancing.",
      textures: "none, so no KTX2 yet",
      sizes: { ...sizes, total_raw_bytes: totals.raw, total_packed_bytes: totals.packed },
      verification: "compressed files are read back with the meshopt decoder; node names, triangle and instance counts, and every named node's POSITION / TRANSLATION array must match the uncompressed file exactly",
    },
    buildings,
    params,
    unresolved_relevant: file.unresolved.filter((u) => ["wtc2.story_height_schedule", "towers.base_column_section", "towers.floor_7_elevation", "towers.floor_9_elevation", "wtc1.antenna_geometry", "towers.corner_column_detail", "towers.window_width", "complex.tower_positions_and_spacing", "towers.core_plan_dimensions_exact", "towers.penthouse_and_roof_geometry"].includes(u.id)),
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${Object.keys(params).length} params cited, ${Object.values(PARADATA).length} paradata rows referenced`);
  console.log(`total: ${totals.raw} B raw -> ${totals.packed} B packed (${(totals.packed / 1024).toFixed(1)} KiB)`);
}

main().catch((err) => {
  console.error(err instanceof GeometryError ? `generate-geometry: ${err.message}` : err);
  process.exit(1);
});
