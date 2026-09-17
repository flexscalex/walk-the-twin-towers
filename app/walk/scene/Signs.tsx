"use client";
// Wayfinding on the core faces. Cited layer: every figure on a sign is a
// parameter in data/geometry-params.json, read through the building's
// JourneyData, and the zone's floor range is the interpretive one recorded in
// P-072. The sign's place on the core face is a presentation choice, the same
// one the plaques make: no shaft or stair position is cited (unresolved
// towers.elevator_shaft_positions_in_core), so the sign marks the face of the
// core, not a bank or a door, and says so. Paradata P-080.
import { Html } from "@react-three/drei";
import type { WalkData } from "@/lib/walk";
import { INK } from "@/lib/industry-colors";
import type { Plan } from "./plan";

/** Sign height above the floor and its width in CSS px (400 px = 1 m at distanceFactor 1; at 2, 240 px is 1.2 m). Presentation. */
const SIGN_Y_M = 2.05;
const SIGN_W_PX = 240;
const STAIRS_OFFSET_M = 3.2;

const card: React.CSSProperties = {
  width: SIGN_W_PX,
  padding: "8px 10px",
  background: "rgba(247,241,230,0.96)",
  border: `1px solid ${INK}`,
  borderLeft: `6px solid ${INK}`,
  borderRadius: 2,
  color: INK,
  fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif",
  fontSize: 11,
  lineHeight: 1.3,
  boxShadow: "0 1px 0 rgba(42,37,32,0.25)",
};
const chip: React.CSSProperties = { fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8a7f72" };
const mono: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 9, color: "#8a7f72" };

function ElevatorSign({ data }: { data: WalkData }) {
  const j = data.journey;
  const zone = j.zones.find((z) => data.floor >= z.from && data.floor <= z.to) ?? null;
  const local = j.params["towers.local_elevators_per_zone"];
  const total = j.params["towers.elevators_total"];
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={chip}>Cited layer</span>
        <span style={chip}>core face</span>
      </div>
      <div style={{ marginTop: 2, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Elevators</div>
      {zone ? (
        <>
          <div style={{ marginTop: 3 }}>
            <strong>{j.counts.localPerZone}</strong> local elevators serve this zone, floors {zone.from} to {zone.to}.
          </div>
          {zone.skyLobby !== null && zone.expressCars !== null ? (
            <div style={{ marginTop: 2 }}>
              Boarded at sky lobby {zone.skyLobby}, reached by <strong>{zone.expressCars}</strong> express elevators from the concourse.
            </div>
          ) : (
            <div style={{ marginTop: 2 }}>Lowest zone: no sky lobby transfer.</div>
          )}
        </>
      ) : null}
      <div style={{ marginTop: 2 }}>
        All <strong>{j.counts.total}</strong> elevators are within the core. Shaft positions are not cited: this sign marks the core face, not a bank.
      </div>
      <div style={{ marginTop: 4, ...mono }}>
        {[local?.id, zone?.expressParam, total?.id].filter(Boolean).join(", ")}; zone floors {j.zoneParadata}.
      </div>
    </div>
  );
}

function StairsSign({ data }: { data: WalkData }) {
  const j = data.journey;
  const loc = j.params["towers.stairs_location"];
  const ac = j.params["towers.stair_a_c_width"];
  const b = j.params["towers.stair_b_width"];
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={chip}>Cited layer</span>
        <span style={chip}>position not cited</span>
      </div>
      <div style={{ marginTop: 2, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>Stairs</div>
      <div style={{ marginTop: 3 }}>
        <strong>{j.counts.stairs}</strong> stairways per tower, {loc ? String(loc.value) : "within the core"}.
        {data.isMechanical ? " This is a mechanical floor." : ""}
      </div>
      {ac && b ? (
        <div style={{ marginTop: 2 }}>
          A and C {String(ac.value)} {ac.unit} wide, B {String(b.value)} {b.unit} wide.
        </div>
      ) : null}
      <div style={{ marginTop: 2 }}>Documented, position on this floor not cited. This sign is on the core face only because the stairs were in the core.</div>
      <div style={{ marginTop: 4, ...mono }}>{["towers.stairways_per_tower", loc?.id, ac?.id, b?.id].filter(Boolean).join(", ")}</div>
    </div>
  );
}

/** One Elevators sign per core face, and one Stairs sign beside the north-face sign. */
export function Signs({ data, plan }: { data: WalkData; plan: Plan }) {
  const gap = 0.03;
  const x = plan.coreHalfX + gap;
  const z = plan.coreHalfZ + gap;
  const faces: { key: string; pos: [number, number, number]; rotY: number }[] = [
    { key: "south", pos: [0, SIGN_Y_M, z], rotY: 0 },
    { key: "north", pos: [0, SIGN_Y_M, -z], rotY: Math.PI },
    { key: "east", pos: [x, SIGN_Y_M, 0], rotY: Math.PI / 2 },
    { key: "west", pos: [-x, SIGN_Y_M, 0], rotY: -Math.PI / 2 },
  ];
  return (
    <group name="signs">
      {faces.map((f) => (
        <Html key={f.key} position={f.pos} rotation={[0, f.rotY, 0]} transform distanceFactor={2} center pointerEvents="none" zIndexRange={[5, 0]}>
          <ElevatorSign data={data} />
        </Html>
      ))}
      <Html position={[-STAIRS_OFFSET_M, SIGN_Y_M, -z]} rotation={[0, Math.PI, 0]} transform distanceFactor={2} center pointerEvents="none" zIndexRange={[5, 0]}>
        <StairsSign data={data} />
      </Html>
    </group>
  );
}
