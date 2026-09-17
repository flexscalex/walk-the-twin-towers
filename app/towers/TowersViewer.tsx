"use client";
// Page shell for the tower view. Owns hover and selection state, runs the
// capability probe, and loads the three.js bundle on the client only so the
// rest of the site stays inside the core JS budget.
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TowersData } from "@/lib/floors";
import type { GeometryFiles, ManifestSummary } from "@/lib/geometry-manifest";
import { INDUSTRY_BLANK_COLOR, NO_RECORD_COLOR, NO_RECORD_MECHANICAL_COLOR } from "@/lib/industry-colors";
import { FloorPanel } from "./FloorPanel";
import { describeProbe, runProbe } from "./scene/probe";
import type { FlightRequest, FloorHighlight, FloorRef, HoverInfo, Probe, SceneStats } from "./types";

const TowersScene = dynamic(() => import("./scene/TowersScene"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-ink-3">Loading the viewer.</p>,
});

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

// ---- Find a floor or tenant -------------------------------------------------
// Typeahead over building + floor numbers ("wtc1 89", "89", "north 89",
// "1 89") and over every tenant name already passed to the viewer. A tenant
// result flies to the first numeric floor the source lists for it.

type SearchResult =
  | { kind: "floor"; key: string; buildingId: string; floor: number; label: string; detail: string }
  | { kind: "tenant"; key: string; buildingId: string; floor: number; floors: number[]; tenantId: string; label: string; detail: string };

const BUILDING_WORDS: Record<string, string> = { north: "wtc1", south: "wtc2", "1": "wtc1", "2": "wtc2", one: "wtc1", two: "wtc2" };
const FLOOR_QUERY = /^(?:(?:wtc\s*([12])|([12])\s*wtc|(north|south|one|two)|(?:tower\s*)?([12]))[\s,]+)?(?:floor\s*|fl\s*)?(\d{1,3})$/i;
const MAX_TENANT_RESULTS = 8;

function buildingFromWord(w: string | undefined): string | null {
  if (!w) return null;
  const k = w.toLowerCase();
  return BUILDING_WORDS[k] ?? (k.startsWith("wtc") ? k : null);
}

function search(q: string, data: TowersData): SearchResult[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const out: SearchResult[] = [];
  const m = FLOOR_QUERY.exec(query);
  if (m) {
    const floor = Number(m[5]);
    const building = buildingFromWord(m[1] ? `wtc${m[1]}` : m[2] ? `wtc${m[2]}` : m[3] ?? m[4]);
    for (const t of data.towers) {
      if (building && t.id !== building) continue;
      const f = t.floors.find((x) => x.floor === floor);
      if (!f) continue;
      out.push({
        kind: "floor",
        key: `${t.id}-${floor}`,
        buildingId: t.id,
        floor,
        label: `${t.name}, floor ${floor}`,
        detail: f.rows === 0 ? "no tenant record in this source" : `${f.rows} ${f.rows === 1 ? "row" : "rows"}${f.dominant ? `, ${f.dominant}` : ""}`,
      });
    }
  }
  if (query.length >= 2) {
    const names = new Map<string, string>(data.towers.map((t) => [t.id, t.name]));
    const hits: SearchResult[] = [];
    for (const t of Object.values(data.tenantsById)) {
      if (!t.name.toLowerCase().includes(query)) continue;
      const floors = t.floors.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      if (floors.length === 0) continue; // concourse, plaza and unresolved levels have no plate to fly to
      const building = t.id.split("-")[0];
      if (!names.has(building)) continue;
      floors.sort((a, b) => a - b);
      hits.push({
        kind: "tenant",
        key: t.id,
        buildingId: building,
        floor: floors[0],
        floors,
        tenantId: t.id,
        label: t.name,
        detail: `${names.get(building)}, ${floors.length > 1 ? `floors ${t.floor_raw}` : `floor ${floors[0]}`}`,
      });
    }
    hits.sort((a, b) => {
      const sa = a.label.toLowerCase().startsWith(query) ? 0 : 1;
      const sb = b.label.toLowerCase().startsWith(query) ? 0 : 1;
      return sa - sb || a.label.localeCompare(b.label);
    });
    out.push(...hits.slice(0, MAX_TENANT_RESULTS));
  }
  return out;
}

interface FinderProps {
  data: TowersData;
  disabled: boolean;
  onPick: (r: SearchResult) => void;
}

