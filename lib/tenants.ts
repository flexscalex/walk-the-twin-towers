// Derived views over the canonical tenant file. Nothing here adds information;
// it only counts, sorts and groups what the source rows already say.
import { loadGeometry, loadTenants } from "./data";
import type { Building, GeometryFile, Tenant, TenantsFile } from "./types";

export { loadTenants } from "./data";

export function getTenantsFile(): TenantsFile {
  return loadTenants().file;
}

export function getBuildings(): Building[] {
  return getTenantsFile().buildings;
}

export function getBuilding(id: string): Building | undefined {
  return getBuildings().find((b) => b.id === id);
}

export function getTenants(buildingId?: string): Tenant[] {
  const all = getTenantsFile().tenants;
  return buildingId ? all.filter((t) => t.building_id === buildingId) : all;
}

export function isNumericFloor(label: string): boolean {
  return /^\d+$/.test(label);
}

/** Sum of sq_ft over rows where the source gave a number. Null rows add nothing. */
export function sqFtAccountedFor(tenants: Tenant[]): number {
  return tenants.reduce((acc, t) => acc + (t.sq_ft ?? 0), 0);
}

export function maxNumericFloor(tenants: Tenant[]): number {
  let max = 0;
  for (const t of tenants) for (const f of t.floors) if (isNumericFloor(f)) max = Math.max(max, Number(f));
  return max;
}

export interface FloorCountInfo {
  floors: number;
  basis: "geometry-params" | "max floor seen in tenant data";
  mechanical: Set<number> | null; // null means the record is silent on mechanical floors
}


/** "towers" in geometry-params means both wtc1 and wtc2. */
function appliesTo(scope: string, buildingId: string): boolean {
  return scope === buildingId || (scope === "towers" && (buildingId === "wtc1" || buildingId === "wtc2"));
}

/**
 * Floor count for a building. Prefers geometry-params (buildings[].floors, or a
 * param "<id>.floors"). Otherwise the highest floor number seen in the tenant
 * rows, and says so.
 */
export function floorCount(buildingId: string, tenants: Tenant[]): FloorCountInfo {
  const geo = loadGeometry();
  const fromGeo = geometryFloorCount(geo, buildingId);
  if (fromGeo) return { ...fromGeo, basis: "geometry-params" };
  return { floors: maxNumericFloor(tenants), basis: "max floor seen in tenant data", mechanical: null };
}

function geometryFloorCount(
  geo: GeometryFile | null,
  buildingId: string,
): { floors: number; mechanical: Set<number> | null } | null {
  if (!geo) return null;
  const b = geo.buildings?.find((x) => x.id === buildingId);
  let floors: number | null = typeof b?.floors === "number" ? b.floors : null;
  let mechanical: number[] | null = Array.isArray(b?.mechanical_floors) ? b.mechanical_floors : null;

  if (floors === null) {
    const p = geo.params.find(
      (x) => appliesTo(x.applies_to, buildingId) && /\.(floors|floor_count|stories|stories_above_grade)$/.test(x.id),
    );
    if (p && typeof p.value === "number") floors = p.value;
  }
  if (mechanical === null) {
    const p = geo.params.find((x) => appliesTo(x.applies_to, buildingId) && /\.mechanical_equipment_room_floors$/.test(x.id))
      ?? geo.params.find((x) => appliesTo(x.applies_to, buildingId) && /\.mechanical_floors$/.test(x.id));
    if (p && Array.isArray(p.value)) mechanical = (p.value as unknown[]).flat().filter((n): n is number => typeof n === "number");
  }
  if (floors === null) return null;
  return { floors, mechanical: mechanical ? new Set(mechanical) : null };
}

export interface FloorRow {
  label: string; // "110", "CNCR"
  kind: "numeric" | "code";
  description: string | null; // from floor_codes for codes
  isMechanical: boolean;
  tenants: Tenant[];
}

/** Top-down floor list plus coded levels, plus every tenant that has no resolved floor. */
export function buildFloorList(
  buildingId: string,
  tenants: Tenant[],
  floorCodes: Record<string, string>,
): { info: FloorCountInfo; floors: FloorRow[]; codes: FloorRow[]; noFloor: Tenant[] } {
  const info = floorCount(buildingId, tenants);
  const byLabel = new Map<string, Tenant[]>();
  for (const t of tenants) {
    for (const f of t.floors) {
      if (!byLabel.has(f)) byLabel.set(f, []);
      byLabel.get(f)!.push(t);
    }
  }
  const floors: FloorRow[] = [];
  for (let n = info.floors; n >= 1; n--) {
    const label = String(n);
    floors.push({
      label,
      kind: "numeric",
      description: null,
      isMechanical: info.mechanical?.has(n) ?? false,
      tenants: byLabel.get(label) ?? [],
    });
  }
  // Numeric floors above the declared count, if the data ever disagrees with geometry.
  for (const [label, ts] of byLabel) {
    if (isNumericFloor(label) && Number(label) > info.floors) {
      floors.unshift({ label, kind: "numeric", description: null, isMechanical: false, tenants: ts });
    }
  }
  const codeOrder = Object.keys(floorCodes);
  const codes: FloorRow[] = [];
  const seenCodes = new Set<string>();
  for (const code of codeOrder) {
    seenCodes.add(code);
    codes.push({
      label: code,
      kind: "code",
      description: floorCodes[code] ?? null,
      isMechanical: false,
      tenants: byLabel.get(code) ?? [],
    });
  }
  for (const [label, ts] of byLabel) {
    if (!isNumericFloor(label) && !seenCodes.has(label)) {
      codes.push({ label, kind: "code", description: null, isMechanical: false, tenants: ts });
    }
  }
  const noFloor = tenants.filter((t) => t.floors.length === 0);
  return { info, floors, codes, noFloor };
}

export interface GapSummary {
  sqFtNull: number;
  industryNull: number;
  floorBlank: number;
  floorUnresolved: Tenant[];
  perBuilding: { building: Building; info: FloorCountInfo; missing: number[]; missingRanges: string }[];
}

export function gapSummary(): GapSummary {
  const file = getTenantsFile();
  const ts = file.tenants;
  const perBuilding = file.buildings.map((building) => {
    const bt = ts.filter((t) => t.building_id === building.id);
    const info = floorCount(building.id, bt);
    const seen = new Set<number>();
    for (const t of bt) for (const f of t.floors) if (isNumericFloor(f)) seen.add(Number(f));
    const missing: number[] = [];
    for (let n = 1; n <= info.floors; n++) if (!seen.has(n)) missing.push(n);
    return { building, info, missing, missingRanges: compressRanges(missing) };
  });
  return {
    sqFtNull: ts.filter((t) => t.sq_ft === null).length,
    industryNull: ts.filter((t) => t.industry === null).length,
    floorBlank: ts.filter((t) => t.floor_raw.trim() === "").length,
    floorUnresolved: ts.filter((t) => t.floor_unresolved !== null),
    perBuilding,
  };
}

export function compressRanges(nums: number[]): string {
  if (nums.length === 0) return "none";
  const out: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? String(start) : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return out.join(", ");
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

