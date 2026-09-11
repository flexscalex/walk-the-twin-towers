// Build-time loaders. Server-only. Reads the canonical JSON files in data/,
// falling back to a small typed fixture when the real tenant file is absent.
import fs from "node:fs";
import path from "node:path";
import type { ErratumRow, GeometryFile, ParadataRow, TenantsFile } from "./types";

const ROOT = process.cwd();
const REAL_TENANTS = path.join(ROOT, "data", "tenants.clean.json");
const FIXTURE_TENANTS = path.join(ROOT, "data", "fixtures", "tenants.sample.json");
const GEOMETRY = path.join(ROOT, "data", "geometry-params.json");
const PARADATA = path.join(ROOT, "data", "paradata.json");
// Sibling files hold rows written by sessions that do not own data/paradata.json
// (paradata.exterior.json P-060 onward, paradata.journey.json P-070 onward).
// Same row format; merged after the main file, in id order.
const PARADATA_DIR = path.join(ROOT, "data");
const ERRATA = path.join(ROOT, "data", "errata.json");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export type TenantDataSource = "real" | "fixture";

let tenantsCache: { file: TenantsFile; source: TenantDataSource; path: string } | null = null;
let loggedTenants = false;

export function loadTenants(): { file: TenantsFile; source: TenantDataSource; path: string } {
  if (tenantsCache) return tenantsCache;
  const useReal = fs.existsSync(REAL_TENANTS);
  const file = readJson<TenantsFile>(useReal ? REAL_TENANTS : FIXTURE_TENANTS);
  tenantsCache = {
    file,
    source: useReal ? "real" : "fixture",
    path: path.relative(ROOT, useReal ? REAL_TENANTS : FIXTURE_TENANTS),
  };
  if (!loggedTenants) {
    loggedTenants = true;
    console.log(
      `[data] tenants: ${tenantsCache.source} (${tenantsCache.path}, ${file.tenants.length} rows)`,
    );
  }
  return tenantsCache;
}

let geometryCache: GeometryFile | null | undefined;
export function loadGeometry(): GeometryFile | null {
  if (geometryCache !== undefined) return geometryCache;
  geometryCache = fs.existsSync(GEOMETRY) ? readJson<GeometryFile>(GEOMETRY) : null;
  console.log(`[data] geometry-params: ${geometryCache ? "present" : "not yet generated"}`);
  return geometryCache;
}

let paradataCache: ParadataRow[] | null | undefined;
export function loadParadata(): ParadataRow[] | null {
  if (paradataCache !== undefined) return paradataCache;
  if (!fs.existsSync(PARADATA)) {
    paradataCache = null;
  } else {
    const rows = readJson<ParadataRow[]>(PARADATA);
    const extra = fs
      .readdirSync(PARADATA_DIR)
      .filter((f) => /^paradata\.[a-z0-9-]+\.json$/.test(f))
      .sort()
      .flatMap((f) => readJson<ParadataRow[]>(path.join(PARADATA_DIR, f)));
    paradataCache = [...rows, ...extra].sort((a, b) => a.id.localeCompare(b.id));
  }
  console.log(`[data] paradata: ${paradataCache ? `${paradataCache.length} rows` : "not yet generated"}`);
  return paradataCache;
}

export function loadErrata(): ErratumRow[] {
  return fs.existsSync(ERRATA) ? readJson<ErratumRow[]>(ERRATA) : [];
}
