"use client";
// A tower loaded from the generator's .glb. Floor plate nodes are found by the
// shared naming constant, each gets its own tinted material, every mesh gets
// a bounds tree for picking, and per-floor detail nodes are thinned on the
// reduced tier.
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Mesh, type Object3D } from "three";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { parseDetailNodeName, parseFloorNodeName } from "@/lib/geometry-naming";
import type { TowerSummary } from "@/lib/floors";
import type { Probe, SceneStats } from "../types";
import { floorBaseColor, makeFloorMaterial } from "./floor-tint";
import type { FloorEntry } from "./TowerGroup";

// Meshopt, not Draco (CLAUDE.md). The decoder is the one shipped with the
// meshoptimizer package the generator encodes with.
export function wireMeshopt(loader: { setMeshoptDecoder: (d: unknown) => unknown }) {
  loader.setMeshoptDecoder(MeshoptDecoder);
}

interface Props {
  url: string;
  tower: TowerSummary;
  industryColors: Record<string, string>;
  probe: Probe;
  onReady: (floors: Map<number, FloorEntry>, stats: SceneStats) => void;
}

export function GltfTower({ url, tower, industryColors, probe, onReady }: Props) {
  const gltf = useGLTF(url, false, false, wireMeshopt);

  // Clone the scene so two towers can come from one file without sharing
  // mutable material state. Geometry stays shared.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  const prepared = useMemo(() => {
    const floors = new Map<number, FloorEntry>();
    const byFloor = new Map(tower.floors.map((f) => [f.floor, f]));
    const stats: SceneStats = { floorMeshes: 0, detailNodes: 0, detailNodesHidden: 0, bvhMeshes: 0 };

    scene.traverse((o: Object3D) => {
      const plate = parseFloorNodeName(o.name);
      if (plate && plate.buildingId === tower.id) {
        let entry = floors.get(plate.floor);
        if (!entry) {
          entry = { floor: plate.floor, y: o.position.y, material: makeFloorMaterial(floorBaseColor(byFloor.get(plate.floor), industryColors)) };
          floors.set(plate.floor, entry);
        }
        // Plates whose elevation rests on a "reported" parameter (a labeled modeling
        // assumption in the manifest) render visibly lighter than documented ones.
        if ((o.userData as { evidence?: string } | undefined)?.evidence === "reported") {
          entry.material.transparent = true;
          entry.material.opacity = 0.45;
        }
        const material = entry.material;
        o.traverse((m) => {
          if (m instanceof Mesh) {
            m.material = material;
            stats.floorMeshes++;
          }
        });
      }
      const detail = parseDetailNodeName(o.name);
      if (detail && detail.buildingId === tower.id) {
        stats.detailNodes++;
        if (probe.detailEvery > 1 && detail.floor % probe.detailEvery !== 0) {
          o.visible = false;
          stats.detailNodesHidden++;
        }
      }
    });

    // Geometry is shared with the loader cache, so a tree built during an
    // earlier (suspended, then discarded) render is reused rather than rebuilt.
    scene.traverse((o) => {
      if (o instanceof Mesh) {
        if (!o.geometry.boundsTree) o.geometry.computeBoundsTree();
        stats.bvhMeshes++;
      }
    });

    return { floors, stats };
  }, [scene, tower, industryColors, probe.detailEvery]);

  useEffect(() => {
    onReady(prepared.floors, prepared.stats);
  }, [prepared, onReady]);

  return <primitive object={scene} />;
}
