# Bicol Rice Stress Hub: Build Instructions for Qoder

Deadline: launch by 28 Nov 2026 (hard stop 30 Nov). Build in the order of section 9. Finish and test one step before starting the next. Commit to Git after each working step.

## 1. Goal
A public web hub on adverse (stressed) rice areas in the six Bicol provinces: Albay, Camarines Norte, Camarines Sur, Catanduanes, Masbate, Sorsogon.
- Visitors need no account. They browse Home (charts), Adverse Data (table), Interactive Map, and Farm Practices.
- LGU users submit stress reports for their own municipality. DA reviewers publish or return them. Admins approve accounts and edit reference data.
- Reference design: the prototype file "Adverse Rice Area Information Hub.html" (layout, pages, charts, map layers, report form, review flow). Reuse its look and behavior, not its mock data.

## 2. Stack (do not change without asking)
- Front end: TypeScript + Vite. Vanilla TS modules are fine; React is acceptable if kept simple. Leaflet for the map. Chart rendering may reuse the prototype's SVG chart code.
- Back end: Supabase only (Postgres + PostGIS, Auth, Storage, RLS). Business rules live in SQL (views, RPC functions, triggers). No separate server.
- Hosting: Vercel (static build). Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Never expose the `service_role` key in the front end or the repo.
- Schema lives in `supabase/migrations/` as numbered SQL files.

## 3. Hard rules
1. Every table has Row Level Security enabled. Security is enforced by RLS, never only by front-end checks.
2. Public (anon) users may read only published stress data and reference data. Never expose reports, profiles, files, or audit logs to anon.
3. Use PSA codes as keys: `adm4_pcode` (barangay, 12 chars), `adm3_pcode` (municipality), `adm2_pcode` (province). Never match by name.
4. No mock or random data in production code. Remove the prototype's generators, demo accounts, and plain-text passwords.
5. Publishing a report is one Postgres function (single transaction): copy items into `stress_records`, set status, write the audit log.
6. Aggregations (municipality totals, province totals, chart numbers) come from SQL views or RPCs, not computed over all rows in the browser.
7. Map boundaries are loaded per selected province from a simplified geometry, never the full 80 MB file.
8. Every fetch has loading, empty, and error states. Keep the prototype's accessibility features (ARIA labels, keyboard use, reduced motion, dark mode).
9. Use a production map tile provider (not the public openstreetmap.org tile server).

## 4. Data we have (facts to rely on)
- `Rice_Stress_Areas.csv`: 2,192 barangays, wide format. Seven mutually exclusive stress categories, each with a farmers column and an area (ha) column: Flood (F), Salt Affected (S), Drought (D), Flood and Drought (FD), Flood and Saline (FS), Drought and Saline (SD), Multiple Stress (FSD). Category columns add up exactly to `Total - Area (Ha)` and `Total - No. of Farmers`. Total about 103,089 ha, about 103,980 farmers. One barangay can have several categories (1 to 6).
- The CSV contains no season or year. It has `date` = 11/09/2022 (day/month/year, confirm) and `validOn` = 11/06/2023. Treat it as one baseline dataset named "Baseline 2022/2023".
- 340 polygons in the CSV are truncated at the 32,767-character Excel cell limit. Use the separate barangay GeoJSON (about 80 MB, has barangay, municipality, province names and `ADM_CODE`) as the only geometry source. Join to the CSV by the 12-digit code.
- Expect 38 barangays whose stress area exceeds the barangay's own area. Import them but flag for review.
- One salt-affected row has a fractional farmer count (`PH0501718075`). Keep as numeric; ask the LGU to confirm.
- Later data (not yet received): processed baseline data from the FGD (farm practices, seeds, yields). Build the tables now, load when it arrives.
- Conversion script: `prep.py` reshapes the CSV into `barangays.csv` and `stress_records.csv` (long format, 3,199 records).

## 5. Schema (create as migration 001, then RLS as 002)
Enable extensions: `postgis`.

