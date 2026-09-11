// Node naming shared by the geometry generator (scripts/generate-geometry.ts)
// and the viewer (app/towers). One constant, one pattern. Pure module, safe to
// import from client components.
//
//   floor plate:  wtc1_floor_042
//   detail node:  wtc1_<part>_042   (anything per-floor that is not the plate)

export const FLOOR_NODE_INFIX = "_floor_";

/** Floor numbers are zero-padded to three digits: 1 -> "001", 110 -> "110". */
export function floorNodeName(buildingId: string, floor: number): string {
  return `${buildingId}${FLOOR_NODE_INFIX}${String(floor).padStart(3, "0")}`;
}

const FLOOR_NODE_RE = /^(wtc\d)_floor_(\d{3})$/;
const DETAIL_NODE_RE = /^(wtc\d)_(?!floor_)[a-z0-9]+(?:_[a-z0-9]+)*?_(\d{3})$/;

export function parseFloorNodeName(name: string): { buildingId: string; floor: number } | null {
  const m = FLOOR_NODE_RE.exec(name);
  return m ? { buildingId: m[1], floor: Number(m[2]) } : null;
}

/** A per-floor node that is not the plate itself (facade panel, spandrel, and so on). */
export function parseDetailNodeName(name: string): { buildingId: string; floor: number } | null {
  const m = DETAIL_NODE_RE.exec(name);
  return m ? { buildingId: m[1], floor: Number(m[2]) } : null;
}
