// Build-time data for Walk mode. Server-only (reads the data loaders and the
// geometry manifest). Nothing here adds information: it selects the tenant
// rows the source places on one floor, reads that floor's cited elevation from
// public/geometry/manifest.json, and joins the plan parameters the client
// needs to draw the plate, core and columns. Every number the client receives
// carries its parameter id and citation.
//
// Two kinds of payload share this shape: a numbered floor (kind "floor") and
// the Plaza lobby on floor 2 (kind "lobby", paradata P-070). Both carry the
// building's cited circulation (JourneyData) for the elevator panel.
import fs from "node:fs";
import path from "node:path";
import { loadGeometry } from "./data";
import { buildTowersData, TOWER_IDS, type TenantLite, type TowerId } from "./floors";
import { makeCiter, type Citer, type WalkParam } from "./geometry-cite";
import { buildJourneyData, type JourneyData } from "./journey";
import { getBuilding, getTenants, isNumericFloor } from "./tenants";
import { towerPositionM, VIEWER_LAYOUT_PARADATA } from "./viewer-layout";
import { GEOMETRY_URL_BASE } from "./geometry-manifest";
import type { Evidence } from "./types";

export type { WalkParam } from "./geometry-cite";

export interface WalkLevel {
  /** Drawing datum of NCSTAR 1-1 Figure 2-2 / 2-3 (Concourse = 310 ft). */
  ft: number;
  node: string;
  params: string[];
  evidence: Evidence;
}

export interface WalkStory {
  ft: number;
  basis: "next floor node" | "roof node" | "typical story height (fallback)" | "tree splice elevation minus the floor 2 line";
  params: string[];
  evidence: Evidence;
  /** Set when the fallback was taken, saying which node was missing. */
  note: string | null;
}

/** Plan dimensions in feet, each with the parameter id it came from. */
export interface WalkDims {
  sideFt: number;
  chamferFt: number;
  columnsPerFace: number;
  columnPitchFt: number;
  columnWidthFt: number;
  columnDepthFt: number;
  coreLongFt: number;
  coreShortFt: number;
  coreOrientation: "east-west" | "north-south";
  slabFt: number;
  columnFreeAreaSqFt: number;
  /** id used for each field above, so the HUD can cite by field. */
  ids: Record<keyof Omit<WalkDims, "ids">, string>;
}

export interface WalkOmission {
  what: string;
  why: string;
  unresolvedId: string | null;
}

/** The Plaza lobby: what is cited about it and how the base perimeter is laid out. */
export interface LobbyInfo {
  usage: string;
  usageParam: string;
  /** Elevation the column lines and glass are drawn up to: the tree splice, a cited column elevation, not a lobby height. */
  wallTopFt: number;
  wallTopParam: string;
  wallHeightFt: number;
  /** Base columns per face below the tree splice, 10 ft on centre. */
  baseColumnsPerFace: number;
  baseColumnPitchFt: number;
  /** Distance from the column reference line corner to the first base column: corner chamfer plus the end bay. */
  baseFirstOffsetFt: number;
  baseIds: { bays: string; pitch: string; endBay: string; run: string; chamfer: string; splice: string; section: string };
  /** CoStar rows coded LBBY for this building. */
  rows: TenantLite[];
  /** Rows on other coded levels (CNCR, GRND, BSMT, LL), named so the visitor knows they exist and are not here. */
  otherCoded: { code: string; label: string; count: number }[];
  /** Cited statements about the lobby, each with its parameters. */
  facts: { text: string; params: string[] }[];
}

/**
 * What the visitor sees through the glass: the city context massing and both
 * towers' exterior outlines, in the shared scene frame of /towers. The tower
 * files put y = 0 at the floor 1 (Concourse) line and the context is extruded
 * from y = 0 (P-067), so the Concourse line is taken as the ground, exactly as
 * /towers draws it. Tower positions on the block are the viewer layout choice
 * recorded in P-066. Paradata P-077.
 */
