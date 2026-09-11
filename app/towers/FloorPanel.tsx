"use client";
// Side panel for the clicked floor. Two tabs: the tenant rows the source
// places on it, and the geometry parameters the generator cites for the tower.
import Link from "next/link";
import { useEffect, useState } from "react";
import { EvidenceBadge, evidenceRowClass } from "@/components/EvidenceBadge";
import type { TowerSummary, TowersData } from "@/lib/floors";
import type { GeometryFiles, ManifestSummary } from "@/lib/geometry-manifest";
import type { FloorRef } from "./types";

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

type Tab = "tenants" | "geometry";

interface Props {
  data: TowersData;
  geometry: GeometryFiles;
  manifest: ManifestSummary;
  selected: FloorRef | null;
  /** Tenant row to scroll to and mark, after a search result. */
  focusTenantId?: string | null;
  onClose: () => void;
}

export function FloorPanel({ data, geometry, manifest, selected, focusTenantId = null, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("tenants");
  useEffect(() => {
    if (focusTenantId) setTab("tenants");
  }, [focusTenantId]);
  const tower = selected ? data.towers.find((t) => t.id === selected.buildingId) : undefined;
  const floor = tower && selected ? tower.floors.find((f) => f.floor === selected.floor) : undefined;

  if (!selected || !tower || !floor) {
    return (
      <div className="text-sm text-ink-3">
        <p>Hover a floor for its tenant count and square footage. Click one to list its rows here.</p>
        <p className="mt-2 text-xs">
          Each tower is drawn as a stack of floor plates tinted by the industry with the most listed square feet on
          that floor. Floors the source leaves empty are drawn in a lighter, desaturated tone.
        </p>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-3">{tower.name}</p>
          <h2 className="mt-0.5 text-2xl font-semibold tracking-tight">Floor {floor.floor}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded-sm border border-rule px-2 py-0.5 text-xs text-ink-2 hover:bg-paper" aria-label="Close panel">
          close
        </button>
      </div>

      <div className="mt-3 flex gap-1 border-b border-rule text-xs">
        {(["tenants", "geometry"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-2 py-1 capitalize ${tab === t ? "border-ink font-medium" : "border-transparent text-ink-3 hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "tenants" ? <TenantsTab data={data} tower={tower} floor={floor} focusTenantId={focusTenantId} /> : <GeometryTab tower={tower} geometry={geometry} manifest={manifest} />}
    </div>
  );
}

function TenantsTab({ data, tower, floor, focusTenantId }: { data: TowersData; tower: TowerSummary; floor: TowerSummary["floors"][number]; focusTenantId: string | null }) {
  const rows = floor.tenantIds.map((id) => data.tenantsById[id]).filter(Boolean);
  useEffect(() => {
    if (!focusTenantId) return;
    const el = document.getElementById(`tenant-row-${focusTenantId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusTenantId, floor.floor]);
  return (
    <div className="mt-3">
      {(floor.isMechanical || floor.isSkyLobby) && (
        <p className="text-xs text-ink-2">
          {floor.isMechanical ? "Mechanical equipment room floor" : "Sky lobby"} per data/geometry-params.json (NIST NCSTAR 1-1 and 1-2A).
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-2 inline-flex items-center gap-2 text-ink-3">
          <EvidenceBadge level="unknown" />
          <span className="italic">No tenant record in this source.</span>
        </p>
      ) : (
        <>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
            <dt className="text-ink-3">Rows on this floor</dt>
            <dd className="tabular">{rows.length}</dd>
            <dt className="text-ink-3">Sq ft listed</dt>
            <dd className="tabular">
              {formatInt(floor.sqFt)} <span className="text-ink-3">({floor.sqFtRows} of {rows.length} rows give a number)</span>
            </dd>
            <dt className="text-ink-3">Tint</dt>
            <dd>
              {floor.dominant === "" ? (
                <span className="text-ink-3">industry blank in source for every row</span>
              ) : (
                <>
                  <span
                    aria-hidden
                    className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                    style={{ background: data.industryColors[floor.dominant ?? ""] }}
                  />
                  {floor.dominant} <span className="text-ink-3">(most {floor.dominantBasis})</span>
                </>
              )}
            </dd>
          </dl>

          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {rows.map((t) => (
              <li
                key={t.id}
                id={`tenant-row-${t.id}`}
                className={`py-1.5 ${evidenceRowClass(t.evidence)} ${t.id === focusTenantId ? "-mx-2 rounded-sm bg-brass/15 px-2" : ""}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>{t.name}</span>
                  <EvidenceBadge level={t.evidence} />
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-2">
                  <span className="tabular">{t.sq_ft !== null ? `${formatInt(t.sq_ft)} sq ft` : `sq ft ${t.sq_ft_raw || "blank"}`}</span>
                  <span className="text-ink-3">{t.industry ?? "industry blank"}</span>
                  {t.floors.length > 1 ? <span className="text-ink-3">floors {t.floor_raw}</span> : null}
                  {t.floor_unresolved ? <span className="text-clay">unresolved: {t.floor_unresolved}</span> : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">
            A row that spans several floors is listed on each of them with its full square footage, as the source gives
            it. Nothing is divided.
          </p>
        </>
      )}

      <p className="mt-4 text-xs text-ink-3">Source: {data.sourceCitation}</p>
      <p className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/walk/${tower.id}/${floor.floor}`}
          className="inline-block rounded-sm border border-ink bg-ink px-3 py-1.5 text-xs font-medium text-paper no-underline hover:bg-ink-2"
        >
          Walk this floor
        </Link>
        <Link
          href={`/walk/${tower.id}/lobby`}
          className="inline-block rounded-sm border border-ink px-3 py-1.5 text-xs font-medium no-underline hover:bg-paper"
        >
          Enter the lobby
        </Link>
      </p>
      <p className="mt-2">
        <Link href={`/directory/${tower.id}`} className="text-xs underline">
          Open {tower.name} in the directory
        </Link>
      </p>
    </div>
  );
}

function GeometryTab({ tower, geometry, manifest }: { tower: TowerSummary; geometry: GeometryFiles; manifest: ManifestSummary }) {
  const entry = manifest.byBuilding[tower.id];
  return (
    <div className="mt-3">
      {geometry.mode !== "real" ? (
        <p className="rounded-sm border border-clay px-2 py-1 text-xs text-clay">
          {geometry.mode === "placeholder" ? "placeholder geometry, not cited" : geometry.note}
        </p>
      ) : null}
      {!manifest.present || !entry ? (
        <p className="mt-2 text-ink-3">geometry manifest not yet generated</p>
      ) : (
        <>
          <p className="text-xs text-ink-2">
            {entry.params.length} cited parameters referenced by public/geometry/manifest.json for {tower.name}
            {entry.nodeCount ? `, ${entry.nodeCount} named nodes` : ""}
            {manifest.generatedAt ? `, generated ${manifest.generatedAt}` : ""}.
          </p>
          {entry.params.length === 0 ? (
            <p className="mt-2 text-ink-3">The manifest names no parameter for this tower.</p>
          ) : (
            <ul className="mt-2 divide-y divide-rule border-y border-rule">
              {entry.params.map((p) => (
                <li key={p.id} className="py-1.5 text-xs">
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
          )}
          {entry.citations.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-ink-3">Citations named in the manifest</p>
              <ul className="mt-1 space-y-1 text-xs text-ink-2">
                {entry.citations.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <p className="mt-4 text-xs text-ink-3">
        Story heights for {tower.id === "wtc1" ? "1 WTC follow the NCSTAR 1-1 Figure 2-2 schedule" : "2 WTC are not scheduled in NCSTAR 1-1; only its roof height is cited"}.
        Where the towers stand on the block is a layout choice, not a cited dimension (paradata P-066). The facade
        glass is drawn at the clear gap between steel column faces, 40 in. pitch minus 14 in. column; the window
        width itself is unresolved (P-061).
      </p>
      {manifest.context ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-ink-3">City context</p>
          <p className="mt-1 text-xs text-ink-2">
            {manifest.context.buildings} buildings drawn as unlabeled gray massing, filter {manifest.context.filter}.
          </p>
          <ul className="mt-1 space-y-1 text-xs text-ink-2">
            {manifest.context.sources.map((s) => (
              <li key={s.id}>
                {s.name}, {s.publisher}. Dataset {s.datasetId},{" "}
                <a href={s.url} className="underline" rel="noreferrer">
                  {s.url}
                </a>
                . Retrieved {s.retrievedAt}.
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-3">{manifest.context.gap}</p>
        </div>
      ) : null}
    </div>
  );
}
