"use client";
// The 3D bundle. Loaded with next/dynamic (ssr: false) from TowersViewer so
// three.js never enters the core JS bundle. WebGL2 only, no post-processing,
// no shadows, warm daytime light on the site's paper background.
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { ACESFilmicToneMapping, BackSide, BufferGeometry, Box3, Color, Group, Mesh, SRGBColorSpace, Vector3 } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { PAPER } from "@/lib/industry-colors";
import type { FlightRequest, FloorRef, SceneProps, SceneStats } from "../types";
import { GltfTower, wireMeshopt } from "./GltfTower";
import { PlaceholderTower } from "./PlaceholderTower";
import { TowerGroup, type FloorEntry } from "./TowerGroup";

// three-mesh-bvh: every Mesh raycast goes through the bounds tree when one has
// been built for its geometry. Wired once per module load.
// The cast reconciles the 0.9 signature with the older augmentation that
// @react-three/drei's own copy of three-mesh-bvh brings along.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree as unknown as BufferGeometry["computeBoundsTree"];
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

// Where the towers sit. The .glb files are in metres about their own plan
// centre (paradata P-043); the scene origin is the block centroid shared with
// the city context (P-065). Positions on the block are a viewer layout choice,
// not a cited dimension: complex.tower_positions_and_spacing is unresolved in
// data/geometry-params.json. The pair is centred on the origin with 1 WTC north
// and west of 2 WTC, centres 420 ft apart on a 45 degree diagonal (P-066).
const M_PER_FT = 0.3048;
export const VIEWER_LAYOUT_TOWER_SPACING_FT = 420;
const LAYOUT_HALF_M = (VIEWER_LAYOUT_TOWER_SPACING_FT * M_PER_FT) / 2 / Math.SQRT2;
const TOWER_POSITIONS_M: Record<string, [number, number, number]> = {
  wtc1: [-LAYOUT_HALF_M, 0, -LAYOUT_HALF_M], // north-west (north is -z)
  wtc2: [LAYOUT_HALF_M, 0, LAYOUT_HALF_M], // south-east
};

// Light and sky. All of this is a rendering choice, not a reconstruction: no
// photograph, weather record or sun table is cited for it. The brief is a
// working weekday, mid-morning, clear: warm blue overhead, pale at the horizon,
// one sun from the south-east. No shadows and no post-processing (budget rule,
// BUILD-PLAN 3.3); tone mapping is ACES filmic, output sRGB. Paradata P-063.
const SKY_ZENITH = "#4f86cc";
const SKY_HORIZON = "#ece5d4";
// The hemisphere light is paler and warmer than the dome's zenith so shaded
// faces stay light and neutral instead of taking a blue cast.
const HEMI_SKY = "#dfe4ea";
const HEMI_GROUND = "#efe6d4";
const SUN_COLOR = "#fff0d2";
const SUN_INTENSITY = 2.2;
const HEMI_INTENSITY = 1.6;
const GROUND_TONE = PAPER; // the ground plane recedes in the site's paper tone
const SKY_RADIUS_M = 12000;
const GROUND_SIZE_M = 40000;
const FOG_NEAR_M = 1800;
const FOG_FAR_M = 9000;
const NO_FLOORS: Map<number, FloorEntry> = new Map();

// Camera. The establishing view is from the south-west (west is -x, south is
// +z), eye a few stories above the street, looking up at the pair with the
// city around it; its distance is fitted to the towers' bounds and the frame's
// aspect. The orbit target sits at the pair's mid-height. The camera may look
// straight up but never drops below MIN_EYE_HEIGHT_M, and can zoom in until one
// story fills the frame.
const VIEW_FROM = new Vector3(-1, 0, 1).normalize();
const VIEW_EYE_HEIGHT_M = 110;
const MIN_EYE_HEIGHT_M = 2;
const MIN_DISTANCE_M = 6;
const MAX_DISTANCE_M = 4000;
const TOP_FROM = new Vector3(-1, 0.55, 1).normalize();
const TOP_DISTANCE_M = 260;
const TOP_TARGET_BELOW_ROOF_M = 25;
const FLOOR_STANDOFF_M = 28; // from the facade to the eye when a floor is framed
const FLOOR_EYE_ABOVE_M = 1.6;
const FLIGHT_MS = 700;