export interface WalkOutside {
  contextUrl: string | null;
  /** This tower's plan centre in the scene frame, metres (x east, z south). */
  positionM: [number, number];
  layoutParadata: string;
  /** Floor 1 (Concourse) line, the y = 0 of the tower files. */
  floor1: { ft: number; node: string };
  /** Each tower's cited roof elevation on the drawing datum, for the exterior outline. */
  towers: { id: TowerId; name: string; roofFt: number; roofNode: string; roofEvidence: Evidence; positionM: [number, number] }[];
}

export interface WalkData {
  kind: "floor" | "lobby";
  buildingId: TowerId;
  buildingName: string;
  floor: number;
  floorCount: number;
  isMechanical: boolean;
  isSkyLobby: boolean;
  isEscalator: "lower" | "upper" | null;
  level: WalkLevel | null;
  story: WalkStory;
  tenants: TenantLite[];
  industryColors: Record<string, string>;
  dims: WalkDims;
  lobby: LobbyInfo | null;
  journey: JourneyData;
  outside: WalkOutside | null;
  params: Record<string, WalkParam>;
  omitted: WalkOmission[];
  sourceCitation: string;
  manifestGeneratedAt: string | null;
}

interface ManifestNode {
  name: string;
  kind: string;
  floor?: number;
  elevation_ft: number;
  params: string[];
  evidence: Evidence;
}

interface Manifest {
  generated_at?: string;
  buildings: Record<string, { nodes: ManifestNode[] }>;
}

