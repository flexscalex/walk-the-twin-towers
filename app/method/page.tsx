import type { Metadata } from "next";
import { archiveLinks } from "@/lib/archive";
import { EvidenceBadge, EVIDENCE_TITLES } from "@/components/EvidenceBadge";
import { loadGeometry, loadParadata } from "@/lib/data";
import { TOWER_IDS } from "@/lib/floors";
import { readManifest } from "@/lib/geometry-manifest";
import { formatInt, gapSummary, getTenants, getTenantsFile, loadTenants, sqFtAccountedFor } from "@/lib/tenants";
import { EVIDENCE_LEVELS } from "@/lib/types";

export const metadata: Metadata = { title: "Method" };

const RENDERS = {
  documented: "Solid, full opacity.",
  corroborated: "Solid, full opacity, with a note in the panel.",
  reported: "Visibly lighter treatment.",
  unknown: "An explicit, labeled void. Never an empty space.",
} as const;

export default function MethodPage() {
  const { source, path } = loadTenants();
  const file = getTenantsFile();
  const all = getTenants();
  const totalSqFt = sqFtAccountedFor(all);
  const geometry = loadGeometry();
  const paradata = loadParadata();
  const gaps = gapSummary();
  const context = readManifest(TOWER_IDS).context;

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Method</h1>

      <section className="mt-8">
        <h2 className="text-lg font-medium">What this is</h2>
        <p className="mt-2 leading-relaxed">
          An evidence-based reconstruction of documented commercial tenancy in the World Trade Center as of September
          2001, built from cited contemporaneous sources, with architectural geometry generated from published
          dimensions.
        </p>
        <p className="mt-3 leading-relaxed text-ink-2">
          This project conforms to the London Charter for the computer-based visualisation of cultural heritage
          (2006, revised 2009) and the Seville Principles (ICOMOS, 2011). Both ask for intellectual transparency: it
          should be clear what a visualisation represents, and how much of it rests on evidence. Every tenant,
          dimension and claim here carries a level on the evidence scale below, and the interface renders the
          difference rather than burying it.
        </p>
        <p className="mt-3 leading-relaxed text-ink-2">
          When the record is silent, the page says the record is silent. Nothing is filled in to make a floor feel
          complete.
        </p>
        <p className="mt-3">The World Trade Center as of September 2001.</p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">The evidence scale</h2>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-3 font-medium">Level</th>
              <th className="py-2 pr-3 font-medium">Meaning</th>
              <th className="py-2 font-medium">How it renders</th>
            </tr>
          </thead>
          <tbody>
            {EVIDENCE_LEVELS.map((lvl) => (
              <tr key={lvl} className="border-b border-rule align-top">
                <td className="py-2 pr-3"><EvidenceBadge level={lvl} /></td>
                <td className="py-2 pr-3">{EVIDENCE_TITLES[lvl]}</td>
                <td className="py-2">{RENDERS[lvl]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">
          In this build every tenant row comes from one contemporaneous list and is marked documented. See the
          paradata for that decision.
        </p>
      </section>

      <details className="mt-8 rounded-sm border border-rule bg-paper-2 px-4 py-3">
        <summary className="text-lg font-medium">Sources <span className="text-sm font-normal text-ink-3">(expand)</span></summary>
        <section className="mt-3">
        <ol className="mt-3 space-y-3 text-sm">
          {file.sources.map((s) => (
            <li key={s.id} className="border-l-2 border-brass pl-3">
              <p>{s.citation}</p>
              <p className="mt-1 text-xs text-ink-3">
                id {s.id}. Retrieved {s.retrieved_at}.
                {s.local_files?.length ? ` Local copies: ${s.local_files.join(", ")}.` : ""}
              </p>
              {archiveLinks(s.archived_url).map((l) => (
                <p key={l.url} className="mt-1 break-all text-xs"><a href={l.url} rel="noreferrer noopener" target="_blank">{l.label}</a></p>
              ))}
            </li>
          ))}
          {geometry ? (
            geometry.sources.map((s) => (
              <li key={s.id} className="border-l-2 border-brass pl-3">
                <p>{s.citation}</p>
                <p className="mt-1 text-xs text-ink-3">id {s.id}. Retrieved {s.retrieved_at}. Used for geometry parameters.</p>
                {s.url ? <p className="mt-1 break-all text-xs"><a href={s.url} rel="noreferrer noopener" target="_blank">{s.url}</a></p> : null}
              </li>
            ))
          ) : (
            <li className="border-l-2 border-rule pl-3">
              <p>
                NIST NCSTAR 1-1 (2005), Federal Building and Fire Safety Investigation of the World Trade Center
                Disaster: Design, Construction, and Maintenance of Structural and Life Safety Systems.
              </p>
              <p className="mt-1 text-xs text-ink-3">Geometry source. Geometry parameters not yet generated.</p>
            </li>
          )}
        </ol>
        <p className="mt-3 text-xs text-ink-3">
          The tenant list is CNN&apos;s, compiled by CoStar. It is cited here, not owned. The extraction, schema and
          text on this site are our own work and are licensed CC BY 4.0.
        </p>
      </section>
      </details>

      <details className="mt-8 rounded-sm border border-rule bg-paper-2 px-4 py-3">
        <summary className="text-lg font-medium">Geometry parameters <span className="text-sm font-normal text-ink-3">(expand)</span></summary>
        <section className="mt-3">
        {geometry ? (
          <div className="mt-3 text-sm">
            <p className="text-ink-2">
              {geometry.params.length} parameters, generated {geometry.meta.generated_at}. Rule: {geometry.meta.rule}
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink text-left uppercase tracking-wide text-ink-3">
                    <th className="py-1.5 pr-3 font-medium">Parameter</th>
                    <th className="py-1.5 pr-3 font-medium">Applies to</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Value</th>
                    <th className="py-1.5 pr-3 font-medium">Evidence</th>
                    <th className="py-1.5 font-medium">Locator</th>
                  </tr>
                </thead>
                <tbody>
                  {geometry.params.map((p) => (
                    <tr key={p.id} className="border-b border-rule align-top">
                      <td className="py-1.5 pr-3 font-mono">{p.id}</td>
                      <td className="py-1.5 pr-3">{p.applies_to}</td>
                      <td className="tabular py-1.5 pr-3 text-right">{Array.isArray(p.value) ? p.value.join(", ") : p.value} {p.unit}</td>
                      <td className="py-1.5 pr-3"><EvidenceBadge level={p.evidence} /></td>
                      <td className="py-1.5">
                        {p.source_id}, section {p.locator.section}, p. {p.locator.printed_page}
                        {p.locator.quote ? <span className="block text-ink-3">&ldquo;{p.locator.quote}&rdquo;</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {geometry.unresolved.length ? (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-ink-3">Unresolved</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
                  {geometry.unresolved.map((u) => (
                    <li key={u.id}><span className="font-mono">{u.id}</span>: {u.why}. Where to look: {u.where_to_look}.</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-3">Not yet generated.</p>
        )}
        <div className="mt-4 text-sm">
          <p className="text-xs uppercase tracking-wide text-ink-3">City context</p>
          <p className="mt-1 text-ink-2">
            The Towers page draws the neighbourhood as unlabeled gray massing from NYC Open Data building footprints,
            filtered to buildings whose recorded construction year is 2001 or earlier and extruded to the published roof
            height. That dataset describes buildings that stand today, so the context shows only buildings that stood in
            2001 <em>and</em> still stand. Neighbours demolished since 2001, including the seven World Trade Center
            buildings, are absent: a labeled gap, not a reconstruction. Roof heights are today&apos;s. The site origin is
            the centroid of the block bounded by Church, Vesey, Liberty and West streets, taken from the NYC street
            centerline file; where the two towers stand inside that block is a layout choice (paradata P-064 to P-067).
          </p>
          {context ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
              {context.sources.map((s) => (
                <li key={s.id}>
                  {s.name}, {s.publisher}. Dataset {s.datasetId},{" "}
                  <a href={s.url} className="underline" rel="noreferrer">
                    {s.url}
                  </a>
                  . Retrieved {s.retrievedAt}. Filter: <span className="font-mono">{s.filter}</span>.
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-ink-3">Context massing not yet generated (pnpm generate:context).</p>
          )}
        </div>
      </section>
      </details>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Known gaps in the tenant source</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          <li>{formatInt(gaps.sqFtNull)} of {formatInt(all.length)} rows have no square footage (source says N/A or blank).</li>
          <li>{formatInt(gaps.industryNull)} rows have a blank industry. They are left blank, not classified.</li>
          <li>{formatInt(gaps.floorBlank)} rows have a blank floor field. They are listed under each building without a floor.</li>
          <li>
            {formatInt(gaps.floorUnresolved.length)} rows carry a floor token that is not a number, a range or a known
            code. The token is kept verbatim and shown as unresolved.
            {gaps.floorUnresolved.length ? (
              <ul className="mt-1 list-disc pl-5 text-xs text-ink-2">
                {gaps.floorUnresolved.map((t) => (
                  <li key={t.id}>{t.name} ({t.id}): floor_raw &ldquo;{t.floor_raw}&rdquo;, unresolved &ldquo;{t.floor_unresolved}&rdquo;</li>
                ))}
              </ul>
            ) : null}
          </li>
        </ul>
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="py-2 pr-3 font-medium">Building</th>
              <th className="py-2 pr-3 text-right font-medium">Floors</th>
              <th className="py-2 pr-3 text-right font-medium">Without a record</th>
              <th className="py-2 font-medium">Which</th>
            </tr>
          </thead>
          <tbody>
            {gaps.perBuilding.map(({ building, info, missing, missingRanges }) => (
              <tr key={building.id} className="border-b border-rule align-top">
                <td className="py-2 pr-3">{building.name}</td>
                <td className="tabular py-2 pr-3 text-right">{info.floors}<span className="block text-xs text-ink-3">{info.basis}</span></td>
                <td className="tabular py-2 pr-3 text-right">{missing.length}</td>
                <td className="py-2 text-xs">{missingRanges}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">
          A floor without a record is not evidence that the floor was empty. It means this source does not list a
          tenant there. Mechanical floors, where known from geometry parameters, are marked on the building pages.
        </p>
      </section>

      <details className="mt-8 rounded-sm border border-rule bg-paper-2 px-4 py-3">
        <summary className="text-lg font-medium">Paradata <span className="text-sm font-normal text-ink-3">(every judgment call, expand)</span></summary>
        <section className="mt-3">
        <p className="mt-2 text-sm text-ink-2">
          Data is the source. Paradata is the reasoning behind each interpretive call made while handling it,
          including what was rejected. Public by design.
        </p>
        {paradata ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink text-left text-xs uppercase tracking-wide text-ink-3">
                  <th className="py-2 pr-3 font-medium">Id</th>
                  <th className="py-2 pr-3 font-medium">Subject</th>
                  <th className="py-2 pr-3 font-medium">Decision</th>
                  <th className="py-2 pr-3 font-medium">Reasoning</th>
                  <th className="py-2 font-medium">Decided</th>
                </tr>
              </thead>
              <tbody>
                {paradata.map((p) => (
                  <tr key={p.id} className="border-b border-rule align-top">
                    <td className="py-2 pr-3 font-mono text-xs">{p.id}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{p.subject}</td>
                    <td className="py-2 pr-3">{p.decision}</td>
                    <td className="py-2 pr-3 text-ink-2">{p.reasoning}</td>
                    <td className="py-2 text-xs text-ink-3">{p.decided_at}<span className="block">{p.decided_by}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-3">Not yet generated.</p>
        )}
      </section>
      </details>

      <section className="mt-10 border-t border-rule pt-6 text-xs text-ink-3">
        <p>
          A note on the square footage. The rows in the source that carry a square footage add up to {formatInt(totalSqFt)}{" "}
          sq ft, which is where the project's working name, Nine Million Square Feet, came from. Rows marked N/A or left
          blank add nothing to the sum. The project was renamed Walk the Twin Towers on 2026-09-11.
        </p>
        <p className="mt-2">
          Build data: {source === "real" ? "canonical file" : "fixture"} at {path}, generated {file.meta.generated_at} by{" "}
          {file.meta.generator}.
        </p>
      </section>
    </div>
  );
}
