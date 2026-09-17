"use client";
// Stylised people for the illustration layer. Each figure is three capsules
// and a sphere with no face, no name and no tenant, in one of three muted
// clothing tones. A few stand at their zone's plaque; the rest walk slow loops
// along the two aisles the fit-out leaves free, the one inside the glass and
// the one around the core, and never leave their zone. Their number scales
// with the desks in the zone. Illustration only: it mounts inside the
// illustration group, so the toggle removes it. Paradata P-079.
//
// Motion runs on a 20 fps budget: the useFrame accumulates time and only
// rewrites the instance matrices when a twentieth of a second has passed, then
// asks for another frame, so it is safe under a demand frameloop as well as the
// walk's continuous one.
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from "three";
import type { Placement } from "./Illustration";
import { FIT_OUT } from "./Illustration";
import { angleOf, dirOf, radialPoint, TAU, type Plan, type XZ, type Zone } from "./plan";

/** Figure proportions and pacing. Presentation, cited by nothing. */
const FIGURE = {
  legsR: 0.12,
  legsLen: 0.42,
  bodyR: 0.17,
  bodyLen: 0.7,
  headR: 0.11,
  /** Centre heights in metres. */
  legsY: 0.33,
  bodyY: 1.02,
  headY: 1.62,
  walkMps: 0.9,
  fps: 20,
  perDesks: 8,
  maxPerZone: 6,
  maxTotal: 48,
  /** Aisle centre lines: inside the glass corridor and around the core. */
  glassAisleInsetM: 1.25,
  coreAisleOutM: 0.6,
  /** Keep clear of the zone boundary walls by about this arc length. */
  boundaryClearM: 1.0,
  standOffM: 0.9,
} as const;

const TONES = ["#9aa3b4", "#c2a88f", "#9db09c"];
const LEGS_TONE = "#7d7872";
const HEAD_TONE = "#d9c9b4";

interface Figure {
  tone: number;
  kind: "stand" | "walk";
  /** World path in XZ. A standing figure has one point. */
  path: XZ[];
  loop: boolean;
  seg: number;
  t: number;
  dir: 1 | -1;
  yaw: number;
  phase: number;
}

/** The plate outline moved inward by d, keeping the chamfer. */
function insetOctagon(plan: Plan, d: number): XZ[] {
  const h = plan.halfM - (plan.drawColumns ? plan.columnDepthM / 2 : 0) - d;
  const c = plan.chamferM;
  return [
    [-h + c, -h],
    [h - c, -h],
    [h, -h + c],
    [h, h - c],
    [h - c, h],
    [-h + c, h],
    [-h, h - c],
    [-h, -h + c],
  ];
}

function coreRing(plan: Plan, d: number): XZ[] {
  const x = plan.coreHalfX + d;
  const z = plan.coreHalfZ + d;
  return [
    [-x, -z],
    [x, -z],
    [x, z],
    [-x, z],
  ];
}

/** Points along a convex ring between two angles, every ~stepM of arc, with the ring's corners kept. */
function ringPath(ring: XZ[], theta0: number, theta1: number, stepM: number): XZ[] {
  const out: XZ[] = [];
  const r0 = Math.hypot(...radialPoint(ring, (theta0 + theta1) / 2));
  const steps = Math.max(2, Math.ceil(((theta1 - theta0) * r0) / stepM));
  const corners = ring.map((p) => angleOf(p)).filter((a) => a > theta0 && a < theta1);
  const angles = new Set<number>();
  for (let i = 0; i <= steps; i++) angles.add(theta0 + ((theta1 - theta0) * i) / steps);
  for (const a of corners) angles.add(a);
  for (const a of [...angles].sort((u, v) => u - v)) out.push(radialPoint(ring, a));
  return out;
}

