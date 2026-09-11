import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceBadge, evidenceRowClass } from "@/components/EvidenceBadge";
import { buildFloorList, formatInt, getBuilding, getBuildings, getTenants, getTenantsFile, sqFtAccountedFor } from "@/lib/tenants";
import type { Tenant } from "@/lib/types";
import type { FloorRow as FloorRowT } from "@/lib/tenants";

export const dynamicParams = false;

export function generateStaticParams() {
  return getBuildings().map((b) => ({ building: b.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ building: string }> }): Promise<Metadata> {
  const { building } = await params;
  const b = getBuilding(building);
  return { title: b ? b.name : "Building" };
}

export default async function BuildingPage({ params }: { params: Promise<{ building: string }> }) {
  const { building: id } = await params;
  const building = getBuilding(id);
  if (!building) notFound();

  const tenants = getTenants(id);
  const { floor_codes } = getTenantsFile();
  const { info, floors, codes, noFloor } = buildFloorList(id, tenants, floor_codes);
  const withRecord = floors.filter((f) => f.tenants.length > 0).length;

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-3">
        <Link href="/directory" className="no-underline hover:underline">Directory</Link>
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{building.name}</h1>
      <p className="mt-1 text-sm text-ink-3">{building.cnn_label}</p>
      <p className="mt-3 max-w-2xl text-sm text-ink-2">
        {formatInt(tenants.length)} tenant rows. {formatInt(sqFtAccountedFor(tenants))} sq ft accounted for.{" "}
        {info.floors} numbered floors listed, {withRecord} with at least one tenant row.
      </p>
      <p className="mt-1 max-w-2xl text-xs text-ink-3">
        Floor count basis: {info.basis === "geometry-params" ? "data/geometry-params.json" : "highest floor number seen in the tenant rows for this building (geometry parameters not yet generated)"}.
        {info.mechanical ? " Mechanical floors are marked from geometry-params." : " The record used here is silent on which floors are mechanical, so none are labeled."}
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Floors, top down</h2>
        <ol className="mt-2 divide-y divide-rule border-y border-rule">
          {floors.map((f) => (
            <FloorLine key={f.label} floor={f} />
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Other levels</h2>
        <ol className="mt-2 divide-y divide-rule border-y border-rule">
          {codes.map((f) => (
            <FloorLine key={f.label} floor={f} />
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">No floor given in source</h2>
        <p className="mt-1 text-xs text-ink-3">
          {noFloor.length} rows. The floor field was blank or held no resolvable token. They are listed here rather than
          placed on a floor.
        </p>
        {noFloor.length ? (
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {noFloor.map((t) => (
              <li key={t.id} className="py-1.5">
                <TenantLine tenant={t} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function FloorLine({ floor: f }: { floor: FloorRowT }) {
  const empty = f.tenants.length === 0;
  return (
    <li className="grid grid-cols-[4.5rem_1fr] gap-3 py-2 sm:grid-cols-[6rem_1fr]">
      <div className="tabular text-sm font-medium">
        {f.label}
        {f.description ? <div className="text-xs font-normal text-ink-3">{f.description}</div> : null}
        {f.isMechanical ? <div className="text-xs font-normal text-ink-3">mechanical</div> : null}
      </div>
      <div className="text-sm">
        {empty ? (
          <span className="inline-flex items-center gap-2 text-ink-3">
            <EvidenceBadge level="unknown" />
            <span className="italic">No tenant record in this source.</span>
          </span>
        ) : (
          <ul className="space-y-1">
            {f.tenants.map((t) => (
              <li key={t.id}>
                <TenantLine tenant={t} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function TenantLine({ tenant: t }: { tenant: Tenant }) {
  return (
    <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 ${evidenceRowClass(t.evidence)}`}>
      <span>{t.name}</span>
      <span className="tabular text-xs text-ink-2">{t.sq_ft !== null ? `${formatInt(t.sq_ft)} sq ft` : "sq ft not given"}</span>
      {t.industry ? <span className="text-xs text-ink-3">{t.industry}</span> : null}
      {t.floors.length > 1 ? <span className="text-xs text-ink-3">floors {t.floor_raw}</span> : null}
      {t.floor_unresolved ? <span className="text-xs text-clay">unresolved: {t.floor_unresolved}</span> : null}
      <EvidenceBadge level={t.evidence} />
    </div>
  );
}
