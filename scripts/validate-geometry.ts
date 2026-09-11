// scripts/validate-geometry.ts
// Enforces CLAUDE.md hard rule 3 on data/geometry-params.json: every parameter
// must carry a source_id that resolves to an entry in `sources`, a locator with
// a pdf_page and a verbatim quote, and an evidence level. Prints a table of
// id / value / unit / page and exits 1 on any failure.
//
// Run:  node --experimental-strip-types scripts/validate-geometry.ts

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "data/geometry-params.json";
const EVIDENCE = new Set(["documented", "corroborated", "reported", "unknown"]);
const APPLIES_TO = new Set(["wtc1", "wtc2", "towers", "complex"]);

const failures: string[] = [];
const fail = (m: string) => { failures.push(m); };

const data = JSON.parse(readFileSync(resolve(ROOT, FILE), "utf8"));

// ---- sources
const sources: any[] = Array.isArray(data.sources) ? data.sources : [];
if (sources.length === 0) fail("sources: empty");
const sourceIds = new Set<string>();
for (const s of sources) {
  if (typeof s.id !== "string" || s.id === "") { fail("sources: entry without id"); continue; }
  if (sourceIds.has(s.id)) fail(`sources: duplicate id ${s.id}`);
  sourceIds.add(s.id);
  if (typeof s.citation !== "string" || s.citation === "") fail(`sources[${s.id}]: missing citation`);
  if (typeof s.url !== "string" || s.url === "") fail(`sources[${s.id}]: missing url`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.retrieved_at))) fail(`sources[${s.id}]: retrieved_at is not YYYY-MM-DD`);
}

// ---- params
const params: any[] = Array.isArray(data.params) ? data.params : [];
if (params.length === 0) fail("params: empty");
const seen = new Set<string>();
for (const [i, p] of params.entries()) {
  const label = typeof p.id === "string" && p.id !== "" ? p.id : `params[${i}]`;
  if (typeof p.id !== "string" || p.id === "") fail(`${label}: missing id`);
  else if (seen.has(p.id)) fail(`${label}: duplicate id`);
  seen.add(p.id);

  if (!APPLIES_TO.has(p.applies_to)) fail(`${label}: applies_to must be one of ${[...APPLIES_TO].join("|")}, got ${JSON.stringify(p.applies_to)}`);
  if (p.value === undefined || p.value === null || p.value === "") fail(`${label}: missing value`);
  if (!("unit" in p)) fail(`${label}: missing unit (use null for dimensionless or string values)`);
  if (!EVIDENCE.has(p.evidence)) fail(`${label}: evidence must be one of ${[...EVIDENCE].join("|")}, got ${JSON.stringify(p.evidence)}`);

  if (typeof p.source_id !== "string" || p.source_id === "") fail(`${label}: missing source_id`);
  else if (!sourceIds.has(p.source_id)) fail(`${label}: source_id ${p.source_id} not in sources`);

  const loc = p.locator;
  if (!loc || typeof loc !== "object") { fail(`${label}: missing locator`); continue; }
  if (!Number.isInteger(loc.pdf_page) || loc.pdf_page < 1) fail(`${label}: locator.pdf_page must be a positive integer`);
  if (typeof loc.printed_page !== "string" || loc.printed_page === "") fail(`${label}: locator.printed_page must be a non-empty string`);
  if (typeof loc.section !== "string" || loc.section === "") fail(`${label}: locator.section must be a non-empty string`);
  // Figure callouts can be as short as "14" or "104'", so only emptiness is rejected here.
  if (typeof loc.quote !== "string" || loc.quote.trim().length === 0) fail(`${label}: locator.quote must be a verbatim quote from the source`);
  if (!("notes" in p)) fail(`${label}: missing notes (use null)`);
}

// ---- unresolved
const unresolved: any[] = Array.isArray(data.unresolved) ? data.unresolved : [];
for (const [i, u] of unresolved.entries()) {
  const label = typeof u.id === "string" ? u.id : `unresolved[${i}]`;
  if (typeof u.id !== "string" || u.id === "") fail(`unresolved[${i}]: missing id`);
  if (seen.has(u.id)) fail(`${label}: listed as both a param and unresolved`);
  if (typeof u.why !== "string" || u.why === "") fail(`${label}: missing why`);
  if (typeof u.where_to_look !== "string" || u.where_to_look === "") fail(`${label}: missing where_to_look`);
}

// ---- table
const rows = params.map((p) => ({
  id: String(p.id),
  value: typeof p.value === "object" ? JSON.stringify(p.value) : String(p.value),
  unit: p.unit === null || p.unit === undefined ? "" : String(p.unit),
  page: p.locator && Number.isInteger(p.locator.pdf_page) ? `${p.source_id ?? "?"} p${p.locator.pdf_page}` : "?",
}));
const w = {
  id: Math.max(2, ...rows.map((r) => r.id.length)),
  value: Math.min(40, Math.max(5, ...rows.map((r) => r.value.length))),
  unit: Math.max(4, ...rows.map((r) => r.unit.length)),
  page: Math.max(4, ...rows.map((r) => r.page.length)),
};
const line = (a: string, b: string, c: string, d: string) =>
  `${a.padEnd(w.id)}  ${b.slice(0, w.value).padEnd(w.value)}  ${c.padEnd(w.unit)}  ${d.padEnd(w.page)}`;
console.log(line("id", "value", "unit", "page"));
console.log(line("-".repeat(w.id), "-".repeat(w.value), "-".repeat(w.unit), "-".repeat(w.page)));
for (const r of rows) console.log(line(r.id, r.value, r.unit, r.page));
console.log(`\n${params.length} params, ${unresolved.length} unresolved, ${sources.length} sources`);

if (failures.length) {
  console.error(`\n${FILE}: ${failures.length} failure(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${FILE}: OK`);
