// Types shared between the page shell (WalkViewer) and the dynamically loaded
// 3D bundle (scene/). Pure types, no three.js imports.
import type { WalkData } from "@/lib/walk";
import type { Probe } from "../towers/types";

export type InputMode = "pointer" | "touch";

export interface WalkSceneProps {
  data: WalkData;
  probe: Probe;
  /** Illustration layer on or off. The cited layer is always drawn. */
  illustration: boolean;
  inputMode: InputMode;
  onLockChange: (locked: boolean) => void;
  onStats: (s: WalkStats) => void;
  /** Fires when the visitor comes within ELEVATOR_PROMPT_M of a core face, and again on leaving. */
  onNearCore: (near: boolean) => void;
}

/** How close to the core face the "Elevators" prompt appears. Presentation, not a dimension of the building. */
export const ELEVATOR_PROMPT_M = 3;

export interface WalkStats {
  zones: number;
  columns: number;
  glassPanels: number;
  desks: number;
}
