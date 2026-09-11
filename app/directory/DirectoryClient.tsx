"use client";
import { archiveLinks } from "@/lib/archive";

import { useMemo, useState } from "react";
import { EvidenceBadge, EVIDENCE_TITLES, evidenceRowClass } from "@/components/EvidenceBadge";
import type { Source, Tenant } from "@/lib/types";

type SortKey = "source" | "sqft-desc" | "sqft-asc" | "name";

interface Props {
  tenants: Tenant[];
  buildings: { id: string; name: string; source_file?: string }[];
  floorCodes: Record<string, string>;
  sourcesById: Record<string, Source>;
}

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

function floorSortKey(f: string): number {
  return /^\d+$/.test(f) ? Number(f) : -1;
}

export function DirectoryClient({ tenants, buildings, floorCodes, sourcesById }: Props) {
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("");
  const [industry, setIndustry] = useState("");
  const [floor, setFloor] = useState("");
  const [sort, setSort] = useState<SortKey>("source");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const industries = useMemo(() => {
    const s = new Set<string>();
    for (const t of tenants) if (t.industry) s.add(t.industry);
    return [...s].sort();
  }, [tenants]);

  const floors = useMemo(() => {
    const s = new Set<string>();
    for (const t of tenants) for (const f of t.floors) s.add(f);
    return [...s].sort((a, b) => {
      const na = floorSortKey(a);
      const nb = floorSortKey(b);
      if (na >= 0 && nb >= 0) return nb - na;
      if (na >= 0) return -1;
      if (nb >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [tenants]);

  const buildingName = useMemo(() => Object.fromEntries(buildings.map((b) => [b.id, b.name])), [buildings]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = tenants.filter((t) => {
      if (needle && !t.name.toLowerCase().includes(needle)) return false;
      if (building && t.building_id !== building) return false;
      if (industry === "__blank" ? t.industry !== null : industry && t.industry !== industry) return false;
      if (floor === "__none" ? t.floors.length !== 0 : floor && !t.floors.includes(floor)) return false;
      return true;
    });
    if (sort === "sqft-desc") out.sort((a, b) => (b.sq_ft ?? -1) - (a.sq_ft ?? -1));
    else if (sort === "sqft-asc") out.sort((a, b) => (a.sq_ft ?? Infinity) - (b.sq_ft ?? Infinity));
    else if (sort === "name") out.sort((a, b) => a.name.localeCompare(b.name));
    // "source" keeps file order: building order, then source_row.
    return out;
  }, [tenants, q, building, industry, floor, sort]);

  const selected = selectedId ? tenants.find((t) => t.id === selectedId) ?? null : null;

  return (
    <div className="mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
      <div className="min-w-0">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name"
            aria-label="Search by name"
            className="w-full min-w-0 rounded-sm border border-rule bg-white px-2 py-1.5 text-sm sm:col-span-2 lg:col-span-1"
          />
          <select value={building} onChange={(e) => setBuilding(e.target.value)} aria-label="Building" className="w-full min-w-0 rounded-sm border border-rule bg-white px-2 py-1.5 text-sm">
            <option value="">All buildings</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} aria-label="Industry" className="w-full min-w-0 rounded-sm border border-rule bg-white px-2 py-1.5 text-sm">
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
            <option value="__blank">Blank in source</option>
          </select>
          <select value={floor} onChange={(e) => setFloor(e.target.value)} aria-label="Floor" className="w-full min-w-0 rounded-sm border border-rule bg-white px-2 py-1.5 text-sm">
            <option value="">All floors</option>
            {floors.map((f) => (
              <option key={f} value={f}>{floorCodes[f] ? `${f} (${floorCodes[f]})` : f}</option>
            ))}
            <option value="__none">No floor given</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort" className="w-full min-w-0 rounded-sm border border-rule bg-white px-2 py-1.5 text-sm">
            <option value="source">Source order</option>
            <option value="sqft-desc">Sq ft, largest first</option>
            <option value="sqft-asc">Sq ft, smallest first</option>
            <option value="name">Name, A to Z</option>
          </select>
        </div>

        <p className="mt-3 text-xs text-ink-3">
          {formatInt(rows.length)} of {formatInt(tenants.length)} rows
        </p>

        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Building</th>
                <th className="py-2 pr-3 font-medium">Floor</th>
                <th className="py-2 pr-3 text-right font-medium">Sq ft</th>
                <th className="py-2 pr-3 font-medium">Industry</th>
                <th className="py-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
                  className={`cursor-pointer border-b border-rule align-top hover:bg-paper-2 ${
                    t.id === selectedId ? "bg-paper-2" : ""
                  } ${evidenceRowClass(t.evidence)}`}
                >
                  <td className="py-1.5 pr-3">{t.name}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">{buildingName[t.building_id] ?? t.building_id}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {t.floors.length ? t.floors.join(", ") : <span className="text-ink-3">not given</span>}
                    {t.floor_unresolved ? <span className="ml-1 text-clay" title="Unresolved token in source">?</span> : null}
                  </td>
                  <td className="tabular py-1.5 pr-3 text-right">
                    {t.sq_ft !== null ? formatInt(t.sq_ft) : <span className="text-ink-3">{t.sq_ft_raw || "blank"}</span>}
                  </td>
                  <td className="py-1.5 pr-3">{t.industry ?? <span className="text-ink-3">blank</span>}</td>
                  <td className="py-1.5"><EvidenceBadge level={t.evidence} /></td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-ink-3">No rows match.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="mt-6 lg:mt-0">
        <div className="sticky top-4 rounded-sm border border-rule bg-paper-2 p-4 text-sm">
          {selected ? (
            <CitationPanel tenant={selected} source={sourcesById[selected.source_id]} buildingName={buildingName[selected.building_id] ?? selected.building_id} sourceFile={buildings.find((b) => b.id === selected.building_id)?.source_file} />
          ) : (
            <p className="text-ink-3">Select a row to see its source fields and citation.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function CitationPanel({ tenant: t, source, buildingName, sourceFile }: { tenant: Tenant; source: Source | undefined; buildingName: string; sourceFile?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-3">Source row</p>
      <h2 className="mt-1 text-lg font-medium">{t.name}</h2>
      <p className="text-ink-2">{buildingName}</p>
      <div className="mt-3">
        <EvidenceBadge level={t.evidence} />
        <p className="mt-1 text-xs text-ink-3">{EVIDENCE_TITLES[t.evidence]}</p>
        {t.evidence === "corroborated" ? (
          <p className="mt-1 text-xs text-ink-2">* Corroborated: more than one secondary source agrees. No primary source found.</p>
        ) : null}
      </div>

      <p className="mt-4 text-xs uppercase tracking-wide text-ink-3">Verbatim fields</p>
      <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-y-1 font-mono text-xs">
        <dt className="text-ink-3">sq_ft_raw</dt>
        <dd>{t.sq_ft_raw === "" ? <em className="text-ink-3">blank</em> : t.sq_ft_raw}</dd>
        <dt className="text-ink-3">industry_raw</dt>
        <dd>{t.industry_raw === "" ? <em className="text-ink-3">blank</em> : t.industry_raw}</dd>
        <dt className="text-ink-3">floor_raw</dt>
        <dd>{t.floor_raw === "" ? <em className="text-ink-3">blank</em> : t.floor_raw}</dd>
        <dt className="text-ink-3">floors</dt>
        <dd>{t.floors.length ? t.floors.join(", ") : <em className="text-ink-3">none resolved</em>}</dd>
        {t.floor_unresolved ? (
          <>
            <dt className="text-clay">floor_unresolved</dt>
            <dd className="text-clay">{t.floor_unresolved}</dd>
          </>
        ) : null}
        <dt className="text-ink-3">source_row</dt>
        <dd>{t.source_row}</dd>
        <dt className="text-ink-3">id</dt>
        <dd>{t.id}</dd>
      </dl>

      <p className="mt-4 text-xs uppercase tracking-wide text-ink-3">Citation</p>
      {source ? (
        <div className="mt-1 text-xs leading-relaxed text-ink-2">
          <p>{source.citation}</p>
          <p className="mt-1">Retrieved {source.retrieved_at}.</p>
          {archiveLinks(source.archived_url)
            .filter((l) => !sourceFile || l.url === (typeof source.archived_url === "object" && source.archived_url ? source.archived_url[sourceFile] : l.url))
            .map((l) => (
              <p key={l.url} className="mt-1 break-all">Archived copy: <a href={l.url} rel="noreferrer noopener" target="_blank">{l.url}</a></p>
            ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-clay">Source id {t.source_id} is not in the sources list.</p>
      )}
    </div>
  );
}
