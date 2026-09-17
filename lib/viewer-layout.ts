// Where the two towers sit in the shared scene frame. Pure module, no three.js,
// used by the /towers scene and by Walk mode's view out of the windows.
//
// The .glb files are in metres about their own plan centre (paradata P-043);
// the scene origin is the block centroid shared with the city context (P-065).
// Positions on the block are a viewer layout choice, not a cited dimension:
// complex.tower_positions_and_spacing is unresolved in data/geometry-params.json.
// The pair is centred on the origin with 1 WTC north and west of 2 WTC, centres
// 420 ft apart on a 45 degree diagonal (P-066).
const M_PER_FT = 0.3048;

export const VIEWER_LAYOUT_TOWER_SPACING_FT = 420;
export const VIEWER_LAYOUT_PARADATA = "P-066";

const LAYOUT_HALF_M = (VIEWER_LAYOUT_TOWER_SPACING_FT * M_PER_FT) / 2 / Math.SQRT2;

export const TOWER_POSITIONS_M: Record<string, [number, number, number]> = {
  wtc1: [-LAYOUT_HALF_M, 0, -LAYOUT_HALF_M], // north-west (north is -z)
  wtc2: [LAYOUT_HALF_M, 0, LAYOUT_HALF_M], // south-east
};

/** Scene position of a tower's plan centre, or a fallback row for an unknown id. */
export function towerPositionM(id: string, index = 0): [number, number, number] {
  return TOWER_POSITIONS_M[id] ?? [index * LAYOUT_HALF_M * 2, 0, 0];
}
