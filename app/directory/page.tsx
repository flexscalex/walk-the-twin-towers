import type { Metadata } from "next";
import { getBuildings, getTenantsFile, loadTenants } from "@/lib/tenants";
import { DirectoryClient } from "./DirectoryClient";

export const metadata: Metadata = { title: "Directory" };

export default function DirectoryPage() {
  const { source, path } = loadTenants();
  const file = getTenantsFile();
  const buildings = getBuildings();
  const sourcesById = Object.fromEntries(file.sources.map((s) => [s.id, s]));

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight">Directory</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        Every tenant row in the source, as written. Search by name, filter by building, industry or floor, sort by
        square footage. Select a row to see the verbatim source fields and the citation.
      </p>
      {source === "fixture" ? (
        <p className="mt-2 text-xs text-clay">Running on the fixture ({path}). The real data file is not present.</p>
      ) : null}
      <DirectoryClient
        tenants={file.tenants}
        buildings={buildings.map((b) => ({ id: b.id, name: b.name, source_file: b.source_file }))}
        floorCodes={file.floor_codes}
        sourcesById={sourcesById}
      />
    </div>
  );
}
