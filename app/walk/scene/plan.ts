// Plan layout for Walk mode. Pure module, no three.js. All lengths in metres.
//
// Frame matches public/geometry/manifest.json: x east, z south (north is -z),
// origin at the centre of the column-reference-line square, y up with 0 at
// the top of this floor's slab.
//
// Everything structural is derived from the cited dimensions in WalkData.dims.
// The tenant-zone layout (angular slices around the core, in source order,
// starting at south and running clockwise) is an interpretive choice recorded
// as paradata P-050. Real tenants were not arranged in slices.
import type { WalkData } from "@/lib/walk";
import type { TenantLite } from "@/lib/floors";
import { INDUSTRY_BLANK_COLOR, NO_RECORD_COLOR, NO_RECORD_MECHANICAL_COLOR } from "@/lib/industry-colors";

/** 1 ft = 0.3048 m exactly. A unit conversion, not a dimension. */
export const M_PER_FT = 0.3048;
export const ftToM = (ft: number): number => ft * M_PER_FT;

/**
 * Presentation constants. These size the visitor and the signage, not the
 * building. None of them is a cited dimension and none is drawn as one.
 */
export const PRESENTATION = {
  eyeHeightM: 1.6,
  playerRadiusM: 0.4,
  walkSpeedMps: 2.2,
  /** How far inside the glass the visitor starts. */
  startInsetM: 2.0,
  boundaryWallHeightM: 0.45,
  boundaryWallThicknessM: 0.03,
} as const;

export type XZ = [number, number];

export interface Plan {
  /** Half the column-reference-line spacing. */
  halfM: number;
  chamferM: number;
  /** Octagon, going around, in (x, z). */
  plate: XZ[];
  /** Core rectangle half extents in x and z, per the cited orientation. */
  coreHalfX: number;
  coreHalfZ: number;
  core: XZ[];
  slabM: number;
  storyM: number;
  /** Underside of the slab above: story height minus slab thickness. */
  ceilingM: number;
  columnWidthM: number;
  columnDepthM: number;
  columnPitchM: number;
  columnsPerFace: number;
  /** Column stories are cited for floors 9 to 107 only. */
  drawColumns: boolean;
  kind: "floor" | "lobby";
  /**
   * Lobby only: base columns below the tree splice, 10 ft on centre, drawn as
   * lines because no section is cited (paradata P-071). Positions along a face
   * are firstOffsetM + k * pitchM from the reference-line corner.
   */
  baseColumns: { count: number; pitchM: number; firstOffsetM: number } | null;
}

export function buildPlan(d: WalkData): Plan {
  const { dims } = d;
  const halfM = ftToM(dims.sideFt) / 2;
  const chamferM = ftToM(dims.chamferFt);
  const h = halfM;
  const c = chamferM;
  const plate: XZ[] = [
    [-h + c, -h],
    [h - c, -h],
    [h, -h + c],
    [h, h - c],
    [h - c, h],
    [-h + c, h],
    [-h, h - c],
    [-h, -h + c],
  ];
  const longM = ftToM(dims.coreLongFt);
  const shortM = ftToM(dims.coreShortFt);
  const coreHalfX = (dims.coreOrientation === "east-west" ? longM : shortM) / 2;
  const coreHalfZ = (dims.coreOrientation === "east-west" ? shortM : longM) / 2;
  const core: XZ[] = [
    [-coreHalfX, -coreHalfZ],
    [coreHalfX, -coreHalfZ],
    [coreHalfX, coreHalfZ],
    [-coreHalfX, coreHalfZ],
  ];
  const slabM = ftToM(dims.slabFt);
  const storyM = ftToM(d.story.ft);
  if (d.kind === "lobby" && d.lobby) {
    // Open-topped: no slab above is drawn, so the wall height is the full
    // cited interval (tree splice minus the floor 2 line).
    return {
      halfM,
      chamferM,
      plate,
      coreHalfX,
      coreHalfZ,
      core,
      slabM,
      storyM,
      ceilingM: storyM,
      columnWidthM: ftToM(dims.columnWidthFt),
      columnDepthM: ftToM(dims.columnDepthFt),
      columnPitchM: ftToM(dims.columnPitchFt),
      columnsPerFace: dims.columnsPerFace,
      drawColumns: false,
      kind: "lobby",
      baseColumns: { count: d.lobby.baseColumnsPerFace, pitchM: ftToM(d.lobby.baseColumnPitchFt), firstOffsetM: ftToM(d.lobby.baseFirstOffsetFt) },
    };
  }
  return {
    halfM,
    chamferM,
    plate,
    coreHalfX,
    coreHalfZ,
    core,
    slabM,
    storyM,
    ceilingM: storyM - slabM,
    columnWidthM: ftToM(dims.columnWidthFt),
    columnDepthM: ftToM(dims.columnDepthFt),
    columnPitchM: ftToM(dims.columnPitchFt),
    columnsPerFace: dims.columnsPerFace,
    drawColumns: d.floor >= 9 && d.floor <= 107,
    kind: "floor",
    baseColumns: null,
  };
}

