-- W11-e e3 - 정비 현황 뷰 redevelopment_zones · 확인일 경고 (PRD-03 RDV-07 · AIOPS-14, docs/dev/W11-e_설계.md e3)
-- 새 구역 표를 만들지 않는다 - 1단계 projects·project_events(현재 단계 뷰)를 읽는 뷰다. 값이 없으면 0행.
-- 사업 유형은 설정 stale_check_policy.redevelopment_types(감수 입력 - 씨앗은 비어 있어 구역 0행), 지정 단계는 designation_stage.
-- 씨앗 redevelopment_types 는 W4 개발방법 비교(dev_methods)의 사업 유형 이름 중 정비사업 4개를 project_types 코드 모양(밑줄)으로 옮긴 권고 기본값 [확인 필요 - PO·감수]. 지정 단계 designation_stage 는 W4에 단계 목록이 비어 있어 넣지 않는다(없으면 지정 고시일 칸 비움).
-- 경고 일수는 stale_check_policy 의 zone_days·ordinance_days - PRD 초기값 90 으로 비어 있을 때만 채운다. 90일째 경고 없음, 91일째 경고.

update public.settings
   set value = jsonb_build_object('zone_days', 90, 'ordinance_days', 90, 'redevelopment_types', jsonb_build_array('redevelopment', 'reconstruction', 'small_scale', 'renewal')),
       updated_by = 'migration:20261025000129'
 where key = 'stale_check_policy' and value = '{}'::jsonb;

create view public.redevelopment_zones as
select p.id as project_id, p.slug, p.name, p.region_code, p.project_type,
       c.current_stage, c.current_stage_label,
       d.notice_date as designation_notice_date,
       p.operator_name,
       p.source_name, ev.source_url, p.last_verified_at as verified_at,
       -- 함수(stale_days·stale_limit_days)는 anon 실행 권한이 없고, 뷰 안의 함수 호출은 읽는 쪽 권한으로 검사되어 막힌다(42501) - 같은 계산을 식으로 풀어 쓴다
       coalesce(((now() at time zone 'Asia/Seoul')::date - (p.last_verified_at at time zone 'Asia/Seoul')::date)
        > (select (s.value ->> 'zone_days')::integer from public.settings s
            where s.key = 'stale_check_policy' and jsonb_typeof(s.value -> 'zone_days') = 'number' and (s.value ->> 'zone_days') ~ '^[0-9]+$'), false) as stale
  from public.projects p
  join public.project_current_stages c on c.project_id = p.id
  join public.project_events ev on ev.id = c.event_id
  join public.settings pol on pol.key = 'stale_check_policy'
  left join lateral (
    select e.notice_date
      from public.project_events e
     where e.project_id = p.id and e.public and e.stage = pol.value ->> 'designation_stage'
       and not exists (select 1 from public.project_events x where x.correction_of = e.id)
     order by e.recorded_at desc, e.id desc limit 1) d on true
 where p.status = 'public'
   and p.source_name is not null and length(btrim(p.source_name)) > 0
   and p.last_verified_at is not null
   and ev.source_url is not null
   and jsonb_typeof(pol.value -> 'redevelopment_types') = 'array' and (pol.value -> 'redevelopment_types') ? p.project_type
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'redevelopment_status') = 'true'::jsonb);

comment on view public.redevelopment_zones is '정비 현황 (RDV-07) - 새 구역 표 없음, projects·project_events 를 읽는 뷰. 출처·확인일 없으면 0행, 기능 키 redevelopment_status 꺼짐이면 0행, 지도·좌표·가격 칸 0';
revoke all on table public.redevelopment_zones from public, anon, authenticated, service_role;
grant select on table public.redevelopment_zones to anon, authenticated, service_role;

-- 확인일 경고 대상 - 시각을 주입할 수 있다(테스트 주소에서 90/91일 확인). 외부 요청 없음, 결과는 id·일수뿐
create function public.stale_check_warnings(p_now timestamptz default now())
returns table (target text, target_id bigint, days integer)
language sql
stable
set search_path = ''
as $$
  select 'zone'::text, p.id, public.stale_days(p.last_verified_at, p_now)
    from public.projects p
    join public.project_current_stages c on c.project_id = p.id
    join public.settings pol on pol.key = 'stale_check_policy'
   where p.status = 'public' and p.last_verified_at is not null
     and jsonb_typeof(pol.value -> 'redevelopment_types') = 'array' and (pol.value -> 'redevelopment_types') ? p.project_type
     and public.stale_limit_days('zone_days') is not null
     and public.stale_days(p.last_verified_at, p_now) > public.stale_limit_days('zone_days')
  union all
  select 'ordinance'::text, o.id, public.stale_days(o.verified_at, p_now)
    from public.ordinance_links o
   where o.status = 'public' and o.verified_at is not null
     and public.stale_limit_days('ordinance_days') is not null
     and public.stale_days(o.verified_at, p_now) > public.stale_limit_days('ordinance_days');
$$;
revoke all on function public.stale_check_warnings(timestamptz) from public, anon, authenticated;
grant execute on function public.stale_check_warnings(timestamptz) to service_role;
