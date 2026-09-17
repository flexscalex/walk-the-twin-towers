"use client";
// The 3D bundle. Loaded with next/dynamic (ssr: false) from TowersViewer so
// three.js never enters the core JS bundle. WebGL2 only, no post-processing,
// no shadows, warm daytime light on the site's paper background.
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import { ACESFilmicToneMapping, BufferGeometry, Box3, Group, Mesh, SRGBColorSpace, Vector3 } from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import { PAPER } from "@/lib/industry-colors";
import type { FlightRequest, FloorRef, SceneProps, SceneStats } from "../types";
import { buildEntry, disposeEntries, liftEyeClear, retarget, step, type ContextEntry } from "./context-fade";
import { GltfTower, wireMeshopt } from "./GltfTower";
import { FOG_FAR_M, FOG_NEAR_M, GROUND_SIZE_M, HEMI_GROUND, HEMI_INTENSITY, HEMI_SKY, SKY_HORIZON, SKY_RADIUS_M, SkyDome, SUN_COLOR, SUN_INTENSITY } from "./SkyDome";
import { towerPositionM } from "@/lib/viewer-layout";
import { PlaceholderTower } from "./PlaceholderTower";
import { TowerGroup, type FloorEntry } from "./TowerGroup";

// three-mesh-bvh: every Mesh raycast goes through the bounds tree when one has
// been built for its geometry. Wired once per module load.
// The cast reconciles the 0.9 signature with the older augmentation that
// @react-three/drei's own copy of three-mesh-bvh brings along.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree as unknown as BufferGeometry["computeBoundsTree"];
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
Mesh.prototype.raycast = acceleratedRaycast;

// Tower positions: lib/viewer-layout.ts (P-066), shared with Walk mode.
export { VIEWER_LAYOUT_TOWER_SPACING_FT } from "@/lib/viewer-layout";

const GROUND_TONE = PAPER; // the ground plane recedes in the site's paper tone
const NO_FLOORS: Map<number, FloorEntry> = new Map();

// Camera. The establishing view is from the south-west (west is -x, south is
// +z), eye a few stories above the street, looking up at the pair with the
// city around it; its distance is fitted to the towers' bounds and the frame's
// aspect. The orbit target sits at the pair's mid-height. The camera may look
// straight up but never drops below MIN_EYE_HEIGHT_M, and can zoom in until one
// story fills the frame.
//
// Street and Top (paradata P-068) are layout choices, recomputed from the
// towers' bounds. Street: a standing eye (1.7 m) on the ground plane, 150 m
// south-west of the pair's centre on the line that bisects the two towers,
// aimed 45 m up the centre so the bases and the ground are in frame. Top: the
// eye 55 degrees above the horizontal, fitted to the pair's height and plan,
// which puts it above every context roof.
const VIEW_FROM = new Vector3(-1, 0, 1).normalize();
const VIEW_EYE_HEIGHT_M = 110;
const MIN_EYE_HEIGHT_M = 1.7;
const MIN_DISTANCE_M = 6;
const MAX_DISTANCE_M = 4000;
const STREET_STANDOFF_M = 150;
const STREET_EYE_HEIGHT_M = 1.7;
const STREET_AIM_HEIGHT_M = 45;
const TOP_TILT_RAD = (55 * Math.PI) / 180;
const FLOOR_STANDOFF_M = 28; // from the facade to the eye when a floor is framed
const FLOOR_EYE_ABOVE_M = 1.6;
const FLIGHT_MS = 700;

// City context: buildings that stood in 2001 and still stand, from NYC Open
// Data, extruded to today's roof heights (scripts/generate-context.ts, P-064).
// Unlabeled massing in one light material from the file, one mesh per building.
// It sits outside the tower groups, so the pointer never picks it; the only rays
// it sees are the occlusion rays in context-fade.ts (P-069).
interface ContextProps {
  url: string;
  entriesRef: React.MutableRefObject<ContextEntry[]>;
  towerBases: Vector3[];
}

function ContextMassing({ url, entriesRef, towerBases }: ContextProps) {
  const gltf = useGLTF(url, false, false, wireMeshopt);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const invalidate = useThree((s) => s.invalidate);
  const moving = useRef(false);

  const entries = useMemo(() => {
    const out: ContextEntry[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof Mesh) out.push(buildEntry(o));
    });
    return out;
  }, [gltf.scene]);

  useEffect(() => {
    entriesRef.current = entries;
    return () => {
      entriesRef.current = [];
      disposeEntries(entries);
    };
  }, [entries, entriesRef]);

  // Retarget on every camera move (orbit, zoom, flight step); the eased opacities run in useFrame.
  useEffect(() => {
    if (!controls) return;
    const fn = () => {
      retarget(entries, camera.position, controls.target, towerBases);
      moving.current = true;
      invalidate();
    };
    controls.addEventListener("change", fn);
    fn();
    return () => controls.removeEventListener("change", fn);
  }, [controls, camera, entries, towerBases, invalidate]);

  useFrame((_, dt) => {
    if (!moving.current) return;
    moving.current = step(entries, dt);
    if (moving.current) invalidate();
  });

  return <primitive object={gltf.scene} />;
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

