// scripts/parse-cnn.ts
// Re-parses the six archived CNN "List of World Trade Center tenants" pages
// (data/cnn_t1.html ... cnn_t7.html) into data/tenants.clean.json and writes the
// parser's interpretive decisions to data/paradata.json.
//
// Run:  node --experimental-strip-types scripts/parse-cnn.ts
// Deps: none (Node 22 stdlib only).
//
// Contract: data/SCHEMA.md. Rule: no field is ever inferred. Anything the markup
// does not state stays null and gets a paradata row.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_TENANTS = resolve(ROOT, "data/tenants.clean.json");
const OUT_PARADATA = resolve(ROOT, "data/paradata.json");

const SOURCE_ID = "cnn-2001-09-13";
const RETRIEVED_AT = "2026-09-10";
const DECIDED_AT = "2026-09-10";
const DECIDED_BY = "Claude (Fable 5.1); human review: pending";

const FLOOR_CODES: Record<string, string> = {
  CNCR: "Concourse",
  LBBY: "Lobby",
  BSMT: "Basement",
  GRND: "Ground",
  LL: "Lower level",
  PLAZ: "Plaza",
};

type Field = "tenant" | "sq_ft" | "industry" | "floor";

// Header label (verbatim from the CNN pages) -> field. The column order of each
// table is read from its own header row, never assumed.
const HEADER_TO_FIELD: Record<string, Field> = {
  "Tenant": "tenant",
  "SF Leased": "sq_ft",
  "Square Feet Leased": "sq_ft",
  "Industry": "industry",
  "Floor": "floor",
};

// What the lead verified by eye. The parser derives the order from the header
// and then asserts it matches this, so the paradata claim can never drift from
// the data silently.
const EXPECTED_ORDER: Record<string, Field[]> = {
  wtc1: ["tenant", "sq_ft", "industry", "floor"],
  wtc2: ["tenant", "sq_ft", "industry", "floor"],
  wtc4: ["tenant", "sq_ft", "floor", "industry"],
  wtc5: ["tenant", "sq_ft", "floor", "industry"],
  wtc6: ["tenant", "sq_ft", "floor", "industry"],
  wtc7: ["tenant", "sq_ft", "floor", "industry"],
};

const FILES = [1, 2, 4, 5, 6, 7].map((n) => ({
  n,
  id: `wtc${n}`,
  name: `${n} World Trade Center`,
  file: `data/cnn_t${n}.html`,
}));

interface Tenant {
  id: string;
  building_id: string;
  name: string | null;
  sq_ft: number | null;
  sq_ft_raw: string;
  industry: string | null;
  industry_raw: string;
  floor_raw: string;
  floors: string[];
  floor_unresolved: string | null;
  evidence: "documented";
  source_id: string;
  source_row: number;
  raw_cells?: string[];
}

interface Building {
  id: string;
  name: string;
  cnn_label: string;
  source_file: string;
  source_url: string | null;
  column_order: Field[];
  tenant_count: number;
  sq_ft_total: number;
  padding_rows_dropped: number;
}

interface Paradata {
  id: string;
  subject: string;
  decision: string;
  reasoning: string;
  decided_by: string;
  decided_at: string;
}

// ---------------------------------------------------------------- helpers

function fail(msg: string): never {
  throw new Error(`parse-cnn: ${msg}`);
}

// Only the entities that actually occur in these files are handled explicitly;
// anything else is left verbatim and reported, never silently mangled.
function decodeEntities(s: string, where: string): string {
  return s.replace(/&(amp|lt|gt|quot|nbsp|#39|#\d+);/g, (m, e: string) => {
    switch (e) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "nbsp": return " ";
      case "#39": return "'";
      default:
        if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
        fail(`unhandled entity ${m} in ${where}`);
    }
  });
}

function cellText(inner: string, where: string): string {
  if (/<[a-zA-Z/!]/.test(inner)) fail(`nested markup inside a <td> at ${where}: ${JSON.stringify(inner)}`);
  return decodeEntities(inner, where).replace(/\s+/g, " ").trim();
}