function buildFigures(plan: Plan, zones: Zone[], desks: Placement[]): Figure[] {
  const out: Figure[] = [];
  const glassRing = insetOctagon(plan, FIT_OUT.glassMargin - FIGURE.glassAisleInsetM);
  const coreRingPts = coreRing(plan, FIGURE.coreAisleOutM);
  const perZone = new Map<number, number>();
  for (const d of desks) perZone.set(d.zone, (perZone.get(d.zone) ?? 0) + 1);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  zones.forEach((zone, zi) => {
    if (!zone.tenant) return; // nobody is placed in a zone with no tenant record
    const deskCount = perZone.get(zi) ?? 0;
    if (deskCount === 0) return;
    const n = Math.min(FIGURE.maxPerZone, Math.max(1, Math.ceil(deskCount / FIGURE.perDesks)));
    for (let i = 0; i < n && out.length < FIGURE.maxTotal; i++) {
      const tone = (zi + i) % TONES.length;
      if (i === 0) {
        // Standing at the plaque, a step toward the glass, facing the core.
        const [px, pz] = zone.plaque;
        const [dx, dz] = dirOf(zone.plaqueTheta);
        const x = px + dx * FIGURE.standOffM;
        const z = pz + dz * FIGURE.standOffM;
        out.push({ tone, kind: "stand", path: [[x, z]], loop: false, seg: 0, t: 0, dir: 1, yaw: Math.atan2(-dx, -dz), phase: rnd() * TAU });
        continue;
      }
      const ring = i % 2 === 1 ? glassRing : coreRingPts;
      let path: XZ[];
      if (zone.ring) {
        path = ringPath(ring, 0, TAU, 2.5);
      } else {
        const r = Math.hypot(...radialPoint(ring, zone.plaqueTheta));
        const clear = FIGURE.boundaryClearM / Math.max(r, 1);
        const a0 = zone.theta0 + clear;
        const a1 = zone.theta1 - clear;
        if (a1 - a0 < clear) continue; // zone too narrow for a walk
        path = ringPath(ring, a0, a1, 2.5);
      }
      if (path.length < 2) continue;
      const seg = Math.floor(rnd() * (path.length - 1));
      out.push({ tone, kind: "walk", path, loop: zone.ring, seg, t: rnd(), dir: rnd() < 0.5 ? 1 : -1, yaw: 0, phase: rnd() * TAU });
    }
  });
  return out;
}