function readManifestFile(): Manifest | null {
  const file = path.join(process.cwd(), "public", "geometry", "manifest.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

/** The view out of the windows, or null when the manifest lacks a floor 1 or roof node for either tower. */
function readOutside(manifest: Manifest | null, buildingId: TowerId, c: Citer): WalkOutside | null {
  if (!manifest) return null;
  const ids = TOWER_IDS.filter((id): id is TowerId => id in manifest.buildings);
  if (!ids.includes(buildingId)) return null;
  const own = manifest.buildings[buildingId].nodes.find((n) => n.kind === "floor_plate" && n.floor === 1);
  if (!own) return null;
  const towers: WalkOutside["towers"] = [];
  for (const id of ids) {
    const roof = manifest.buildings[id].nodes.find((n) => n.kind === "roof_plate");
    const b = getBuilding(id);
    if (!roof || !b) return null;
    for (const pid of roof.params) c.cite(pid);
    const [x, , z] = towerPositionM(id, ids.indexOf(id));
    towers.push({ id, name: b.name, roofFt: roof.elevation_ft, roofNode: roof.name, roofEvidence: roof.evidence, positionM: [x, z] });
  }
  for (const pid of own.params) c.cite(pid);
  const [x, , z] = towerPositionM(buildingId, ids.indexOf(buildingId));
  const contextFile = path.join(process.cwd(), "public", "geometry", "context.glb");
  return {
    contextUrl: fs.existsSync(contextFile) ? `${GEOMETRY_URL_BASE}/context.glb` : null,
    positionM: [x, z],
    layoutParadata: VIEWER_LAYOUT_PARADATA,
    floor1: { ft: own.elevation_ft, node: own.name },
    towers,
  };
}

export function isTowerId(id: string): id is TowerId {
  return (TOWER_IDS as readonly string[]).includes(id);
}

function readDims(buildingId: TowerId, c: Citer): WalkDims {
  const orientationId = `${buildingId}.core_long_axis_orientation`;
  const orientation = c.str(orientationId);
  if (orientation !== "east-west" && orientation !== "north-south") {
    throw new Error(`walk: unrecognised core orientation ${orientation}`);
  }
  const ids: WalkDims["ids"] = {
    sideFt: "towers.column_reference_line_spacing",
    chamferFt: "towers.corner_chamfer",
    columnsPerFace: "towers.perimeter_columns_per_face",
    columnPitchFt: "towers.perimeter_column_spacing_oc",
    columnWidthFt: "towers.perimeter_column_outer_web_width",
    columnDepthFt: "towers.perimeter_column_depth",
    coreLongFt: "towers.core_plan_long_approx",
    coreShortFt: "towers.core_plan_short_approx",
    coreOrientation: orientationId,
    slabFt: "towers.truss_floor_slab_thickness",
    columnFreeAreaSqFt: "towers.column_free_area_outside_core_per_floor_approx",
  };
  return {
    sideFt: c.ft(ids.sideFt),
    chamferFt: c.ft(ids.chamferFt),
    columnsPerFace: c.count(ids.columnsPerFace),
    columnPitchFt: c.ft(ids.columnPitchFt),
    columnWidthFt: c.ft(ids.columnWidthFt),
    columnDepthFt: c.ft(ids.columnDepthFt),
    coreLongFt: c.ft(ids.coreLongFt),
    coreShortFt: c.ft(ids.coreShortFt),
    coreOrientation: orientation,
    slabFt: c.ft(ids.slabFt),
    columnFreeAreaSqFt: c.count(ids.columnFreeAreaSqFt),
    ids,
  };
}

const COMMON_OMISSIONS: WalkOmission[] = [
  { what: "core openings and doors", why: "no core opening width, door position or wall thickness is cited; the core is drawn as one solid block of the approximate 135 ft by 87 ft plan.", unresolvedId: "towers.core_plan_dimensions_exact" },
  { what: "elevator shafts and stairwells", why: "all elevators and the three stairs were in the core, but no shaft or stair position is cited (positions are referred to NCSTAR 1-7). The elevator panel is a list, not a drawn bank.", unresolvedId: "towers.elevator_shaft_positions_in_core" },
  { what: "corner members", why: "corner member section is not cited.", unresolvedId: "towers.corner_column_detail" },
  { what: "core columns, walls and shafts", why: "no plan dimensions cited beyond the approximate core rectangle.", unresolvedId: "towers.core_column_count" },
  { what: "city context outside the glass", why: "not yet built.", unresolvedId: "complex.tower_positions_and_spacing" },
];

/**
 * The walk data for one numbered floor of one tower, or null when the floor
 * is outside the cited floor count.
 */
export function buildWalkData(buildingId: TowerId, floor: number): WalkData | null {
  const building = getBuilding(buildingId);
  const geo = loadGeometry();
  if (!building || !geo) return null;

  const towers = buildTowersData();
  const tower = towers.towers.find((t) => t.id === buildingId);
  if (!tower) return null;
  if (!Number.isInteger(floor) || floor < 1 || floor > tower.floorCount) return null;
  const summary = tower.floors.find((f) => f.floor === floor);
  const journey = buildJourneyData(buildingId);
  if (!journey) return null;

  const c = makeCiter(geo);
  const paramsById = new Map(geo.params.map((p) => [p.id, p]));
  const dims = readDims(buildingId, c);
  // The framed-tube columns run floor 9 to floor 107 (towers.framed_tube_box_column_floor_range).
  const columnRange = c.str("towers.framed_tube_box_column_floor_range");

  // Elevation from the manifest node for this floor; story height from the next line up.
  const manifest = readManifestFile();
  const nodes = manifest?.buildings?.[buildingId]?.nodes ?? [];
  const plate = nodes.find((n) => n.kind === "floor_plate" && n.floor === floor) ?? null;
  const level: WalkLevel | null = plate
    ? { ft: plate.elevation_ft, node: plate.name, params: plate.params, evidence: plate.evidence }
    : null;
  for (const id of level?.params ?? []) if (paramsById.has(id)) c.cite(id);

  const typical = c.ft("towers.typical_story_height");
  let story: WalkStory;
  const above =
    floor === tower.floorCount
      ? (nodes.find((n) => n.kind === "roof_plate") ?? null)
      : (nodes.find((n) => n.kind === "floor_plate" && n.floor === floor + 1) ?? null);
  if (plate && above) {
    const params = [...new Set([...plate.params, ...above.params])].filter((id) => paramsById.has(id));
    for (const id of params) c.cite(id);
    const worse: Evidence = plate.evidence === "reported" || above.evidence === "reported" ? "reported" : "documented";
    story = {
      ft: above.elevation_ft - plate.elevation_ft,
      basis: above.kind === "roof_plate" ? "roof node" : "next floor node",
      params,
      evidence: worse,
      note: null,
    };
  } else {
    const missing = !plate ? `${buildingId}_floor_${String(floor).padStart(3, "0")}` : floor === tower.floorCount ? `${buildingId}_roof` : `${buildingId}_floor_${String(floor + 1).padStart(3, "0")}`;
    story = {
      ft: typical,
      basis: "typical story height (fallback)",
      params: ["towers.typical_story_height"],
      evidence: paramsById.get("towers.typical_story_height")?.evidence ?? "documented",
      note: `${missing} is not in the manifest, so the story height is the typical 12 ft (towers.typical_story_height), not a per-floor figure.`,
    };
  }

  const omitted: WalkOmission[] = [];
  const unresolved = new Map(geo.unresolved.map((u) => [u.id, u]));
  const omit = (what: string, why: string, unresolvedId: string | null = null) => omitted.push({ what, why, unresolvedId });
  if (!plate) omit("floor elevation", `${buildingId}_floor_${String(floor).padStart(3, "0")} has no cited elevation in the manifest; the floor line is shown without a figure.`);
  if (floor < 9 || floor > 107) omit("perimeter columns", `the framed-tube columns are cited for floors ${columnRange} only; this floor is outside that range and the generator does not draw them here.`, "towers.base_column_section");
  omit("window frames and sill", unresolved.get("towers.window_width")?.why ?? "window width is not cited", "towers.window_width");
  omit("spandrel plates", "spandrel depth is cited (towers.spandrel_depth_typical, 52 in) but the plate's position relative to the floor line is not, so the spandrel is not placed and the glass runs floor to ceiling.", null);
  omit("ceiling finish, raised floor, partitions", "not in NCSTAR 1-1; the cited layer shows the structural slab above as the ceiling.", null);
  omitted.push(...COMMON_OMISSIONS);

  const tenants: TenantLite[] = (summary?.tenantIds ?? []).map((id) => towers.tenantsById[id]).filter(Boolean);
  // Sanity: every row placed here really lists this floor.
  for (const t of tenants) if (!t.floors.some((f) => isNumericFloor(f) && Number(f) === floor)) throw new Error(`walk: ${t.id} is not on floor ${floor}`);

  const jf = journey.floors.find((f) => f.floor === floor);
  const isEscalator: WalkData["isEscalator"] = jf?.usage === "Lower escalator" ? "lower" : jf?.usage === "Upper escalator" ? "upper" : null;
  if (jf?.isSkyLobby || isEscalator) {
    c.cite("towers.sky_lobby_floors");
    c.cite("towers.escalator_floors");
  }

  return {
    kind: "floor",
    buildingId,
    buildingName: building.name,
    floor,
    floorCount: tower.floorCount,
    isMechanical: summary?.isMechanical ?? false,
    isSkyLobby: summary?.isSkyLobby ?? false,
    isEscalator,
    level,
    story,
    tenants,
    industryColors: towers.industryColors,
    dims,
    lobby: null,
    journey,
    outside: readOutside(manifest, buildingId, c),
    params: c.used,
    omitted,
    sourceCitation: towers.sourceCitation,
    manifestGeneratedAt: manifest?.generated_at ?? null,
  };
}

/**
 * The Plaza lobby of one tower: floor 2, cited as "Plaza - Lobby" (NCSTAR 1-2A
 * Table G-1). Drawn with the floor 2 plate, the core, and the base columns at
 * their cited 10 ft spacing up to the cited tree splice elevation. No ceiling:
 * no lobby height is cited (unresolved towers.lobby_ceiling_height). Paradata
 * P-070, P-071, P-074, P-076.
 */
export function buildLobbyData(buildingId: TowerId): WalkData | null {
  const building = getBuilding(buildingId);
  const geo = loadGeometry();
  if (!building || !geo) return null;
  const towers = buildTowersData();
  const tower = towers.towers.find((t) => t.id === buildingId);
  if (!tower) return null;
  const journey = buildJourneyData(buildingId);
  if (!journey) return null;

  const c = makeCiter(geo);
  const paramsById = new Map(geo.params.map((p) => [p.id, p]));
  const dims = readDims(buildingId, c);
  const floor = journey.lobbyFloor;

  const manifest = readManifestFile();
  const nodes = manifest?.buildings?.[buildingId]?.nodes ?? [];
  const plate = nodes.find((n) => n.kind === "floor_plate" && n.floor === floor) ?? null;
  if (!plate) return null;
  const level: WalkLevel = { ft: plate.elevation_ft, node: plate.name, params: plate.params, evidence: plate.evidence };
  for (const id of level.params) if (paramsById.has(id)) c.cite(id);

  const usage = c.str("towers.floor_2_usage");
  const floor2 = c.ft("towers.floor_2_elevation");
  if (floor2 !== plate.elevation_ft) throw new Error(`lobby: manifest floor 2 at ${plate.elevation_ft} ft, parameter says ${floor2} ft`);
  const splice = c.ft("towers.tree_column_splice_elevation");
  const wallHeightFt = splice - floor2;
  const bays = c.count("towers.base_face_bays");
  const pitch = c.ft("towers.base_column_spacing_oc");
  const run = c.ft("towers.base_face_column_run");
  if (Math.abs(bays * pitch - run) > 1e-9) throw new Error(`lobby: ${bays} bays at ${pitch} ft is not the cited ${run} ft run`);
  const endBay = c.ft("towers.base_face_end_bay");
  const firstOffset = dims.chamferFt + endBay;
  // The figure's own sum: chamfer + end bay + run + end bay + chamfer = reference line spacing.
  if (Math.abs(2 * firstOffset + run - dims.sideFt) > 1e-6) throw new Error("lobby: base column layout does not add up to the column reference line spacing");
  c.cite("towers.transition_ten_ft_to_three_at_3ft4in");
  c.cite("towers.floors_3_to_6_usage");
  c.cite("towers.floor_1_usage");
  c.cite("towers.atrium_levels");
  c.cite("towers.atrium_area_extent");
  c.cite("towers.core_bracing_lobby_atrium");
  c.cite("towers.main_lobby_inspection_items");
  c.cite("towers.stairs_a_c_discharge_level");
  c.cite("towers.fig2_5_base_level");

  const story: WalkStory = {
    ft: wallHeightFt,
    basis: "tree splice elevation minus the floor 2 line",
    params: ["towers.tree_column_splice_elevation", "towers.floor_2_elevation"],
    evidence: "documented",
    note: "This is the height the column lines and glass are drawn to, a cited column elevation. It is not a lobby ceiling height, which is not cited.",
  };

  const all = getTenants(buildingId);
  const lite = towers.tenantsById;
  const rows: TenantLite[] = all.filter((t) => t.floors.includes("LBBY")).map((t) => lite[t.id]).filter(Boolean);
  const otherCounts = new Map<string, number>();
  for (const t of all) for (const f of t.floors) if (!isNumericFloor(f) && f !== "LBBY") otherCounts.set(f, (otherCounts.get(f) ?? 0) + 1);
  const floorCodes: Record<string, string> = { CNCR: "Concourse", BSMT: "Basement", GRND: "Ground", LL: "Lower level", PLAZ: "Plaza" };
  const otherCoded = [...otherCounts.entries()].sort().map(([code, count]) => ({ code, label: floorCodes[code] ?? code, count }));

  const facts: LobbyInfo["facts"] = [
    { text: `Floor 2 is listed as "${usage}" for both towers; floor 1 below it is the Concourse.`, params: ["towers.floor_2_usage", "towers.floor_1_usage"] },
    { text: 'Floors 3 to 6 are listed as "Core Only (Storage)": outside the core there was no floor between the lobby and floor 7. The atrium area ran from below floor 7 to the foundation, and the core columns were braced at the lobby atrium levels.', params: ["towers.floors_3_to_6_usage", "towers.atrium_area_extent", "towers.core_bracing_lobby_atrium", "towers.atrium_levels"] },
    { text: "Below the tree splice at elevation 363 ft the exterior columns were spaced 10 ft on centre; between there and floor 7 each one forked into three at 3 ft 4 in.", params: ["towers.base_column_spacing_oc", "towers.tree_column_splice_elevation", "towers.transition_ten_ft_to_three_at_3ft4in"] },
    { text: "Plaster ceilings in the main lobby and marble wall panel supports are named in the inspection program; no dimension or position is given, so neither is drawn.", params: ["towers.main_lobby_inspection_items"] },
    { text: "Stairs A and C terminated at the mezzanine, at the Plaza level. On the riser diagram the express and local elevators rise from the Plaza Level.", params: ["towers.stairs_a_c_discharge_level", "towers.fig2_5_base_level"] },
  ];

  const unresolved = new Map(geo.unresolved.map((u) => [u.id, u]));
  const omitted: WalkOmission[] = [
    { what: "ceiling", why: unresolved.get("towers.lobby_ceiling_height")?.why ?? "no lobby height is cited.", unresolvedId: "towers.lobby_ceiling_height" },
    { what: "base column section", why: "the base columns are placed at their cited 10 ft centres but no width or depth is cited, so each is drawn as a line, not a box (paradata P-039, P-071).", unresolvedId: "towers.base_column_section" },
    { what: "doors, lobby glazing, mezzanine", why: "no entrance position, door width, glazing height or mezzanine extent is cited. The perimeter is the same glass line as the floors above, cut nowhere. The plaza side of the tower is not fixed by the sources used, so you start at the south face (paradata P-076).", unresolvedId: "complex.tower_positions_and_spacing" },
    { what: "lobby finishes", why: "plaster ceilings and marble wall panels are attested (towers.main_lobby_inspection_items) with no dimensions.", unresolvedId: null },
    ...COMMON_OMISSIONS,
  ];

  return {
    kind: "lobby",
    buildingId,
    buildingName: building.name,
    floor,
    floorCount: tower.floorCount,
    isMechanical: false,
    isSkyLobby: false,
    isEscalator: null,
    level,
    story,
    tenants: rows,
    industryColors: towers.industryColors,
    dims,
    lobby: {
      usage,
      usageParam: "towers.floor_2_usage",
      wallTopFt: splice,
      wallTopParam: "towers.tree_column_splice_elevation",
      wallHeightFt,
      baseColumnsPerFace: bays + 1,
      baseColumnPitchFt: pitch,
      baseFirstOffsetFt: firstOffset,
      baseIds: {
        bays: "towers.base_face_bays",
        pitch: "towers.base_column_spacing_oc",
        endBay: "towers.base_face_end_bay",
        run: "towers.base_face_column_run",
        chamfer: "towers.corner_chamfer",
        splice: "towers.tree_column_splice_elevation",
        section: "towers.base_column_section",
      },
      rows,
      otherCoded,
      facts,
    },
    journey,
    outside: readOutside(manifest, buildingId, c),
    params: c.used,
    omitted,
    sourceCitation: towers.sourceCitation,
    manifestGeneratedAt: manifest?.generated_at ?? null,
  };
}

export function walkFloorParams(): { building: string; floor: string }[] {
  const out: { building: string; floor: string }[] = [];
  const towers = buildTowersData();
  for (const t of towers.towers) for (let n = 1; n <= t.floorCount; n++) out.push({ building: t.id, floor: String(n) });
  return out;
}
