import type { Metadata } from "next";
import Link from "next/link";
import { buildTowersData, TOWER_IDS } from "@/lib/floors";
import { geometryFiles, readManifest } from "@/lib/geometry-manifest";
import { loadTenants } from "@/lib/tenants";
import { TowersViewer } from "./TowersViewer";

export const metadata: Metadata = { title: "Towers" };

export default function TowersPage() {
  const { source, path } = loadTenants();
  const data = buildTowersData();
  const geometry = geometryFiles(TOWER_IDS);
  const manifest = readManifest(TOWER_IDS);

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Towers</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        The two towers, floor by floor. Each plate is tinted by the industry with the most listed square feet on that
        floor. Orbit with the mouse or a finger, hover a floor for its count, click it for the rows.
      </p>
      {source === "fixture" ? (
        <p className="mt-2 text-xs text-clay">Running on the fixture ({path}). The real data file is not present.</p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink-3">Or walk in at the front doors:</span>
        {data.towers.map((t) => (
          <Link
            key={t.id}
            href={`/walk/${t.id}/lobby`}
            className="inline-block rounded-sm border border-ink bg-ink px-3 py-1.5 font-medium text-paper no-underline hover:bg-ink-2"
          >
            Enter the lobby of {t.name}
          </Link>
        ))}
      </p>
      <TowersViewer data={data} geometry={geometry} manifest={manifest} />
    </div>
  );
}
