-- W2-c 3단계 DB — 지표 대시보드(/admin/metrics)의 읽기 함수 · 운영 도메인 전환일 설정 (GROW-01, docs/dev/W2-c_설계.md 2.6·8.3)
-- · analytics_metric_sessions — 대시보드가 부르는 세션 묶음 읽기. 세는 규칙(유효 방문·재방문·깔때기·봇·편집국 제외·한국 날짜)은
--   웹 앱의 순수 함수(apps/web/lib/analytics/metrics.ts) 한 곳에 있고, 이 함수는 규칙 없이 이벤트를 세션별로 묶어 줄이기만 한다.
--   · 고르는 세션: 첫 이벤트가 [p_from, p_to)에 든 세션(p_from 전 하루 안에 이벤트가 있는 세션은 앞 기간에서 시작한 세션이라 뺀다)
--     + 그 세션들의 방문자가 [p_to, p_until)에 새로 시작한 세션(재방문 30일을 보려고 — 기간 뒤 30일까지)
--   · 세션마다 [방문자 번호(이 응답 안에서만 쓰는 1부터 번호 — 방문자 UUID는 내보내지 않는다), 첫 방문, 봇, 편집국, 시작 시각,
--     고른 이름(p_names)의 이벤트 [이름 번호, 분야, 시각]]. 시각은 p_from에서 지난 밀리초. 봇·편집국 세션도 표시와 함께 보낸다(빼는 일은 규칙 쪽)
--   · 세션이 p_limit개를 넘으면 세션 목록 없이 {over: true, count} — 한 번에 너무 큰 응답을 만들지 않는다 (대시보드가 '기간을 줄이세요'를 보인다)
--   · JSON 한 값을 돌려 API 행 상한(1,000)과 상관없다. security invoker·search_path 빈칸, service_role만 실행 (anon·authenticated 0)
-- · 설정 씨앗 domain_cutover — 운영 도메인 전환일(한국 날짜). 비어 있으면 아직 전환 전이라 모든 수치가 '시험 기간' (PRD-01A 11장·GROW-01).
--   anon 공개 키가 아니다(공개 설정 목록 settings_public_read에 넣지 않는다)

create function public.analytics_metric_sessions(
  p_from timestamptz, p_to timestamptz, p_until timestamptz, p_names text[], p_limit integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_total integer;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_until is null or p_from >= p_to or p_until < p_to then
    raise exception '지표 범위가 틀렸습니다 (p_from < p_to <= p_until)';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception '세션 상한은 1 이상이어야 합니다';
  end if;
  if p_names is null or cardinality(p_names) = 0 then
    raise exception '이벤트 이름 목록이 비었습니다';
  end if;

  -- 세션 고르기 — 기간 안에서 시작한 세션 + 그 방문자가 기간 뒤(p_until 전)에 새로 시작한 세션
  with started_before as (
    select distinct e.session_id
    from public.analytics_events e
    where e.occurred_at >= p_from - interval '1 day' and e.occurred_at < p_from
  ),
  base as (
    select distinct e.session_id
    from public.analytics_events e
    where e.occurred_at >= p_from and e.occurred_at < p_to
      and not exists (select 1 from started_before b where b.session_id = e.session_id)
  ),
  base_visitors as (
    select distinct e.visitor_id
    from public.analytics_events e
    join base b on b.session_id = e.session_id
    where e.occurred_at >= p_from and e.occurred_at < p_to and e.visitor_id is not null
  ),
  later as (
    select distinct e.session_id
    from public.analytics_events e
    join base_visitors v on v.visitor_id = e.visitor_id
    where e.occurred_at >= p_to and e.occurred_at < p_until
      and not exists (select 1 from base b where b.session_id = e.session_id)
      and not exists (select 1 from started_before b where b.session_id = e.session_id)
  )
  select coalesce(array_agg(t.session_id), '{}'::uuid[]) into v_ids
  from (select session_id from base union select session_id from later) t;

  v_total := cardinality(v_ids);
  if v_total > p_limit then
    return jsonb_build_object('over', true, 'count', v_total);
  end if;

  with ev as (
    select e.id, e.session_id, e.visitor_id, e.first_visit, e.is_bot, e.is_staff, e.name, e.section, e.occurred_at
    from public.analytics_events e
    join unnest(v_ids) as p(session_id) on p.session_id = e.session_id
    where e.occurred_at >= p_from and e.occurred_at < p_until
  ),
  sess as (
    select ev.session_id,
      (array_agg(ev.visitor_id order by ev.occurred_at, ev.id) filter (where ev.visitor_id is not null))[1] as visitor_id,
      bool_or(ev.first_visit) as fv,
      bool_or(ev.is_bot) as bot,
      bool_or(ev.is_staff) as staff,
      min(ev.occurred_at) as started,
      coalesce(
        jsonb_agg(
          jsonb_build_array(array_position(p_names, ev.name) - 1, ev.section, floor(extract(epoch from (ev.occurred_at - p_from)) * 1000)::bigint)
          order by ev.occurred_at, ev.id
        ) filter (where ev.name = any (p_names)),
        '[]'::jsonb) as events
    from ev
    group by ev.session_id
  ),
  numbered as (
    select s.*, case when s.visitor_id is null then null else dense_rank() over (order by s.visitor_id) end as v
    from sess s
  )
  select jsonb_build_object(
    'over', false,
    'count', v_total,
    'sessions', coalesce(jsonb_agg(
      jsonb_build_array(n.v, n.fv, n.bot, n.staff, floor(extract(epoch from (n.started - p_from)) * 1000)::bigint, n.events)
      order by n.started, n.session_id), '[]'::jsonb))
  into v_result
  from numbered n;
  return v_result;
end;
$$;

revoke all on function public.analytics_metric_sessions(timestamptz, timestamptz, timestamptz, text[], integer) from public, anon, authenticated;
grant execute on function public.analytics_metric_sessions(timestamptz, timestamptz, timestamptz, text[], integer) to service_role;

comment on function public.analytics_metric_sessions(timestamptz, timestamptz, timestamptz, text[], integer) is
  '지표 대시보드(GROW-01) 세션 묶음 읽기 — 규칙 없이 세션별로 줄이기만 한다(규칙은 apps/web/lib/analytics/metrics.ts). 방문자 UUID 대신 응답 안 번호. service_role만';

-- ─────────────────────────────────────────────────────────────
-- 운영 도메인 전환일 (설계 2.6 — 시험 tests/w2c-metrics.test.mjs가 설계 문서의 값과 대조한다)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('domain_cutover',
   '{"version":"2026-10-18.1","date":null}'::jsonb,
   '운영 도메인 전환일 (GROW-01 · PRD-01A 11장) — date는 한국 날짜 YYYY-MM-DD, 비어 있으면 전환 전. 이 날 앞의 지표는 ''시험 기간''으로 따로 보인다',
   'migration:20261018000016');