/** Standing on the plaza south-west of the pair, looking up the centre (P-068). */
function streetPose(box: Box3): Pose {
  const center = box.getCenter(new Vector3());
  const position = new Vector3(center.x, STREET_EYE_HEIGHT_M, center.z).addScaledVector(VIEW_FROM, STREET_STANDOFF_M);
  return { position, target: new Vector3(center.x, STREET_AIM_HEIGHT_M, center.z) };
}

/** Above the roofs, looking down 55 degrees at the pair's mid-height, fitted to the frame (P-068). */
function topPose(box: Box3, aspect: number, fov: number): Pose {
  const size = box.getSize(new Vector3());
  const target = box.getCenter(new Vector3());
  const extent = size.y * Math.cos(TOP_TILT_RAD) + Math.hypot(size.x, size.z) * Math.sin(TOP_TILT_RAD);
  const dist = (extent * 0.55) / Math.tan((fov * Math.PI) / 360) / Math.min(1, aspect);
  const dir = new Vector3(VIEW_FROM.x * Math.cos(TOP_TILT_RAD), Math.sin(TOP_TILT_RAD), VIEW_FROM.z * Math.cos(TOP_TILT_RAD));
  return { position: target.clone().addScaledVector(dir, dist), target };
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
  contextRef: React.MutableRefObject<ContextEntry[]>;
}

declare global {
  interface Window {
    /** Test hook: place the eye and orbit target directly (metres, scene frame). */
    __towersCamera?: (position: [number, number, number], target: [number, number, number]) => void;
    __towersCameraState?: () => { position: number[]; target: number[] };
  }
}

/** Establishing fit (snap), flights (700 ms eased tween, demand-safe), the tilt guard and the roof clamp. */
function CameraRig({ root, ready, resetKey, flight, floorsByTower, positions, contextRef }: RigProps) {
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

  // Tilt guard and roof clamp: recomputed on every controls change (orbit, zoom, tween step).
  // The clamp lifts an eye that has entered a context building's bounds (P-069); it is
  // skipped mid-flight because every flight ends at a legal pose.
  useEffect(() => {
    if (!controls) return;
    controls.minPolarAngle = 0.02;
    controls.minDistance = MIN_DISTANCE_M;
    controls.maxDistance = MAX_DISTANCE_M;
    const fn = () => {
      if (!tween.current && liftEyeClear(contextRef.current, camera.position)) {
        controls.update();
        invalidate();
      }
      applyTiltLimit(controls, camera.position);
    };
    controls.addEventListener("change", fn);
    fn();
    return () => controls.removeEventListener("change", fn);
  }, [controls, camera, contextRef, invalidate]);

  // Test hooks for the screenshot harness; harmless in production.
  useEffect(() => {
    if (!controls) return;
    window.__towersCamera = (p, t) => {
      tween.current = null;
      camera.position.set(p[0], p[1], p[2]);
      controls.target.set(t[0], t[1], t[2]);
      setNearFar(camera.position.distanceTo(controls.target));
      controls.update();
      invalidate();
    };
    window.__towersCameraState = () => ({ position: camera.position.toArray(), target: controls.target.toArray() });
    return () => {
      delete window.__towersCamera;
      delete window.__towersCameraState;
    };
  }, [controls, camera, invalidate, setNearFar]);

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
    if (flight.kind === "street") to = streetPose(box);
    else if (flight.kind === "top") to = topPose(box, aspect, fov);
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
  const contextRef = useRef<ContextEntry[]>([]);
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
      out[t.id] = towerPositionM(t.id, i);
    });
    return out;
  }, [data.towers]);

  // Ground centre of each tower: the occlusion rays aim here as well as at the orbit target (P-069).
  const towerBases = useMemo(() => Object.values(positions).map((p) => new Vector3(p[0], 0, p[2])), [positions]);

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
            <ContextMassing url={geometry.contextUrl} entriesRef={contextRef} towerBases={towerBases} />
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
      <CameraRig root={root} ready={ready} resetKey={resetKey} flight={flight} floorsByTower={floorsByTower} positions={positions} contextRef={contextRef} />
    </Canvas>
  );
}
