-- Nine Million Square Feet. Postgres schema (derived mirror of data/*.json).
-- The repo JSON is the source of truth; this database is seeded from it by
-- scripts/seed.ts. Adapted from BUILD-PLAN.md section 3.4 and 0.5.

begin;

create table if not exists sources (
  id            text primary key,                 -- 'cnn-2001-09-13', 'ncstar1-1'
  citation      text not null,
  url           text,
  archived_url  text,
  retrieved_at  date not null,
  local_files   text[] default '{}'
);

create table if not exists buildings (
  id            text primary key,                 -- 'wtc1','wtc2','wtc4','wtc5','wtc6','wtc7'
  name          text not null,
  cnn_label     text,
  source_file   text,
  floors        int,                              -- null until geometry-params supplies it
  floors_basis  text,                             -- 'geometry-params' | 'max floor seen in tenant data'
  notes         text
);

create table if not exists floors (
  id            serial primary key,
  building_id   text not null references buildings(id),
  floor_label   text not null,                    -- '105', 'CNCR', 'LBBY'
  floor_index   int,                              -- null for concourse/lobby codes
  is_mechanical boolean not null default false,
  has_record    boolean not null default true,    -- false renders as "No tenant record in this source."
  unique (building_id, floor_label)
);

create table if not exists tenants (
  id               text primary key,              -- 'wtc1-001' (building id + 3-digit source row order)
  building_id      text not null references buildings(id),
  name             text not null,
  sq_ft            int,                           -- null when source said N/A or blank
  sq_ft_raw        text not null default '',      -- verbatim
  industry         text,                          -- null when blank; never classified
  industry_raw     text not null default '',
  floor_raw        text not null default '',      -- verbatim
  floor_unresolved text,                          -- token that was not a number, range, or known code
  evidence         text not null
                   check (evidence in ('documented','corroborated','reported','unknown')),
  source_id        text not null references sources(id),
  source_row       int not null                   -- 1-based row within that building's source table
);

create table if not exists tenant_floors (       -- expands '9-11,81' into rows
  tenant_id     text not null references tenants(id) on delete cascade,
  floor_id      int  not null references floors(id),
  primary key (tenant_id, floor_id)
);

create table if not exists exhibits (
  id            serial primary key,
  tenant_id     text references tenants(id),
  title         text not null,
  body          text not null,
  status        text not null default 'draft'
                check (status in ('draft','review','approved')),
  approved_by   text,
  approved_at   timestamptz
);
-- exhibits.status gates rendering. Only 'approved' reaches the client.

create table if not exists claims (              -- every factual assertion in an exhibit, cited
  id            serial primary key,
  exhibit_id    int not null references exhibits(id) on delete cascade,
  claim_text    text not null,
  source_id     text not null references sources(id),
  confidence    text not null
                check (confidence in ('documented','corroborated','reported','unknown'))
);

create table if not exists paradata (            -- reasoning behind interpretive calls, public
  id            text primary key,                -- 'P-001'
  subject       text not null,                   -- 'schema', 'tenant:wtc1-142', 'geometry:floor_height'
  decision      text not null,
  reasoning     text not null,                   -- why, and what was rejected
  decided_by    text not null,
  decided_at    date not null
);

create table if not exists errata (
  id            serial primary key,
  date          date not null,
  subject       text not null,
  was           text not null,
  now           text not null,
  why           text not null,
  source_id     text references sources(id)
);

create index if not exists tenants_building_idx on tenants(building_id);
create index if not exists tenants_industry_idx on tenants(industry);
create index if not exists floors_building_idx on floors(building_id, floor_index);
create index if not exists tenant_floors_floor_idx on tenant_floors(floor_id);

commit;
