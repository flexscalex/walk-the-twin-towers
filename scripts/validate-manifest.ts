// scripts/validate-manifest.ts
// Checks public/geometry/manifest.json (written by scripts/generate-geometry.ts)
// against data/geometry-params.json and data/paradata.json: every param id the
// manifest cites must exist with a locator, every paradata id it cites must
// exist, every node name must follow lib/geometry-naming.ts, and the .glb files
// it points at must exist and stay inside the Phase 1 size budget. Exits 1 on
// any failure. Skips with exit 0 (and says so) when no manifest has been
// generated yet, because .glb files are build outputs, not source.
//
// Run:  node --experimental-strip-types scripts/validate-manifest.ts

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = resolve(ROOT, "public/geometry/manifest.json");
const GEOMETRY_DIR = resolve(ROOT, "public/geometry");
const PARAMS_FILE = resolve(ROOT, "data/geometry-params.json");
const PARADATA_FILE = resolve(ROOT, "data/paradata.json");
const PARADATA_EXTERIOR_FILE = resolve(ROOT, "data/paradata.exterior.json"); // facade decisions, P-060 onward
const SIZE_BUDGET_BYTES = 5 * 1024 * 1024; // Phase 1 target: both towers well under 5 MB

const NODE_RE = /^(wtc[12])(?:_floor_\d{3}|_roof|_sublevel_[1-5]|_service_level|_core_(?:\d{3}|sublevel_[1-5]|service_level)|_columns_\d{3}|_spandrels_\d{3}|_glass_\d{3})$/;
const OMITTED_RE = /^(wtc[12])_[a-z0-9_]+$/;

const failures: string[] = [];
const fail = (m: string) => { failures.push(m); };

