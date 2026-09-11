// The only way a number or a statement from data/geometry-params.json reaches
// a Walk or Journey payload. Every read records the parameter with its
// citation and locator, so the client can list exactly what it was built from.
// Server-only.
import type { Evidence, GeometryFile, GeometryParam, Source } from "./types";

const IN_PER_FT = 12;

export interface WalkParam {
  id: string;
  value: number | string;
  unit: string;
  evidence: Evidence;
  citation: string;
  locator: string;
  /** Verbatim quote from the report, for prose that must stay inside the record. */
  quote: string;
  notes: string | null;
}

export function formatLocator(p: GeometryParam): string {
  const l = p.locator;
  return `pdf p${l.pdf_page}, printed p${l.printed_page}, section ${l.section}`;
}

export interface Citer {
  used: Record<string, WalkParam>;
  has: (id: string) => boolean;
  cite: (id: string) => GeometryParam;
  ft: (id: string) => number;
  count: (id: string) => number;
  str: (id: string) => string;
  list: (id: string) => number[];
}

export function makeCiter(geo: GeometryFile): Citer {
  const paramsById = new Map(geo.params.map((p) => [p.id, p]));
  const sourcesById = new Map<string, Source>(geo.sources.map((s) => [s.id, s]));
  const used: Record<string, WalkParam> = {};
  const cite = (id: string): GeometryParam => {
    const p = paramsById.get(id);
    if (!p) throw new Error(`geometry: parameter ${id} is not in data/geometry-params.json`);
    if (!used[id]) {
      const src = sourcesById.get(p.source_id);
      used[id] = {
        id,
        value: Array.isArray(p.value) ? JSON.stringify(p.value) : p.value,
        unit: p.unit,
        evidence: p.evidence,
        citation: src ? src.citation : `source ${p.source_id}`,
        locator: formatLocator(p),
        quote: p.locator.quote,
        notes: p.notes,
      };
    }
    return p;
  };
  const ft = (id: string): number => {
    const p = cite(id);
    if (typeof p.value !== "number") throw new Error(`geometry: ${id} is not numeric`);
    if (p.unit === "ft") return p.value;
    if (p.unit === "in") return p.value / IN_PER_FT;
    throw new Error(`geometry: ${id} has unit ${p.unit}, expected ft or in`);
  };
  const count = (id: string): number => {
    const p = cite(id);
    if (typeof p.value !== "number") throw new Error(`geometry: ${id} is not numeric`);
    return p.value;
  };
  const str = (id: string): string => String(cite(id).value);
  const list = (id: string): number[] => {
    const p = cite(id);
    if (!Array.isArray(p.value)) throw new Error(`geometry: ${id} is not a list`);
    return (p.value as unknown[]).flat().filter((n): n is number => typeof n === "number");
  };
  return { used, has: (id) => paramsById.has(id), cite, ft, count, str, list };
}