/** Distance from a point to the nearest core face, 0 inside the core. Used for the elevator prompt. */
export function distanceToCore(plan: Plan, x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x) - plan.coreHalfX);
  const dz = Math.max(0, Math.abs(z) - plan.coreHalfZ);
  return Math.hypot(dx, dz);
}

/**
 * Lobby plaque anchors: either side of the way from the start to the core,
 * alternating east and west and stepping toward the core, so they are in view
 * on arrival. A presentation choice (paradata P-074); the source gives no
 * position for a lobby tenant. Sizes are presentation, not building.
 */
export function lobbyPlaquePoints(plan: Plan, n: number): { point: XZ; theta: number }[] {
  const out: { point: XZ; theta: number }[] = [];
  const start = startPose(plan);
  const sideM = 9;
  const aheadM = 7;
  const stepM = 5;
  for (let i = 0; i < n; i++) {
    const x = (i % 2 === 0 ? 1 : -1) * sideM;
    const z = Math.max(plan.coreHalfZ + PRESENTATION.playerRadiusM + 3, start.z - aheadM - stepM * Math.floor(i / 2));
    out.push({ point: [x, z], theta: angleOf([x, z]) });
  }
  return out;
}

// ---- angles. theta = 0 points south (+z), increasing toward east (+x).
export const TAU = Math.PI * 2;

export function dirOf(theta: number): XZ {
  return [Math.sin(theta), Math.cos(theta)];
}

export function angleOf([x, z]: XZ): number {
  const a = Math.atan2(x, z);
  return a < 0 ? a + TAU : a;
}