function advance(f: Figure, dt: number): void {
  if (f.kind !== "walk") return;
  let remaining = FIGURE.walkMps * dt;
  for (let guard = 0; guard < 8 && remaining > 0; guard++) {
    const a = f.path[f.seg];
    const b = f.path[f.seg + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = f.dir === 1 ? (1 - f.t) * len : f.t * len;
    if (remaining < along) {
      f.t += (f.dir * remaining) / Math.max(len, 1e-6);
      remaining = 0;
    } else {
      remaining -= along;
      if (f.dir === 1) {
        if (f.seg + 1 < f.path.length - 1) {
          f.seg += 1;
          f.t = 0;
        } else if (f.loop) {
          f.seg = 0;
          f.t = 0;
        } else {
          f.dir = -1;
          f.t = 1;
        }
      } else if (f.seg > 0) {
        f.seg -= 1;
        f.t = 1;
      } else if (f.loop) {
        f.seg = f.path.length - 2;
        f.t = 1;
      } else {
        f.dir = 1;
        f.t = 0;
      }
    }
  }
  const a = f.path[f.seg];
  const b = f.path[f.seg + 1];
  const dx = (b[0] - a[0]) * f.dir;
  const dz = (b[1] - a[1]) * f.dir;
  if (dx !== 0 || dz !== 0) f.yaw = Math.atan2(dx, dz);
}

function positionOf(f: Figure): XZ {
  if (f.kind === "stand") return f.path[0];
  const a = f.path[f.seg];
  const b = f.path[f.seg + 1];
  return [a[0] + (b[0] - a[0]) * f.t, a[1] + (b[1] - a[1]) * f.t];
}

export function Figures({ plan, zones, desks, onCount }: { plan: Plan; zones: Zone[]; desks: Placement[]; onCount: (n: number) => void }) {
  const figures = useMemo(() => buildFigures(plan, zones, desks), [plan, zones, desks]);
  const n = figures.length;
  useEffect(() => {
    onCount(n);
    return () => onCount(0);
  }, [n, onCount]);

  const geoms = useMemo(
    () => ({
      legs: new CapsuleGeometry(FIGURE.legsR, FIGURE.legsLen, 3, 8),
      body: new CapsuleGeometry(FIGURE.bodyR, FIGURE.bodyLen, 3, 10),
      head: new SphereGeometry(FIGURE.headR, 10, 8),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      legs: new MeshStandardMaterial({ color: new Color(LEGS_TONE), roughness: 1, metalness: 0 }),
      body: new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 1, metalness: 0 }),
      head: new MeshStandardMaterial({ color: new Color(HEAD_TONE), roughness: 1, metalness: 0 }),
    }),
    [],
  );
  useEffect(() => () => {
    Object.values(geoms).forEach((g) => g.dispose());
    Object.values(mats).forEach((m) => m.dispose());
  }, [geoms, mats]);

  const legsRef = useRef<InstancedMesh>(null);
  const bodyRef = useRef<InstancedMesh>(null);
  const headRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const acc = useRef(0);
  const clock = useRef(0);
  const scratch = useMemo(() => ({ m: new Matrix4(), q: new Quaternion(), p: new Vector3(), one: new Vector3(1, 1, 1), up: new Vector3(0, 1, 0) }), []);

  // Clothing tones once per mount.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || n === 0) return;
    const c = new Color();
    figures.forEach((f, i) => body.setColorAt(i, c.set(TONES[f.tone])));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
  }, [figures, n]);

  const write = (time: number) => {
    const legs = legsRef.current;
    const body = bodyRef.current;
    const head = headRef.current;
    if (!legs || !body || !head) return;
    const { m, q, p, one, up } = scratch;
    figures.forEach((f, i) => {
      const [x, z] = positionOf(f);
      const bob = f.kind === "walk" ? Math.abs(Math.sin(time * 6 + f.phase)) * 0.03 : Math.sin(time * 1.3 + f.phase) * 0.012;
      const yaw = f.kind === "walk" ? f.yaw : f.yaw + Math.sin(time * 0.7 + f.phase) * 0.12;
      q.setFromAxisAngle(up, yaw);
      legs.setMatrixAt(i, m.compose(p.set(x, FIGURE.legsY + bob, z), q, one));
      body.setMatrixAt(i, m.compose(p.set(x, FIGURE.bodyY + bob, z), q, one));
      head.setMatrixAt(i, m.compose(p.set(x, FIGURE.headY + bob, z), q, one));
    });
    legs.instanceMatrix.needsUpdate = true;
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    legs.computeBoundingSphere();
    body.computeBoundingSphere();
    head.computeBoundingSphere();
  };

  useEffect(() => {
    if (n > 0) write(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figures, n]);

  useFrame((_, dt) => {
    if (n === 0) return;
    acc.current += Math.min(dt, 0.25);
    if (acc.current < 1 / FIGURE.fps) {
      invalidate();
      return;
    }
    const step = acc.current;
    acc.current = 0;
    clock.current += step;
    for (const f of figures) advance(f, step);
    write(clock.current);
    invalidate();
  });

  if (n === 0) return null;
  return (
    <group name="illustration-figures">
      <instancedMesh ref={legsRef} args={[geoms.legs, mats.legs, n]} frustumCulled={false} />
      <instancedMesh ref={bodyRef} args={[geoms.body, mats.body, n]} frustumCulled={false} />
      <instancedMesh ref={headRef} args={[geoms.head, mats.head, n]} frustumCulled={false} />
    </group>
  );
}