interface RawRow { cells: string[]; attrs: string[] }

function extractTable(html: string, file: string): { rows: RawRow[]; headerRaw: string[] } {
  const open = /<table\b[^>]*\bwidth=600\b[^>]*style='border-collapse:\s*collapse;table-layout:fixed'>/g;
  const matches = [...html.matchAll(open)];
  if (matches.length !== 1) fail(`${file}: expected exactly one tenant table, found ${matches.length}`);
  const start = matches[0].index! + matches[0][0].length;
  const end = html.indexOf("</table>", start);
  if (end < 0) fail(`${file}: unterminated tenant table`);
  const body = html.slice(start, end);
  if (/<table\b/i.test(body)) fail(`${file}: nested <table> inside tenant table`);

  const rows: RawRow[] = [];
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    const attrs: string[] = [];
    for (const td of tr[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
      const a = td[1];
      if (/\b(colspan|rowspan)\b/i.test(a)) fail(`${file}: colspan/rowspan in row ${rows.length + 1}; markup shape not handled`);
      attrs.push(a.trim());
      cells.push(cellText(td[2], `${file} row ${rows.length + 1}`));
    }
    rows.push({ cells, attrs });
  }
  if (rows.length < 2) fail(`${file}: table has no rows`);
  return { rows, headerRaw: rows[0].cells };
}

function columnOrderFromHeader(header: string[], file: string): Field[] {
  const order = header.map((h) => {
    const f = HEADER_TO_FIELD[h];
    if (!f) fail(`${file}: unknown header cell ${JSON.stringify(h)}`);
    return f;
  });
  const seen = new Set(order);
  if (order.length !== 4 || seen.size !== 4) fail(`${file}: header does not name four distinct fields: ${header.join(" | ")}`);
  return order;
}

function parseSqFt(raw: string): { value: number | null; ok: boolean } {
  if (raw === "" || raw === "N/A") return { value: null, ok: true };
  if (/^\d{1,3}(,\d{3})+$/.test(raw) || /^\d+$/.test(raw)) return { value: Number(raw.replace(/,/g, "")), ok: true };
  return { value: null, ok: false };
}

function parseFloors(raw: string): { floors: string[]; unresolved: string[] } {
  const floors: string[] = [];
  const unresolved: string[] = [];
  if (raw === "") return { floors, unresolved };
  for (const tok0 of raw.split(",")) {
    const tok = tok0.trim();
    if (tok === "") { unresolved.push(tok0); continue; }
    if (/^\d+$/.test(tok)) { floors.push(String(Number(tok))); continue; }
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      if (a <= b) { for (let f = a; f <= b; f++) floors.push(String(f)); continue; }
      unresolved.push(tok); continue;           // descending range: do not guess the intent
    }
    if (tok in FLOOR_CODES) { floors.push(tok); continue; }
    unresolved.push(tok);
  }
  return { floors, unresolved };
}

