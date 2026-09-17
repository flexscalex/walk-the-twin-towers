// City context occlusion handling (paradata P-069). Pure three.js, no React.
//
// Every context building is its own mesh (scripts/generate-context.ts). When the
// camera moves, rays from the eye to the orbit target and to each tower's ground
// centre find the buildings in the way; those ease to OCCLUDED_OPACITY. Buildings
// within NEAR_FADE_M of the eye go fully transparent so the city is never behind
// or over a viewer standing on the plaza. Materials are cloned per building only
// once a building has ever faded; the rest keep the file's shared material.
import { Box3, Material, Mesh, MeshStandardMaterial, Raycaster, Sphere, Vector3 } from "three";

export const OCCLUDED_OPACITY = 0.15;
export const NEAR_FADE_M = 60; // fully transparent inside this radius of the eye
export const NEAR_FADE_END_M = 100; // opaque again beyond this
export const ROOF_CLEARANCE_M = 5; // the eye is lifted this far above a roof it would have entered
const EASE_PER_SECOND = 7;
const SNAP = 0.01;

export interface ContextEntry {
  mesh: Mesh;
  /** World-space bounds (the context sits at the scene origin, so local equals world). */
  box: Box3;
  own: MeshStandardMaterial | null;
  opacity: number;
  target: number;
}

const ray = new Raycaster();
ray.firstHitOnly = false;
const dir = new Vector3();
const tmp = new Vector3();

/** Per-building bounds from the mesh's own indices (the position attribute is shared by every building). */
export function buildEntry(mesh: Mesh): ContextEntry {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const box = new Box3();
  if (idx) {
    for (let i = 0; i < idx.count; i++) box.expandByPoint(tmp.fromBufferAttribute(pos, idx.getX(i)));
  } else {
    for (let i = 0; i < pos.count; i++) box.expandByPoint(tmp.fromBufferAttribute(pos, i));
  }
  geo.boundingBox = box.clone();
  geo.boundingSphere = box.getBoundingSphere(new Sphere());
  if (!geo.boundsTree) geo.computeBoundsTree({ setBoundingBox: false });
  return { mesh, box, own: null, opacity: 1, target: 1 };
}

/** Recompute every building's target opacity for the current eye, target and tower bases. */
export function retarget(entries: ContextEntry[], eye: Vector3, orbitTarget: Vector3, towerBases: Vector3[]): void {
  for (const e of entries) {
    const d = e.box.distanceToPoint(eye);
    e.target = d >= NEAR_FADE_END_M ? 1 : d <= NEAR_FADE_M ? 0 : (d - NEAR_FADE_M) / (NEAR_FADE_END_M - NEAR_FADE_M);
  }
  const meshes = entries.map((e) => e.mesh);
  const byMesh = new Map(entries.map((e) => [e.mesh, e]));
  for (const to of [orbitTarget, ...towerBases]) {
    dir.subVectors(to, eye);
    const len = dir.length();
    if (len < 1e-3) continue;
    ray.set(eye, dir.divideScalar(len));
    ray.near = 0;
    ray.far = len;
    for (const hit of ray.intersectObjects(meshes, false)) {
      const e = byMesh.get(hit.object as Mesh);
      if (e && e.target > OCCLUDED_OPACITY) e.target = OCCLUDED_OPACITY;
    }
  }
}

/** Ease every building toward its target. Returns true while anything is still moving. */
export function step(entries: ContextEntry[], dt: number): boolean {
  const k = Math.min(1, dt * EASE_PER_SECOND);
  let moving = false;
  for (const e of entries) {
    if (e.opacity === e.target) continue;
    const next = Math.abs(e.target - e.opacity) < SNAP ? e.target : e.opacity + (e.target - e.opacity) * k;
    e.opacity = next;
    apply(e);
    if (next !== e.target) moving = true;
  }
  return moving;
}

function apply(e: ContextEntry): void {
  if (!e.own) {
    const base = e.mesh.material as Material;
    e.own = (base as MeshStandardMaterial).clone();
    e.mesh.material = e.own;
  }
  const m = e.own;
  const faded = e.opacity < 1;
  m.transparent = faded;
  m.opacity = e.opacity;
  m.depthWrite = !faded || e.opacity > 0.5;
  m.needsUpdate = m.transparent !== faded ? true : m.needsUpdate;
  e.mesh.visible = e.opacity > 0.005;
}

/** Keep the eye out of any building's bounds: lift it to that roof plus clearance. Returns true if it moved. */
export function liftEyeClear(entries: ContextEntry[], eye: Vector3): boolean {
  let moved = false;
  for (const e of entries) {
    const b = e.box;
    if (eye.x < b.min.x || eye.x > b.max.x || eye.z < b.min.z || eye.z > b.max.z) continue;
    if (eye.y >= b.max.y) continue;
    eye.y = b.max.y + ROOF_CLEARANCE_M;
    moved = true;
  }
  return moved;
}

/** Restore the file's material and drop the bounds trees when the context unmounts. */
export function disposeEntries(entries: ContextEntry[]): void {
  for (const e of entries) {
    if (e.own) e.own.dispose();
    e.mesh.geometry.disposeBoundsTree?.();
  }
}