function Finder({ data, disabled, onPick }: FinderProps) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => search(q, data), [q, data]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (r: SearchResult) => {
    onPick(r);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={box} className="relative min-w-0 flex-1 sm:max-w-md">
      <label className="sr-only" htmlFor="tower-finder">
        Find a floor or tenant
      </label>
      <input
        id="tower-finder"
        type="search"
        autoComplete="off"
        disabled={disabled}
        value={q}
        placeholder="Find a floor or tenant (wtc1 89, north 89, a name)"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (results[active]) pick(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="w-full rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none disabled:opacity-60"
        aria-expanded={open && results.length > 0}
        aria-controls="tower-finder-results"
      />
      {open && q.trim() ? (
        <ul id="tower-finder-results" role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-sm border border-rule bg-paper-2 py-1 text-sm shadow-md">
          {results.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-ink-3">No floor or tenant matches. Floors are 1 to 110; tenant names are as the source lists them.</li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.key}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(r);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-2 py-1.5 ${i === active ? "bg-paper" : ""}`}
              >
                <span className={r.kind === "floor" ? "font-medium" : ""}>{r.label}</span>
                <span className="ml-2 text-xs text-ink-3">{r.detail}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

// ---- Viewer -------------------------------------------------------------------

interface Props {
  data: TowersData;
  geometry: GeometryFiles;
  manifest: ManifestSummary;
}

export function TowersViewer({ data, geometry, manifest }: Props) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [debug, setDebug] = useState(false);
  useEffect(() => { try { setDebug(new URLSearchParams(window.location.search).get("debug") === "1"); } catch { /* ignore */ } }, []);
  const [hovered, setHovered] = useState<HoverInfo | null>(null);
  const [selected, setSelected] = useState<FloorRef | null>(null);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showContext, setShowContext] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [flight, setFlight] = useState<FlightRequest | null>(null);
  const [highlight, setHighlight] = useState<FloorHighlight | null>(null);
  const [focusTenantId, setFocusTenantId] = useState<string | null>(null);
  const flightId = useRef(0);

  useEffect(() => {
    setProbe(runProbe());
  }, []);

  const fly = useCallback((req: Omit<FlightRequest, "id">) => {
    flightId.current += 1;
    setFlight({ id: flightId.current, ...req });
  }, []);

  const onHover = useCallback((h: HoverInfo | null) => setHovered(h), []);
  // A click in the scene replaces any search-driven highlight.
  const onSelect = useCallback((s: FloorRef | null) => {
    setSelected(s);
    setHighlight(null);
    setFocusTenantId(null);
  }, []);
  const onLoaded = useCallback((s: SceneStats) => setStats(s), []);
  const onError = useCallback((m: string) => setError(m), []);
  const hoveredRef = useMemo<FloorRef | null>(() => (hovered ? { buildingId: hovered.buildingId, floor: hovered.floor } : null), [hovered]);

  const onPick = useCallback(
    (r: SearchResult) => {
      setSelected({ buildingId: r.buildingId, floor: r.floor });
      if (r.kind === "tenant") {
        setHighlight({ buildingId: r.buildingId, floors: r.floors });
        setFocusTenantId(r.tenantId);
      } else {
        setHighlight(null);
        setFocusTenantId(null);
      }
      fly({ kind: "floor", buildingId: r.buildingId, floor: r.floor });
    },
    [fly],
  );

  const floorCount = Math.max(...data.towers.map((t) => t.floorCount), 0);
  const hoverTower = hovered ? data.towers.find((t) => t.id === hovered.buildingId) : null;
  const hoverFloor = hoverTower && hovered ? hoverTower.floors.find((f) => f.floor === hovered.floor) : null;

  const legend = useMemo(() => {
    const used = new Set<string>();
    for (const t of data.towers) for (const f of t.floors) if (f.dominant) used.add(f.dominant);
    return [...used].sort().map((name) => ({ name, color: data.industryColors[name] }));
  }, [data]);

  const canRender = probe?.tier !== "unsupported" && geometry.mode !== "none" && !error;
  const buttonClass = "rounded-sm border border-rule bg-paper/90 px-2 py-1 text-xs text-ink-2 hover:bg-paper-2 disabled:opacity-50";

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_auto] lg:gap-x-6 lg:gap-y-3">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Finder data={data} disabled={!canRender || !stats} onPick={onPick} />
          <div className="flex gap-1">
            <button type="button" className={buttonClass} disabled={!canRender || !stats} onClick={() => fly({ kind: "street" })} title="Plaza-level view of the pair from the south-west">
              Street
            </button>
            <button type="button" className={buttonClass} disabled={!canRender || !stats} onClick={() => fly({ kind: "top" })} title="Fly to the roof zone">
              Top
            </button>
          </div>
        </div>

        <div className="relative h-[58vh] min-h-[360px] overflow-hidden lg:h-[70vh] lg:min-h-[420px] rounded-sm border border-rule bg-paper">
          {geometry.mode === "placeholder" ? (
            <p className="pointer-events-none absolute left-2 top-2 z-10 rounded-sm border border-clay bg-paper/90 px-2 py-1 text-xs text-clay">
              placeholder geometry, not cited
            </p>
          ) : null}

          {probe === null ? (
            <p className="p-4 text-sm text-ink-3">Checking what this browser can draw.</p>
          ) : canRender && probe ? (
            <TowersScene
              data={data}
              geometry={geometry}
              probe={probe}
              showContext={showContext}
              resetKey={resetKey}
              flight={flight}
              highlight={highlight}
              hovered={hoveredRef}
              selected={selected}
              onHover={onHover}
              onSelect={onSelect}
              onLoaded={onLoaded}
              onError={onError}
            />
          ) : (
            <div className="p-4 text-sm">
              <p className="font-medium">The 3D view is not available here.</p>
              <p className="mt-1 text-ink-2">
                {error
                  ? `The geometry file failed to load: ${error}`
                  : geometry.mode === "none"
                    ? geometry.note
                    : "This browser did not provide a WebGL2 context. The directory has every floor as a list."}
              </p>
              <ul className="mt-3 list-disc pl-5 text-ink-2">
                {data.towers.map((t) => (
                  <li key={t.id}>
                    <a href={`/directory/${t.id}`} className="underline">
                      {t.name}, floor by floor
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {canRender && probe ? (
            <button type="button" onClick={() => setResetKey((k) => k + 1)} className={`absolute right-2 top-2 z-10 ${buttonClass}`}>
              Reset view
            </button>
          ) : null}

          {hovered && hoverTower && hoverFloor ? (
            <div
              className="pointer-events-none absolute z-10 rounded-sm border border-rule bg-paper-2/95 px-2 py-1 text-xs shadow-sm"
              style={{ left: Math.min(hovered.x - (typeof window !== "undefined" ? window.scrollX : 0), 99999), top: hovered.y - 44, position: "fixed" }}
            >
              <div className="font-medium">
                {hoverTower.name}, floor {hoverFloor.floor}
              </div>
              {hoverFloor.rows === 0 ? (
                <div className="italic text-ink-3">No tenant record in this source.{hoverFloor.isMechanical ? " Mechanical floor." : ""}</div>
              ) : (
                <div className="tabular text-ink-2">
                  {hoverFloor.rows} {hoverFloor.rows === 1 ? "row" : "rows"}, {formatInt(hoverFloor.sqFt)} sq ft listed
                  {hoverFloor.dominant ? `, ${hoverFloor.dominant}` : ""}
                </div>
              )}
            </div>
          ) : null}

          {debug && probe ? (
            <p className="pointer-events-none absolute bottom-2 left-2 right-2 z-10 truncate rounded-sm bg-paper/85 px-2 py-1 font-mono text-[11px] text-ink-3" title={describeProbe(probe, floorCount)}>
              probe: {describeProbe(probe, floorCount)}
              {stats ? ` ${stats.floorMeshes} floor meshes, ${stats.bvhMeshes} meshes with bounds trees${stats.detailNodes ? `, ${stats.detailNodesHidden} of ${stats.detailNodes} detail nodes hidden` : ""}.` : ""}
            </p>
          ) : null}
        </div>
      </div>

      <aside className="lg:col-start-2 lg:row-start-1 lg:row-span-2">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-sm border border-rule bg-paper-2 p-4">
          <FloorPanel data={data} geometry={geometry} manifest={manifest} selected={selected} focusTenantId={focusTenantId} onClose={() => onSelect(null)} />
        </div>
      </aside>

      <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
          {legend.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: INDUSTRY_BLANK_COLOR }} />
            industry blank in source
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-rule" style={{ background: NO_RECORD_COLOR }} />
            no tenant record
          </span>
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-rule" style={{ background: NO_RECORD_MECHANICAL_COLOR }} />
            mechanical, no record
          </span>
        </div>
        {geometry.contextUrl ? (
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} className="accent-ink" />
            City context
            <span className="text-ink-3">
              (buildings that stood in 2001 and still stand, NYC Open Data; demolished neighbours are absent. Details in the Geometry tab.)
            </span>
          </label>
        ) : null}
        <p className="mt-2 text-xs text-ink-3">
          Tint is the industry with the most listed square feet on the floor (rows that give a number), otherwise the
          most rows. Rows with no numeric floor are not placed:{" "}
          {data.towers.map((t, i) => `${t.name} ${t.noFloorRows} without a floor, ${t.codedLevelRows} on concourse or plaza levels${i < data.towers.length - 1 ? "; " : "."}`)}{" "}
          Where the towers stand on the block, and their spacing, is a layout choice, not a cited dimension (paradata P-066).
        </p>
      </div>
    </div>
  );
}
