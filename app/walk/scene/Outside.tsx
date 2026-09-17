"use client";
// The view out of the windows. Cited layer: the city context massing is the
// same file /towers draws (scripts/generate-context.ts, P-064) and each tower's
// exterior is its cited plan outline extruded to its cited roof elevation, no
// facade detail. The whole group is shifted so this floor's plate sits at the
// scene origin: the tower's plan centre goes to minus its layout position
// (P-066) and the ground drops by this floor's cited height above the floor 1
// line, which is the y = 0 of the tower files and of the context (P-067). The
// sky dome and the fog are the rendering choices recorded in P-063. Nothing
// here is pickable and nothing here carries a name. Paradata P-077.
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Color, ExtrudeGeometry, Mesh, MeshStandardMaterial, Shape } from "three";
import type { WalkData } from "@/lib/walk";
import { wireMeshopt } from "../../towers/scene/GltfTower";
import { GROUND_SIZE_M, SKY_HORIZON, SkyDome } from "../../towers/scene/SkyDome";
import { ftToM, type Plan, type XZ } from "./plan";

// Exterior tones. The outline shares the column tone of the cited layer so the
// tower reads as one object from inside; the ground recedes in the horizon tone.
const OUTLINE_TONE = "#a89f8f";
const GROUND_TONE = SKY_HORIZON;
/** Fog for the walk: nearer than /towers because the eye is inside the plate, so the far city softens with distance. */
export const WALK_FOG_NEAR_M = 700;
export const WALK_FOG_FAR_M = 5000;

const MAT = {
  outline: new MeshStandardMaterial({ color: new Color(OUTLINE_TONE), roughness: 0.85, metalness: 0.05 }),
  ground: new MeshStandardMaterial({ color: new Color(GROUND_TONE), roughness: 1, metalness: 0 }),
};

function shapeXZ(points: XZ[]): Shape {
  const s = new Shape();
  points.forEach(([x, z], i) => (i === 0 ? s.moveTo(x, -z) : s.lineTo(x, -z)));
  s.closePath();
  return s;
}

/** A tower's cited plan outline, extruded from yFrom to yTo (metres in the shifted frame). */
function Outline({ plan, x, z, yFrom, yTo }: { plan: Plan; x: number; z: number; yFrom: number; yTo: number }) {
  const height = yTo - yFrom;
  const geom = useMemo(() => new ExtrudeGeometry(shapeXZ(plan.plate), { depth: height, bevelEnabled: false }), [plan, height]);
  useEffect(() => () => geom.dispose(), [geom]);
  if (height <= 0) return null;
  // ExtrudeGeometry extrudes along +z of the shape; rotated -90 degrees about x, that becomes +y from yFrom.
  return <mesh geometry={geom} material={MAT.outline} rotation={[-Math.PI / 2, 0, 0]} position={[x, yFrom, z]} />;
}

function ContextMassing({ url }: { url: string }) {
  const gltf = useGLTF(url, false, false, wireMeshopt);
  // One shared file with /towers (drei caches by url); the walk never picks it and never fades it.
  useEffect(() => {
    gltf.scene.traverse((o) => {
      if (o instanceof Mesh) o.raycast = () => undefined;
    });
  }, [gltf.scene]);
  return <primitive object={gltf.scene} />;
}

export function Outside({ data, plan }: { data: WalkData; plan: Plan }) {
  const out = data.outside;
  const levelFt = data.level?.ft ?? null;
  if (!out || levelFt === null) return null;
  const [tx, tz] = out.positionM;
  // This floor's line above the Concourse line, in metres: how far the ground drops.
  const aboveGround = ftToM(levelFt - out.floor1.ft);
  const groundY = -aboveGround;
  return (
    <group name="outside" position={[-tx, groundY, -tz]}>
      <SkyDome />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} material={MAT.ground}>
        <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
      </mesh>
      {out.contextUrl ? <ContextMassing url={out.contextUrl} /> : null}
      {out.towers.map((t) => {
        const roof = ftToM(t.roofFt - out.floor1.ft);
        if (t.id === data.buildingId) {
          // This tower: the outline below this floor's slab and above the slab over it, so the
          // cited plate, core and columns of the floor itself are what the visitor stands in.
          return (
            <group key={t.id}>
              <Outline plan={plan} x={t.positionM[0]} z={t.positionM[1]} yFrom={0} yTo={aboveGround - plan.slabM} />
              <Outline plan={plan} x={t.positionM[0]} z={t.positionM[1]} yFrom={aboveGround + plan.storyM} yTo={roof} />
            </group>
          );
        }
        // The other tower shares the cited plan (every plan parameter applies to both towers).
        return <Outline key={t.id} plan={plan} x={t.positionM[0]} z={t.positionM[1]} yFrom={0} yTo={roof} />;
      })}
    </group>
  );
}
