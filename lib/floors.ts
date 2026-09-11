// Build-time floor summaries for the tower view. Server-only (imports the
// data loaders). Nothing here adds information: it groups and sums the rows in
// data/tenants.clean.json and reads floor facts from data/geometry-params.json.
import { loadGeometry } from "./data";
import { PALETTE } from "./industry-colors";
import { floorCount, getBuilding, getTenants, isNumericFloor } from "./tenants";
import type { Tenant } from "./types";

export const TOWER_IDS = ["wtc1", "wtc2"] as const;
export type TowerId = (typeof TOWER_IDS)[number];

/** The subset of a tenant row the viewer needs. Field names match the schema. */
export interface TenantLite {
  id: string;
  name: string;
  sq_ft: number | null;
  sq_ft_raw: string;
  industry: string | null;
  floors: string[];
  floor_raw: string;
  floor_unresolved: string | null;
  evidence: Tenant["evidence"];
  source_row: number;
}

export interface FloorSummary {
  floor: number;
  tenantIds: string[];
  /** Rows placed on this floor. A row spanning several floors counts on each. */
  rows: number;
  /** Sum of sq_ft over rows on this floor that give a number. */
  sqFt: number;
  /** How many of those rows gave a number. */
  sqFtRows: number;
  /**
   * The industry with the most square feet on the floor (rows that give a
   * number), else the most rows. null when no row is placed here.
   * "" when rows exist but every one leaves industry blank.
   */
  dominant: string | null;
  dominantBasis: "sq ft" | "row count" | null;
  isMechanical: boolean;
  isSkyLobby: boolean;
}

export interface TowerSummary {
  id: TowerId;
  name: string;
  floorCount: number;
  floorCountBasis: string;
  mechanical: number[];
  skyLobbies: number[];
  floors: FloorSummary[];
  /** Rows for this tower with no resolvable floor. Not placed on any plate. */
  noFloorRows: number;
  /** Rows with at least one non-numeric level (concourse, plaza). Not placed on a plate. */
  codedLevelRows: number;
}

export interface TowersData {
  towers: TowerSummary[];
  tenantsById: Record<string, TenantLite>;
  /** industry label -> hex, for every industry that appears in either tower. */
  industryColors: Record<string, string>;
  sourceCitation: string;
}

function lite(t: Tenant): TenantLite {
  return {
    id: t.id,
    name: t.name,
    sq_ft: t.sq_ft,
    sq_ft_raw: t.sq_ft_raw,
    industry: t.industry,
    floors: t.floors,
    floor_raw: t.floor_raw,
    floor_unresolved: t.floor_unresolved,
    evidence: t.evidence,
    source_row: t.source_row,
  };
}

function skyLobbyFloors(buildingId: string): number[] {
  const geo = loadGeometry();
  if (!geo) return [];
  const p = geo.params.find(
    (x) => (x.applies_to === buildingId || x.applies_to === "towers") && /\.sky_lobby_floors$/.test(x.id),
  );
  return Array.isArray(p?.value) ? p.value.filter((n): n is number => typeof n === "number") : [];
}

function dominantIndustry(rows: Tenant[]): Pick<FloorSummary, "dominant" | "dominantBasis"> {
  if (rows.length === 0) return { dominant: null, dominantBasis: null };
  const bySqFt = new Map<string, number>();
  const byCount = new Map<string, number>();
  for (const t of rows) {
    if (t.industry === null) continue;
    byCount.set(t.industry, (byCount.get(t.industry) ?? 0) + 1);
    if (t.sq_ft !== null) bySqFt.set(t.industry, (bySqFt.get(t.industry) ?? 0) + t.sq_ft);
  }
  if (byCount.size === 0) return { dominant: "", dominantBasis: null };
  const pick = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  if (bySqFt.size > 0) return { dominant: pick(bySqFt), dominantBasis: "sq ft" };
  return { dominant: pick(byCount), dominantBasis: "row count" };
}

export function buildTowersData(): TowersData {
  const tenantsById: Record<string, TenantLite> = {};
  const industries = new Set<string>();
  const towers: TowerSummary[] = [];

  for (const id of TOWER_IDS) {
    const building = getBuilding(id);
    if (!building) continue;
    const tenants = getTenants(id);
    const info = floorCount(id, tenants);
    const mechanical = info.mechanical ? [...info.mechanical].sort((a, b) => a - b) : [];
    const sky = skyLobbyFloors(id);

    const byFloor = new Map<number, Tenant[]>();
    let codedLevelRows = 0;
    for (const t of tenants) {
      tenantsById[t.id] = lite(t);
      if (t.industry) industries.add(t.industry);
      if (t.floors.some((f) => !isNumericFloor(f))) codedLevelRows++;
      for (const f of t.floors) {
        if (!isNumericFloor(f)) continue;
        const n = Number(f);
        if (!byFloor.has(n)) byFloor.set(n, []);
        byFloor.get(n)!.push(t);
      }
    }

    const floors: FloorSummary[] = [];
    for (let n = 1; n <= info.floors; n++) {
      const rows = byFloor.get(n) ?? [];
      const withSqFt = rows.filter((t) => t.sq_ft !== null);
      floors.push({
        floor: n,
        tenantIds: rows.map((t) => t.id),
        rows: rows.length,
        sqFt: withSqFt.reduce((a, t) => a + (t.sq_ft ?? 0), 0),
        sqFtRows: withSqFt.length,
        ...dominantIndustry(rows),
        isMechanical: info.mechanical?.has(n) ?? false,
        isSkyLobby: sky.includes(n),
      });
    }

    towers.push({
      id,
      name: building.name,
      floorCount: info.floors,
      floorCountBasis: info.basis,
      mechanical,
      skyLobbies: sky,
      floors,
      noFloorRows: tenants.filter((t) => t.floors.length === 0).length,
      codedLevelRows,
    });
  }

  const industryColors: Record<string, string> = {};
  [...industries].sort().forEach((name, i) => {
    industryColors[name] = PALETTE[i % PALETTE.length];
  });

  return {
    towers,
    tenantsById,
    industryColors,
    sourceCitation:
      "CNN.com, List of World Trade Center tenants, data provided by CoStar Group, Inc., as archived by the Internet Archive on 2001-09-13.",
  };
}
