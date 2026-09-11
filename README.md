# Walk the Twin Towers

An evidence-based reconstruction of documented commercial tenancy in the World
Trade Center as of September 2001, built from cited contemporaneous sources.

This is the Phase 0 deliverable: a plain tenant directory with no 3D. Every row
on the site traces to a source row, and every floor without a record says so.
Full spec in `BUILD-PLAN.md`; the rules that apply to every session in
`CLAUDE.md`; the data contract in `data/SCHEMA.md`.

## Run

```
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # static build, logs which data file it used
pnpm typecheck    # app + scripts
```

Pages: `/`, `/directory`, `/directory/[building]`, `/method`, `/errata`.
Production is public and indexable. Preview deployments sit behind Vercel Authentication.

## Data

The app reads `data/tenants.clean.json` at build time. If that file is absent
it falls back to `data/fixtures/tenants.sample.json` (three rows) and says so in
the build log and on the pages. `data/geometry-params.json` and
`data/paradata.json` are read when present and render as "not yet generated"
otherwise. `data/errata.json` is hand-maintained; see `/errata` for the format.

Regenerate: the generated files come from scripts in `scripts/` run against the
raw sources in `data/` (the archived CNN pages and `wtc_tenants.json`). Never
hand-edit a generated file. Fix the script or add a paradata row.

Postgres is a derived mirror, not the source of truth. `db/schema.sql` holds
the schema and `DATABASE_URL=... pnpm seed` loads the JSON into it. The seed
refuses to run on the fixture.

## License

- Code (this app, the scripts, the schema): MIT.
- Data compilation, paradata, and text on the site: CC BY 4.0.
- The underlying tenant list is CNN's, compiled by CoStar Group, Inc., as
  archived by the Internet Archive on 2001-09-13. It is cited, not owned, and
  no license is asserted over it.

Known gaps, assumptions, and how to verify the work: see `GAPS.md`.

## Make it better, and give credit

This is meant to be improved by other people. Corrections, new sources, better geometry,
and new exhibits are all welcome. Code is MIT (keep the copyright line). Data, paradata
and text are CC BY 4.0: attribute "Walk the Twin Towers, Chris Cousins / FlexScaleX LLC"
with a link to this repository (CITATION.cff has a ready-made citation). The tenant list
itself is CNN's, compiled by CoStar Group, Inc.; cite them too. Nothing without a
citation gets merged; that rule is the project.