```sql
create type user_role as enum ('LGU','DA','Admin');
create type approval_status as enum ('Pending','Approved','Rejected');
create type report_status as enum ('Submitted','Returned','Published');
create type season_t as enum ('Wet','Dry');

create table provinces (
  adm2_pcode text primary key,
  name text not null unique,
  physical_rice_area_ha numeric(12,2),
  total_farmers integer
);
create table municipalities (
  adm3_pcode text primary key,
  province_pcode text not null references provinces(adm2_pcode),
  name text not null
);
create table barangays (
  adm4_pcode char(12) primary key,
  municipality_pcode text not null references municipalities(adm3_pcode),
  name text not null,
  area_sqkm numeric(12,6),
  geom geometry(MultiPolygon,4326)
);
create index on barangays using gist (geom);

create table stress_types (
  code text primary key,           -- F, S, D, FD, FS, SD, FSD
  label text not null,
  color text not null,
  dash text not null default '',
  sort_order smallint not null
);

create table datasets (
  id bigint generated always as identity primary key,
  name text not null,              -- 'Baseline 2022/2023'
  snapshot_date date,
  valid_on date,
  description text
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'LGU',
  municipality_pcode text references municipalities(adm3_pcode),
  approval approval_status not null default 'Pending',
  created_at timestamptz not null default now()
);

create table reports (
  id bigint generated always as identity primary key,
  municipality_pcode text not null references municipalities(adm3_pcode),
  submitted_by uuid not null references profiles(id),
  status report_status not null default 'Submitted',
  notes text,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references profiles(id),
  review_notes text,
  decided_at timestamptz
);
create table report_items (
  id bigint generated always as identity primary key,
  report_id bigint not null references reports(id) on delete cascade,
  barangay_pcode char(12) not null references barangays(adm4_pcode),
  stress_code text not null references stress_types(code),
  area_ha numeric(10,2) not null check (area_ha > 0),
  farmers numeric(10,1) not null check (farmers > 0),
  season season_t not null,
  year smallint not null check (year between 2000 and 2035)
);
create table report_files (
  id bigint generated always as identity primary key,
  report_id bigint not null references reports(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes integer not null check (size_bytes <= 5242880)
);

create table stress_records (
  id bigint generated always as identity primary key,
  barangay_pcode char(12) not null references barangays(adm4_pcode),
  stress_code text not null references stress_types(code),
  area_ha numeric(10,2) not null,
  farmers numeric(10,1) not null,
  season season_t,                 -- null for the baseline dataset
  year smallint,                   -- null for the baseline dataset
  dataset_id bigint references datasets(id),
  report_item_id bigint references report_items(id),
  status report_status not null default 'Published',
  check ((dataset_id is not null) <> (report_item_id is not null))
);
create index on stress_records (barangay_pcode);
create index on stress_records (stress_code);

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  report_id bigint references reports(id),
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

-- Farm practices (FGD baseline). Blank stress_code = normal conditions.
create table practices (
  id bigint generated always as identity primary key,
  province_pcode text not null references provinces(adm2_pcode),
  stress_code text references stress_types(code),
  season season_t,
  category text not null,          -- Seeds, Land, Crop, Nutrients, Water, Pests, Harvest
  practice_text text not null,
  sort_order smallint not null default 0,
  source text
);
create table seed_recommendations (
  id bigint generated always as identity primary key,
  province_pcode text not null references provinces(adm2_pcode),
  stress_code text references stress_types(code),
  season season_t,
  seed_type text not null,
  variety text not null,
  seeding_rate text,
  notes text
);
create table baseline_yields (
  id bigint generated always as identity primary key,
  province_pcode text not null references provinces(adm2_pcode),
  stress_code text references stress_types(code),
  season season_t,
  avg_farm_size_ha numeric(6,2),
  yield_t_ha numeric(6,2)
);
create table gallery_photos (
  id bigint generated always as identity primary key,
  storage_path text not null,
  caption text not null,
  alt_text text not null,
  sort_order smallint not null default 0
);
```

Views and functions (migration 003):
- `v_barangay_stress` : barangay with its stress rows aggregated (codes, areas, total area, total farmers).
- `v_municipality_totals`, `v_province_totals` : area and farmers by stress type, for the Data table, dialog, and charts.
- `rpc_map_barangays(provinces text[], stress_codes text[])` : simplified GeoJSON features with dominant stress and all stress rows.
- `rpc_publish_report(report_id)` and `rpc_return_report(report_id, note)` : DA or Admin only; write the audit log.
- Trigger on `auth.users` insert: create a `profiles` row with role LGU and approval Pending.