if (!existsSync(MANIFEST)) {
  console.log(`${MANIFEST}: not generated yet (run pnpm generate:geometry); skipping`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const params = JSON.parse(readFileSync(PARAMS_FILE, "utf8"));
const paradata = [
  ...(JSON.parse(readFileSync(PARADATA_FILE, "utf8")) as { id: string }[]),
  ...(existsSync(PARADATA_EXTERIOR_FILE) ? (JSON.parse(readFileSync(PARADATA_EXTERIOR_FILE, "utf8")) as { id: string }[]) : []),
];
const paramById = new Map<string, any>((params.params as any[]).map((p) => [p.id, p]));
const paradataIds = new Set(paradata.map((r) => r.id));

function checkParamIds(ids: unknown, where: string): void {
  if (!Array.isArray(ids)) { fail(`${where}: params is not an array`); return; }
  for (const id of ids) {
    const p = paramById.get(String(id));
    if (!p) { fail(`${where}: param ${id} not in data/geometry-params.json`); continue; }
    if (!p.locator || !Number.isInteger(p.locator.pdf_page) || !p.locator.quote) fail(`${where}: param ${id} has no locator`);
    if (p.evidence === "unknown") fail(`${where}: param ${id} has evidence "unknown"`);
  }
}
function checkParadataIds(ids: unknown, where: string): void {
  if (!Array.isArray(ids)) { fail(`${where}: paradata is not an array`); return; }
  for (const id of ids) if (!paradataIds.has(String(id))) fail(`${where}: paradata row ${id} not in data/paradata.json`);
}

// ---- top level
if (typeof manifest.generated_at !== "string") fail("manifest: missing generated_at");
checkParadataIds(manifest.paradata, "manifest.paradata");
if (!manifest.params || typeof manifest.params !== "object") fail("manifest: missing params map");
else checkParamIds(Object.keys(manifest.params), "manifest.params");

// ---- buildings
const buildings = manifest.buildings ?? {};
let totalBytes = 0;
const seenTowers = new Set<string>();
for (const id of ["wtc1", "wtc2"]) {
  const b = buildings[id];
  if (!b) { fail(`manifest: no building ${id}`); continue; }
  seenTowers.add(id);
  const glb = resolve(GEOMETRY_DIR, String(b.file));
  if (!existsSync(glb)) fail(`${id}: ${b.file} does not exist (run pnpm generate:geometry)`);
  else totalBytes += statSync(glb).size;
  checkParamIds(b.params, `${id}.params`);
  if (!Array.isArray(b.citations) || b.citations.length === 0) fail(`${id}: no citations listed`);

  if (!Array.isArray(b.nodes) || b.nodes.length === 0) fail(`${id}: no nodes`);
  else {
    const names = new Set<string>();
    for (const n of b.nodes) {
      const name = String(n.name);
      if (names.has(name)) fail(`${id}: duplicate node ${name}`);
      names.add(name);
      const m = NODE_RE.exec(name);
      if (!m || m[1] !== id) fail(`${id}: node ${name} does not follow the naming convention`);
      if (!Array.isArray(n.params) || n.params.length === 0) fail(`${id}: node ${name} cites no params`);
      else checkParamIds(n.params, `${id}.${name}`);
      checkParadataIds(n.paradata, `${id}.${name}`);
      if (n.kind === "floor_plate") {
        const f = Number(n.floor);
        if (!Number.isInteger(f) || name !== `${id}_floor_${String(f).padStart(3, "0")}`) fail(`${id}: floor plate ${name} / floor ${n.floor} mismatch`);
      }
      if (typeof n.elevation_ft !== "number") fail(`${id}: node ${name} has no elevation_ft`);
    }
    if (!names.has(`${id}_floor_001`)) fail(`${id}: floor 1 plate missing`);
    if (!names.has(`${id}_roof`)) fail(`${id}: roof plate missing`);
    if (![...names].some((n) => n.startsWith(`${id}_core_`))) fail(`${id}: core segments missing`);
  }

  if (!Array.isArray(b.omitted)) fail(`${id}: omitted is not an array`);
  else {
    for (const o of b.omitted) {
      const what = String(o.what);
      if (!OMITTED_RE.test(what) || !what.startsWith(`${id}_`)) fail(`${id}: omitted entry ${what} is not named for this building`);
      if (typeof o.why !== "string" || o.why.length < 20) fail(`${id}: omitted ${what} has no reason`);
      checkParamIds(o.params, `${id}.omitted.${what}`);
      checkParadataIds(o.paradata, `${id}.omitted.${what}`);
    }
    // Every floor 1..stories_above_concourse is either a node or an omission, never silent.
    const stories = paramById.get("towers.stories_above_concourse")?.value;
    if (Number.isInteger(stories)) {
      const nodeFloors = new Set((b.nodes as any[]).filter((n) => n.kind === "floor_plate").map((n) => Number(n.floor)));
      const omittedFloors = new Set((b.omitted as any[]).map((o) => /_floor_(\d{3})$/.exec(String(o.what))?.[1]).filter(Boolean).map(Number));
      for (let f = 1; f <= stories; f++) {
        if (nodeFloors.has(f) && omittedFloors.has(f)) fail(`${id}: floor ${f} is both a node and omitted`);
        if (!nodeFloors.has(f) && !omittedFloors.has(f)) fail(`${id}: floor ${f} is neither a node nor listed as omitted`);
      }
    }
  }
  const s = b.stats ?? {};
  if (!Number.isInteger(s.triangles) || !Number.isInteger(s.instances)) fail(`${id}: stats missing triangles/instances`);
  if (Array.isArray(s.extensions) && !s.extensions.includes("EXT_meshopt_compression")) fail(`${id}: .glb is not meshopt-compressed`);
}
// ---- city context (optional; written by scripts/generate-context.ts after the towers)
if (manifest.context) {
  const c = manifest.context;
  const glb = resolve(GEOMETRY_DIR, String(c.file));
  if (!existsSync(glb)) fail(`context: ${c.file} does not exist (run pnpm generate:context)`);
  else totalBytes += statSync(glb).size;
  if (!Array.isArray(c.sources) || c.sources.length === 0) fail("context: no sources listed");
  else for (const s of c.sources) if (!s.dataset_id || !s.url || !s.retrieved_at || !s.filter) fail(`context: source ${s.id ?? "?"} lacks dataset_id / url / retrieved_at / filter`);
  if (typeof c.gap !== "string" || c.gap.length < 40) fail("context: the gap statement is missing");
  checkParadataIds(c.paradata, "context.paradata");
  if (!Number.isInteger(c.buildings) || c.buildings < 1) fail("context: no buildings");
  console.log(`  context: ${c.buildings} buildings, ${c.stats?.triangles} tris, ${c.stats?.packed_bytes} B`);
}
if (totalBytes > SIZE_BUDGET_BYTES) fail(`total .glb size ${totalBytes} B exceeds the ${SIZE_BUDGET_BYTES} B Phase 1 budget`);

const nParams = manifest.params ? Object.keys(manifest.params).length : 0;
console.log(`manifest: ${seenTowers.size} buildings, ${nParams} params cited, ${totalBytes} B of .glb`);
for (const id of seenTowers) {
  const b = buildings[id];
  console.log(`  ${id}: ${b.nodes.length} nodes, ${b.omitted.length} omitted, ${b.stats?.triangles} tris, ${b.stats?.instances} instances, ${b.stats?.packed_bytes} B`);
}
if (failures.length) {
  console.error(`\n${MANIFEST}: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${MANIFEST}: OK`);
