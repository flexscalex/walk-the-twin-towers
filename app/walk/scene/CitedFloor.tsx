"use client";
// The cited layer. Every mesh here is sized by a parameter in
// data/geometry-params.json (via WalkData.dims) or by a tenant row in
// data/tenants.clean.json. Nothing is estimated. Where the record is silent the
// element is left out and the HUD lists it (WalkData.omitted).
import { useEffect, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";
import type { TenantLite } from "@/lib/floors";
import type { WalkData } from "@/lib/walk";
import { INK, PAPER_2 } from "@/lib/industry-colors";
import { boundarySegment, lobbyPlaquePoints, PRESENTATION, type Plan, type XZ, type Zone } from "./plan";
import { Signs } from "./Signs";

// Materials for the cited layer: flat, matte, in the site's palette. The
// illustration layer never uses these (see Illustration.tsx).
const MAT = {
  slab: new MeshStandardMaterial({ color: new Color("#d9d2c4"), roughness: 0.95, metalness: 0 }),
  ceiling: new MeshStandardMaterial({ color: new Color("#e9e2d4"), roughness: 0.95, metalness: 0 }),
  core: new MeshStandardMaterial({ color: new Color("#bfb4a2"), roughness: 0.9, metalness: 0 }),
  column: new MeshStandardMaterial({ color: new Color("#8f8778"), roughness: 0.7, metalness: 0.1 }),
  glass: new MeshStandardMaterial({
    color: new Color("#cfe3ea"),
    roughness: 0.15,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    side: DoubleSide,
    depthWrite: false,
  }),
  chamfer: new MeshStandardMaterial({ color: new Color(PAPER_2), roughness: 1, metalness: 0, side: DoubleSide }),
  boundary: new MeshStandardMaterial({
    color: new Color(INK),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  }),
  /** Base column lines in the lobby: a position with no section (P-039, P-071). */
  columnLine: new LineBasicMaterial({ color: new Color("#6f675a") }),
};

/** Shape in the XZ plane. Shapes are XY; after rotation.x = -PI/2, shape y maps to -z. */
function shapeXZ(points: XZ[], holes: XZ[][] = []): Shape {
  const s = new Shape();
  points.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  for (const h of holes) {
    const path = new Shape();
    h.forEach(([x, z], i) => (i === 0 ? path.moveTo(x, -z) : path.lineTo(x, -z)));
    path.closePath();
    s.holes.push(path);
  }
  return s;
}

function Slabs({ plan }: { plan: Plan }) {
  const geom = useMemo(() => new ExtrudeGeometry(shapeXZ(plan.plate), { depth: plan.slabM, bevelEnabled: false }), [plan]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <>
      {/* This floor's slab: top face at y = 0. */}
      <mesh geometry={geom} material={MAT.slab} rotation={[-Math.PI / 2, 0, 0]} position={[0, -plan.slabM, 0]} />
      {/* The slab above: its underside is the ceiling. The lobby has none: its height is not cited. */}
      {plan.kind === "floor" ? <mesh geometry={geom} material={MAT.ceiling} rotation={[-Math.PI / 2, 0, 0]} position={[0, plan.ceilingM, 0]} /> : null}
    </>
  );
}

/**
 * Lobby perimeter: the base columns at their cited 10 ft centres, drawn as
 * vertical lines because no base column section is cited (unresolved
 * towers.base_column_section, paradata P-039, P-071), with one glass plane per
 * face between the chamfers. Both run from the floor 2 line to the cited tree
 * splice elevation (plan.ceilingM), which is a column elevation and not a
 * lobby height.
 */
function BasePerimeter({ plan, onCount }: { plan: Plan; onCount: (columns: number, glass: number) => void }) {
  const base = plan.baseColumns;
  const h = plan.halfM;
  const lineGeom = useMemo(() => {
    const pts: number[] = [];
    if (base) {
      for (let k = 0; k < base.count; k++) {
        const a = -h + base.firstOffsetM + k * base.pitchM;
        pts.push(a, 0, h, a, plan.ceilingM, h, a, 0, -h, a, plan.ceilingM, -h, h, 0, a, h, plan.ceilingM, a, -h, 0, a, -h, plan.ceilingM, a);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, [base, h, plan.ceilingM]);
  const glassGeom = useMemo(() => new PlaneGeometry(2 * (h - plan.chamferM), plan.ceilingM), [h, plan.chamferM, plan.ceilingM]);
  useEffect(() => () => {
    lineGeom.dispose();
    glassGeom.dispose();
  }, [lineGeom, glassGeom]);
  useEffect(() => {
    onCount(base ? base.count * 4 : 0, 4);
  }, [base, onCount]);
  const y = plan.ceilingM / 2;
  return (
    <>
      <lineSegments geometry={lineGeom} material={MAT.columnLine} frustumCulled={false} />
      <mesh geometry={glassGeom} material={MAT.glass} position={[0, y, h]} renderOrder={10} />
      <mesh geometry={glassGeom} material={MAT.glass} position={[0, y, -h]} renderOrder={10} />
      <mesh geometry={glassGeom} material={MAT.glass} position={[h, y, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={10} />
      <mesh geometry={glassGeom} material={MAT.glass} position={[-h, y, 0]} rotation={[0, Math.PI / 2, 0]} renderOrder={10} />
    </>
  );
}

function Core({ plan }: { plan: Plan }) {
  return (
    <mesh material={MAT.core} position={[0, plan.ceilingM / 2, 0]}>
      <boxGeometry args={[plan.coreHalfX * 2, plan.ceilingM, plan.coreHalfZ * 2]} />
    </mesh>
  );
}

/**
 * Perimeter columns: per face, columnsPerFace boxes at columnPitch on centre,
 * the first one chamfer in from the reference line, centred on the line
 * (paradata P-045). Glass fills the clear gap between adjacent column faces on
 * each face: pitch minus column width. That gap is derived, not a cited window
 * width (unresolved towers.window_width); the HUD says so.
 */
function Perimeter({ plan, onCount }: { plan: Plan; onCount: (columns: number, glass: number) => void }) {
  const colRef = useRef<InstancedMesh>(null);
  const glassRef = useRef<InstancedMesh>(null);
  const n = plan.columnsPerFace;
  const columns = n * 4;
  const glass = (n - 1) * 4;
  const gapM = plan.columnPitchM - plan.columnWidthM;

  const colGeom = useMemo(() => new BoxGeometry(plan.columnWidthM, plan.ceilingM, plan.columnDepthM), [plan]);
  const glassGeom = useMemo(() => new PlaneGeometry(gapM, plan.ceilingM), [gapM, plan]);
  useEffect(() => () => {
    colGeom.dispose();
    glassGeom.dispose();
  }, [colGeom, glassGeom]);

  useEffect(() => {
    const cm = colRef.current;
    const gm = glassRef.current;
    if (!cm || !gm) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const yTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const h = plan.halfM;
    const y = plan.ceilingM / 2;
    let ci = 0;
    let gi = 0;
    for (let k = 0; k < n; k++) {
      const a = -h + plan.chamferM + k * plan.columnPitchM;
      // south (+z) and north (-z) faces: box runs along x
      cm.setMatrixAt(ci++, m.compose(new Vector3(a, y, h), q.identity(), one));
      cm.setMatrixAt(ci++, m.compose(new Vector3(a, y, -h), q.identity(), one));
      // east (+x) and west (-x) faces: turned 90 degrees
      cm.setMatrixAt(ci++, m.compose(new Vector3(h, y, a), yTurn, one));
      cm.setMatrixAt(ci++, m.compose(new Vector3(-h, y, a), yTurn, one));
      if (k < n - 1) {
        const g = a + plan.columnPitchM / 2;
        gm.setMatrixAt(gi++, m.compose(new Vector3(g, y, h), q.identity(), one));
        gm.setMatrixAt(gi++, m.compose(new Vector3(g, y, -h), q.identity(), one));
        gm.setMatrixAt(gi++, m.compose(new Vector3(h, y, g), yTurn, one));
        gm.setMatrixAt(gi++, m.compose(new Vector3(-h, y, g), yTurn, one));
      }
    }
    cm.instanceMatrix.needsUpdate = true;
    gm.instanceMatrix.needsUpdate = true;
    cm.computeBoundingSphere();
    gm.computeBoundingSphere();
    onCount(columns, glass);
  }, [plan, n, columns, glass, onCount]);

  return (
    <>
      <instancedMesh ref={colRef} args={[colGeom, MAT.column, columns]} frustumCulled={false} />
      <instancedMesh ref={glassRef} args={[glassGeom, MAT.glass, glass]} frustumCulled={false} renderOrder={10} />
    </>
  );
}

/** The four chamfer faces, drawn as plain panels. The corner member itself is not cited. */
function Chamfers({ plan }: { plan: Plan }) {
  const len = plan.chamferM * Math.SQRT2;
  const h = plan.halfM;
  const c = plan.chamferM;
  const mid = h - c / 2;
  const corners: { pos: [number, number, number]; rotY: number }[] = [
    { pos: [mid, plan.ceilingM / 2, mid], rotY: -Math.PI / 4 },
    { pos: [-mid, plan.ceilingM / 2, mid], rotY: Math.PI / 4 },
    { pos: [-mid, plan.ceilingM / 2, -mid], rotY: (3 * Math.PI) / 4 },
    { pos: [mid, plan.ceilingM / 2, -mid], rotY: (-3 * Math.PI) / 4 },
  ];
  return (
    <>
      {corners.map((k, i) => (
        <mesh key={i} material={MAT.chamfer} position={k.pos} rotation={[0, k.rotY, 0]}>
          <planeGeometry args={[len, plan.ceilingM]} />
        </mesh>
      ))}
    </>
  );
}

function ZoneTint({ zone, plan }: { zone: Zone; plan: Plan }) {
  const geom = useMemo(() => new ShapeGeometry(zone.ring ? shapeXZ(plan.plate, [plan.core]) : shapeXZ(zone.polygon)), [zone, plan]);
  const mat = useMemo(() => {
    const reported = zone.tenant?.evidence === "reported";
    return new MeshStandardMaterial({
      color: new Color(zone.color),
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: zone.tenant ? (reported ? 0.45 : 0.9) : 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
  }, [zone]);
  useEffect(() => () => {
    geom.dispose();
    mat.dispose();
  }, [geom, mat]);
  return <mesh geometry={geom} material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} />;
}

function Boundary({ plan, theta }: { plan: Plan; theta: number }) {
  const { from, to } = boundarySegment(plan, theta);
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const rotY = Math.atan2(dx, dz);
  return (
    <mesh
      material={MAT.boundary}
      position={[(from[0] + to[0]) / 2, PRESENTATION.boundaryWallHeightM / 2, (from[1] + to[1]) / 2]}
      rotation={[0, rotY, 0]}
    >
      <boxGeometry args={[PRESENTATION.boundaryWallThicknessM, PRESENTATION.boundaryWallHeightM, len]} />
    </mesh>
  );
}

function formatSqFt(t: Zone["tenant"]): string {
  if (!t) return "";
  return t.sq_ft !== null ? `${t.sq_ft.toLocaleString("en-US")} sq ft` : `sq ft ${t.sq_ft_raw.trim() || "blank"} in source`;
}

/**
 * Plaque at eye height on the zone's centre ray. drei Html in transform mode:
 * 400 CSS px = 1 m at distanceFactor 1; at distanceFactor 2 a 320 px plaque is 1.6 m wide.
 */
function Plaque({ zone, data }: { zone: Zone; data: WalkData }) {
  const t = zone.tenant;
  const [x, z] = zone.plaque;
  return (
    <Html position={[x, PRESENTATION.eyeHeightM, z]} transform sprite distanceFactor={2} center pointerEvents="none" zIndexRange={[5, 0]}>
      <div
        style={{
          width: 320,
          padding: "10px 12px",
          background: "rgba(247,241,230,0.96)",
          border: `1px solid ${INK}`,
          borderRadius: 2,
          color: INK,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
          fontSize: 13,
          lineHeight: 1.3,
          boxShadow: "0 1px 0 rgba(42,37,32,0.25)",
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8a7f72" }}>Cited layer</span>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 5px",
              border: `1px ${t ? "solid" : "dashed"} ${INK}`,
              background: t && t.evidence !== "reported" ? INK : "transparent",
              color: t && t.evidence !== "reported" ? "#f7f1e6" : INK,
              opacity: t?.evidence === "reported" ? 0.6 : 1,
            }}
          >
            {t ? (t.evidence === "unknown" ? "no record" : t.evidence) : "no record"}
          </span>
        </div>
        {t ? (
          <>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{t.name}</div>
            <div style={{ marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{formatSqFt(t)}</div>
            <div style={{ color: "#5c5348" }}>{t.industry ?? "industry blank in source"}</div>
            <div style={{ color: "#5c5348" }}>
              {t.floors.length > 1 ? "floors" : "floor"} {t.floor_raw.trim() || "blank"}
              {t.floor_unresolved ? `, unresolved token ${t.floor_unresolved}` : ""}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: "#8a7f72" }}>
              Zone share {Math.round(zone.share * 1000) / 10}% of the ring, {zone.shareBasis}.
            </div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, fontStyle: "italic" }}>No tenant record in this source.</div>
            {data.isMechanical ? <div style={{ color: "#5c5348" }}>Mechanical equipment room floor per data/geometry-params.json.</div> : null}
            {data.isSkyLobby ? <div style={{ color: "#5c5348" }}>Sky lobby per data/geometry-params.json.</div> : null}
          </>
        )}
        <div style={{ marginTop: 6, fontSize: 10, color: "#8a7f72" }}>
          {t ? `${data.sourceCitation} Row ${t.source_row}, ${t.id}.` : data.sourceCitation}
        </div>
      </div>
    </Html>
  );
}

/** Lobby plaques: one per row coded LBBY, spaced round the perimeter (P-074). */
function LobbyPlaques({ data, plan }: { data: WalkData; plan: Plan }) {
  const rows = data.tenants;
  const points = useMemo(() => lobbyPlaquePoints(plan, Math.max(1, rows.length)), [plan, rows.length]);
  const card = (t: TenantLite | null, key: string, [x, z]: XZ) => (
    <Html key={key} position={[x, PRESENTATION.eyeHeightM, z]} transform sprite distanceFactor={2} center pointerEvents="none" zIndexRange={[5, 0]}>
      <div
        style={{
          width: 320,
          padding: "10px 12px",
          background: "rgba(247,241,230,0.96)",
          border: `1px solid ${INK}`,
          borderRadius: 2,
          color: INK,
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
          fontSize: 13,
          lineHeight: 1.3,
          boxShadow: "0 1px 0 rgba(42,37,32,0.25)",
        }}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8a7f72" }}>Cited layer</span>
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 5px",
              border: `1px ${t ? "solid" : "dashed"} ${INK}`,
              background: t && t.evidence !== "reported" ? INK : "transparent",
              color: t && t.evidence !== "reported" ? "#f7f1e6" : INK,
            }}
          >
            {t ? t.evidence : "no record"}
          </span>
        </div>
        {t ? (
          <>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em" }}>{t.name}</div>
            <div style={{ marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{formatSqFt(t)}</div>
            <div style={{ color: "#5c5348" }}>{t.industry ?? "industry blank in source"}</div>
            <div style={{ color: "#5c5348" }}>Lobby (source code {t.floor_raw.trim() || "blank"})</div>
            <div style={{ marginTop: 4, fontSize: 10, color: "#8a7f72" }}>Position on this plaque is a layout choice; the source gives none.</div>
          </>
        ) : (
          <>
            <div style={{ marginTop: 4, fontSize: 16, fontWeight: 600, fontStyle: "italic" }}>No row in this source is coded LBBY for {data.buildingName}.</div>
            {data.lobby?.otherCoded.length ? (
              <div style={{ color: "#5c5348" }}>
                Rows on other coded levels: {data.lobby.otherCoded.map((o) => `${o.count} ${o.label} (${o.code})`).join(", ")}. Those levels are not this lobby.
              </div>
            ) : null}
          </>
        )}
        <div style={{ marginTop: 6, fontSize: 10, color: "#8a7f72" }}>
          {t ? `${data.sourceCitation} Row ${t.source_row}, ${t.id}.` : data.sourceCitation}
        </div>
      </div>
    </Html>
  );
  if (rows.length === 0) return card(null, "lobby-none", points[0].point);
  return <>{rows.map((t, i) => card(t, t.id, points[i].point))}</>;
}

export function CitedFloor({
  data,
  plan,
  zones,
  onCounts,
}: {
  data: WalkData;
  plan: Plan;
  zones: Zone[];
  onCounts: (columns: number, glass: number) => void;
}) {
  useEffect(() => {
    if (!plan.drawColumns && plan.kind === "floor") onCounts(0, 0);
  }, [plan, onCounts]);
  return (
    <group>
      <Slabs plan={plan} />
      <Core plan={plan} />
      {plan.drawColumns ? <Perimeter plan={plan} onCount={onCounts} /> : null}
      {plan.kind === "lobby" ? <BasePerimeter plan={plan} onCount={onCounts} /> : null}
      {plan.kind === "lobby" ? <LobbyPlaques data={data} plan={plan} /> : null}
      <Chamfers plan={plan} />
      {zones.map((z) => (
        <ZoneTint key={z.key} zone={z} plan={plan} />
      ))}
      {zones.length > 1 ? zones.map((z) => <Boundary key={`b-${z.key}`} plan={plan} theta={z.theta0} />) : null}
      {zones.map((z) => (
        <Plaque key={`p-${z.key}`} zone={z} data={data} />
      ))}
      {plan.kind === "floor" ? <Signs data={data} plan={plan} /> : null}
    </group>
  );
}
