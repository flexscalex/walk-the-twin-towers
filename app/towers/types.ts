// Types shared between the page shell (TowersViewer) and the dynamically
// loaded 3D bundle (scene/). Pure types, no three.js imports.
import type { TowersData } from "@/lib/floors";
import type { GeometryFiles } from "@/lib/geometry-manifest";

export interface Probe {
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  maxTextureSize: number | null;
  devicePixelRatio: number;
  deviceMemoryGb: number | null;
  tier: "full" | "reduced" | "unsupported";
  /** Device pixel ratio the renderer is allowed to use. */
  dprCap: number;
  /** Per-floor detail nodes are kept on every Nth floor. 1 keeps all. */
  detailEvery: number;
  reasons: string[];
}

export interface FloorRef {
  buildingId: string;
  floor: number;
}

export interface HoverInfo extends FloorRef {
  x: number;
  y: number;
}

/** A camera move requested by the page shell; `id` increments so repeats replay. */
export interface FlightRequest {
  id: number;
  kind: "street" | "top" | "floor";
  buildingId?: string;
  floor?: number;
}

/** Floors to hold lit while a tenant result is shown. */
export interface FloorHighlight {
  buildingId: string;
  floors: number[];
}

export interface SceneStats {
  floorMeshes: number;
  detailNodes: number;
  detailNodesHidden: number;
  /** Meshes that carry a bounds tree after setup. */
  bvhMeshes: number;
}

export interface SceneProps {
  data: TowersData;
  geometry: GeometryFiles;
  probe: Probe;
  /** Draw the city context massing (context.glb) around the towers. */
  showContext: boolean;
  /** Increment to return the camera to the establishing view. */
  resetKey: number;
  flight: FlightRequest | null;
  highlight: FloorHighlight | null;
  hovered: FloorRef | null;
  selected: FloorRef | null;
  onHover: (h: HoverInfo | null) => void;
  onSelect: (s: FloorRef | null) => void;
  onLoaded: (stats: SceneStats) => void;
  onError: (message: string) => void;
}
