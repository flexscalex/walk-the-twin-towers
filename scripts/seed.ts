// Seed Postgres from the canonical JSON files. Run: DATABASE_URL=... pnpm seed
// Loads data/tenants.clean.json, data/paradata.json and (if present)
// data/geometry-params.json. Idempotent: upserts by id, rebuilds tenant_floors.
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import type { GeometryFile, ParadataRow, TenantsFile } from "../lib/types";

const ROOT = process.cwd();
const read = <T,>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const tenantsPath = "data/tenants.clean.json";
  if (!fs.existsSync(path.join(ROOT, tenantsPath))) {
    throw new Error(`${tenantsPath} not found. Generate it first; the seed never runs on the fixture.`);
  }
  const file = read<TenantsFile>(tenantsPath);
  const paradata = fs.existsSync(path.join(ROOT, "data/paradata.json")) ? read<ParadataRow[]>("data/paradata.json") : [];
  const geometry = fs.existsSync(path.join(ROOT, "data/geometry-params.json"))
    ? read<GeometryFile>("data/geometry-params.json")
    : null;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(fs.readFileSync(path.join(ROOT, "db/schema.sql"), "utf8"));

    for (const s of [...file.sources, ...(geometry?.sources ?? [])]) {
      await client.query(
        `insert into sources (id, citation, url, archived_url, retrieved_at, local_files)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set citation=excluded.citation, url=excluded.url,
           archived_url=excluded.archived_url, retrieved_at=excluded.retrieved_at, local_files=excluded.local_files`,
        [s.id, s.citation, s.url, s.archived_url, s.retrieved_at, s.local_files ?? []],
      );
    }

    for (const b of file.buildings) {
      const bt = file.tenants.filter((t) => t.building_id === b.id);
      const geoB = geometry?.buildings?.find((x) => x.id === b.id);
      const geoParam = geometry?.params.find(
        (p) => p.applies_to === b.id && /\.(floors|floor_count|stories)$/.test(p.id) && typeof p.value === "number",
      );
      const geoFloors = geoB?.floors ?? (geoParam ? (geoParam.value as number) : null);
      const maxSeen = Math.max(0, ...bt.flatMap((t) => t.floors.filter((f) => /^\d+$/.test(f)).map(Number)));
      const floors = geoFloors ?? maxSeen;
      const basis = geoFloors !== null ? "geometry-params" : "max floor seen in tenant data";
      const mechParam = geometry?.params.find((p) => p.applies_to === b.id && /\.mechanical_floors$/.test(p.id));
      const mechanical = new Set<number>(
        geoB?.mechanical_floors ?? (Array.isArray(mechParam?.value) ? (mechParam!.value as number[]) : []),
      );

      await client.query(
        `insert into buildings (id, name, cnn_label, source_file, floors, floors_basis)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set name=excluded.name, cnn_label=excluded.cnn_label,
           source_file=excluded.source_file, floors=excluded.floors, floors_basis=excluded.floors_basis`,
        [b.id, b.name, b.cnn_label, b.source_file, floors, basis],
      );

      const withRecord = new Set<string>(bt.flatMap((t) => t.floors));
      const labels: { label: string; index: number | null }[] = [];
      for (let n = 1; n <= floors; n++) labels.push({ label: String(n), index: n });
      for (const code of Object.keys(file.floor_codes)) labels.push({ label: code, index: null });
      for (const l of withRecord) if (!labels.some((x) => x.label === l)) labels.push({ label: l, index: /^\d+$/.test(l) ? Number(l) : null });

      for (const l of labels) {
        await client.query(
          `insert into floors (building_id, floor_label, floor_index, is_mechanical, has_record)
           values ($1,$2,$3,$4,$5)
           on conflict (building_id, floor_label) do update set floor_index=excluded.floor_index,
             is_mechanical=excluded.is_mechanical, has_record=excluded.has_record`,
          [b.id, l.label, l.index, l.index !== null && mechanical.has(l.index), withRecord.has(l.label)],
        );
      }
    }

    for (const t of file.tenants) {
      await client.query(
        `insert into tenants (id, building_id, name, sq_ft, sq_ft_raw, industry, industry_raw, floor_raw,
           floor_unresolved, evidence, source_id, source_row)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set building_id=excluded.building_id, name=excluded.name, sq_ft=excluded.sq_ft,
           sq_ft_raw=excluded.sq_ft_raw, industry=excluded.industry, industry_raw=excluded.industry_raw,
           floor_raw=excluded.floor_raw, floor_unresolved=excluded.floor_unresolved, evidence=excluded.evidence,
           source_id=excluded.source_id, source_row=excluded.source_row`,
        [t.id, t.building_id, t.name, t.sq_ft, t.sq_ft_raw, t.industry, t.industry_raw, t.floor_raw,
         t.floor_unresolved, t.evidence, t.source_id, t.source_row],
      );
      await client.query("delete from tenant_floors where tenant_id = $1", [t.id]);
      for (const f of t.floors) {
        await client.query(
          `insert into tenant_floors (tenant_id, floor_id)
           select $1, id from floors where building_id = $2 and floor_label = $3
           on conflict do nothing`,
          [t.id, t.building_id, f],
        );
      }
    }

    for (const p of paradata) {
      await client.query(
        `insert into paradata (id, subject, decision, reasoning, decided_by, decided_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (id) do update set subject=excluded.subject, decision=excluded.decision,
           reasoning=excluded.reasoning, decided_by=excluded.decided_by, decided_at=excluded.decided_at`,
        [p.id, p.subject, p.decision, p.reasoning, p.decided_by, p.decided_at],
      );
    }

    await client.query("commit");
    console.log(
      `seeded ${file.sources.length + (geometry?.sources.length ?? 0)} sources, ${file.buildings.length} buildings, ` +
        `${file.tenants.length} tenants, ${paradata.length} paradata rows`,
    );
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
