// scripts/fetch-context.ts
// Fetches the public data behind the city context around the site and writes
//   data/context/nyc-footprints-raw.json        raw SODA response, building footprints in the bbox
//   data/context/nyc-centerlines-raw.json       raw SODA response, the four bounding streets' centerlines
//   data/context/buildings-standing-in-2001.json cleaned: bin, year, roof height, ground elevation,
//                                                polygons in local metres about the site origin,
//                                                plus the origin derivation and the source citations
//
// Run:  node --experimental-strip-types scripts/fetch-context.ts     (network; not part of the build)
// The cleaned file is committed and read by scripts/generate-context.ts at build time.
//
// What this is and is not (GAPS.md, method page): the footprint dataset describes buildings that
// stand TODAY. Filtering construction_year <= 2001 keeps the ones that already stood in 2001 and
// still stand. Neighbours demolished since (and the six WTC buildings themselves) are absent.
// height_roof is the current roof height, not necessarily the 2001 height.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(ROOT, "data/context");

// Bounding box around the site (WGS84). A study-area choice, not a cited dimension.
const BBOX = { lon_min: -74.0165, lon_max: -74.0075, lat_min: 40.7075, lat_max: 40.7145 };
const YEAR_CUTOFF = 2001;

const FOOTPRINTS = {
  id: "nyc-building-footprints",
  name: "Building Footprints (dataset title \"BUILDING\")",
  publisher: "NYC Office of Technology and Innovation (OTI), via NYC Open Data",
  dataset_id: "5zhs-2jue",
  url: "https://data.cityofnewyork.us/d/5zhs-2jue",
  api: "https://data.cityofnewyork.us/resource/5zhs-2jue.json",
  field_docs: "https://github.com/CityOfNewYork/nyc-geo-metadata/blob/master/Metadata/Metadata_BuildingFootprints.md",
};
const CENTERLINES = {
  id: "nyc-street-centerline",
  name: "NYC Street Centerline (CSCL)",
  publisher: "NYC Office of Technology and Innovation (OTI), via NYC Open Data",
  dataset_id: "inkn-q76z",
  url: "https://data.cityofnewyork.us/d/inkn-q76z",
  api: "https://data.cityofnewyork.us/resource/inkn-q76z.json",
};
const BLOCK_STREETS = ["CHURCH ST", "VESEY ST", "LIBERTY ST", "WEST ST"] as const;

// WGS84 semi-major axis, for the local equirectangular projection (a unit definition, not a site dimension).
const EARTH_R_M = 6378137;
const M_PER_FT = 0.3048;

type LonLat = [number, number];
interface Footprint {
  bin: string;
  construction_year: string;
  height_roof: string;
  ground_elevation: string;
  feature_code?: string;
  last_status_type?: string;
  base_bbl?: string;
  the_geom: { type: "MultiPolygon"; coordinates: LonLat[][][] };
}
interface Segment {
  physicalid: string;
  full_street_name: string;
  streetwidth?: string;
  rw_type?: string;
  the_geom: { type: "MultiLineString"; coordinates: LonLat[][] };
}

const bboxWkt = `POLYGON((${BBOX.lon_min} ${BBOX.lat_min}, ${BBOX.lon_max} ${BBOX.lat_min}, ${BBOX.lon_max} ${BBOX.lat_max}, ${BBOX.lon_min} ${BBOX.lat_max}, ${BBOX.lon_min} ${BBOX.lat_min}))`;

async function soda<T>(api: string, where: string, select?: string): Promise<{ rows: T[]; url: string }> {
  const u = new URL(api);
  u.searchParams.set("$where", where);
  if (select) u.searchParams.set("$select", select);
  u.searchParams.set("$limit", "10000");
  const res = await fetch(u);
  if (!res.ok) throw new Error(`${u} -> HTTP ${res.status}`);
  const rows = (await res.json()) as T[] | { message?: string };
  if (!Array.isArray(rows)) throw new Error(`${u} -> ${JSON.stringify(rows).slice(0, 200)}`);
  return { rows, url: u.toString() };
}

const near = (a: LonLat, b: LonLat) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
function endpoints(seg: Segment): LonLat[] {
  return seg.the_geom.coordinates.flatMap((line) => [line[0], line[line.length - 1]]);
}
/** Points where a segment of street A ends on a segment of street B. */
function junctions(a: Segment[], b: Segment[]): LonLat[] {
  const out: LonLat[] = [];
  for (const sa of a) for (const pa of endpoints(sa)) for (const sb of b) for (const pb of endpoints(sb)) {
    if (near(pa, pb) && !out.some((q) => near(q, pa))) out.push(pa);
  }
  return out;
}

