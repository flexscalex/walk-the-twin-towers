// Build-time reader for the geometry files the generator emits into
// public/geometry (wtc1.glb, wtc2.glb, manifest.json). Server-only.
//
// The manifest is written by scripts/generate-geometry.ts. This reader is
// deliberately tolerant about its shape: it walks the document, collects every
// string that is a known parameter id from data/geometry-params.json, and
// joins each to its citation. Anything under a "citation"/"citations" key is
// also surfaced verbatim. If the generator changes its layout, the Geometry
// tab still lists the right parameters.
import fs from "node:fs";
import path from "node:path";
import { loadGeometry } from "./data";
import type { GeometryParam, Source } from "./types";

const GEOMETRY_DIR = path.join(process.cwd(), "public", "geometry");
export const GEOMETRY_URL_BASE = "/geometry";

export type GeometryMode = "real" | "placeholder" | "none";

export interface GeometryFiles {
  mode: GeometryMode;
  /** building id -> url of the .glb that holds it. */
  urls: Record<string, string>;
  /** City context massing (scripts/generate-context.ts), when generated. */
  contextUrl: string | null;
  note: string;
}

export function geometryFiles(buildingIds: readonly string[]): GeometryFiles {
  const real = buildingIds.every((id) => fs.existsSync(path.join(GEOMETRY_DIR, `${id}.glb`)));
  const contextUrl = fs.existsSync(path.join(GEOMETRY_DIR, "context.glb")) ? `${GEOMETRY_URL_BASE}/context.glb` : null;
  if (real) {
    return {
      mode: "real",
      urls: Object.fromEntries(buildingIds.map((id) => [id, `${GEOMETRY_URL_BASE}/${id}.glb`])),
      contextUrl,
      note: "Geometry generated from data/geometry-params.json by scripts/generate-geometry.ts.",
    };
  }
  if (fs.existsSync(path.join(GEOMETRY_DIR, "placeholder.glb"))) {
    return {
      mode: "placeholder",
      urls: Object.fromEntries(buildingIds.map((id) => [id, `${GEOMETRY_URL_BASE}/placeholder.glb`])),
      contextUrl,
      note: "placeholder geometry, not cited",
    };
  }
  return {
    mode: "none",
    urls: {},
    contextUrl: null,
    note: "No geometry file is present. Run scripts/generate-geometry.ts, or node tools/make-placeholder-glb.mjs for a stand-in.",
  };
}

export interface ManifestParam {
  id: string;
  value: string;
  unit: string;
  evidence: GeometryParam["evidence"];
  citation: string;
  locator: string;
  notes: string | null;
}

/** One public dataset behind the city context, as recorded by scripts/fetch-context.ts. */
export interface ContextSource {
  id: string;
  name: string;
  publisher: string;
  datasetId: string;
  url: string;
  retrievedAt: string;
  filter: string;
  notes: string[];
}

export interface ContextSummary {
  buildings: number;
  filter: string;
  gap: string;
  originMethod: string;
  sources: ContextSource[];
}

export interface ManifestSummary {
  present: boolean;
  generatedAt: string | null;
  /** building id -> params referenced for that building (plus "towers"-scoped ones). */
  byBuilding: Record<string, { params: ManifestParam[]; citations: string[]; nodeCount: number | null }>;
  /** The city-context entry, when scripts/generate-context.ts has run. */
  context: ContextSummary | null;
}

function readContext(manifest: Record<string, unknown>): ContextSummary | null {
  const c = manifest.context as Record<string, unknown> | undefined;
  if (!c || typeof c !== "object") return null;
  const origin = (c.origin ?? {}) as Record<string, unknown>;
  const sources = Array.isArray(c.sources) ? (c.sources as Record<string, unknown>[]) : [];
  return {
    buildings: Number(c.buildings ?? 0),
    filter: String(c.filter ?? ""),
    gap: String(c.gap ?? ""),
    originMethod: String(origin.method ?? ""),
    sources: sources.map((s) => ({
      id: String(s.id ?? ""),
      name: String(s.name ?? ""),
      publisher: String(s.publisher ?? ""),
      datasetId: String(s.dataset_id ?? ""),
      url: String(s.url ?? ""),
      retrievedAt: String(s.retrieved_at ?? ""),
      filter: String(s.filter ?? ""),
      notes: Array.isArray(s.notes) ? (s.notes as unknown[]).map(String) : [],
    })),
  };
}