/** Where the ray from the origin at angle theta leaves a convex polygon that contains the origin. */
export function radialPoint(poly: XZ[], theta: number): XZ {
  const [dx, dz] = dirOf(theta);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [px, pz] = poly[i];
    const [qx, qz] = poly[(i + 1) % poly.length];
    const ex = qx - px;
    const ez = qz - pz;
    const det = dx * ez - dz * ex;
    if (Math.abs(det) < 1e-12) continue;
    // t * d = p + s * e
    const t = (px * ez - pz * ex) / det;
    const s = (px * dz - pz * dx) / det;
    if (t > 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  if (!Number.isFinite(best)) return [0, 0];
  return [dx * best, dz * best];
}

export function pointInPolygon([x, z]: XZ, poly: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: XZ[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return Math.abs(a) / 2;
}

// ---- tenant zones

export interface Zone {
  key: string;
  tenant: TenantLite | null;
  theta0: number;
  theta1: number;
  /** Fraction of the leasable ring, after normalisation. */
  share: number;
  /** How the share was set, for the plaque. */
  shareBasis: "sq ft as listed" | "sq ft not given, smallest listed share" | "sq ft not given, equal share" | "whole ring";
  polygon: XZ[];
  /** Whole ring: octagon with the core as a hole (single zone only). */
  ring: boolean;
  color: string;
  /** Plaque anchor, mid-way between core and glass on the zone's centre ray. */
  plaque: XZ;
  plaqueTheta: number;
}

function wedgePolygon(outer: XZ[], inner: XZ[], theta0: number, theta1: number): XZ[] {
  const between = (a: number) => a > theta0 + 1e-9 && a < theta1 - 1e-9;
  const outerPts = outer.map((p) => ({ p, a: angleOf(p) })).filter((v) => between(v.a)).sort((u, v) => u.a - v.a).map((v) => v.p);
  const innerPts = inner.map((p) => ({ p, a: angleOf(p) })).filter((v) => between(v.a)).sort((u, v) => v.a - u.a).map((v) => v.p);
  return [radialPoint(outer, theta0), ...outerPts, radialPoint(outer, theta1), radialPoint(inner, theta1), ...innerPts, radialPoint(inner, theta0)];
}

export function layoutZones(d: WalkData, plan: Plan): Zone[] {
  // The lobby has no tenant zones: its LBBY rows go on perimeter plaques (P-074).
  if (d.kind === "lobby") return [];
  const rows = d.tenants;
  const color = (t: TenantLite | null): string => {
    if (!t) return d.isMechanical ? NO_RECORD_MECHANICAL_COLOR : NO_RECORD_COLOR;
    if (!t.industry) return INDUSTRY_BLANK_COLOR;
    return d.industryColors[t.industry] ?? INDUSTRY_BLANK_COLOR;
  };
  const plaqueFor = (theta: number): XZ => {
    const [ox, oz] = radialPoint(plan.plate, theta);
    const [ix, iz] = radialPoint(plan.core, theta);
    return [(ox + ix) / 2, (oz + iz) / 2];
  };

  if (rows.length === 0) {
    return [
      {
        key: "no-record",
        tenant: null,
        theta0: 0,
        theta1: TAU,
        share: 1,
        shareBasis: "whole ring",
        polygon: plan.plate,
        ring: true,
        color: color(null),
        plaque: plaqueFor(0),
        plaqueTheta: 0,
      },
    ];
  }

  const listed = rows.filter((t) => t.sq_ft !== null).map((t) => t.sq_ft as number);
  const smallest = listed.length ? Math.min(...listed) : null;
  const weights = rows.map((t) => {
    if (t.sq_ft !== null) return { w: t.sq_ft, basis: "sq ft as listed" as const };
    if (smallest !== null) return { w: smallest, basis: "sq ft not given, smallest listed share" as const };
    return { w: 1, basis: "sq ft not given, equal share" as const };
  });
  const total = weights.reduce((a, x) => a + x.w, 0);

  if (rows.length === 1) {
    const t = rows[0];
    return [
      {
        key: t.id,
        tenant: t,
        theta0: 0,
        theta1: TAU,
        share: 1,
        shareBasis: weights[0].basis,
        polygon: plan.plate,
        ring: true,
        color: color(t),
        plaque: plaqueFor(0),
        plaqueTheta: 0,
      },
    ];
  }

  const zones: Zone[] = [];
  let theta = 0;
  rows.forEach((t, i) => {
    const share = weights[i].w / total;
    const theta0 = theta;
    const theta1 = i === rows.length - 1 ? TAU : theta + share * TAU;
    const mid = (theta0 + theta1) / 2;
    zones.push({
      key: t.id,
      tenant: t,
      theta0,
      theta1,
      share,
      shareBasis: weights[i].basis,
      polygon: wedgePolygon(plan.plate, plan.core, theta0, theta1),
      ring: false,
      color: color(t),
      plaque: plaqueFor(mid),
      plaqueTheta: mid,
    });
    theta = theta1;
  });
  return zones;
}

/** The radial boundary between two zones: from the core face to the glass. */
export function boundarySegment(plan: Plan, theta: number): { from: XZ; to: XZ } {
  return { from: radialPoint(plan.core, theta), to: radialPoint(plan.plate, theta) };
}

// ---- collision. Simple clamps: stay inside the glass line, stay out of the core.

export function clampToFloor(plan: Plan, x: number, z: number): XZ {
  const r = PRESENTATION.playerRadiusM;
  // Column inner face sits half a column depth inside the reference line.
  const inset = (plan.drawColumns ? plan.columnDepthM / 2 : 0) + r;
  const lim = plan.halfM - inset;
  let cx = Math.max(-lim, Math.min(lim, x));
  let cz = Math.max(-lim, Math.min(lim, z));
  // Chamfer: |x| + |z| <= 2h - c on the diagonal, inset by r * sqrt(2).
  const diag = 2 * plan.halfM - plan.chamferM - inset * Math.SQRT2;
  const s = Math.abs(cx) + Math.abs(cz);
  if (s > diag) {
    const k = diag / s;
    cx *= k;
    cz *= k;
  }
  // Core: push out along the axis of least penetration.
  const px = plan.coreHalfX + r - Math.abs(cx);
  const pz = plan.coreHalfZ + r - Math.abs(cz);
  if (px > 0 && pz > 0) {
    if (px < pz) cx += Math.sign(cx || 1) * px;
    else cz += Math.sign(cz || 1) * pz;
  }
  return [cx, cz];
}

/** Start just inside the glass on the south side, facing the core (north, -z). yaw 0 looks down -z. */
export function startPose(plan: Plan): { x: number; z: number; yaw: number } {
  const z = plan.halfM - (plan.drawColumns ? plan.columnDepthM / 2 : 0) - PRESENTATION.startInsetM;
  return { x: 0, z, yaw: 0 };
}
