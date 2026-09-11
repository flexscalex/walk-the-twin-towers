// Types mirror data/SCHEMA.md exactly. No field is ever inferred.

export type Evidence = "documented" | "corroborated" | "reported" | "unknown";

export const EVIDENCE_LEVELS: Evidence[] = ["documented", "corroborated", "reported", "unknown"];

export interface Source {
  id: string;
  citation: string;
  url: string | null;
  archived_url: string | Record<string, string> | null; // one URL, or local file -> capture URL
  retrieved_at: string;
  local_files?: string[];
}

export interface Building {
  id: string;
  name: string;
  cnn_label: string;
  source_file: string;
  column_order: string[];
  tenant_count: number;
  sq_ft_total: number;
}

export interface Tenant {
  id: string;
  building_id: string;
  name: string;
  sq_ft: number | null;
  sq_ft_raw: string;
  industry: string | null;
  industry_raw: string;
  floor_raw: string;
  floors: string[];
  floor_unresolved: string | null;
  evidence: Evidence;
  source_id: string;
  source_row: number;
}

export interface TenantsFile {
  meta: { generated_at: string; generator: string; tenant_count: number };
  sources: Source[];
  buildings: Building[];
  floor_codes: Record<string, string>;
  tenants: Tenant[];
}

export interface ParadataRow {
  id: string;
  subject: string;
  decision: string;
  reasoning: string;
  decided_by: string;
  decided_at: string;
}

export interface GeometryLocator {
  pdf_page: number;
  printed_page: string;
  section: string;
  quote: string;
}

export interface GeometryParam {
  id: string;
  applies_to: string;
  value: number | string | number[];
  unit: string;
  evidence: Evidence;
  source_id: string;
  locator: GeometryLocator;
  notes: string | null;
}

// buildings[] is optional in SCHEMA.md. The app reads it when present and
// falls back to the highest floor seen in the tenant data otherwise.
export interface GeometryBuilding {
  id: string;
  floors?: number;
  mechanical_floors?: number[];
}

export interface GeometryFile {
  meta: { generated_at: string; rule: string };
  sources: Source[];
  buildings?: GeometryBuilding[];
  params: GeometryParam[];
  unresolved: { id: string; why: string; where_to_look: string }[];
}

export interface ErratumRow {
  date: string; // YYYY-MM-DD
  subject: string; // e.g. "tenant:wtc1-042"
  was: string;
  now: string;
  why: string;
  source_id: string | null;
}