function walkStrings(node: unknown, visit: (s: string, key: string | null) => void, key: string | null = null): void {
  if (typeof node === "string") visit(node, key);
  else if (Array.isArray(node)) for (const n of node) walkStrings(n, visit, key);
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walkStrings(v, visit, k);
}

function formatLocator(p: GeometryParam): string {
  const l = p.locator;
  return `pdf p${l.pdf_page}, printed p${l.printed_page}, section ${l.section}`;
}

function formatValue(v: GeometryParam["value"]): string {
  return Array.isArray(v) ? JSON.stringify(v) : String(v);
}

/** Pick the sub-document that belongs to one building, if the manifest has one. */
function buildingSubtree(manifest: Record<string, unknown>, id: string): unknown {
  const b = manifest.buildings;
  if (Array.isArray(b)) return b.find((x) => x && typeof x === "object" && (x as { id?: string }).id === id);
  if (b && typeof b === "object" && id in (b as Record<string, unknown>)) return (b as Record<string, unknown>)[id];
  if (id in manifest) return manifest[id];
  const meshes = manifest.meshes ?? manifest.nodes;
  if (Array.isArray(meshes)) {
    const mine = meshes.filter((m) => {
      if (!m || typeof m !== "object") return false;
      const r = m as Record<string, unknown>;
      const name = String(r.node ?? r.name ?? r.id ?? "");
      return r.building === id || r.building_id === id || name.startsWith(`${id}_`) || name === id;
    });
    return mine.length ? mine : null;
  }
  return null;
}

export function readManifest(buildingIds: readonly string[]): ManifestSummary {
  const file = path.join(GEOMETRY_DIR, "manifest.json");
  const empty: ManifestSummary = { present: false, generatedAt: null, byBuilding: {}, context: null };
  if (!fs.existsSync(file)) return empty;
  const geo = loadGeometry();
  if (!geo) return empty;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return empty;
  }
  const paramsById = new Map(geo.params.map((p) => [p.id, p]));
  const sourcesById = new Map<string, Source>(geo.sources.map((s) => [s.id, s]));
  const meta = (manifest.meta ?? {}) as Record<string, unknown>;
  const generatedAt = String(manifest.generated_at ?? meta.generated_at ?? "") || null;

  const byBuilding: ManifestSummary["byBuilding"] = {};
  for (const id of buildingIds) {
    const subtree = buildingSubtree(manifest, id) ?? manifest;
    const scoped = subtree !== manifest;
    const ids = new Set<string>();
    const citations = new Set<string>();
    let nodeCount = 0;
    walkStrings(subtree, (s, key) => {
      const p = paramsById.get(s);
      if (p && (scoped || p.applies_to === id || p.applies_to === "towers" || p.applies_to === "complex")) ids.add(s);
      if (key && /^citations?$/.test(key) && !paramsById.has(s)) citations.add(s);
      if (s.startsWith(`${id}_`)) nodeCount++;
    });
    const params: ManifestParam[] = [...ids].sort().map((pid) => {
      const p = paramsById.get(pid)!;
      const src = sourcesById.get(p.source_id);
      return {
        id: p.id,
        value: formatValue(p.value),
        unit: p.unit,
        evidence: p.evidence,
        citation: src ? src.citation : `source ${p.source_id}`,
        locator: formatLocator(p),
        notes: p.notes,
      };
    });
    byBuilding[id] = { params, citations: [...citations], nodeCount: nodeCount || null };
  }
  return { present: true, generatedAt, byBuilding, context: readContext(manifest) };
}
