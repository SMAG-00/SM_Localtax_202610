-- W4 25단계 — 지역 성과 대시보드·편집비 (docs/dev/W4_설계.md 1장 25단계 · 12장 #28, PRD-01B REG1-15)
-- · region_editorial_costs — 지역·월별 편집비(원). 지역마다 달마다 한 줄(고치면 같은 줄을 고치고 사유는 감사 기록에 남는다). RLS 기본 거부 — service_role만.
--   행이 없는 달은 '편집비 미입력'이다(화면이 추정값 0을 만들지 않는다). 금액은 사람이 적는다(기본값 0).
-- · region_news_facts — 지역 태그 기사 한 줄씩(지역 × 공개 중 기사, 이관 기사 제외): 자체 취재(content_type = reported_news)·확인된 취재 근거 수. 읽기 전용 뷰.
-- · region_dashboard_metrics(p_from, p_to, p_until, p_today) — 지역별 지표 JSON 한 값. 세는 규칙은 W2-c와 같다:
--   · 봇·편집국 세션 제외(세션 안에 하나라도 is_bot·is_staff 이벤트가 있으면 세션째), 한국 날짜
--   · 지역 재방문 region_returned(12장 #28) — 수집 이벤트가 아니라 region_viewed로 계산한다. 방문자 ID가 있는 세션만(측정 동의),
--     기간 안 처음 본 날(한국 날짜)부터 30일째 날짜까지 다른 세션에서 같은 지역을 다시 보면 재방문(30일째 포함 · 31일째 제외)
--   · 문제해결 이동률 — region_viewed 세션 가운데 같은 지역의 region_to_tax_clicked 또는 region_to_realestate_clicked가 있는 세션
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

create table public.region_editorial_costs (
  id bigint generated always as identity primary key,
  region_code text not null references public.regions (code),
  month date not null check (extract(day from month) = 1),     -- 그 달 1일 (한국 달력)
  amount_krw bigint not null check (amount_krw >= 0 and amount_krw <= 100000000000),
  entered_by text not null check (length(btrim(entered_by)) > 0), -- user:<uuid>
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint region_editorial_costs_unique unique (region_code, month)
);
comment on table public.region_editorial_costs is '지역·월별 편집비(원) — W4 25단계 REG1-15. 행이 없는 달 = 편집비 미입력(추정값 0 아님). 관리자만 입력, 변경 사유는 audit_logs';
alter table public.region_editorial_costs enable row level security;
revoke all on table public.region_editorial_costs from anon, authenticated;

create view public.region_news_facts with (security_invoker = true) as
select r.code as region_code, a.id as article_id, a.first_published_at, a.content_type,
  (a.content_type = 'reported_news') as is_own,
  (select count(*)::int from public.article_evidence e where e.article_id = a.id and e.verification_status = 'verified') as evidence_verified
from public.articles a
cross join lateral unnest(a.region_codes) as r(code)
where a.status = 'published' and a.origin <> 'legacy' and a.first_published_at is not null;
comment on view public.region_news_facts is '지역 태그 공개 기사 한 줄씩(지역 × 기사, 이관 기사 제외) — 지역 성과 대시보드 (REG1-15)';
revoke all on table public.region_news_facts from public, anon, authenticated;
grant select on table public.region_news_facts to service_role;

create function public.region_dashboard_metrics(p_from timestamptz, p_to timestamptz, p_until timestamptz, p_today date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_until is null or p_today is null or p_from >= p_to or p_until < p_to then
    raise exception '지표 범위가 틀렸습니다 (p_from < p_to <= p_until)';
  end if;
  with ev as (
    select e.name, e.session_id, e.visitor_id, e.occurred_at, e.props ->> 'region_code' as rc
    from public.analytics_events e
    where e.name in ('region_viewed', 'region_to_tax_clicked', 'region_to_realestate_clicked')
      and e.occurred_at >= p_from and e.occurred_at < p_until
      and e.props ? 'region_code'
      and not exists (select 1 from public.analytics_events x where x.session_id = e.session_id and (x.is_bot or x.is_staff))
  ),
  views as (select distinct rc, session_id from ev where name = 'region_viewed' and occurred_at < p_to and occurred_at >= p_from),
  moved as (select distinct rc, session_id from ev where name <> 'region_viewed' and occurred_at >= p_from and occurred_at < p_to),
  sess as (
    select v.rc, count(*)::int as view_sessions, count(m.session_id)::int as moved_sessions
    from views v left join moved m on m.rc = v.rc and m.session_id = v.session_id
    group by v.rc
  ),
  vv as (select * from ev where name = 'region_viewed' and visitor_id is not null),
  base as (
    select distinct on (visitor_id, rc) visitor_id, rc, session_id, occurred_at
    from vv where occurred_at >= p_from and occurred_at < p_to
    order by visitor_id, rc, occurred_at, session_id
  ),
  ret as (
    select b.rc,
      exists (
        select 1 from vv v
        where v.visitor_id = b.visitor_id and v.rc = b.rc and v.session_id <> b.session_id and v.occurred_at > b.occurred_at
          and (v.occurred_at at time zone 'Asia/Seoul')::date <= (b.occurred_at at time zone 'Asia/Seoul')::date + 30
      ) as returned,
      ((b.occurred_at at time zone 'Asia/Seoul')::date + 30) as last_day
    from base b
  ),
  rv as (
    select rc, count(*)::int as visitors, count(*) filter (where returned)::int as returned,
      count(*) filter (where not returned and last_day >= p_today)::int as pending
    from ret group by rc
  ),
  news as (
    select f.region_code as rc, count(*)::int as published, count(*) filter (where f.is_own)::int as own,
      count(*) filter (where f.is_own and f.evidence_verified > 0)::int as own_with_evidence
    from public.region_news_facts f
    where f.first_published_at >= p_from and f.first_published_at < p_to
    group by f.region_code
  ),
  codes as (select rc from sess union select rc from rv union select rc from news)
  select coalesce(jsonb_agg(jsonb_build_object(
      'region_code', c.rc, 'published', coalesce(n.published, 0), 'own', coalesce(n.own, 0), 'own_with_evidence', coalesce(n.own_with_evidence, 0),
      'view_sessions', coalesce(s.view_sessions, 0), 'moved_sessions', coalesce(s.moved_sessions, 0),
      'visitors', coalesce(r.visitors, 0), 'returned', coalesce(r.returned, 0), 'pending', coalesce(r.pending, 0)
    ) order by c.rc), '[]'::jsonb)
  into v_result
  from codes c
  left join news n on n.rc = c.rc
  left join sess s on s.rc = c.rc
  left join rv r on r.rc = c.rc;
  return jsonb_build_object('regions', v_result);
end;
$$;
revoke all on function public.region_dashboard_metrics(timestamptz, timestamptz, timestamptz, date) from public, anon, authenticated;
grant execute on function public.region_dashboard_metrics(timestamptz, timestamptz, timestamptz, date) to service_role;
comment on function public.region_dashboard_metrics(timestamptz, timestamptz, timestamptz, date) is
  '지역 성과 대시보드(REG1-15) 지역별 숫자 — 자체 취재·근거·이동·region_returned(30일째 포함 31일째 제외). 봇·편집국 세션 제외. service_role만';