// The original CNN URL is reconstructed only from strings present in the file:
// the site-root-relative link to tenants1.html gives the directory, the Akamai
// asset paths embed the host (www.cnn.com) with the same directory, and the
// page's own nav must link to tenants<n>.html. If any piece is absent -> null.
function recoverSourceUrl(html: string, n: number): string | null {
  const dirMatch = html.match(/href="(\/SPECIALS\/2001\/trade\.center)\/tenants1\.html"/i);
  const hostMatch = html.match(/\/(www\.cnn\.com)\/SPECIALS\/2001\/trade\.center\//i);
  const selfLink = new RegExp(`href="tenants${n}\\.html"`, "i").test(html);
  if (!dirMatch || !hostMatch || !selfLink) return null;
  return `http://${hostMatch[1]}${dirMatch[1]}/tenants${n}.html`;
}

function recoverArchivedUrl(html: string): string | null {
  const m = html.match(/https?:\/\/web\.archive\.org\/web\/\d{4,14}[a-z_]*\/[^"'\s<>]+/i);
  return m ? m[0] : null;
}

function cnnLabel(html: string, file: string): string {
  const m = [...html.matchAll(/<B>Building:\s*([^<]*)<\/B>/g)];
  if (m.length !== 1) fail(`${file}: expected one "Building:" label, found ${m.length}`);
  return decodeEntities(m[0][1], `${file} label`).replace(/\s+/g, " ").trim();
}

function assertCoStarCredit(html: string, file: string): void {
  if (!/Tenant List provided by CoStar Group, Inc\./.test(html)) fail(`${file}: CoStar credit line missing`);
}

// ---------------------------------------------------------------- main

const buildings: Building[] = [];
const tenants: Tenant[] = [];
const anomalies: Paradata[] = [];          // one row per row-level interpretive call
let anomalyCounter = 30;                    // dynamic rows start at P-030
const nextAnomalyId = () => `P-${String(anomalyCounter++).padStart(3, "0")}`;

const paddingByFile: Record<string, number> = {};
const archivedUrls: Record<string, string | null> = {};
// Verified 2026-09-10 by the lead: each capture was fetched from the id_ (raw) endpoint
// and its tenant table compared cell-for-cell to the local file. All six identical.
const VERIFIED_ARCHIVE_URLS: Record<string, string> = {
  "cnn_t1.html": "https://web.archive.org/web/20010913191234/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants1.html",
  "cnn_t2.html": "https://web.archive.org/web/20010913194306/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants2.html",
  "cnn_t4.html": "https://web.archive.org/web/20010913194307/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants4.html",
  "cnn_t5.html": "https://web.archive.org/web/20010913194315/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants5.html",
  "cnn_t6.html": "https://web.archive.org/web/20010913194319/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants6.html",
  "cnn_t7.html": "https://web.archive.org/web/20010913194320/http://www2.cnn.com/SPECIALS/2001/trade.center/tenants7.html",
};
let recoveredUrlT1: string | null = null;

for (const spec of FILES) {
  const path = resolve(ROOT, spec.file);
  const html = readFileSync(path, "latin1");   // page declares iso-8859-1
  assertCoStarCredit(html, spec.file);
  const label = cnnLabel(html, spec.file);
  const sourceUrl = recoverSourceUrl(html, spec.n);
  if (spec.n === 1) recoveredUrlT1 = sourceUrl;
  archivedUrls[spec.file] = recoverArchivedUrl(html) ?? VERIFIED_ARCHIVE_URLS[spec.file.replace(/^.*\//, "")] ?? null;

  const { rows, headerRaw } = extractTable(html, spec.file);
  const order = columnOrderFromHeader(headerRaw, spec.file);
  const expected = EXPECTED_ORDER[spec.id];
  if (order.join() !== expected.join()) fail(`${spec.id}: header order ${order.join(",")} != verified ${expected.join(",")}`);

  let sourceRow = 0;
  let padding = 0;
  let sawPadding = false;
  let sqFtTotal = 0;

  for (let r = 1; r < rows.length; r++) {
    const { cells } = rows[r];
    const allEmpty = cells.every((c) => c === "");
    if (allEmpty) { padding++; sawPadding = true; continue; }
    if (sawPadding) fail(`${spec.file}: data row after an all-empty row (row ${r + 1}); padding assumption broken`);

    sourceRow++;
    const id = `${spec.id}-${String(sourceRow).padStart(3, "0")}`;
    const where = `${spec.file} <tr> #${r + 1} (${id})`;

    // Cell count is checked against the header, never assumed to be 4.
    if (cells.length !== order.length) {
      const t: Tenant = {
        id, building_id: spec.id, name: null, sq_ft: null, sq_ft_raw: "", industry: null, industry_raw: "",
        floor_raw: "", floors: [], floor_unresolved: null, evidence: "documented", source_id: SOURCE_ID,
        source_row: sourceRow, raw_cells: cells,
      };
      tenants.push(t);
      anomalies.push({
        id: nextAnomalyId(), subject: `row ${id}`,
        decision: `Row has ${cells.length} <td> cells but the header has ${order.length}; all fields set null, raw_cells kept.`,
        reasoning: `Cannot map cells to columns without guessing which column is missing. Rejected: positional assignment from the left, and dropping the row. Raw cells: ${JSON.stringify(cells)}.`,
        decided_by: DECIDED_BY, decided_at: DECIDED_AT,
      });
      continue;
    }

    const byField = {} as Record<Field, string>;
    order.forEach((f, i) => { byField[f] = cells[i]; });

    const sq = parseSqFt(byField.sq_ft);
    const fl = parseFloors(byField.floor);
    const t: Tenant = {
      id,
      building_id: spec.id,
      name: byField.tenant === "" ? null : byField.tenant,
      sq_ft: sq.value,
      sq_ft_raw: byField.sq_ft,
      industry: byField.industry === "" ? null : byField.industry,
      industry_raw: byField.industry,
      floor_raw: byField.floor,
      floors: fl.floors,
      floor_unresolved: fl.unresolved.length ? fl.unresolved.join(",") : null,
      evidence: "documented",
      source_id: SOURCE_ID,
      source_row: sourceRow,
    };
    if (sq.value !== null) sqFtTotal += sq.value;

    if (t.name === null) {
      t.raw_cells = cells;
      anomalies.push({
        id: nextAnomalyId(), subject: `row ${id}`,
        decision: "Tenant cell is blank while other cells carry data; name set null, raw_cells kept.",
        reasoning: `The source names no tenant for this row. Rejected: dropping the row (it carries cited sq_ft/floor data) and labelling it from the industry. Raw cells: ${JSON.stringify(cells)}.`,
        decided_by: DECIDED_BY, decided_at: DECIDED_AT,
      });
    }
    if (!sq.ok) {
      t.raw_cells = cells;
      anomalies.push({
        id: nextAnomalyId(), subject: `row ${id}`,
        decision: `sq_ft cell ${JSON.stringify(byField.sq_ft)} is neither an integer, "N/A", nor blank; sq_ft set null, sq_ft_raw kept.`,
        reasoning: `Only the literal forms seen in the source are parsed. Rejected: extracting the first number from the cell. Raw cells: ${JSON.stringify(cells)}.`,
        decided_by: DECIDED_BY, decided_at: DECIDED_AT,
      });
    }
    if (fl.unresolved.length) {
      anomalies.push({
        id: nextAnomalyId(), subject: `row ${id}`,
        decision: `Floor token(s) ${JSON.stringify(fl.unresolved)} not an integer, ascending range, or known code; kept verbatim in floor_unresolved, omitted from floors.`,
        reasoning: `No mapping for the token exists in the source. Rejected: guessing a floor from the tenant name or from neighbouring rows. floor_raw: ${JSON.stringify(byField.floor)}.`,
        decided_by: DECIDED_BY, decided_at: DECIDED_AT,
      });
    }
    tenants.push(t);
  }

  paddingByFile[spec.file] = padding;
  buildings.push({
    id: spec.id,
    name: spec.name,
    cnn_label: label,
    source_file: spec.file,
    source_url: sourceUrl,
    column_order: order,
    tenant_count: sourceRow,
    sq_ft_total: sqFtTotal,
    padding_rows_dropped: padding,
  });
}

// Special case the lead asked about: "CINDE" in cnn_t2. It is not a floor token.
// It is the tenant cell of its own <tr> (source row 2), directly after
// "Continental Insurance Company" (row 1), with sq_ft "N/A" and blank
// industry/floor. Kept verbatim as a row, flagged with raw_cells.
const cinde = tenants.find((t) => t.building_id === "wtc2" && t.name === "CINDE");
if (cinde) {
  const html = readFileSync(resolve(ROOT, "data/cnn_t2.html"), "latin1");
  const { rows } = extractTable(html, "data/cnn_t2.html");
  cinde.raw_cells = rows.find((r) => r.cells[0] === "CINDE")!.cells;
}

// Exact duplicate detection (same building, same four raw cells). None are
// expected; if any appear they stay in the data and get a paradata row.
const dupKey = (t: Tenant) => `${t.building_id}|${t.name}|${t.sq_ft_raw}|${t.industry_raw}|${t.floor_raw}`;
const seenKeys = new Map<string, string>();
const duplicates: string[] = [];
for (const t of tenants) {
  const k = dupKey(t);
  if (seenKeys.has(k)) duplicates.push(`${t.id} duplicates ${seenKeys.get(k)}`);
  else seenKeys.set(k, t.id);
}
for (const d of duplicates) {
  anomalies.push({
    id: nextAnomalyId(), subject: "duplicate row",
    decision: `${d}; both rows kept.`,
    reasoning: "The source lists the row twice. Rejected: silently de-duplicating (the listing may reflect two leases). Downstream consumers decide.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  });
}

// ---------------------------------------------------------------- output

const total = tenants.length;
const unresolvedRows = tenants.filter((t) => t.floor_unresolved !== null);
const paddingSummary = Object.entries(paddingByFile).map(([f, n]) => `${f}: ${n}`).join("; ");
const anyArchived = Object.values(archivedUrls).some((u) => u !== null);

const out = {
  meta: {
    generated_at: new Date().toISOString(),
    generator: "scripts/parse-cnn.ts",
    tenant_count: total,
  },
  sources: [{
    id: SOURCE_ID,
    citation: 'CNN.com, "List of World Trade Center tenants" (tenant list provided by CoStar Group, Inc.), as archived by the Internet Archive on 2001-09-13',
    url: recoveredUrlT1,
    archived_url: anyArchived ? archivedUrls : null,
    retrieved_at: RETRIEVED_AT,
    local_files: FILES.map((f) => f.file),
  }],
  buildings,
  floor_codes: FLOOR_CODES,
  tenants,
};

const staticParadata: Paradata[] = [
  {
    id: "P-010", subject: "column order",
    decision: "Column order is read from each table's own header row. cnn_t1/cnn_t2: Tenant | SF Leased | Industry | Floor. cnn_t4/t5/t6/t7: Tenant | Square Feet Leased | Floor | Industry. Recorded per building in buildings[].column_order.",
    reasoning: "The header cells differ between the two page generations and the parser asserts the derived order against the lead's eyeballed order, so a drift fails the build. The previous extraction (data/wtc_tenants.json) assumed the t1 order for all six pages, which swapped floor and industry for every wtc4/5/6/7 row (49 rows; e.g. US Airways in cnn_t5 got floor \"Transportation\"). Rejected: hard-coding one order for all files; rejected: detecting the order from cell contents (a floor code and an industry string are both text).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-011", subject: "missing cells",
    decision: "A missing value is encoded in the markup as an empty <td></td> or <td class=\"text\"></td>; every data row in all six tables has exactly four <td> cells, no colspan/rowspan. Blank cells become null (industry, sq_ft) or \"\" (floor_raw) with the raw value kept verbatim.",
    reasoning: "Inspected the HTML rather than the rendered text. \"Ann Taylor Loft | 7,200 | CNCR\" is really four cells with an empty third cell (industry), so nothing is guessed. Rejected: positional inference from a short whitespace-tokenised row, which is how the earlier extraction worked. A defensive path exists for rows whose cell count differs from the header (all fields null, raw_cells kept, dynamic paradata row); no such row occurred in this capture.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-012", subject: "padding rows",
    decision: `Trailing rows whose four cells are all empty are dropped and counted in buildings[].padding_rows_dropped (${paddingSummary}). They are not tenants and do not consume source_row numbers.`,
    reasoning: "They are spreadsheet-export padding (identical empty <tr> blocks after the last named tenant). The parser fails if a non-empty row ever follows an empty one, so a genuinely blank tenant inside the list could not be silently dropped. Rejected: emitting them as evidence=unknown rows (they assert nothing about any floor).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-013", subject: "floor ranges and lists",
    decision: "floor_raw is split on commas; each token is an integer (kept), an ascending range a-b (expanded inclusively, e.g. \"9-11\" -> 9,10,11), or a known code (CNCR, LBBY, BSMT, GRND, LL, PLAZ; kept as-is). Source order is preserved; floors are not de-duplicated or sorted. Example: \"GRND,1-6,13,18-46\" -> GRND, 1..6, 13, 18..46.",
    reasoning: "Expansion is the only interpretive step and it is mechanical; a descending range or a range with a code endpoint goes to floor_unresolved rather than being 'fixed'. Rejected: treating a range as 'some floors between' (the source says leased, not partially leased) and rejected mapping codes to numeric levels (CNCR is not floor 0 in this source).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-014", subject: "unresolved floor tokens",
    decision: `Tokens that are not an integer, ascending range, or known code go verbatim to floor_unresolved and are omitted from floors. Count in this capture: ${unresolvedRows.length} row(s)${unresolvedRows.length ? ": " + unresolvedRows.map((t) => `${t.id} ${JSON.stringify(t.floor_unresolved)}`).join(", ") : ""}.`,
    reasoning: "Every floor token in all 329 rows resolved to an integer, a range, or one of the six codes. The lead expected \"CINDE\" (cnn_t2) to be an unknown floor token; in the markup it is not in the Floor column at all (see P-015). Rejected: adding speculative codes to floor_codes to absorb future tokens.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-015", subject: "row wtc2-002 \"CINDE\"",
    decision: "Kept as its own tenant row exactly as the source has it: tenant cell \"CINDE\", sq_ft \"N/A\", industry blank, floor blank, immediately after wtc2-001 \"Continental Insurance Company\" (40,000 sq ft, industry blank, floor blank). raw_cells attached; evidence stays documented because the row is verbatim from the source.",
    reasoning: "The markup gives CINDE its own <tr> with four <td>s, so it is a listing row, not a floor token of the preceding row. It looks like a truncated second line of the Continental Insurance name (CINDE could be a CoStar abbreviation) but that is a guess. Rejected: merging it into wtc2-001; rejected: moving it to wtc2-001.floor_unresolved; rejected: dropping it. A human reviewer may decide to mark it a parsing artifact of the source export.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-016", subject: "sq_ft N/A and blank",
    decision: "sq_ft is an integer only when the cell is digits with optional thousands commas. \"N/A\" and blank both become null; sq_ft_raw keeps the verbatim cell so the two cases stay distinguishable (blank: wtc2 \"Gibbs & Hill\"). sq_ft_total per building sums the integers only.",
    reasoning: "N/A means the source did not report a figure, not zero. Rejected: 0 (would corrupt totals and imply a measured value); rejected: imputing from floor count.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-017", subject: "evidence level",
    decision: "Every tenant row is evidence=documented. No row is corroborated.",
    reasoning: "The CNN list is a contemporaneous listing (CoStar data, published within days of the date the reconstruction depicts), which is the definition of documented in CLAUDE.md. data/SOURCE.md lists eight tenants as 'validated against independently sourced facts' but names no source for any of them, so nothing can be promoted to corroborated yet; a future claims row with a citation can do that per tenant. Rejected: marking rows with blank floor or N/A sq_ft as reported (the evidence level describes the source, not the completeness of the row).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-018", subject: "duplicates and parsing artifacts",
    decision: `Exact duplicate rows (same building and identical four cells): ${duplicates.length}. Duplicate tenant names within a building: none. The only row that reads as a possible export artifact is wtc2-002 \"CINDE\" (P-015). Header rows and padding rows (P-012) are the only <tr>s excluded. \"&amp;\" is the sole HTML entity in any cell and is decoded to \"&\"; whitespace inside a cell is collapsed to single spaces.`,
    reasoning: "Checked every row, not a sample. The previous file's building field contained header text (\"...North Tower\\n\\n Tenant\\n SF Leased...\"), an artifact of whitespace tokenising; replaced by cnn_label taken from the <B>Building: ...</B> line above each table. Rejected: normalising tenant name spelling or case (e.g. \"Sandler O'Neil\" is kept as the source spells it).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-019", subject: "original CNN URL",
    decision: `sources[0].url = ${JSON.stringify(recoveredUrlT1)}; per-page URLs in buildings[].source_url. Reconstructed from three strings inside each file: the site-root-relative link \"/SPECIALS/2001/trade.center/tenants1.html\", Akamai asset paths embedding \"www.cnn.com/SPECIALS/2001/trade.center/\", and the page's own nav link \"tenants<n>.html\". Scheme http is assumed (2001).`,
    reasoning: "No <base href> and no absolute self-link exist in the files, so the URL is reconstructed rather than read. If any of the three strings were missing the field would be null. Rejected: leaving it null when the path and host are both present in the file. buildings[].source_url is an addition to SCHEMA.md because the source is six pages, not one.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-020", subject: "Wayback capture URL",
    decision: "sources[0].archived_url is a map of local file to Internet Archive capture URL, all captured 2001-09-13 between 19:12:34 and 19:43:20 UTC.",
    reasoning: "None of the six files contains a Wayback toolbar or archive comment, so the capture URL could not be read from the bytes. The lead fetched each capture from the raw (id_) endpoint on 2026-09-10 and compared the tenant table cell for cell to the local file; all six were identical, which is the evidence that these captures are the source of the local files. The captures redirect to host www2.cnn.com, which is recorded as returned. Rejected: leaving the field null once the match was confirmed, and rejected: citing the www.cnn.com form of the URL, which is not what the archive serves.",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
  {
    id: "P-021", subject: "source_row numbering and ids",
    decision: "source_row is the 1-based position among data rows of that building's table, counting neither the header row nor dropped padding rows. id = building id + '-' + source_row zero-padded to 3 digits (wtc1-001 .. wtc1-203).",
    reasoning: "Matches the SCHEMA.md example (Strawberry = wtc1-005, the fifth listed tenant). Rejected: numbering by <tr> index including the header (off by one against the schema) and rejected: sorting by name (ids must be stable against the source order, which is CNN's).",
    decided_by: DECIDED_BY, decided_at: DECIDED_AT,
  },
];

const generated = [...staticParadata, ...anomalies];

// Preserve rows this script does not own (e.g. P-001 written by the lead).
let existing: Paradata[] = [];
if (existsSync(OUT_PARADATA)) {
  try { existing = JSON.parse(readFileSync(OUT_PARADATA, "utf8")); } catch { fail("existing data/paradata.json is not valid JSON; fix or delete it"); }
}
const owned = new Set(generated.map((p) => p.id));
const kept = existing.filter((p) => !owned.has(p.id) && !/^P-0(1\d|[2-9]\d)$/.test(p.id));
const merged = [...kept, ...generated].sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(OUT_TENANTS, JSON.stringify(out, null, 2) + "\n");
writeFileSync(OUT_PARADATA, JSON.stringify(merged, null, 2) + "\n");

console.log(`wrote ${OUT_TENANTS}: ${total} tenants`);
for (const b of buildings) console.log(`  ${b.id}  ${String(b.tenant_count).padStart(3)} rows  ${b.sq_ft_total.toLocaleString("en-US").padStart(11)} sq ft  order=${b.column_order.join(",")}  padding=${b.padding_rows_dropped}`);
console.log(`  total sq_ft: ${buildings.reduce((s, b) => s + b.sq_ft_total, 0).toLocaleString("en-US")}`);
console.log(`  floor_unresolved rows: ${unresolvedRows.length}; anomaly paradata rows: ${anomalies.length}`);
console.log(`wrote ${OUT_PARADATA}: ${merged.length} rows (${kept.length} preserved, ${generated.length} generated)`);
