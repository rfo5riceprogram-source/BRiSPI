-- Bicol Rice Stress Hub: schema v1
-- Run in Supabase: SQL Editor > New query > paste all > Run

create extension if not exists postgis with schema extensions;

-- ---------- enums ----------
create type user_role       as enum ('LGU','DA','Admin');
create type approval_status as enum ('Pending','Approved','Rejected');
create type report_status   as enum ('Submitted','Returned','Published');
create type season_t        as enum ('Wet','Dry');

-- ---------- geography ----------
create table provinces (
  adm2_pcode            text primary key,
  name                  text not null unique,
  physical_rice_area_ha numeric(12,2),
  total_farmers         integer
);

create table municipalities (
  adm3_pcode     text primary key,
  province_pcode text not null references provinces(adm2_pcode),
  name           text not null
);
create index on municipalities (province_pcode);

create table barangays (
  adm4_pcode         char(12) primary key,
  municipality_pcode text not null references municipalities(adm3_pcode),
  name               text not null,
  area_sqkm          numeric(12,6),
  geom               extensions.geometry(MultiPolygon,4326)
);
create index on barangays (municipality_pcode);
create index barangays_geom_idx on barangays using gist (geom);

create table stress_types (
  code       text primary key,
  label      text not null,
  color      text not null,
  dash       text not null default '',
  sort_order smallint not null
);

-- ---------- datasets and users ----------
create table datasets (
  id            bigint generated always as identity primary key,
  name          text not null,
  snapshot_date date,
  valid_on      date,
  description   text
);

create table profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text not null,
  role               user_role not null default 'LGU',
  municipality_pcode text references municipalities(adm3_pcode),
  approval           approval_status not null default 'Pending',
  created_at         timestamptz not null default now()
);

-- ---------- report workflow ----------
create table reports (
  id                 bigint generated always as identity primary key,
  municipality_pcode text not null references municipalities(adm3_pcode),
  submitted_by       uuid not null references profiles(id),
  status             report_status not null default 'Submitted',
  notes              text,
  submitted_at       timestamptz not null default now(),
  reviewed_by        uuid references profiles(id),
  review_notes       text,
  decided_at         timestamptz
);
create index on reports (municipality_pcode);
create index on reports (status);

create table report_items (
  id             bigint generated always as identity primary key,
  report_id      bigint not null references reports(id) on delete cascade,
  barangay_pcode char(12) not null references barangays(adm4_pcode),
  stress_code    text not null references stress_types(code),
  area_ha        numeric(10,2) not null check (area_ha > 0),
  farmers        numeric(10,1) not null check (farmers > 0),
  season         season_t not null,
  year           smallint not null check (year between 2000 and 2035)
);
create index on report_items (report_id);

create table report_files (
  id           bigint generated always as identity primary key,
  report_id    bigint not null references reports(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  size_bytes   integer not null check (size_bytes <= 5242880)
);
create index on report_files (report_id);

-- ---------- stress records (what the public sees) ----------
create table stress_records (
  id             bigint generated always as identity primary key,
  barangay_pcode char(12) not null references barangays(adm4_pcode),
  stress_code    text not null references stress_types(code),
  area_ha        numeric(10,2) not null,
  farmers        numeric(10,1) not null,
  season         season_t,
  year           smallint,
  dataset_id     bigint references datasets(id),
  report_item_id bigint references report_items(id),
  status         report_status not null default 'Published',
  check ((dataset_id is not null) <> (report_item_id is not null))
);
create index on stress_records (barangay_pcode);
create index on stress_records (stress_code);
create index on stress_records (status);

create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references profiles(id),
  report_id  bigint references reports(id),
  action     text not null,
  detail     text,
  created_at timestamptz not null default now()
);

-- ---------- farm practices and content (filled from the FGD baseline) ----------
create table practices (
  id             bigint generated always as identity primary key,
  province_pcode text not null references provinces(adm2_pcode),
  stress_code    text references stress_types(code),   -- null = normal conditions
  season         season_t,
  category       text not null,
  practice_text  text not null,
  sort_order     smallint not null default 0,
  source         text
);
create table seed_recommendations (
  id             bigint generated always as identity primary key,
  province_pcode text not null references provinces(adm2_pcode),
  stress_code    text references stress_types(code),
  season         season_t,
  seed_type      text not null,
  variety        text not null,
  seeding_rate   text,
  notes          text
);
create table baseline_yields (
  id               bigint generated always as identity primary key,
  province_pcode   text not null references provinces(adm2_pcode),
  stress_code      text references stress_types(code),
  season           season_t,
  avg_farm_size_ha numeric(6,2),
  yield_t_ha       numeric(6,2)
);
create table gallery_photos (
  id           bigint generated always as identity primary key,
  storage_path text not null,
  caption      text not null,
  alt_text     text not null,
  sort_order   smallint not null default 0
);

-- ---------- seed the stress types ----------
insert into stress_types (code,label,color,dash,sort_order) values
 ('F',  'Flood',                       '#2b6cb0','',            1),
 ('S',  'Saline intrusion',            '#d9a400','2 4',         2),
 ('D',  'Drought',                     '#c0392b','9 4',         3),
 ('FD', 'Flood and drought',           '#7b4bb7','9 4 2 4',     4),
 ('FS', 'Flood and saline intrusion',  '#2f9e5b','14 3',        5),
 ('SD', 'Saline intrusion and drought','#e07b1a','2 2 8 2',     6),
 ('FSD','Flood, saline intrusion and drought (multiple stress)','#7a4a2b','1 5',7);

-- ---------- new signups become Pending LGU profiles ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role, municipality_pcode, approval)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          'LGU',
          nullif(new.raw_user_meta_data->>'municipality_pcode',''),
          'Pending');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Row Level Security: lock everything, then open only what is public ----------
alter table provinces            enable row level security;
alter table municipalities       enable row level security;
alter table barangays            enable row level security;
alter table stress_types         enable row level security;
alter table datasets             enable row level security;
alter table profiles             enable row level security;
alter table reports              enable row level security;
alter table report_items         enable row level security;
alter table report_files         enable row level security;
alter table stress_records       enable row level security;
alter table audit_log            enable row level security;
alter table practices            enable row level security;
alter table seed_recommendations enable row level security;
alter table baseline_yields      enable row level security;
alter table gallery_photos       enable row level security;

create policy "public read" on provinces            for select using (true);
create policy "public read" on municipalities       for select using (true);
create policy "public read" on barangays            for select using (true);
create policy "public read" on stress_types         for select using (true);
create policy "public read" on datasets             for select using (true);
create policy "public read" on practices            for select using (true);
create policy "public read" on seed_recommendations for select using (true);
create policy "public read" on baseline_yields      for select using (true);
create policy "public read" on gallery_photos       for select using (true);
create policy "public read published" on stress_records for select using (status = 'Published');
create policy "read own profile" on profiles for select using (auth.uid() = id);
-- reports, report_items, report_files, audit_log have no policies yet = nobody can read them.
-- Next migration adds the LGU / DA / Admin policies and the publish function.
