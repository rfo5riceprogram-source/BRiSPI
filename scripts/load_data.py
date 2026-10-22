"""
Load provinces, municipalities, barangays (with boundaries) and the baseline stress
records into Supabase.

  pip install pandas shapely "psycopg[binary]"

Dry run (checks only, nothing is written):
  python scripts/load_data.py --csv data/Rice_Stress_Areas.csv --geojson data/barangays.geojson --dry-run

Real run (DATABASE_URL = the Supabase "Session pooler" connection string):
  set DATABASE_URL=postgresql://postgres.xxxx:PASSWORD@aws-0-xx.pooler.supabase.com:5432/postgres
  python scripts/load_data.py --csv data/Rice_Stress_Areas.csv --geojson data/barangays.geojson
"""
import argparse, json, os, sys
import pandas as pd
from shapely.geometry import shape, mapping, MultiPolygon
from shapely.validation import make_valid

ap = argparse.ArgumentParser()
ap.add_argument('--csv', required=True)
ap.add_argument('--geojson', required=True)
ap.add_argument('--code-field', help='GeoJSON property holding the 12-digit barangay code (auto-detected if omitted)')
ap.add_argument('--tolerance', type=float, default=0.0003, help='simplify tolerance in degrees (bigger = smaller file)')
ap.add_argument('--max-missing-pct', type=float, default=10, help='stop if more than this %% of barangays have no boundary')
ap.add_argument('--db-url', help='Supabase Session pooler link (or set DATABASE_URL instead)')
ap.add_argument('--dry-run', action='store_true')
a = ap.parse_args()

CAT = [('F','Flood - '),('S','Salt Affected - '),('D','Drought - '),('FD','Flood and Drought - '),
       ('FS','Flood and Saline - '),('SD','Drought and Saline - '),('FSD','Multiple Stress (Flood, Saline and Drought) - ')]
DATASET = 'Baseline 2022/2023'

# ---------- 1. CSV ----------
df = pd.read_csv(a.csv, dtype={'ADM4_PCODE':str,'ADM3_PCODE':str,'ADM2_PCODE':str})
assert df.ADM4_PCODE.is_unique, 'duplicate barangay codes in the CSV'
provinces = df[['ADM2_PCODE','Province']].drop_duplicates().values.tolist()
munis = df[['ADM3_PCODE','ADM2_PCODE','Municipality']].drop_duplicates().values.tolist()
brgys = df[['ADM4_PCODE','ADM3_PCODE','Barangay','AREA_SQKM']].values.tolist()
snap = pd.to_datetime(df['date'].iloc[0], dayfirst=True).date()
valid = pd.to_datetime(df['validOn'].iloc[0], dayfirst=True).date()
recs = []
for _, r in df.iterrows():
    for code, p in CAT:
        v = r[p + 'Area (Ha)']
        if pd.notna(v):
            recs.append((r.ADM4_PCODE, code, round(float(v), 2), float(r[p + 'No. of Farmers'])))
tot = df['Total - Area (Ha)'].sum()
assert abs(sum(x[2] for x in recs) - tot) < 1, 'stress areas do not add up to the CSV total'
print(f'CSV: {len(provinces)} provinces, {len(munis)} municipalities, {len(brgys)} barangays, {len(recs)} stress records, {tot:,.1f} ha')
print(f'Dataset dates: snapshot {snap}, valid on {valid}  (check these are day/month/year as intended)')

# ---------- 2. GeoJSON ----------
gj = json.load(open(a.geojson, encoding='utf-8'))
feats = gj['features']
props = feats[0]['properties']
field = a.code_field
if not field:
    for c in ('ADM4_PCODE','ADM_CODE','adm4_pcode','adm_code','ADM4_CODE'):
        if c in props: field = c; break
if not field or field not in props:
    sys.exit(f'Cannot find the barangay code property. Properties are: {list(props)}. Re-run with --code-field NAME')
print(f'GeoJSON: {len(feats)} features, using property "{field}" as the barangay code')
geoms, bad = {}, 0
for f in feats:
    code = str(f['properties'][field]).strip()
    if not f.get('geometry'): bad += 1; continue
    g = shape(f['geometry'])
    if not g.is_valid: g = make_valid(g)
    g = g.simplify(a.tolerance, preserve_topology=True)
    polys = [x for x in (g.geoms if hasattr(g, 'geoms') else [g]) if x.geom_type in ('Polygon','MultiPolygon')]
    flat = []
    for x in polys: flat += list(x.geoms) if x.geom_type == 'MultiPolygon' else [x]
    if not flat: bad += 1; continue
    geoms[code] = json.dumps(mapping(MultiPolygon(flat)))
csv_codes = {b[0] for b in brgys}
missing = sorted(csv_codes - set(geoms)); extra = sorted(set(geoms) - csv_codes)
print(f'Boundary match: {len(csv_codes) - len(missing)} of {len(csv_codes)} barangays have a boundary; '
      f'{len(missing)} without; {len(extra)} GeoJSON features not in the CSV; {bad} unusable features')
if missing: print('  first barangays without a boundary:', missing[:5])
if len(missing) > len(csv_codes) * a.max_missing_pct / 100:
    sys.exit('More than 10% of barangays have no boundary. The codes probably do not match: check --code-field.')

if a.dry_run:
    print('Dry run finished. Nothing was written.'); sys.exit()

# ---------- 3. Database ----------
import psycopg
url = a.db_url or os.environ.get('DATABASE_URL') or sys.exit('No connection link given. Add --db-url "postgresql://..." to the command (Supabase > Connect > Session pooler)')
with psycopg.connect(url) as con:
    cur = con.cursor()
    cur.execute('select count(*) from provinces'); 
    if cur.fetchone()[0]: sys.exit('provinces already has rows. This script is for an empty database; stopping.')
    cur.executemany('insert into provinces (adm2_pcode, name) values (%s,%s)', provinces)
    cur.executemany('insert into municipalities (adm3_pcode, province_pcode, name) values (%s,%s,%s)', munis)
    cur.executemany(
        'insert into barangays (adm4_pcode, municipality_pcode, name, area_sqkm, geom) values '
        '(%s,%s,%s,%s, case when %s::text is null then null else '
        'extensions.st_multi(extensions.st_setsrid(extensions.st_geomfromgeojson(%s::text),4326)) end)',
        [(c, m, n, ar, geoms.get(c), geoms.get(c)) for c, m, n, ar in brgys])
    cur.execute('insert into datasets (name, snapshot_date, valid_on, description) values (%s,%s,%s,%s) returning id',
                (DATASET, snap, valid, 'Rice_Stress_Areas.csv, LGU barangay data'))
    ds = cur.fetchone()[0]
    cur.executemany(
        "insert into stress_records (barangay_pcode, stress_code, area_ha, farmers, dataset_id, status) "
        "values (%s,%s,%s,%s,%s,'Published')", [(c, s, ar, f, ds) for c, s, ar, f in recs])
    # verify before committing
    cur.execute('select count(*) from barangays'); nb = cur.fetchone()[0]
    cur.execute('select count(*) from barangays where geom is not null'); ng = cur.fetchone()[0]
    cur.execute('select count(*), sum(area_ha) from stress_records'); nr, ar = cur.fetchone()
    print(f'In database: {nb} barangays ({ng} with boundary), {nr} stress records, {ar:,.1f} ha')
    assert nb == len(brgys) and nr == len(recs) and abs(float(ar) - tot) < 1, 'counts do not match: rolled back'
    con.commit()
print('Done. All data committed.')
