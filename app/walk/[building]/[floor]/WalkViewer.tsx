"use client";
// Page shell for Walk mode. Owns the HUD, the illustration-layer toggle, the
// input mode, the capability probe, and the elevator prompt and panel. Loads
// the three.js bundle on the client only. Serves both a numbered floor and
// the Plaza lobby (WalkData.kind).
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import type { WalkData } from "@/lib/walk";
import { INDUSTRY_BLANK_COLOR } from "@/lib/industry-colors";
import { SITE_NAME } from "@/lib/site";
import { runProbe } from "../../../towers/scene/probe";
import type { Probe } from "../../../towers/types";
import { ElevatorPanel, type WalkLocation } from "../../ElevatorPanel";
import { ELEVATOR_PROMPT_M, type InputMode, type WalkStats } from "../../types";

const WalkScene = dynamic(() => import("../../scene/WalkScene"), {
  ssr: false,
  loading: () => <p className="p-4 text-sm text-ink-3">Loading the floor.</p>,
});

const STORAGE_KEY = "nmsf.walk.illustration";
export const ILLUSTRATION_LABEL = "Illustration. Furnishings are not a reconstruction.";

function describeWalkProbe(p: Probe, stats: WalkStats | null, illustration: boolean): string {
  const gpu = [`WebGL2 ${p.webgl2 ? "yes" : "no"}`, p.renderer ?? "renderer withheld", `DPR ${p.devicePixelRatio} used ${p.dprCap}`, p.tier === "reduced" ? `reduced (${p.reasons.join(", ")})` : "tier full"].join(" / ");
  const counts = stats
    ? ` ${stats.zones} ${stats.zones === 1 ? "zone" : "zones"}, ${stats.columns} columns, ${stats.glassPanels} glass panels${illustration ? `, ${stats.desks} illustration desks` : ""}.`
    : "";
  return `probe: ${gpu}.${counts}`;
}

