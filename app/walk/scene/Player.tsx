"use client";
// First-person movement. Desktop: pointer lock (drei PointerLockControls)
// for looking, WASD or arrows to move. Touch: a left-thumb joystick to move
// and a right-side drag to look, both fed in through TouchInput refs from the
// overlay in WalkScene. Collision is the AABB clamp in plan.ts: inside the
// glass line, outside the core. No physics library.
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls } from "@react-three/drei";
import { Euler, Vector3 } from "three";
import { ELEVATOR_PROMPT_M, type InputMode } from "../types";
import { clampToFloor, distanceToCore, PRESENTATION, startPose, type Plan } from "./plan";

export interface TouchInput {
  /** Joystick displacement, each axis in [-1, 1]. x right, y forward. */
  move: { x: number; y: number };
  /** Accumulated look delta in CSS px since the last frame. */
  look: { dx: number; dy: number };
}

export function newTouchInput(): TouchInput {
  return { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 } };
}

const KEYS: Record<string, "f" | "b" | "l" | "r"> = {
  KeyW: "f",
  ArrowUp: "f",
  KeyS: "b",
  ArrowDown: "b",
  KeyA: "l",
  ArrowLeft: "l",
  KeyD: "r",
  ArrowRight: "r",
};

const TOUCH_LOOK_RAD_PER_PX = 0.004;
const MAX_PITCH = Math.PI / 2 - 0.05;

export function Player({
  plan,
  inputMode,
  touch,
  onLockChange,
  onNearCore,
}: {
  plan: Plan;
  inputMode: InputMode;
  touch: TouchInput;
  onLockChange: (locked: boolean) => void;
  onNearCore: (near: boolean) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Set<string>>(new Set());
  const euler = useRef(new Euler(0, 0, 0, "YXZ"));

  // Start pose: just inside the south glass, eye height, facing the core.
  useEffect(() => {
    const p = startPose(plan);
    camera.position.set(p.x, PRESENTATION.eyeHeightM, p.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(0, p.yaw, 0);
    camera.updateProjectionMatrix();
  }, [plan, camera]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (KEYS[e.code]) {
        keys.current.add(KEYS[e.code]);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (KEYS[e.code]) keys.current.delete(KEYS[e.code]);
    };
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const forward = useRef(new Vector3());
  const right = useRef(new Vector3());
  const near = useRef<boolean | null>(null);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05) * PRESENTATION.walkSpeedMps;

    // Elevator prompt: within reach of a core face. Reported only on change.
    const isNear = distanceToCore(plan, camera.position.x, camera.position.z) <= ELEVATOR_PROMPT_M;
    if (isNear !== near.current) {
      near.current = isNear;
      onNearCore(isNear);
    }

    // Touch look: yaw about y, pitch about x, clamped.
    if (inputMode === "touch" && (touch.look.dx !== 0 || touch.look.dy !== 0)) {
      const e = euler.current.setFromQuaternion(camera.quaternion);
      e.y -= touch.look.dx * TOUCH_LOOK_RAD_PER_PX;
      e.x -= touch.look.dy * TOUCH_LOOK_RAD_PER_PX;
      e.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, e.x));
      camera.quaternion.setFromEuler(e);
      touch.look.dx = 0;
      touch.look.dy = 0;
    }

    let mx = 0;
    let mz = 0;
    const k = keys.current;
    if (k.has("f")) mz += 1;
    if (k.has("b")) mz -= 1;
    if (k.has("r")) mx += 1;
    if (k.has("l")) mx -= 1;
    if (inputMode === "touch") {
      mx += touch.move.x;
      mz += touch.move.y;
    }
    if (mx === 0 && mz === 0) return;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    // Move on the floor plane in the camera's yaw frame.
    const f = forward.current;
    camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) return;
    f.normalize();
    const r = right.current.set(-f.z, 0, f.x); // forward x up: +x when looking down -z
    const nx = camera.position.x + (f.x * mz + r.x * mx) * step;
    const nz = camera.position.z + (f.z * mz + r.z * mx) * step;
    const [cx, cz] = clampToFloor(plan, nx, nz);
    camera.position.set(cx, PRESENTATION.eyeHeightM, cz);
  });

  if (inputMode !== "pointer") return null;
  return <PointerLockControls domElement={gl.domElement} onLock={() => onLockChange(true)} onUnlock={() => onLockChange(false)} />;
}