// Gradient sky: a large inverted sphere shaded from the horizon tone at and
// below the eye line to the zenith tone overhead. Written in linear light and
// run through three's tone-mapping and colour-space chunks so it matches the
// lit geometry. Not fogged, not lit, drawn behind everything.
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  varying vec3 vDir;
  void main() {
    float t = clamp(vDir.y, 0.0, 1.0);
    // pale band near the horizon, blue gaining with height
    float k = pow(t, 0.4);
    vec3 c = mix(horizon, zenith, k);
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function SkyDome() {
  const uniforms = useMemo(
    () => ({ zenith: { value: new Color(SKY_ZENITH) }, horizon: { value: new Color(SKY_HORIZON) } }),
    [],
  );
  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS_M, 32, 16]} />
      <shaderMaterial vertexShader={SKY_VERT} fragmentShader={SKY_FRAG} uniforms={uniforms} side={BackSide} depthWrite={false} fog={false} toneMapped />
    </mesh>
  );
}

// City context: buildings that stood in 2001 and still stand, from NYC Open
// Data, extruded to today's roof heights (scripts/generate-context.ts, P-064).
// Unlabeled massing in one light material from the file. Not pickable: the
// raycast is disabled on every mesh, and it sits outside the tower groups.
function ContextMassing({ url }: { url: string }) {
  const gltf = useGLTF(url, false, false, wireMeshopt);
  const scene = useMemo(() => {
    const s = gltf.scene;
    s.traverse((o) => {
      if (o instanceof Mesh) o.raycast = () => {};
    });
    return s;
  }, [gltf.scene]);
  return <primitive object={scene} />;
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow={false}>
      <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
      <meshStandardMaterial color={GROUND_TONE} roughness={1} metalness={0} />
    </mesh>
  );
}

/** The parts of OrbitControls the camera rig touches. Kept structural: three-stdlib is drei's dependency, not ours. */
interface ControlsLike {
  target: Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update: () => void;
  addEventListener: (type: "change", fn: () => void) => void;
  removeEventListener: (type: "change", fn: () => void) => void;
}

