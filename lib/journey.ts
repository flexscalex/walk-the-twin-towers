// Build-time data for Journey mode: the building's own circulation as the
// sources state it. Server-only. Every count and statement here is read
// through the citer, so the client gets the parameter ids and quotes behind
// each line of the elevator panel. The one interpretive piece, the floor
// range of each elevator zone, is marked as such and recorded as paradata
// P-072 in data/paradata.journey.json.
import fs from "node:fs";
import path from "node:path";
import { loadGeometry } from "./data";
import { buildTowersData, type TowerId } from "./floors";
import { getBuilding } from "./tenants";
import { makeCiter, type WalkParam } from "./geometry-cite";
import type { Evidence } from "./types";

export type ZoneId = "low" | "mid" | "high";

export interface JourneyZone {
  id: ZoneId;
  label: string;
  /** Lowest and highest floor the zone's local cars are taken to reach. Interpretive; see zoneParadata. */
  from: number;
  to: number;
  /** The sky lobby where this zone's locals are boarded; null for the lowest zone (boarded at the Plaza lobby). */
  skyLobby: number | null;
  /** Express cars from the concourse to this zone's sky lobby, as cited; null for the lowest zone. */
  expressCars: number | null;
  expressParam: string | null;
}

export interface JourneyFloor {
  floor: number;
  /** A floor plate with a cited elevation exists in the manifest. Without one the floor cannot be selected. */
  hasPlate: boolean;
  plateEvidence: Evidence | null;
  /** Tenant rows the source places on this floor. */
  rows: number;
  /** Cited use, when the sources give one (Concourse, Plaza lobby, sky lobby, mechanical, escalator, restaurant, observation, TV/storage). */
  usage: string | null;
  usageParams: string[];
  isMechanical: boolean;
  isSkyLobby: boolean;
  isEscalator: boolean;
  /** Reached by a cited dedicated express car from the concourse. */
  dedicatedExpress: boolean;
}

export interface JourneyFact {
  text: string;
  params: string[];
}

export interface JourneyData {
  buildingId: TowerId;
  buildingName: string;
  floorCount: number;
  concourseFloor: number;
  lobbyFloor: number;
  zones: JourneyZone[];
  zoneParadata: string;
  floors: JourneyFloor[];
  counts: {
    express44: number;
    express78: number;
    localPerZone: number;
    total: number;
    freight: number;
    stairs: number;
  };
  facts: {
    system: JourneyFact[];
    skyLobby: JourneyFact[];
    stairs: JourneyFact[];
    freight: JourneyFact;
    dedicated: JourneyFact[];
  };
  params: Record<string, WalkParam>;
}

interface ManifestNode {
  name: string;
  kind: string;
  floor?: number;
  elevation_ft: number;
  evidence: Evidence;
}

function readPlates(buildingId: string): Map<number, ManifestNode> {
  const file = path.join(process.cwd(), "public", "geometry", "manifest.json");
  const out = new Map<number, ManifestNode>();
  if (!fs.existsSync(file)) return out;
  try {
    const m = JSON.parse(fs.readFileSync(file, "utf8")) as { buildings?: Record<string, { nodes: ManifestNode[] }> };
    for (const n of m.buildings?.[buildingId]?.nodes ?? []) if (n.kind === "floor_plate" && typeof n.floor === "number") out.set(n.floor, n);
  } catch {
    // unreadable manifest: every floor reads as "no cited elevation"
  }
  return out;
}

