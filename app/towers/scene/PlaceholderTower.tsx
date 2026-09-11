"use client";
// Stand-in used only when the generator's files are absent. Reads the plain
// box for this tower out of public/geometry/placeholder.glb, takes its bounds,
// and slices that volume into one plate per floor so the picking, tinting and
// panel can be exercised. Nothing here is a reconstruction; the page says so
// on screen whenever this component is the one rendering.
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, BoxGeometry, Mesh, Vector3 } from "three";
import { floorNodeName } from "@/lib/geometry-naming";
import type { TowerSummary } from "@/lib/floors";
import type { SceneStats } from "../types";
import { floorBaseColor, makeFloorMaterial } from "./floor-tint";
import type { FloorEntry } from "./TowerGroup";

interface Props {
  url: string;
  tower: TowerSummary;
  industryColors: Record<string, string>;
  onReady: (floors: Map<number, FloorEntry>, stats: SceneStats) => void;
}

export function PlaceholderTower({ url, tower, industryColors, onReady }: Props) {
  const gltf = useGLTF(url);

  const built = useMemo(() => {
    const box = gltf.scene.getObjectByName(tower.id);
    const bounds = new Box3();
    if (box) bounds.setFromObject(box);
    else bounds.set(new Vector3(-100, 0, -100), new Vector3(100, 1000, 100));
    const size = bounds.getSize(new Vector3());
    const n = tower.floorCount;
    const plateH = size.y / n;
    const geometry = new BoxGeometry(size.x * 0.96, plateH * 0.8, size.z * 0.96);
    geometry.computeBoundsTree();

    const byFloor = new Map(tower.floors.map((f) => [f.floor, f]));
    const floors = new Map<number, FloorEntry>();
    const meshes: Mesh[] = [];
    for (let i = 1; i <= n; i++) {
      const material = makeFloorMaterial(floorBaseColor(byFloor.get(i), industryColors));
      const y = bounds.min.y + (i - 0.5) * plateH;
      floors.set(i, { floor: i, y, material });
      const m = new Mesh(geometry, material);
      m.name = floorNodeName(tower.id, i);
      m.position.set(0, y, 0);
      meshes.push(m);
    }
    const stats: SceneStats = { floorMeshes: n, detailNodes: 0, detailNodesHidden: 0, bvhMeshes: n };
    return { floors, meshes, stats };
  }, [gltf.scene, tower, industryColors]);

  useEffect(() => {
    onReady(built.floors, built.stats);
  }, [built, onReady]);

  return (
    <group>
      {built.meshes.map((m) => (
        <primitive key={m.name} object={m} />
      ))}
    </group>
  );
}