class LoadBoundary extends Component<{ onError: (m: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError(err instanceof Error ? err.message : String(err));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface Pose {
  position: Vector3;
  target: Vector3;
}

function establishingPose(box: Box3, aspect: number, fov: number): Pose {
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.6;
  // Vertical FOV covers the height; on a portrait phone the width is the tighter constraint.
  const dist = radius / Math.tan((fov * Math.PI) / 360) / Math.min(1, aspect);
  // Horizontal standoff from the south-west, eye a few stories up, looking at the pair's centre.
  const drop = center.y - VIEW_EYE_HEIGHT_M;
  const horizontal = Math.sqrt(Math.max(dist * dist - drop * drop, (dist * 0.5) ** 2));
  const position = center.clone().addScaledVector(VIEW_FROM, horizontal);
  position.y = VIEW_EYE_HEIGHT_M;
  return { position, target: center };
}

function topPose(box: Box3): Pose {
  const center = box.getCenter(new Vector3());
  const target = new Vector3(center.x, box.max.y - TOP_TARGET_BELOW_ROOF_M, center.z);
  return { position: target.clone().addScaledVector(TOP_FROM, TOP_DISTANCE_M), target };
}

/** Eye level with the floor, outside the face of that tower nearest the camera's current side. */
function floorPose(towerBox: Box3, floorY: number, from: Vector3): Pose {
  const center = towerBox.getCenter(new Vector3());
  const size = towerBox.getSize(new Vector3());
  const half = Math.max(size.x, size.z) / 2;
  const dx = from.x - center.x, dz = from.z - center.z;
  const normal = Math.abs(dx) > Math.abs(dz) ? new Vector3(Math.sign(dx) || 1, 0, 0) : new Vector3(0, 0, Math.sign(dz) || 1);
  const target = new Vector3(center.x, floorY, center.z);
  const position = target.clone().addScaledVector(normal, half + FLOOR_STANDOFF_M);
  position.y = floorY + FLOOR_EYE_ABOVE_M;
  return { position, target };
}

/** Keep the camera above the ground: the largest polar angle that leaves the eye at MIN_EYE_HEIGHT_M. */
function applyTiltLimit(controls: ControlsLike, cameraPosition: Vector3): void {
  const dist = Math.max(1e-3, cameraPosition.distanceTo(controls.target));
  const c = Math.max(-1, Math.min(1, (MIN_EYE_HEIGHT_M - controls.target.y) / dist));
  controls.maxPolarAngle = Math.acos(c);
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

interface RigProps {
  root: React.RefObject<Group | null>;
  ready: boolean;
  resetKey: number;
  flight: FlightRequest | null;
  floorsByTower: Record<string, Map<number, FloorEntry>>;
  positions: Record<string, [number, number, number]>;
}

/** Establishing fit (snap), flights (700 ms eased tween, demand-safe) and the tilt guard. */
function CameraRig({ root, ready, resetKey, flight, floorsByTower, positions }: RigProps) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const viewport = useThree((s) => s.size);
  const aspect = viewport.width / Math.max(1, viewport.height);
  const fov = "fov" in camera ? (camera.fov as number) : 40;
  const fitted = useRef<{ aspect: number; resetKey: number } | null>(null);
  const tween = useRef<{ from: Pose; to: Pose; start: number } | null>(null);
  const lastFlight = useRef<number>(0);

  const setNearFar = useCallback(
    (dist: number) => {
      camera.near = Math.max(0.5, Math.min(5, dist / 200));
      camera.far = Math.max(dist * 20, SKY_RADIUS_M * 1.5);
      camera.updateProjectionMatrix();
    },
    [camera],
  );

  // Tilt guard: recomputed on every controls change (orbit, zoom, tween step).
  useEffect(() => {
    if (!controls) return;
    controls.minPolarAngle = 0.02;
    controls.minDistance = MIN_DISTANCE_M;
    controls.maxDistance = MAX_DISTANCE_M;
    const fn = () => applyTiltLimit(controls, camera.position);
    controls.addEventListener("change", fn);
    fn();
    return () => controls.removeEventListener("change", fn);
  }, [controls, camera]);

  // Establishing fit: once, again when the frame's aspect changes (phone rotation, window resize), and on Reset view.
  useEffect(() => {
    if (!ready || !root.current || !controls) return;
    const f = fitted.current;
    if (f && f.resetKey === resetKey && Math.abs(f.aspect - aspect) < 0.05) return;
    const box = new Box3().setFromObject(root.current);
    if (box.isEmpty()) return;
    const pose = establishingPose(box, aspect, fov);
    tween.current = null;
    camera.position.copy(pose.position);
    controls.target.copy(pose.target);
    setNearFar(pose.position.distanceTo(pose.target));
    applyTiltLimit(controls, camera.position);
    controls.update();
    fitted.current = { aspect, resetKey };
    invalidate();
  }, [ready, root, camera, controls, invalidate, aspect, fov, resetKey, setNearFar]);

  // Flights: Street, Top, or a floor of one tower.
  useEffect(() => {
    if (!flight || flight.id === lastFlight.current || !ready || !root.current || !controls) return;
    lastFlight.current = flight.id;
    const box = new Box3().setFromObject(root.current);
    if (box.isEmpty()) return;
    let to: Pose | null = null;
    if (flight.kind === "street") to = establishingPose(box, aspect, fov);
    else if (flight.kind === "top") to = topPose(box);
    else if (flight.kind === "floor" && flight.buildingId && flight.floor !== undefined) {
      const obj = root.current.getObjectByName(flight.buildingId);
      const entry = floorsByTower[flight.buildingId]?.get(flight.floor);
      if (obj && entry) {
        const towerBox = new Box3().setFromObject(obj);
        const y = entry.y + (positions[flight.buildingId]?.[1] ?? 0);
        to = floorPose(towerBox, y, camera.position);
      }
    }
    if (!to) return;
    tween.current = { from: { position: camera.position.clone(), target: controls.target.clone() }, to, start: performance.now() };
    setNearFar(to.position.distanceTo(to.target));
    invalidate();
  }, [flight, ready, root, controls, camera, aspect, fov, floorsByTower, positions, setNearFar, invalidate]);

  useFrame(() => {
    const t = tween.current;
    if (!t || !controls) return;
    const k = Math.min(1, (performance.now() - t.start) / FLIGHT_MS);
    const e = easeInOut(k);
    camera.position.lerpVectors(t.from.position, t.to.position, e);
    controls.target.lerpVectors(t.from.target, t.to.target, e);
    applyTiltLimit(controls, camera.position);
    controls.update();
    if (k < 1) invalidate();
    else tween.current = null;
  });
  return null;
}

export default function TowersScene(props: SceneProps) {
  const { data, geometry, probe, showContext, resetKey, flight, highlight, hovered, selected, onHover, onSelect, onLoaded, onError } = props;
  const root = useRef<Group>(null);
  const [floorsByTower, setFloorsByTower] = useState<Record<string, Map<number, FloorEntry>>>({});
  const statsRef = useRef<Record<string, SceneStats>>({});

  const onReadyFor = useMemo(() => {
    const map: Record<string, (floors: Map<number, FloorEntry>, stats: SceneStats) => void> = {};
    for (const t of data.towers) {
      map[t.id] = (floors, stats) => {
        statsRef.current[t.id] = stats;
        setFloorsByTower((prev) => (prev[t.id] === floors ? prev : { ...prev, [t.id]: floors }));
      };
    }
    return map;
  }, [data.towers]);

  const ready = data.towers.every((t) => floorsByTower[t.id]);
  useEffect(() => {
    if (!ready) return;
    const all = Object.values(statsRef.current);
    onLoaded({
      floorMeshes: all.reduce((a, s) => a + s.floorMeshes, 0),
      detailNodes: all.reduce((a, s) => a + s.detailNodes, 0),
      detailNodesHidden: all.reduce((a, s) => a + s.detailNodesHidden, 0),
      bvhMeshes: all.reduce((a, s) => a + s.bvhMeshes, 0),
    });
  }, [ready, onLoaded]);

  const clearSelection = useCallback(() => onSelect(null), [onSelect]);
  const positions = useMemo<Record<string, [number, number, number]>>(() => {
    const out: Record<string, [number, number, number]> = {};
    data.towers.forEach((t, i) => {
      out[t.id] = TOWER_POSITIONS_M[t.id] ?? [i * LAYOUT_HALF_M * 2, 0, 0];
    });
    return out;
  }, [data.towers]);

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  return (
    <Canvas
      frameloop="demand"
      dpr={probe.dprCap}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
        toneMapping: ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
        outputColorSpace: SRGBColorSpace,
      }}
      camera={{ fov: 40, near: 1, far: 30000, position: [1500, 900, 1800] }}
      onCreated={({ raycaster }) => {
        raycaster.firstHitOnly = true;
      }}
      onPointerMissed={clearSelection}
    >
      <color attach="background" args={[SKY_HORIZON]} />
      <fog attach="fog" args={[SKY_HORIZON, FOG_NEAR_M, FOG_FAR_M]} />
      {/* hemisphere matches the dome: sky tone from above, ground tone from below */}
      <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY]} />
      {/* one sun, mid-morning from the south-east (+x east, +z south); no shadow maps */}
      <directionalLight position={[2600, 2400, 1900]} intensity={SUN_INTENSITY} color={SUN_COLOR} />
      <SkyDome />
      <Ground />
      {showContext && geometry.contextUrl ? (
        <LoadBoundary onError={(m) => console.warn(`city context not drawn: ${m}`)}>
          <Suspense fallback={null}>
            <ContextMassing url={geometry.contextUrl} />
          </Suspense>
        </LoadBoundary>
      ) : null}

      <group ref={root}>
        <LoadBoundary onError={onError}>
          <Suspense fallback={null}>
            {data.towers.map((t) => {
              const url = geometry.urls[t.id];
              if (!url) return null;
              const floors = floorsByTower[t.id] ?? NO_FLOORS;
              const sel: FloorRef | null = selected;
              return (
                <TowerGroup
                  key={t.id}
                  buildingId={t.id}
                  position={positions[t.id]}
                  floors={floors}
                  hovered={hovered}
                  selected={sel}
                  highlight={highlight}
                  onHover={onHover}
                  onSelect={onSelect}
                >
                  {geometry.mode === "real" ? (
                    <GltfTower url={url} tower={t} industryColors={data.industryColors} probe={probe} onReady={onReadyFor[t.id]} />
                  ) : (
                    <PlaceholderTower url={url} tower={t} industryColors={data.industryColors} onReady={onReadyFor[t.id]} />
                  )}
                </TowerGroup>
              );
            })}
          </Suspense>
        </LoadBoundary>
      </group>

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minPolarAngle={0.02} maxPolarAngle={Math.PI * 0.6} minDistance={MIN_DISTANCE_M} maxDistance={MAX_DISTANCE_M} />
      <CameraRig root={root} ready={ready} resetKey={resetKey} flight={flight} floorsByTower={floorsByTower} positions={positions} />
    </Canvas>
  );
}