function polygonAreaCentroid(ring: [number, number][]): { area: number; cx: number; cy: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  return { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
}

function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const retrieved = new Date().toISOString().slice(0, 10);

  // ---- footprints
  const fpFilter = `intersects(the_geom, '${bboxWkt}') AND construction_year <= ${YEAR_CUTOFF}`;
  const fp = await soda<Footprint>(FOOTPRINTS.api, fpFilter, "bin,construction_year,height_roof,ground_elevation,feature_code,last_status_type,base_bbl,the_geom");
  writeFileSync(resolve(OUT_DIR, "nyc-footprints-raw.json"), JSON.stringify(fp.rows) + "\n");
  console.log(`footprints: ${fp.rows.length} rows with construction_year <= ${YEAR_CUTOFF} in the bbox`);

  // ---- centerlines of the four streets that bound the old superblock
  const clFilter = `intersects(the_geom, '${bboxWkt}') AND full_street_name in (${BLOCK_STREETS.map((s) => `'${s}'`).join(",")})`;
  const cl = await soda<Segment>(CENTERLINES.api, clFilter);
  writeFileSync(resolve(OUT_DIR, "nyc-centerlines-raw.json"), JSON.stringify(cl.rows) + "\n");
  const by = (name: string) => cl.rows.filter((s) => s.full_street_name === name);
  const church = by("CHURCH ST"), vesey = by("VESEY ST"), liberty = by("LIBERTY ST"), west = by("WEST ST");
  console.log(`centerlines: church ${church.length}, vesey ${vesey.length}, liberty ${liberty.length}, west ${west.length} segments`);

  // ---- site origin: the centroid of the block quadrilateral whose corners are the centerline
  //      junctions. West St is a divided roadway in CSCL (two carriageways, rw_type 2); Vesey and
  //      Liberty carry a node at each. The carriageway adjoining the block is the eastern one, so
  //      the West St corner is the easternmost junction (largest longitude).
  const pickOne = (pts: LonLat[], label: string): LonLat => {
    if (pts.length !== 1) throw new Error(`${label}: expected one junction, found ${pts.length}: ${JSON.stringify(pts)}`);
    return pts[0];
  };
  const pickEast = (pts: LonLat[], label: string): LonLat => {
    if (pts.length === 0) throw new Error(`${label}: no junction`);
    return pts.reduce((a, b) => (b[0] > a[0] ? b : a));
  };
  const NE = pickOne(junctions(church, vesey), "Church/Vesey");
  const SE = pickOne(junctions(church, liberty), "Church/Liberty");
  const NW = pickEast(junctions(vesey, west), "Vesey/West");
  const SW = pickEast(junctions(liberty, west), "Liberty/West");
  const corners: Record<string, LonLat> = { NE, SE, SW, NW };

  // First pass: project about the mean of the corners, take the area centroid, then re-project
  // about that centroid so the origin is exactly (0, 0) in the output frame.
  const lat0 = (NE[1] + SE[1] + SW[1] + NW[1]) / 4;
  const k = (Math.PI / 180) * EARTH_R_M;
  const proj = (p: LonLat, o: LonLat): [number, number] => [(p[0] - o[0]) * k * Math.cos((o[1] * Math.PI) / 180), -(p[1] - o[1]) * k];
  const mean: LonLat = [(NE[0] + SE[0] + SW[0] + NW[0]) / 4, lat0];
  const quad = [NE, SE, SW, NW].map((p) => proj(p, mean));
  const c = polygonAreaCentroid(quad);
  const origin: LonLat = [mean[0] + c.cx / (k * Math.cos((mean[1] * Math.PI) / 180)), mean[1] - c.cy / k];
  const blockRing = [NE, SE, SW, NW].map((p) => proj(p, origin));
  const blockArea = Math.abs(polygonAreaCentroid(blockRing).area);
  console.log(`origin: lon ${origin[0].toFixed(6)}, lat ${origin[1].toFixed(6)}; block quadrilateral ${(blockArea / 4046.8564224).toFixed(1)} acres between centerlines`);

  // ---- clean the footprints
  const buildings = fp.rows
    .filter((r) => r.the_geom && r.the_geom.type === "MultiPolygon")
    .map((r) => ({
      bin: r.bin,
      construction_year: Number(r.construction_year),
      height_roof_ft: Number(r.height_roof),
      ground_elevation_ft: Number(r.ground_elevation),
      feature_code: r.feature_code ? Number(r.feature_code) : null,
      polygons: r.the_geom.coordinates.map((poly) => ({
        outer: poly[0].map((p) => proj(p, origin).map((v) => Math.round(v * 1000) / 1000) as [number, number]),
        holes: poly.slice(1).map((ring) => ring.map((p) => proj(p, origin).map((v) => Math.round(v * 1000) / 1000) as [number, number])),
      })),
    }))
    .sort((a, b) => a.bin.localeCompare(b.bin));
  const dropped = fp.rows.length - buildings.length;
  const noHeight = buildings.filter((b) => !(b.height_roof_ft > 0)).length;
  // Cross-check: nothing that stood in 2001 and stands today should sit inside the block.
  const inside = buildings.filter((b) => b.polygons.some((p) => p.outer.some((v) => pointInRing(v, blockRing))));
  console.log(`cleaned: ${buildings.length} buildings (${dropped} dropped for missing geometry, ${noHeight} without a roof height); ${inside.length} have a vertex inside the block quadrilateral`);
  if (inside.length) console.log("  inside:", inside.map((b) => `${b.bin} (${b.construction_year})`).join(", "));

  const xs = buildings.flatMap((b) => b.polygons.flatMap((p) => p.outer.map((v) => v[0])));
  const zs = buildings.flatMap((b) => b.polygons.flatMap((p) => p.outer.map((v) => v[1])));

  const out = {
    meta: {
      generated_at: new Date().toISOString(),
      generator: "scripts/fetch-context.ts",
      what: `Buildings inside the study bbox whose recorded construction year is ${YEAR_CUTOFF} or earlier, as published today. This is the set that stood in ${YEAR_CUTOFF} AND still stands; buildings demolished since ${YEAR_CUTOFF} (including the seven World Trade Center buildings) are absent because the source only describes buildings that exist now.`,
      bbox_wgs84: BBOX,
      filter: `construction_year <= ${YEAR_CUTOFF}`,
      count: buildings.length,
      local_extent_m: { x_min: Math.min(...xs), x_max: Math.max(...xs), z_min: Math.min(...zs), z_max: Math.max(...zs) },
      frame: {
        units: "metres",
        axes: "x east, y up, z south (north is -z); same frame as the tower .glb files (paradata P-043)",
        projection: `local equirectangular about the origin: x = (lon - lon0) * cos(lat0) * R * pi / 180, z = -(lat - lat0) * R * pi / 180, R = ${EARTH_R_M} m (WGS84 semi-major axis). Error over a 1 km study area is well under a metre.`,
        y: "not carried. ground_elevation_ft is kept per building but not applied; every building is extruded from y = 0 (paradata P-067).",
        units_in: "height_roof_ft and ground_elevation_ft are feet as published; the generator converts with 1 ft = 0.3048 m",
      },
      origin: {
        lon: origin[0],
        lat: origin[1],
        method: "Area centroid of the quadrilateral whose corners are the junctions of the NYC Street Centerline segments for Church St, Vesey St, Liberty St and West St around the former superblock (the block the six original buildings and the plaza occupied). West St is a divided roadway in CSCL; the junction on its eastern carriageway, the one adjoining the block, is used. Street half-widths were not subtracted: the shift that would make is under 7 ft, and tower positions inside the block are unresolved anyway (paradata P-065, P-066).",
        corners_wgs84: corners,
        corners_local_m: Object.fromEntries(Object.entries(corners).map(([k2, p]) => [k2, proj(p, origin).map((v) => Math.round(v * 100) / 100)])),
        block_area_between_centerlines_acres: Math.round((blockArea / 4046.8564224) * 10) / 10,
        cross_check: `${inside.length} of ${buildings.length} filtered footprints have a vertex inside the block quadrilateral`,
      },
    },
    sources: [
      {
        ...FOOTPRINTS,
        retrieved_at: retrieved,
        query: fp.url,
        filter: fpFilter,
        rows_returned: fp.rows.length,
        notes: [
          "height_roof is the height of the CURRENT roof above the building's ground elevation (field documentation: 'The height of the roof above the ground elevation, not height above sea level'). It is not a 2001 measurement; a building altered since 2001 is shown at its present height.",
          "construction_year is 'the year construction of the building was completed', originally from the Department of Finance RPAD file, later from imagery and city systems. Zero or null means unknown; such rows do not pass the filter and are absent.",
          "The dataset contains only buildings that exist today. Buildings demolished after 2001 are not in it, so the context is incomplete by construction: a labeled gap, not an omission the model could fill.",
          "Dataset 5zhs-2jue was republished on the new Socrata backend in 2024 with renamed fields (cnstrct_yr -> construction_year, heightroof -> height_roof, groundelev -> ground_elevation).",
        ],
        license: "NYC Open Data terms of use (open, attribution to the City of New York)",
      },
      {
        ...CENTERLINES,
        retrieved_at: retrieved,
        query: cl.url,
        filter: clFilter,
        rows_returned: cl.rows.length,
        notes: ["Used only to locate the site origin (the block centroid). Current centerlines; the streets bounding the block keep their 2001 alignments, which is why they can locate it."],
        license: "NYC Open Data terms of use (open, attribution to the City of New York)",
      },
    ],
    buildings,
  };
  writeFileSync(resolve(OUT_DIR, "buildings-standing-in-2001.json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote data/context/buildings-standing-in-2001.json (${buildings.length} buildings); heights ${Math.min(...buildings.map((b) => b.height_roof_ft))} to ${Math.max(...buildings.map((b) => b.height_roof_ft))} ft (${(Math.max(...buildings.map((b) => b.height_roof_ft)) * M_PER_FT).toFixed(0)} m)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
