"use client";
// Wraps one tower's floor meshes with the pointer handlers. The handlers sit on
// the group, so React Three Fiber raycasts every descendant mesh (accelerated
// by three-mesh-bvh, see TowersScene) and reports the nearest hit; we walk up
// from the hit object to the floor node it belongs to.
import { useCallback, useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { Group, MeshStandardMaterial, Object3D } from "three";
import { parseDetailNodeName, parseFloorNodeName } from "@/lib/geometry-naming";
import type { FloorHighlight, FloorRef, HoverInfo } from "../types";
import { applyFloorState } from "./floor-tint";

export interface FloorEntry {
  floor: number;
  material: MeshStandardMaterial;
  /** Height of the floor line in the tower's local frame, metres (the plate node's y). */
  y: number;
}

interface Props {
  buildingId: string;
  position: [number, number, number];
  floors: Map<number, FloorEntry>;
  hovered: FloorRef | null;
  selected: FloorRef | null;
  highlight: FloorHighlight | null;
  onHover: (h: HoverInfo | null) => void;
  onSelect: (s: FloorRef | null) => void;
  children: React.ReactNode;
}

function floorOf(obj: Object3D | null, buildingId: string): number | null {
  let o: Object3D | null = obj;
  while (o) {
    const f = parseFloorNodeName(o.name) ?? parseDetailNodeName(o.name);
    if (f) return f.buildingId === buildingId ? f.floor : null;
    o = o.parent;
  }
  return null;
}

export function TowerGroup({ buildingId, position, floors, hovered, selected, highlight, onHover, onSelect, children }: Props) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  const lastHover = useRef<number | null>(null);

  // Reflect hover and selection in the materials of this tower only.
  useEffect(() => {
    const lit = highlight?.buildingId === buildingId ? new Set(highlight.floors) : null;
    for (const [n, entry] of floors) {
      applyFloorState(
        entry.material,
        hovered?.buildingId === buildingId && hovered.floor === n,
        selected?.buildingId === buildingId && selected.floor === n,
        lit?.has(n) ?? false,
      );
    }
    invalidate();
  }, [floors, hovered, selected, highlight, buildingId, invalidate]);

  const move = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const floor = floorOf(e.object, buildingId);
      if (floor === null) {
        if (lastHover.current !== null) {
          lastHover.current = null;
          onHover(null);
        }
        return;
      }
      e.stopPropagation();
      if (lastHover.current !== floor) lastHover.current = floor;
      onHover({ buildingId, floor, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY });
    },
    [buildingId, onHover],
  );

  const out = useCallback(() => {
    lastHover.current = null;
    onHover(null);
  }, [onHover]);

  const click = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      const floor = floorOf(e.object, buildingId);
      if (floor === null) return;
      e.stopPropagation();
      const same = selected?.buildingId === buildingId && selected.floor === floor;
      onSelect(same ? null : { buildingId, floor });
    },
    [buildingId, selected, onSelect],
  );

  return (
    <group ref={group} name={buildingId} position={position} onPointerMove={move} onPointerOut={out} onClick={click}>
      {children}
    </group>
  );
}
