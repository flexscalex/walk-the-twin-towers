// scripts/validate-tenants.ts
// Checks data/tenants.clean.json against the raw CNN HTML and the SCHEMA.md
// contract, then prints coverage stats. Exits 1 on any failure.
//
// Run:  node --experimental-strip-types scripts/validate-tenants.ts

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_TOTAL = 329;                 // SOURCE.md; a change here is a change in the source
const TOWER_FLOORS = 110;                   // wtc1 and wtc2 only; 4/5/6/7 are not floor-gap checked
const EVIDENCE = new Set(["documented", "corroborated", "reported", "unknown"]);

const failures: string[] = [];
const fail = (m: string) => { failures.push(m); };

const data = JSON.parse(readFileSync(resolve(ROOT, "data/tenants.clean.json"), "utf8"));
const tenants: any[] = data.tenants;
const buildings: any[] = data.buildings;
const floorCodes = new Set(Object.keys(data.floor_codes));
const sourceIds = new Set((data.sources as any[]).map((s) => s.id));

// ---- 1. Row counts: independent count of data rows in each HTML table.
// Deliberately a different method from the parser: strip all tags from each
// <tr>, count the ones with any text, subtract the header.
function htmlDataRowCount(file: string): number {
  const html = readFileSync(resolve(ROOT, file), "latin1");
  const open = html.search(/<table\b[^>]*\bwidth=600\b[^>]*style='border-collapse:\s*collapse;table-layout:fixed'>/);
  if (open < 0) { fail(`${file}: tenant table not found`); return -1; }
  const body = html.slice(open, html.indexOf("</table>", open));
  const trs = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  const nonEmpty = trs.filter((tr) => tr.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() !== "");
  return nonEmpty.length - 1; // header
}

// Re-read the raw cells of one row so name/raw fields can be compared verbatim.
function htmlRows(file: string): string[][] {
  const html = readFileSync(resolve(ROOT, file), "latin1");
  const open = html.search(/<table\b[^>]*\bwidth=600\b[^>]*style='border-collapse:\s*collapse;table-layout:fixed'>/);
  const body = html.slice(open, html.indexOf("</table>", open));
  const trs = body.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
  return trs
    .map((tr) => [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1].replace(/&amp;/g, "&").replace(/\s+/g, " ").trim()))
    .filter((cells) => cells.some((c) => c !== ""))
    .slice(1);
}

const byBuilding = new Map<string, any[]>();
for (const t of tenants) {
  if (!byBuilding.has(t.building_id)) byBuilding.set(t.building_id, []);
  byBuilding.get(t.building_id)!.push(t);
}

for (const b of buildings) {
  const rows = byBuilding.get(b.id) ?? [];
  const htmlCount = htmlDataRowCount(b.source_file);
  if (htmlCount !== b.tenant_count) fail(`${b.id}: HTML has ${htmlCount} data rows, buildings[].tenant_count says ${b.tenant_count}`);
  if (rows.length !== b.tenant_count) fail(`${b.id}: ${rows.length} tenants in file, buildings[].tenant_count says ${b.tenant_count}`);
  const sum = rows.reduce((s, t) => s + (t.sq_ft ?? 0), 0);
  if (sum !== b.sq_ft_total) fail(`${b.id}: sq_ft_total ${b.sq_ft_total} != sum of rows ${sum}`);
  if (!Array.isArray(b.column_order) || b.column_order.length !== 4) fail(`${b.id}: column_order malformed`);

  // Verbatim comparison of every row against the HTML using the recorded column order.
  const raw = htmlRows(b.source_file);
  const idx = (f: string) => b.column_order.indexOf(f);
  rows.forEach((t, i) => {
    const cells = raw[t.source_row - 1];
    if (!cells) { fail(`${t.id}: no HTML row at source_row ${t.source_row}`); return; }
    if (cells.length === 4 && !t.raw_cells?.length) {
      const want = { name: cells[idx("tenant")], sq_ft_raw: cells[idx("sq_ft")], industry_raw: cells[idx("industry")], floor_raw: cells[idx("floor")] };
      for (const [k, v] of Object.entries(want)) if (t[k] !== v) fail(`${t.id}: ${k} ${JSON.stringify(t[k])} != HTML ${JSON.stringify(v)}`);
    }
    if (t.source_row !== i + 1) fail(`${t.id}: source_row ${t.source_row} out of sequence (expected ${i + 1})`);
  });
}
if (tenants.length !== EXPECTED_TOTAL) fail(`total tenants ${tenants.length} != expected ${EXPECTED_TOTAL}`);
if (data.meta?.tenant_count !== tenants.length) fail(`meta.tenant_count ${data.meta?.tenant_count} != ${tenants.length}`);

