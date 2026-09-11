"use client";
// The illustration layer. A generic late-1990s office fit-out made of boxes
// and cylinders. It is a hypothetical reconstruction in London Charter terms:
// nothing here is sized from a source, nothing is tied to a tenant, and the
// HUD carries a persistent label while it is on. It shares no material with
// the cited layer: everything is a muted, grayscale-warm stipple so it cannot
// be read as evidence. Paradata P-051.
import { useEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { pointInPolygon, startPose, type Plan, type XZ, type Zone } from "./plan";

/**
 * Furnishing sizes. Generic, uncited, and declared as such on screen. They
 * describe the illustration, not the building.
 */
const FIT_OUT = {
  deskW: 1.6,
  deskD: 0.8,
  deskH: 0.74,
  deskTop: 0.03,
  partitionH: 1.2,
  partitionT: 0.05,
  chairR: 0.24,
  chairSeatH: 0.46,
  chairBackH: 0.42,
  gridX: 2.7,
  gridZ: 2.5,
  glassMargin: 2.5,
  /** No furniture within this radius of the start position, so the visitor arrives in an aisle. */
  startPocket: 4.0,
  coreMargin: 1.2,
  boundaryMargin: 0.25,
  ceilingCell: 0.6,
  ceilingDrop: 0.03,
  tileSize: 0.58,
  tileT: 0.02,
  carpetTile: 0.5,
  maxDesks: 600,
  maxTiles: 3600,
} as const;

function stippleTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e4dfd6";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#a59d91";
  for (let y = 3; y < 64; y += 8) for (let x = (y / 8) % 2 === 0 ? 3 : 7; x < 64; x += 8) g.fillRect(x, y, 1.5, 1.5);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function carpetTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "rgba(120,112,100,0.35)";
  for (let y = 3; y < 128; y += 8) for (let x = (y / 8) % 2 === 0 ? 3 : 7; x < 128; x += 8) g.fillRect(x, y, 2, 2);
  g.strokeStyle = "rgba(90,82,70,0.35)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1 / FIT_OUT.carpetTile, 1 / FIT_OUT.carpetTile);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Placement {
  x: number;
  z: number;
}

/** Footprint corners of a desk-and-partition cluster centred at (x, z). */
function footprint(x: number, z: number): XZ[] {
  const hw = FIT_OUT.deskW / 2 + 0.1;
  const hd = FIT_OUT.deskD / 2 + FIT_OUT.chairR * 2 + 0.2;
  return [
    [x - hw, z - hd],
    [x + hw, z - hd],
    [x + hw, z + hd],
    [x - hw, z + hd],
  ];
}

function insideGlass(plan: Plan, [x, z]: XZ): boolean {
  const lim = plan.halfM - (plan.drawColumns ? plan.columnDepthM / 2 : 0) - FIT_OUT.glassMargin;
  if (Math.abs(x) > lim || Math.abs(z) > lim) return false;
  return Math.abs(x) + Math.abs(z) <= 2 * plan.halfM - plan.chamferM - FIT_OUT.glassMargin * Math.SQRT2;
}

function inCore(plan: Plan, [x, z]: XZ): boolean {
  return Math.abs(x) < plan.coreHalfX + FIT_OUT.coreMargin && Math.abs(z) < plan.coreHalfZ + FIT_OUT.coreMargin;
}

/**
 * Rows of desks on a fixed grid, kept where every corner of the cluster is
 * inside the zone, clear of the core, and clear of the glass. A fixed grid
 * means the count scales with zone area. Zone boundaries are respected by
 * testing the corners against the zone polygon shrunk by a margin.
 */