function formatFt(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** The lines under the title: level, ceiling, rows. Shared by the desktop HUD and the phone strip. */
function HudLines({ data }: { data: WalkData }) {
  const listedSqFt = data.tenants.reduce((a, t) => a + (t.sq_ft ?? 0), 0);
  const listedRows = data.tenants.filter((t) => t.sq_ft !== null).length;
  const ceilingFt = data.story.ft - data.dims.slabFt;
  const sky = data.journey.zones;
  if (data.kind === "lobby" && data.lobby) {
    return (
      <>
        <p className="tabular text-ink-2">You are in the Plaza lobby of {data.buildingName}.</p>
        <p className="mt-1 text-clay">Lobby height not cited; ceiling omitted.</p>
        <p className="mt-1 tabular text-ink-2">
          Floor 2 line {formatFt(data.level?.ft ?? 0)} ft above the drawing datum (Concourse, towers.floor_1_elevation); listed as &ldquo;{data.lobby.usage}&rdquo; ({data.lobby.usageParam}).
        </p>
        <p className="mt-1 tabular text-ink-2">
          Column lines and glass drawn to the tree splice at {formatFt(data.lobby.wallTopFt)} ft ({data.lobby.wallTopParam}), {formatFt(data.lobby.wallHeightFt)} ft up: a column elevation, not a ceiling.
        </p>
        <p className="mt-1 text-ink-2">
          {data.tenants.length === 0 ? `No row in this source is coded LBBY for ${data.buildingName}.` : `${data.tenants.length} ${data.tenants.length === 1 ? "row" : "rows"} coded LBBY in this source, on plaques either side of the way in.`}
        </p>
        <p className="mt-1 text-ink-2">Walk to the core for the elevators.</p>
      </>
    );
  }
  return (
    <>
      <p className="tabular text-ink-2">
        {data.level
          ? `Floor line ${formatFt(data.level.ft)} ft above the drawing datum (Concourse, towers.floor_1_elevation).`
          : "Floor line: elevation not cited for this floor (no node in the manifest)."}
      </p>
      {data.level ? <p className="font-mono text-[10px] text-ink-3">{data.level.params.join(", ")}</p> : null}
      <p className="mt-1 tabular text-ink-2">
        Ceiling {formatFt(ceilingFt)} ft: story {formatFt(data.story.ft)} ft ({data.story.basis}) minus the {formatFt(data.dims.slabFt * 12)} in slab above ({data.dims.ids.slabFt}).
      </p>
      {data.story.note ? <p className="mt-0.5 text-clay">{data.story.note}</p> : null}
      <p className="mt-1 text-ink-2">
        {data.tenants.length === 0
          ? "No tenant record in this source."
          : `${data.tenants.length} ${data.tenants.length === 1 ? "row" : "rows"} on this floor, ${formatInt(listedSqFt)} sq ft listed (${listedRows} of ${data.tenants.length} give a number), against the cited approximately ${formatInt(data.dims.columnFreeAreaSqFt)} sq ft column-free area outside the core (${data.dims.ids.columnFreeAreaSqFt}).`}
        {data.isMechanical ? " Mechanical equipment room floor per data/geometry-params.json." : ""}
      </p>
      {data.isSkyLobby ? (
        <p className="mt-1 text-ink">
          Sky lobby: the transfer floor where people changed from the express elevators to the local elevators of this zone (towers.sky_lobby_floors). Floors {data.floor - 1} and {data.floor + 1} were the lower and upper escalator floors (towers.escalator_floors).
        </p>
      ) : null}
      {data.isEscalator ? (
        <p className="mt-1 text-ink-2">
          {data.isEscalator === "lower" ? "Lower" : "Upper"} escalator floor per NCSTAR 1-2A Table G-1 (towers.escalator_floors), one below or above the sky lobby on {data.isEscalator === "lower" ? data.floor + 1 : data.floor - 1}.
        </p>
      ) : null}
      {data.floor === data.journey.lobbyFloor ? (
        <p className="mt-1 text-ink-2">
          Floor 2 is the Plaza lobby.{" "}
          <Link href={`/walk/${data.buildingId}/lobby`} className="pointer-events-auto underline">
            Enter it as the lobby
          </Link>
          .
        </p>
      ) : null}
      {data.floor === 1 ? <p className="mt-1 text-ink-2">Floor 1 is the Concourse (towers.floor_1_usage). The express elevators are cited as running from here to sky lobbies {sky[1].skyLobby} and {sky[2].skyLobby}.</p> : null}
    </>
  );
}

export function WalkViewer({ data }: { data: WalkData }) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [illustration, setIllustration] = useState(true);
  const [inputMode, setInputMode] = useState<InputMode>("pointer");
  const [locked, setLocked] = useState(false);
  const [stats, setStats] = useState<WalkStats | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => { try { setDebug(new URLSearchParams(window.location.search).get("debug") === "1"); } catch { /* ignore */ } }, []);
  const [nearCore, setNearCore] = useState(false);
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    setProbe(runProbe());
    setInputMode(window.matchMedia("(pointer: coarse)").matches ? "touch" : "pointer");
    // ?illustration=off for this load; otherwise the remembered choice; default on.
    const q = new URLSearchParams(window.location.search).get("illustration");
    if (q === "off" || q === "on") {
      setIllustration(q === "on");
      return;
    }
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "off") setIllustration(false);
    } catch {
      // storage unavailable; keep the default
    }
  }, []);

  const toggleIllustration = useCallback(() => {
    setIllustration((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
      } catch {
        // storage unavailable
      }
      return next;
    });
  }, []);

  const onLockChange = useCallback((v: boolean) => setLocked(v), []);
  const onStats = useCallback((s: WalkStats) => setStats(s), []);
  const onNearCore = useCallback((v: boolean) => setNearCore(v), []);

  const openPanel = useCallback(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    setPanel(true);
  }, []);
  const closePanel = useCallback(() => setPanel(false), []);

  // E opens the panel when the prompt is showing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyE" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (nearCore && !panel) {
        e.preventDefault();
        openPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nearCore, panel, openPanel]);

  const location: WalkLocation = useMemo(() => (data.kind === "lobby" ? { kind: "lobby" } : { kind: "floor", floor: data.floor }), [data.kind, data.floor]);
  const isLobby = data.kind === "lobby";
  const gapIn = (data.dims.columnPitchFt - data.dims.columnWidthFt) * 12;
  const canRender = probe?.tier !== "unsupported";
  const params = Object.values(data.params).sort((a, b) => a.id.localeCompare(b.id));
  const prev = !isLobby && data.floor > 1 ? data.floor - 1 : null;
  const next = !isLobby && data.floor < data.floorCount ? data.floor + 1 : null;
  const title = isLobby ? "Plaza lobby" : data.isSkyLobby ? `Floor ${data.floor}, sky lobby` : `Floor ${data.floor}`;

  return (
    <div className="mt-4">
      <div className="relative h-[58vh] min-h-[360px] overflow-hidden rounded-sm border border-rule bg-paper lg:h-[78vh] lg:min-h-[480px]">
        {probe === null ? (
          <p className="p-4 text-sm text-ink-3">Checking what this browser can draw.</p>
        ) : canRender ? (
          <WalkScene data={data} probe={probe} illustration={illustration} inputMode={inputMode} onLockChange={onLockChange} onStats={onStats} onNearCore={onNearCore} />
        ) : (
          <div className="p-4 text-sm">
            <p className="font-medium">The walk is not available here.</p>
            <p className="mt-1 text-ink-2">This browser did not provide a WebGL2 context. The directory lists every row on this floor.</p>
            <p className="mt-3">
              <Link href={`/directory/${data.buildingId}`} className="underline">
                {data.buildingName}, floor by floor
              </Link>
            </p>
          </div>
        )}

        <div className={`absolute left-2 right-2 top-2 z-20 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between ${panel ? "hidden" : ""}`}>
          {/* What you are looking at. */}
          <div className="pointer-events-none w-full rounded-sm border border-rule bg-paper/92 px-3 py-2 text-xs shadow-sm sm:max-w-[22rem]">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-ink-3">{SITE_NAME}</p>
                <p className="uppercase tracking-wide text-ink-3">{data.buildingName}</p>
                <p className="text-lg font-semibold leading-tight tracking-tight">{title}</p>
              </div>
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-sm border border-ink bg-ink px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-paper">Cited</span>
                <EvidenceBadge level={data.level?.evidence ?? data.story.evidence} />
              </span>
            </div>
            {showInfo ? (
              <div className="mt-1.5">
                <HudLines data={data} />
                {isLobby ? <p className="mt-1 text-ink-3">Lobby height is not cited, so no ceiling is drawn.</p> : null}
              </div>
            ) : null}
          </div>

          {/* Layer toggle, exit, jump fallback. */}
          <div className="flex flex-wrap gap-1.5 text-xs sm:flex-col sm:items-end">
            <Link href="/towers" className="rounded-sm border border-rule bg-paper/92 px-2 py-1 no-underline shadow-sm hover:bg-paper-2">
              Exit to Towers
            </Link>
            <button type="button" onClick={() => setShowInfo((v) => !v)} aria-pressed={showInfo} className="rounded-sm border border-rule bg-paper/92 px-2 py-1 shadow-sm hover:bg-paper-2">
              {showInfo ? "Hide info" : "Info"}
            </button>
            {!isLobby ? (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-rule bg-paper/92 px-2 py-1 shadow-sm">
                <input type="checkbox" checked={illustration} onChange={toggleIllustration} className="accent-ink" />
                Illustration layer
              </label>
            ) : null}
            <details className="rounded-sm border border-rule bg-paper/92 px-2 py-1 shadow-sm">
              <summary className="cursor-pointer text-ink-2">Jump</summary>
              <div className="mt-1 flex flex-col gap-1">
                {prev ? (
                  <Link href={`/walk/${data.buildingId}/${prev}`} className="no-underline hover:underline">
                    Floor {prev}
                  </Link>
                ) : null}
                {next ? (
                  <Link href={`/walk/${data.buildingId}/${next}`} className="no-underline hover:underline">
                    Floor {next}
                  </Link>
                ) : null}
                {!isLobby ? (
                  <Link href={`/walk/${data.buildingId}/lobby`} className="no-underline hover:underline">
                    Plaza lobby
                  </Link>
                ) : null}
                <button type="button" onClick={openPanel} className="text-left hover:underline">
                  Elevator panel
                </button>
              </div>
            </details>
          </div>
        </div>

        {/* Elevator prompt: appears within reach of the core. */}
        {canRender && nearCore && !panel ? (
          <button
            type="button"
            onClick={openPanel}
            className="absolute bottom-16 left-1/2 z-20 -translate-x-1/2 rounded-sm border border-ink bg-ink px-4 py-2 text-sm font-medium text-paper shadow-sm hover:bg-ink-2"
          >
            Elevators{inputMode === "pointer" ? <span className="ml-2 rounded-sm border border-paper/60 px-1 text-[10px]">E</span> : null}
          </button>
        ) : null}

        <ElevatorPanel journey={data.journey} location={location} open={panel} onClose={closePanel} />

        {/* Persistent label while the illustration layer is on. */}
        {illustration && canRender && !isLobby ? (
          <p className="pointer-events-none absolute bottom-10 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm border border-dashed border-ink/60 bg-paper/92 px-3 py-1 text-xs font-medium tracking-wide text-ink shadow-sm">
            {ILLUSTRATION_LABEL}
          </p>
        ) : null}

        {/* Controls hint. */}
        {canRender && probe ? (
          inputMode === "pointer" ? (
            !locked ? (
              <p className="pointer-events-none absolute bottom-2 right-2 z-20 max-w-[55%] truncate rounded-sm bg-paper/85 px-2 py-1 text-[11px] text-ink-3">
                Click the floor to look around. W A S D or the arrow keys to walk. Esc releases the mouse. E at the core opens the elevators.
              </p>
            ) : null
          ) : (
            <p className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm bg-paper/85 px-2 py-1 text-[11px] text-ink-3">
              Left thumb: walk. Right side: drag to look. Tap Elevators at the core.
            </p>
          )
        ) : null}

        {debug && probe && inputMode === "pointer" ? (
          <p className="pointer-events-none absolute bottom-2 left-2 z-20 max-w-[40%] truncate rounded-sm bg-paper/85 px-2 py-1 font-mono text-[11px] text-ink-3" title={describeWalkProbe(probe, stats, illustration)}>
            {describeWalkProbe(probe, stats, illustration)}
          </p>
        ) : null}
      </div>

      <details className="mt-4 rounded-sm border border-rule bg-paper-2 px-4 py-3 text-xs text-ink-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">Sources and method for {isLobby ? "the lobby" : "this floor"}</summary>
      <div className="mt-3 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{isLobby ? "How the lobby is drawn" : "How this floor is drawn"}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Plate: {formatFt(data.dims.sideFt)} ft square on column reference lines ({data.dims.ids.sideFt}), corners chamfered {formatFt(data.dims.chamferFt * 12)} in ({data.dims.ids.chamferFt}).
            </li>
            <li>
              Core: one solid block, {formatFt(data.dims.coreLongFt)} ft by {formatFt(data.dims.coreShortFt)} ft, long axis {data.dims.coreOrientation} ({data.dims.ids.coreLongFt}, {data.dims.ids.coreShortFt}, {data.dims.ids.coreOrientation}). No opening width is cited, so none is cut. The elevator prompt appears within {ELEVATOR_PROMPT_M} m of its face; that reach is a presentation choice.
            </li>
            {isLobby && data.lobby ? (
              <>
                <li>
                  Perimeter: {data.lobby.baseColumnsPerFace} base columns per face at {formatFt(data.lobby.baseColumnPitchFt)} ft on centre ({data.lobby.baseIds.bays}, {data.lobby.baseIds.pitch}, {data.lobby.baseIds.run}), the first {formatFt(data.lobby.baseFirstOffsetFt * 12)} in from the reference-line corner (the {formatFt(data.dims.chamferFt * 12)} in chamfer plus the {formatFt((data.lobby.baseFirstOffsetFt - data.dims.chamferFt) * 12)} in end bay, {data.lobby.baseIds.chamfer}, {data.lobby.baseIds.endBay}). Each is a line, not a box: no base column section is cited ({data.lobby.baseIds.section}). Glass runs between the chamfers. Both stop at the tree splice, {formatFt(data.lobby.wallTopFt)} ft ({data.lobby.baseIds.splice}).
                </li>
                <li>Open-topped. Floors 3 to 6 are cited as core only, so outside the core the next plate above is floor 7, whose elevation is not lettered. No ceiling is drawn.</li>
                <li>Lobby rows: the CoStar rows coded LBBY, one plaque each, set either side of the way from the start to the core in source order. Their positions are a layout choice (paradata P-074); the source gives none. Rows coded CNCR belong to the Concourse below and are not shown here.</li>
                <li>No illustration layer in the lobby: the generic office fit-out would misdescribe a lobby, and no lobby fit-out is cited.</li>
              </>
            ) : (
              <>
                <li>
                  {data.floor >= 9 && data.floor <= 107
                    ? `Perimeter: ${data.dims.columnsPerFace} columns per face at ${formatFt(data.dims.columnPitchFt * 12)} in on centre, each ${formatFt(data.dims.columnWidthFt * 12)} in wide by ${formatFt(data.dims.columnDepthFt * 12)} in deep (${data.dims.ids.columnsPerFace}, ${data.dims.ids.columnPitchFt}, ${data.dims.ids.columnWidthFt}, ${data.dims.ids.columnDepthFt}). Glass fills the ${formatFt(gapIn)} in clear gap between column faces. That gap is column spacing minus column width, not a cited window width (towers.window_width is unresolved).`
                    : "Perimeter columns are cited for floors 9 to 107 only, so this floor shows the plate edge without them."}
                </li>
                <li>
                  Tenant zones: angular slices around the core in source order, starting at the south face and running clockwise, each sized to the row&apos;s share of listed square feet and scaled to fill the ring. Rows with no figure get the smallest listed share and say so. This arrangement is a layout choice (paradata P-050); the source does not say where on the plate a tenant sat.
                </li>
                <li>
                  Tint by industry, as in the Towers view.{" "}
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: INDUSTRY_BLANK_COLOR }} /> industry blank in source.
                </li>
              </>
            )}
            <li>
              Elevators: a panel, not a bank. Every button on it is a car the sources describe (express to the sky lobbies, locals within a zone, the dedicated cars to the top floors); the floor ranges of the local zones are interpretive (paradata P-072). The ride is a counter, since no cab is cited (paradata P-073).
            </li>
          </ul>
          {isLobby && data.lobby ? (
            <>
              <h2 className="mt-4 text-sm font-semibold uppercase tracking-wide text-ink-3">What the record says about the lobby</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {data.lobby.facts.map((f) => (
                  <li key={f.text}>
                    {f.text} <span className="font-mono text-ink-3">({f.params.join(", ")})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Not drawn, and why</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {data.omitted.map((o) => (
              <li key={o.what}>
                <span className="font-medium text-ink">{o.what}.</span> {o.why}
                {o.unresolvedId ? <span className="font-mono text-ink-3"> ({o.unresolvedId})</span> : null}
              </li>
            ))}
          </ul>
          {!isLobby ? (
            <p className="mt-3 text-ink-3">
              The illustration layer (desks, partitions, chairs, carpet, ceiling grid) is a generic office fit-out made of procedural boxes and cylinders. It is a hypothetical reconstruction, sized by nothing in the record, tied to no tenant, and drawn in its own stipple treatment. It is on by default and can be turned off above (paradata P-051).
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 text-xs">
        <button type="button" onClick={() => setShowSources((v) => !v)} className="rounded-sm border border-rule px-2 py-1 text-ink-2 hover:bg-paper-2">
          {showSources ? "Hide" : "Show"} the {params.length} cited parameters behind {isLobby ? "the lobby" : "this floor"}
        </button>
        {showSources ? (
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {params.map((p) => (
              <li key={p.id} className="py-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <code className="font-mono">{p.id}</code>
                  <span className="tabular">
                    {p.value} {p.unit}
                  </span>
                  <EvidenceBadge level={p.evidence} />
                </div>
                <p className="mt-0.5 text-ink-2">
                  {p.citation}. {p.locator}.
                </p>
                {p.notes ? <p className="mt-0.5 text-ink-3">{p.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-ink-3">
          Tenant rows: {data.sourceCitation}
          {data.manifestGeneratedAt ? ` Geometry manifest generated ${data.manifestGeneratedAt}.` : ""}
        </p>
      </div>
      </details>
    </div>
  );
}
