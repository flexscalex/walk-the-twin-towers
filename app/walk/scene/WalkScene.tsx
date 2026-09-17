"use client";
// The 3D bundle for Walk mode. Loaded with next/dynamic (ssr: false) from
// WalkViewer so three.js stays out of the core JS bundle; three, fiber and
// drei chunks are shared with /towers. WebGL2, no post-processing, no
// shadows, the same daylight, sky and city context as /towers outside the
// glass (Outside.tsx, P-077), and the floor's cited elevation setting how far
// below the visitor the ground lies.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { WalkSceneProps } from "../types";
import { CitedFloor } from "./CitedFloor";
import { Illustration } from "./Illustration";
import { Outside, WALK_FOG_FAR_M, WALK_FOG_NEAR_M } from "./Outside";
import { buildPlan, layoutZones } from "./plan";
import { newTouchInput, Player, type TouchInput } from "./Player";
import { HEMI_GROUND, HEMI_SKY, SKY_HORIZON, SUN_COLOR } from "../../towers/scene/SkyDome";

// Interior light: a touch stronger than the /towers exterior so the fit-out
// stays legible under the slab, same colours as the shared sky.
const HEMI_INTENSITY_IN = 1.9;
const SUN_INTENSITY_IN = 1.1;
const JOYSTICK_RADIUS_PX = 48;

/** Left half: joystick. Right half: drag to look. Touch only; hidden otherwise. */
function TouchOverlay({ input }: { input: TouchInput }) {
  const ref = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const ids = useRef<{ move: number | null; look: number | null; lookX: number; lookY: number; ox: number; oy: number }>({
    move: null,
    look: null,
    lookX: 0,
    lookY: 0,
    ox: 0,
    oy: 0,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = ids.current;
    const start = (e: TouchEvent) => {
      const rect = el.getBoundingClientRect();
      for (const t of Array.from(e.changedTouches)) {
        const local = t.clientX - rect.left;
        if (local < rect.width / 2 && s.move === null) {
          s.move = t.identifier;
          s.ox = t.clientX;
          s.oy = t.clientY;
          setStick({ ox: local, oy: t.clientY - rect.top, x: 0, y: 0 });
        } else if (s.look === null) {
          s.look = t.identifier;
          s.lookX = t.clientX;
          s.lookY = t.clientY;
        }
      }
      e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === s.move) {
          const dx = t.clientX - s.ox;
          const dy = t.clientY - s.oy;
          const len = Math.hypot(dx, dy);
          const k = len > JOYSTICK_RADIUS_PX ? JOYSTICK_RADIUS_PX / len : 1;
          input.move.x = (dx * k) / JOYSTICK_RADIUS_PX;
          input.move.y = (-dy * k) / JOYSTICK_RADIUS_PX;
          setStick((p) => (p ? { ...p, x: dx * k, y: dy * k } : p));
        } else if (t.identifier === s.look) {
          input.look.dx += t.clientX - s.lookX;
          input.look.dy += t.clientY - s.lookY;
          s.lookX = t.clientX;
          s.lookY = t.clientY;
        }
      }
      e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === s.move) {
          s.move = null;
          input.move.x = 0;
          input.move.y = 0;
          setStick(null);
        } else if (t.identifier === s.look) {
          s.look = null;
        }
      }
    };
    el.addEventListener("touchstart", start, { passive: false });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [input]);

  return (
    <div ref={ref} className="absolute inset-0 z-10 touch-none select-none" aria-hidden>
      {stick ? (
        <div
          className="pointer-events-none absolute rounded-full border border-ink/40 bg-paper/30"
          style={{ left: stick.ox - JOYSTICK_RADIUS_PX, top: stick.oy - JOYSTICK_RADIUS_PX, width: JOYSTICK_RADIUS_PX * 2, height: JOYSTICK_RADIUS_PX * 2 }}
        >
          <div
            className="absolute h-8 w-8 rounded-full bg-ink/60"
            style={{ left: JOYSTICK_RADIUS_PX - 16 + stick.x, top: JOYSTICK_RADIUS_PX - 16 + stick.y }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default function WalkScene({ data, probe, illustration, inputMode, onLockChange, onStats, onNearCore }: WalkSceneProps) {
  const plan = useMemo(() => buildPlan(data), [data]);
  const zones = useMemo(() => layoutZones(data, plan), [data, plan]);
  const touch = useMemo(() => newTouchInput(), []);
  const counts = useRef({ columns: 0, glass: 0, desks: 0, figures: 0 });

  const report = useCallback(() => {
    onStats({ zones: zones.length, columns: counts.current.columns, glassPanels: counts.current.glass, desks: counts.current.desks, figures: counts.current.figures });
  }, [onStats, zones.length]);
  const onCounts = useCallback(
    (columns: number, glass: number) => {
      counts.current.columns = columns;
      counts.current.glass = glass;
      report();
    },
    [report],
  );
  const onDesks = useCallback(
    (n: number) => {
      counts.current.desks = n;
      report();
    },
    [report],
  );
  const onFigures = useCallback(
    (n: number) => {
      counts.current.figures = n;
      report();
    },
    [report],
  );
  useEffect(() => {
    if (!illustration) {
      onDesks(0);
      onFigures(0);
    }
  }, [illustration, onDesks, onFigures]);

  return (
    <div className="absolute inset-0">
      <Canvas
        frameloop="always"
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
        camera={{ fov: 70, near: 0.05, far: 30000, position: [0, 1.6, 0] }}
      >
        <color attach="background" args={[SKY_HORIZON]} />
        <fog attach="fog" args={[SKY_HORIZON, WALK_FOG_NEAR_M, WALK_FOG_FAR_M]} />
        <hemisphereLight args={[HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY_IN]} />
        <directionalLight position={[2600, 2400, 1900]} intensity={SUN_INTENSITY_IN} color={SUN_COLOR} />
        <Suspense fallback={null}>
          <Outside data={data} plan={plan} />
        </Suspense>
        <CitedFloor data={data} plan={plan} zones={zones} onCounts={onCounts} />
        {illustration && plan.kind === "floor" ? <Illustration plan={plan} zones={zones} onDesks={onDesks} onFigures={onFigures} /> : null}
        <Player plan={plan} inputMode={inputMode} touch={touch} onLockChange={onLockChange} onNearCore={onNearCore} />
      </Canvas>
      {inputMode === "touch" ? <TouchOverlay input={touch} /> : null}
    </div>
  );
}
