import pandas as pd, json, sys
from datetime import datetime
src=sys.argv[1]; n=int(sys.argv[2]); out=sys.argv[3]
df=pd.read_csv(src,dtype={'ADM4_PCODE':str,'ADM3_PCODE':str,'ADM2_PCODE':str}).head(n)
CAT=[('F','Flood - '),('S','Salt Affected - '),('D','Drought - '),('FD','Flood and Drought - '),
 ('FS','Flood and Saline - '),('SD','Drought and Saline - '),('FSD','Multiple Stress (Flood, Saline and Drought) - ')]
snap=datetime.strptime(df['date'].iloc[0],'%d/%m/%Y').date().isoformat()
brgy=df[['ADM4_PCODE','Barangay','ADM3_PCODE','Municipality','ADM2_PCODE','Province','AREA_SQKM']].copy()
brgy.columns=['adm4_pcode','barangay','adm3_pcode','municipality','adm2_pcode','province','area_sqkm']
rows=[]
for _,r in df.iterrows():
    for code,p in CAT:
        a=r[p+'Area (Ha)']
        if pd.notna(a):
            rows.append(dict(adm4_pcode=r['ADM4_PCODE'],stress_code=code,area_ha=round(float(a),2),
              farmers=float(r[p+'No. of Farmers']),snapshot_date=snap,status='Published',source='Baseline 2022/2023'))
rec=pd.DataFrame(rows)
tot=rec.groupby('adm4_pcode')[['area_ha','farmers']].sum()
chk=df.set_index('ADM4_PCODE')[['Total - Area (Ha)','Total - No. of Farmers']]
assert ((tot.area_ha-chk['Total - Area (Ha)']).abs()<0.05).all() and ((tot.farmers-chk['Total - No. of Farmers']).abs()<0.01).all()
brgy['flag_stress_exceeds_brgy_area']=(brgy.adm4_pcode.map(tot.area_ha)>brgy.area_sqkm*100).values
brgy.to_csv(out+'/barangays.csv',index=False); rec.to_csv(out+'/stress_records.csv',index=False)
from shapely import wkt
from shapely.geometry import mapping
def geo(w):
    try: return mapping(wkt.loads(w).simplify(0.0003,preserve_topology=True))
    except Exception: return None
feats=[{"type":"Feature","properties":{"adm4_pcode":r.ADM4_PCODE,"barangay":r.Barangay,"municipality":r.Municipality,"province":r.Province},
  "geometry":geo(r.geometry)} for r in df.itertuples()]
miss=[f["properties"]["adm4_pcode"] for f in feats if f["geometry"] is None]
feats=[f for f in feats if f["geometry"]]
brgy["geometry_ok"]=~brgy.adm4_pcode.isin(miss); brgy.to_csv(out+"/barangays.csv",index=False)
print("geometry truncated in CSV:",len(miss))
json.dump({"type":"FeatureCollection","features":feats},open(out+'/barangays_web.geojson','w'),separators=(',',':'))
print(len(brgy),'barangays ->',len(rec),'records; checks passed; flagged',brgy.flag_stress_exceeds_brgy_area.sum())