// ---- 2. Per-row contract.
const ids = new Set<string>();
for (const t of tenants) {
  if (ids.has(t.id)) fail(`${t.id}: duplicate id`);
  ids.add(t.id);
  if (!/^wtc[1-7]-\d{3}$/.test(t.id)) fail(`${t.id}: bad id format`);
  if (t.id !== `${t.building_id}-${String(t.source_row).padStart(3, "0")}`) fail(`${t.id}: id does not match building_id + source_row`);
  if (!Number.isInteger(t.source_row) || t.source_row < 1) fail(`${t.id}: source_row missing or invalid`);
  if (!t.source_id || !sourceIds.has(t.source_id)) fail(`${t.id}: source_id missing or unknown`);
  if (!EVIDENCE.has(t.evidence)) fail(`${t.id}: evidence ${JSON.stringify(t.evidence)} not on the scale`);
  if (typeof t.sq_ft_raw !== "string") fail(`${t.id}: sq_ft_raw must be a string`);
  // sq_ft parses: int iff raw is digits/commas; null iff raw is "" or "N/A".
  const digits = /^\d{1,3}(,\d{3})+$|^\d+$/.test(t.sq_ft_raw);
  if (digits) {
    if (t.sq_ft !== Number(t.sq_ft_raw.replace(/,/g, ""))) fail(`${t.id}: sq_ft ${t.sq_ft} != raw ${t.sq_ft_raw}`);
  } else if (t.sq_ft_raw === "" || t.sq_ft_raw === "N/A") {
    if (t.sq_ft !== null) fail(`${t.id}: sq_ft should be null for raw ${JSON.stringify(t.sq_ft_raw)}`);
  } else if (!t.raw_cells) fail(`${t.id}: unparseable sq_ft_raw ${JSON.stringify(t.sq_ft_raw)} without raw_cells`);
  if (t.industry === "" ) fail(`${t.id}: blank industry must be null`);
  if ((t.industry ?? "") !== t.industry_raw) fail(`${t.id}: industry/industry_raw mismatch`);
  // floors: integers or known codes only.
  if (!Array.isArray(t.floors)) fail(`${t.id}: floors not an array`);
  for (const f of t.floors) if (!(/^\d+$/.test(f) || floorCodes.has(f))) fail(`${t.id}: floor ${JSON.stringify(f)} is neither an integer nor a known code`);
  if (t.floor_unresolved !== null && typeof t.floor_unresolved !== "string") fail(`${t.id}: floor_unresolved must be null or string`);
  if (t.floor_raw !== "" && t.floors.length === 0 && t.floor_unresolved === null) fail(`${t.id}: floor_raw ${JSON.stringify(t.floor_raw)} produced neither floors nor floor_unresolved`);
  if (t.floor_raw === "" && (t.floors.length || t.floor_unresolved)) fail(`${t.id}: floors present with empty floor_raw`);
  if (t.name === null && !t.raw_cells) fail(`${t.id}: null name without raw_cells`);
}

// ---- 3. Coverage stats.
const pct = (n: number, d: number) => d ? `${((100 * n) / d).toFixed(1)}%` : "n/a";
const ranges = (nums: number[]) => {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j;
  }
  return out.join(", ");
};

console.log("Coverage (data/tenants.clean.json)");
console.log("building  rows  numeric-floor  sq_ft-present     sq_ft-total");
let grand = 0;
for (const b of buildings) {
  const rows = byBuilding.get(b.id) ?? [];
  const numeric = rows.filter((t) => t.floors.some((f: string) => /^\d+$/.test(f))).length;
  const withSf = rows.filter((t) => t.sq_ft !== null).length;
  grand += b.sq_ft_total;
  console.log(`${b.id.padEnd(8)}  ${String(rows.length).padStart(4)}  ${pct(numeric, rows.length).padStart(13)}  ${pct(withSf, rows.length).padStart(13)}  ${b.sq_ft_total.toLocaleString("en-US").padStart(14)}`);
}
const allNumeric = tenants.filter((t) => t.floors.some((f: string) => /^\d+$/.test(f))).length;
const allSf = tenants.filter((t) => t.sq_ft !== null).length;
console.log(`${"all".padEnd(8)}  ${String(tenants.length).padStart(4)}  ${pct(allNumeric, tenants.length).padStart(13)}  ${pct(allSf, tenants.length).padStart(13)}  ${grand.toLocaleString("en-US").padStart(14)}`);
console.log(`unresolved floor tokens: ${tenants.filter((t) => t.floor_unresolved !== null).length} rows; rows with raw_cells: ${tenants.filter((t) => t.raw_cells).map((t) => t.id).join(", ") || "none"}`);

for (const id of ["wtc1", "wtc2"]) {
  const rows = byBuilding.get(id) ?? [];
  const occupied = new Set<number>();
  for (const t of rows) for (const f of t.floors) if (/^\d+$/.test(f)) occupied.add(Number(f));
  const over = [...occupied].filter((f) => f < 1 || f > TOWER_FLOORS);
  if (over.length) fail(`${id}: floors outside 1-${TOWER_FLOORS}: ${over.join(",")}`);
  const gaps: number[] = [];
  for (let f = 1; f <= TOWER_FLOORS; f++) if (!occupied.has(f)) gaps.push(f);
  console.log(`${id}: ${occupied.size} of ${TOWER_FLOORS} floors have >=1 named tenant; gaps (${gaps.length}): ${ranges(gaps) || "none"}`);
}

if (failures.length) {
  console.error(`\nFAILED: ${failures.length} problem(s)`);
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log("\nOK: all checks passed");
