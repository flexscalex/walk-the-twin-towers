// Per-floor materials. One MeshStandardMaterial per floor plate so hover and
// selection can be shown by changing that floor alone.
import { Color, MeshStandardMaterial } from "three";
import type { FloorSummary } from "@/lib/floors";
import { BRASS, INDUSTRY_BLANK_COLOR, NO_RECORD_COLOR, NO_RECORD_MECHANICAL_COLOR } from "@/lib/industry-colors";

export function floorBaseColor(f: FloorSummary | undefined, industryColors: Record<string, string>): string {
  if (!f || f.dominant === null) return f?.isMechanical ? NO_RECORD_MECHANICAL_COLOR : NO_RECORD_COLOR;
  if (f.dominant === "") return INDUSTRY_BLANK_COLOR;
  return industryColors[f.dominant] ?? INDUSTRY_BLANK_COLOR;
}

export function makeFloorMaterial(hex: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(hex), roughness: 0.85, metalness: 0 });
}

const hoverEmissive = new Color(BRASS);
const selectEmissive = new Color(BRASS);

export function applyFloorState(m: MeshStandardMaterial, hovered: boolean, selected: boolean, highlighted = false): void {
  if (selected) {
    m.emissive.copy(selectEmissive);
    m.emissiveIntensity = 0.55;
  } else if (hovered) {
    m.emissive.copy(hoverEmissive);
    m.emissiveIntensity = 0.3;
  } else if (highlighted) {
    m.emissive.copy(selectEmissive);
    m.emissiveIntensity = 0.4;
  } else {
    m.emissiveIntensity = 0;
  }
}