export function buildJourneyData(buildingId: TowerId): JourneyData | null {
  const building = getBuilding(buildingId);
  const geo = loadGeometry();
  if (!building || !geo) return null;
  const towers = buildTowersData();
  const tower = towers.towers.find((t) => t.id === buildingId);
  if (!tower) return null;
  const c = makeCiter(geo);

  // Counts, each from its parameter.
  const skyLobbies = c.list("towers.sky_lobby_floors");
  if (skyLobbies.length !== 2) throw new Error("journey: expected two sky lobby floors");
  const [sky1, sky2] = [...skyLobbies].sort((a, b) => a - b);
  const zonesCount = c.count("towers.elevator_zones");
  if (zonesCount !== 3) throw new Error("journey: expected three elevator zones");
  const express44 = c.count("towers.express_elevators_concourse_to_44");
  const express78 = c.count("towers.express_elevators_concourse_to_78");
  const localPerZone = c.count("towers.local_elevators_per_zone");
  const total = c.count("towers.elevators_total");
  const freight = c.count("towers.freight_elevators");
  const stairs = c.count("towers.stairways_per_tower");
  c.cite("towers.stair_a_c_width");
  c.cite("towers.stair_b_width");
  c.cite("towers.stairs_location");
  c.cite("towers.stairs_a_c_discharge_level");
  c.cite("towers.local_elevator_shaft_termination");
  c.cite("towers.fig2_5_base_level");
  c.cite("towers.dedicated_express_elevators_top_floors");
  c.cite("towers.passenger_elevators_exec_summary");

  // Zone floor ranges. NCSTAR 1-1 refers the floor groups to NCSTAR 1-7, which is
  // not among the sources used, so the zones are taken as the floors between the
  // sky lobbies (paradata P-072). The lowest zone runs from the Concourse (floor 1)
  // through the Plaza lobby (floor 2) to the floor below the first sky lobby.
  const zones: JourneyZone[] = [
    { id: "low", label: `Concourse and Plaza lobby to floor ${sky1 - 1}`, from: 1, to: sky1 - 1, skyLobby: null, expressCars: null, expressParam: null },
    { id: "mid", label: `Sky lobby ${sky1} to floor ${sky2 - 1}`, from: sky1, to: sky2 - 1, skyLobby: sky1, expressCars: express44, expressParam: "towers.express_elevators_concourse_to_44" },
    { id: "high", label: `Sky lobby ${sky2} to floor ${tower.floorCount}`, from: sky2, to: tower.floorCount, skyLobby: sky2, expressCars: express78, expressParam: "towers.express_elevators_concourse_to_78" },
  ];

  // Per-floor cited uses.
  const mechanicalFloors = new Set(c.list("towers.mechanical_equipment_room_floors"));
  const escalatorFloors = c.list("towers.escalator_floors");
  const lowerEscalator = new Set(escalatorFloors.filter((f) => f === sky1 - 1 || f === sky2 - 1));
  const upperEscalator = new Set(escalatorFloors.filter((f) => f === sky1 + 1 || f === sky2 + 1));
  const concourseUsage = c.str("towers.floor_1_usage");
  const lobbyUsage = c.str("towers.floor_2_usage");
  const storageUsage = c.str("towers.floors_3_to_6_usage");
  const restaurantFloors = new Set(buildingId === "wtc1" ? c.list("wtc1.restaurant_floors") : []);
  const usage107 = c.str(`${buildingId}.floor_107_usage`);
  const usage110 = buildingId === "wtc1" ? c.str("wtc1.floor_110_usage") : null;
  if (buildingId === "wtc2") c.cite("wtc2.observation_deck_dedicated_express");

  const plates = readPlates(buildingId);
  const floors: JourneyFloor[] = [];
  for (let n = 1; n <= tower.floorCount; n++) {
    const summary = tower.floors.find((f) => f.floor === n);
    const plate = plates.get(n) ?? null;
    let usage: string | null = null;
    const usageParams: string[] = [];
    const isMechanical = mechanicalFloors.has(n);
    const isSkyLobby = n === sky1 || n === sky2;
    const isEscalator = lowerEscalator.has(n) || upperEscalator.has(n);
    if (n === 1) {
      usage = concourseUsage;
      usageParams.push("towers.floor_1_usage");
    } else if (n === 2) {
      usage = lobbyUsage;
      usageParams.push("towers.floor_2_usage");
    } else if (n >= 3 && n <= 6) {
      usage = storageUsage;
      usageParams.push("towers.floors_3_to_6_usage");
    } else if (isSkyLobby) {
      usage = "Sky lobby";
      usageParams.push("towers.sky_lobby_floors");
    } else if (isMechanical) {
      usage = "Mechanical equipment room";
      usageParams.push("towers.mechanical_equipment_room_floors");
    } else if (lowerEscalator.has(n)) {
      usage = "Lower escalator";
      usageParams.push("towers.escalator_floors");
    } else if (upperEscalator.has(n)) {
      usage = "Upper escalator";
      usageParams.push("towers.escalator_floors");
    } else if (n === 107) {
      usage = usage107;
      usageParams.push(`${buildingId}.floor_107_usage`);
    } else if (restaurantFloors.has(n)) {
      usage = "Restaurant";
      usageParams.push("wtc1.restaurant_floors");
    } else if (n === 110 && usage110) {
      usage = usage110;
      usageParams.push("wtc1.floor_110_usage");
    }
    const dedicatedExpress = buildingId === "wtc1" ? restaurantFloors.has(n) : n === 107;
    floors.push({
      floor: n,
      hasPlate: plate !== null,
      plateEvidence: plate?.evidence ?? null,
      rows: summary?.rows ?? 0,
      usage,
      usageParams,
      isMechanical,
      isSkyLobby,
      isEscalator,
      dedicatedExpress,
    });
  }

  // Prose for the panel. Each line is a close paraphrase of the quoted
  // sentence in the parameter it names; the quote itself is listed under sources.
  const facts: JourneyData["facts"] = {
    system: [
      {
        text: `Each tower was divided vertically into three zones by sky lobbies on floors ${sky1} and ${sky2}, which distributed passengers between express and local elevators.`,
        params: ["towers.elevator_zones", "towers.sky_lobby_floors"],
      },
      {
        text: `${express44} express elevators ran from the concourse to floor ${sky1} and ${express78} from the concourse to floor ${sky2}, with ${localPerZone} local elevators per zone serving groups of floors in those zones.`,
        params: ["towers.express_elevators_concourse_to_44", "towers.express_elevators_concourse_to_78", "towers.local_elevators_per_zone"],
      },
      {
        text: `${total} elevators in each tower, all inside the core. The Executive Summary counts them as 99 passenger cars plus 7 freight; the wording conflict is recorded on the parameter.`,
        params: ["towers.elevators_total", "towers.passenger_elevators_exec_summary"],
      },
      {
        text: "The local elevators within a zone were stacked in a common shaft. Locals serving the lower part of a zone stopped short, and the shaft space above them went back to leasable tenant space.",
        params: ["towers.local_elevator_shaft_termination"],
      },
      {
        text: "Which floors each local bank served is referred by NCSTAR 1-1 to NCSTAR 1-7, which is not among the sources used. The zone ranges below are therefore taken as the floors between the sky lobbies (paradata P-072). The riser diagram, Figure 2-5, letters Plaza Level at the foot of the shafts and no floor numbers.",
        params: ["towers.local_elevators_per_zone", "towers.fig2_5_base_level"],
      },
    ],
    skyLobby: [
      {
        text: `People transferred from express elevators to local elevators at the sky lobbies, on floors ${sky1} and ${sky2} in both towers.`,
        params: ["towers.sky_lobby_floors"],
      },
      {
        text: `The floors either side, ${sky1 - 1} and ${sky1 + 1}, ${sky2 - 1} and ${sky2 + 1}, are listed as the lower and upper escalator floors; the escalator floors occurred in the two levels directly above the mechanical rooms.`,
        params: ["towers.escalator_floors"],
      },
    ],
    stairs: [
      {
        text: `Stairwells: ${stairs} per tower are documented, two 44 in. wide (A and C) and one 56 in. wide (B), in the core except at the mechanical floors. Their positions are referred to NCSTAR 1-7 and are not in the sources used, so they are not drawn.`,
        params: ["towers.stairways_per_tower", "towers.stair_a_c_width", "towers.stair_b_width", "towers.stairs_location"],
      },
      {
        text: "Stairs A and C terminated at the mezzanine level, which was at the Plaza level rather than the street.",
        params: ["towers.stairs_a_c_discharge_level"],
      },
    ],
    freight: {
      text: `${freight} freight elevators, only one of which served all floors. Not passenger cars; not selectable here.`,
      params: ["towers.freight_elevators"],
    },
    dedicated:
      buildingId === "wtc1"
        ? [
            {
              text: "Dedicated express elevators served the restaurant, bars and meeting rooms on floors 106 and 107 of 1 World Trade Center.",
              params: ["towers.dedicated_express_elevators_top_floors", "wtc1.restaurant_floors"],
            },
          ]
        : [
            {
              text: "A dedicated express elevator from the Concourse level served the observation deck on floor 107 of 2 World Trade Center.",
              params: ["towers.dedicated_express_elevators_top_floors", "wtc2.observation_deck_dedicated_express", "wtc2.floor_107_usage"],
            },
          ],
  };

  return {
    buildingId,
    buildingName: building.name,
    floorCount: tower.floorCount,
    concourseFloor: 1,
    lobbyFloor: 2,
    zones,
    zoneParadata: "P-072",
    floors,
    counts: { express44, express78, localPerZone, total, freight, stairs },
    facts,
    params: c.used,
  };
}