function placeDesks(plan: Plan, zones: Zone[]): Placement[] {
  const out: Placement[] = [];
  const lim = plan.halfM;
  const start = startPose(plan);
  for (const zone of zones) {
    const inZone = (p: XZ) => (zone.ring ? true : pointInPolygon(p, zone.polygon));
    for (let z = -lim + FIT_OUT.gridZ / 2; z < lim; z += FIT_OUT.gridZ) {
      for (let x = -lim + FIT_OUT.gridX / 2; x < lim; x += FIT_OUT.gridX) {
        const corners = footprint(x, z);
        if (Math.hypot(x - start.x, z - start.z) < FIT_OUT.startPocket) continue;
        if (!corners.every((c) => insideGlass(plan, c) && !inCore(plan, c) && inZone(c))) continue;
        if (!zone.ring) {
          // Keep a little air between the cluster and the boundary wall.
          const pad = FIT_OUT.boundaryMargin;
          const padded: XZ[] = [
            [x - FIT_OUT.deskW / 2 - pad, z - FIT_OUT.deskD - pad],
            [x + FIT_OUT.deskW / 2 + pad, z - FIT_OUT.deskD - pad],
            [x + FIT_OUT.deskW / 2 + pad, z + FIT_OUT.deskD + pad],
            [x - FIT_OUT.deskW / 2 - pad, z + FIT_OUT.deskD + pad],
          ];
          if (!padded.every((c) => inZone(c))) continue;
        }
        out.push({ x, z });
      }
    }
  }
  if (out.length <= FIT_OUT.maxDesks) return out;
  const step = out.length / FIT_OUT.maxDesks;
  const thinned: Placement[] = [];
  for (let i = 0; i < FIT_OUT.maxDesks; i++) thinned.push(out[Math.floor(i * step)]);
  return thinned;
}