## 6. RLS summary (migration 002)
| Table | anon | LGU | DA | Admin |
|---|---|---|---|---|
| provinces, municipalities, barangays, stress_types, datasets, practices, seed_recommendations, baseline_yields, gallery_photos | read | read | read | read and write |
| stress_records | read where status = Published | same | same | read and write |
| profiles | none | own row | read all | read and write all |
| reports, report_items, report_files | none | insert and read for own municipality only; edit only while Returned | read all; status changes only through the RPCs | all |
| audit_log | none | none | read | read |
- Storage: bucket `report-files` is private (LGU uploads to own reports; DA and Admin read). Bucket `gallery` is public read.
- An LGU user must not be able to set their own role or approval.

## 7. Importing the data
1. Create the schema and seed `stress_types` (F, S, D, FD, FS, SD, FSD with the template's colors and dash patterns), `provinces`, and `municipalities` from the GeoJSON attributes.
2. Prepare geometry: simplify two copies with mapshaper (a lightly simplified master for the database; a heavily simplified web copy). Keep only `ADM_CODE` and the names. Make sure the CRS is WGS84 (EPSG:4326) and the type is MultiPolygon.
3. Import to Supabase using `ogr2ogr` or QGIS with the session pooler connection string. Do not upload the 80 MB file through the dashboard (Storage free tier limit is 50 MB per file).
4. Create the dataset row "Baseline 2022/2023" (snapshot 2022-09-11, valid on 2023-06-11).
5. Run `prep.py` on the full CSV, then load `stress_records.csv` through a staging table, mapping `dataset_id` to the dataset above.
6. Verify: 2,192 barangays, 3,199 stress records, about 103,089 ha total. Province totals: Camarines Sur 47,859, Masbate 22,679, Albay 13,320, Camarines Norte 8,380, Sorsogon 7,923, Catanduanes 2,928 (ha, approximate).
7. Report the 38 barangays whose stress area exceeds barangay area.

## 8. Front-end pages (match the prototype)
- Home: hero, "Rice area at a glance" charts (province, stress type, farmers; bar, horizontal bar, line, donut, pie switcher), land-condition pie by province, field photo gallery.
- Adverse Data: search, filters (province, stress type; add season and year only when data exists), sortable municipality table, barangay dialog by stress type, pagination, real CSV download.
- Interactive Map: barangay polygons colored by dominant stress; click panel lists all stresses with area and farmers; layer panel for stress type and province; municipal outline overlay; mobile drawer.
- Farm Practices: province, stress type, season selectors; tabs Seeds, Land, Crop, Nutrients, Water, Pests, Harvest; content from the practices tables. Show "coming soon" for provinces with no FGD data.
- Login: sign in, register as LGU (Pending until approved), password reset, email verification.
- LGU account: report form (multiple barangay rows, own municipality only, season, year, one supporting file PDF, JPG or PNG up to 5 MB), "My reports".
- DA and Admin account: review queue, publish or return with required note, decided list, audit log; Admin also approves users and edits reference data.

## 9. Build order
1. Project scaffold, Git, Vercel connection, env vars.
2. Migration 001 (schema), seed reference data, load boundaries and baseline records.
3. Views and map RPC. Public pages read real data: Home, Adverse Data, Map.
4. Migration 002 (RLS) and tests per role.
5. Auth, registration, approval trigger, LGU report form with file upload.
6. DA review, publish and return RPCs, audit log, Admin pages.
7. Farm Practices page against the practices tables (sample rows until FGD data arrives).
8. Import FGD data when received; real accounts; remove all test data.
9. Responsive, accessibility, dark mode, and slow-network checks; polish; user guide.
10. Launch by 28 Nov.

If behind schedule, cut in this order: Farm Practices content, Admin reference editor, gallery, multi-row report entry. Never cut the public pages, login, the report workflow, or RLS.

## 10. Definition of done
- The full cycle works with real accounts: register, approve, submit with file, review, publish, and the record appears in the table and on the map.
- Anon users cannot read any unpublished data (tested directly against the API).
- Each role is tested for both allowed and forbidden actions.
- Totals on the site match the source CSV.
- No demo accounts, mock data, or secret keys remain in the repo or the build.

## 11. Open items to confirm with the data owners
- Date format of 11/09/2022 (day first or month first).
- Whether season and year exist for the baseline data.
- The 38 barangays with stress area larger than the barangay, and the fractional farmer count.
- Source of total physical rice area and farmers per province.
- FGD baseline data format when it arrives.
