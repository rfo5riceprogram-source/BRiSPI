create or replace view public.v_province_totals
with (security_invoker = true)
as
with province_stress_totals as (
  select
    p.adm2_pcode as province_pcode,
    st.code as stress_code,
    st.label as stress_label,
    st.color as stress_color,
    st.sort_order,
    coalesce(sum(sr.area_ha), 0::numeric) as area_ha,
    coalesce(sum(sr.farmers), 0::numeric) as farmers,
    count(sr.id)::bigint as record_count
  from public.provinces p
  cross join public.stress_types st
  left join public.municipalities m
    on m.province_pcode = p.adm2_pcode
  left join public.barangays b
    on b.municipality_pcode = m.adm3_pcode
  left join public.stress_records sr
    on sr.barangay_pcode = b.adm4_pcode
    and sr.stress_code = st.code
    and sr.status = 'Published'
  group by p.adm2_pcode, st.code, st.label, st.color, st.sort_order
),
province_totals as (
  select
    p.adm2_pcode as province_pcode,
    p.name as province_name,
    p.physical_rice_area_ha,
    p.total_farmers,
    coalesce(sum(pst.area_ha), 0::numeric) as total_affected_area_ha,
    coalesce(sum(pst.farmers), 0::numeric) as affected_farmers,
    coalesce(sum(pst.record_count), 0)::bigint as record_count,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'code', pst.stress_code,
          'label', pst.stress_label,
          'color', pst.stress_color,
          'sort_order', pst.sort_order,
          'area_ha', pst.area_ha,
          'farmers', pst.farmers,
          'record_count', pst.record_count
        ) order by pst.sort_order
      ) filter (where pst.stress_code is not null),
      '[]'::jsonb
    ) as stress_breakdown
  from public.provinces p
  left join province_stress_totals pst
    on pst.province_pcode = p.adm2_pcode
  group by
    p.adm2_pcode,
    p.name,
    p.physical_rice_area_ha,
    p.total_farmers
)
select
  pt.*,
  case
    when pt.physical_rice_area_ha is null
      or pt.physical_rice_area_ha <= 0
      or pt.total_affected_area_ha > pt.physical_rice_area_ha
    then null
    else pt.physical_rice_area_ha - pt.total_affected_area_ha
  end as favorable_area_ha
from province_totals pt;

create or replace view public.v_stress_type_totals
with (security_invoker = true)
as
select
  st.code as stress_code,
  st.label as stress_label,
  st.color as stress_color,
  st.sort_order,
  coalesce(sum(sr.area_ha), 0::numeric) as total_area_ha,
  coalesce(sum(sr.farmers), 0::numeric) as total_farmers,
  count(sr.id)::bigint as record_count
from public.stress_types st
left join public.stress_records sr
  on sr.stress_code = st.code
  and sr.status = 'Published'
group by st.code, st.label, st.color, st.sort_order;

create or replace view public.v_home_summary
with (security_invoker = true)
as
select
  case
    when count(*) filter (where physical_rice_area_ha is null) > 0 then null
    else coalesce(sum(physical_rice_area_ha), 0::numeric)
  end as physical_rice_area_ha,
  case
    when count(*) filter (where total_farmers is null) > 0 then null
    else coalesce(sum(total_farmers), 0)::bigint
  end as total_farmers,
  coalesce(sum(total_affected_area_ha), 0::numeric) as total_affected_area_ha,
  coalesce(sum(affected_farmers), 0::numeric) as affected_farmers,
  coalesce(sum(record_count), 0)::bigint as record_count
from public.v_province_totals;

grant select on public.v_province_totals to anon, authenticated;
grant select on public.v_stress_type_totals to anon, authenticated;
grant select on public.v_home_summary to anon, authenticated;