function useInstances(count: number, fill: (set: (i: number, x: number, y: number, z: number, rotY?: number) => void) => void) {
  const ref = useRef<InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const one = new Vector3(1, 1, 1);
    fill((i, x, y, z, rotY = 0) => {
      q.setFromAxisAngle(up, rotY);
      mesh.setMatrixAt(i, m.compose(new Vector3(x, y, z), q, one));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [count, fill]);
  return ref;
}

function shapeXZ(points: XZ[], holes: XZ[][] = []): Shape {
  const s = new Shape();
  points.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  for (const h of holes) {
    const p = new Shape();
    h.forEach(([x, z], i) => (i === 0 ? p.moveTo(x, -z) : p.lineTo(x, -z)));
    p.closePath();
    s.holes.push(p);
  }
  return s;
}

export function Illustration({ plan, zones, onDesks }: { plan: Plan; zones: Zone[]; onDesks: (n: number) => void }) {
  const stipple = useMemo(() => stippleTexture(), []);
  const carpet = useMemo(() => carpetTexture(), []);
  const mats = useMemo(
    () => ({
      desk: new MeshStandardMaterial({ map: stipple, color: new Color("#f2eee8"), roughness: 1, metalness: 0 }),
      partition: new MeshStandardMaterial({ map: stipple, color: new Color("#f6f3ee"), roughness: 1, metalness: 0 }),
      chair: new MeshStandardMaterial({ map: stipple, color: new Color("#d9d3ca"), roughness: 1, metalness: 0 }),
      tile: new MeshStandardMaterial({ map: stipple, color: new Color("#faf8f4"), roughness: 1, metalness: 0 }),
      carpet: new MeshStandardMaterial({ map: carpet, color: new Color("#ffffff"), roughness: 1, metalness: 0, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      grid: new LineBasicMaterial({ color: new Color("#a39b8f") }),
    }),
    [stipple, carpet],
  );
  useEffect(() => () => {
    stipple.dispose();
    carpet.dispose();
    Object.values(mats).forEach((m) => m.dispose());
  }, [stipple, carpet, mats]);

  const desks = useMemo(() => placeDesks(plan, zones), [plan, zones]);
  useEffect(() => onDesks(desks.length), [desks.length, onDesks]);

  const geoms = useMemo(
    () => ({
      deskTop: new BoxGeometry(FIT_OUT.deskW, FIT_OUT.deskTop, FIT_OUT.deskD),
      deskLeg: new BoxGeometry(0.05, FIT_OUT.deskH - FIT_OUT.deskTop, FIT_OUT.deskD - 0.1),
      partition: new BoxGeometry(FIT_OUT.deskW + 0.2, FIT_OUT.partitionH, FIT_OUT.partitionT),
      seat: new CylinderGeometry(FIT_OUT.chairR, FIT_OUT.chairR * 0.9, 0.08, 12),
      back: new BoxGeometry(FIT_OUT.chairR * 1.6, FIT_OUT.chairBackH, 0.05),
      post: new CylinderGeometry(0.03, 0.03, FIT_OUT.chairSeatH, 8),
      tile: new BoxGeometry(FIT_OUT.tileSize, FIT_OUT.tileT, FIT_OUT.tileSize),
    }),
    [],
  );
  useEffect(() => () => Object.values(geoms).forEach((g) => g.dispose()), [geoms]);

  const n = desks.length;
  const deskTopRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x, FIT_OUT.deskH - FIT_OUT.deskTop / 2, d.z)));
  const legLRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x - FIT_OUT.deskW / 2 + 0.05, (FIT_OUT.deskH - FIT_OUT.deskTop) / 2, d.z)));
  const legRRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x + FIT_OUT.deskW / 2 - 0.05, (FIT_OUT.deskH - FIT_OUT.deskTop) / 2, d.z)));
  const partRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x, FIT_OUT.partitionH / 2, d.z - FIT_OUT.deskD / 2 - FIT_OUT.partitionT)));
  const chairZ = (d: Placement) => d.z + FIT_OUT.deskD / 2 + FIT_OUT.chairR + 0.1;
  const seatRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x, FIT_OUT.chairSeatH, chairZ(d))));
  const backRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x, FIT_OUT.chairSeatH + FIT_OUT.chairBackH / 2, chairZ(d) + FIT_OUT.chairR - 0.03)));
  const postRef = useInstances(n, (set) => desks.forEach((d, i) => set(i, d.x, FIT_OUT.chairSeatH / 2, chairZ(d))));

  // Ceiling grid lines and a scatter of tiles, just under the slab above,
  // over the inner square (which sits inside the chamfered plate).
  const inner = plan.halfM - plan.chamferM;
  const gridGeom = useMemo(() => {
    const pts: number[] = [];
    const y = plan.ceilingM - FIT_OUT.ceilingDrop;
    const cells = Math.floor((2 * inner) / FIT_OUT.ceilingCell);
    const span = (cells * FIT_OUT.ceilingCell) / 2;
    for (let i = 0; i <= cells; i++) {
      const a = -span + i * FIT_OUT.ceilingCell;
      pts.push(a, y, -span, a, y, span, -span, y, a, span, y, a);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, [plan, inner]);
  useEffect(() => () => gridGeom.dispose(), [gridGeom]);

  const tiles = useMemo(() => {
    const out: Placement[] = [];
    const cells = Math.floor((2 * inner) / FIT_OUT.ceilingCell);
    const span = (cells * FIT_OUT.ceilingCell) / 2;
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        if ((i + j) % 3 !== 0) continue;
        const x = -span + (i + 0.5) * FIT_OUT.ceilingCell;
        const z = -span + (j + 0.5) * FIT_OUT.ceilingCell;
        if (Math.abs(x) < plan.coreHalfX && Math.abs(z) < plan.coreHalfZ) continue;
        out.push({ x, z });
        if (out.length >= FIT_OUT.maxTiles) return out;
      }
    }
    return out;
  }, [plan, inner]);
  const tileRef = useInstances(tiles.length, (set) => tiles.forEach((t, i) => set(i, t.x, plan.ceilingM - FIT_OUT.ceilingDrop - FIT_OUT.tileT, t.z)));

  const carpetGeom = useMemo(() => new ShapeGeometry(shapeXZ(plan.plate, [plan.core])), [plan]);
  useEffect(() => () => carpetGeom.dispose(), [carpetGeom]);

  return (
    <group name="illustration-layer">
      <mesh geometry={carpetGeom} material={mats.carpet} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} />
      <lineSegments geometry={gridGeom} material={mats.grid} />
      <instancedMesh ref={tileRef} args={[geoms.tile, mats.tile, tiles.length]} frustumCulled={false} />
      {n > 0 ? (
        <>
          <instancedMesh ref={deskTopRef} args={[geoms.deskTop, mats.desk, n]} frustumCulled={false} />
          <instancedMesh ref={legLRef} args={[geoms.deskLeg, mats.desk, n]} frustumCulled={false} />
          <instancedMesh ref={legRRef} args={[geoms.deskLeg, mats.desk, n]} frustumCulled={false} />
          <instancedMesh ref={partRef} args={[geoms.partition, mats.partition, n]} frustumCulled={false} />
          <instancedMesh ref={seatRef} args={[geoms.seat, mats.chair, n]} frustumCulled={false} />
          <instancedMesh ref={backRef} args={[geoms.back, mats.chair, n]} frustumCulled={false} />
          <instancedMesh ref={postRef} args={[geoms.post, mats.chair, n]} frustumCulled={false} />
        </>
      ) : null}
    </group>
  );
}
