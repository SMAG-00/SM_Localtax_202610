-- W2-c 2단계 DB — 많이 본 기사·상담 사례 HOT 순위 · 1시간 집계 배치 함수 · 원본 보존 기한 정리 (ART-11 · HOME-05 · FND-06, docs/dev/W2-c_설계.md 3·7·8장)
-- · article_rankings — 집계 배치(/api/jobs/popular-hourly)가 매 실행 통째로 바꾸는 순위 목록 두 개(많이 본 기사 popular · 상담 사례 HOT hot).
--   공개 화면은 anon 키로 이 표의 '순위·기사 번호·고정 여부·집계 시각' 칸만 읽는다. 점수(조회 수 등)·집계 창 칸은 비공개.
--   행은 RLS 정책으로 거른다 — 정책 안의 기사 하위 질의가 읽는 역할의 RLS로 돌아, 지금 공개된 기사의 행만 보인다
--   (비공개·삭제로 바뀐 기사는 다음 집계를 기다리지 않고 바로 목록에서 빠진다 — ART-11).
--   원본 analytics_events·집계 article_stats는 그대로 anon·authenticated 0 (1단계 마이그레이션 14) — 최소 권한: 순위 목록만 연다.
-- · 집계 함수 — 배치(service_role)만 실행한다. anon·authenticated 실행 0 (verify-rls-remote — anon 실행 허용은 health_ping뿐).
--   함수는 security invoker(부르는 역할의 권한)이고 search_path는 비운다.
-- · 공개 설정 키에 popular_rules를 더한다 — 화면이 사이드바·목록 건수(sidebar_size·list_size)를 설정에서 읽는다(코드 상수 0).
--   값은 숫자·기사 유형 목록뿐이다(방문자 정보 0).

-- ─────────────────────────────────────────────────────────────
-- article_rankings — 순위 목록 (popular: 최근 window_hours시간 사람 조회 · hot: 최근 window_days일 HOT 점수 + 편집자 고정)
-- ─────────────────────────────────────────────────────────────
create table public.article_rankings (
  list text not null check (list in ('popular', 'hot')),
  rank integer not null check (rank between 1 and 100),                 -- 1부터, 빈 번호 없이 (배치가 매기고 함수가 다시 센다)
  article_id bigint not null references public.articles (id) on delete cascade,
  pinned boolean not null default false,                                 -- HOT 편집자 고정 (HOME-05 — 점수와 관계없이 맨 앞)
  score numeric not null check (score >= 0),                             -- popular = 사람 조회 수, hot = 가중 점수 (비공개 칸)
  window_start timestamptz not null,                                     -- 집계 창 [window_start, window_end) — UTC 정시
  window_end timestamptz not null,
  computed_at timestamptz not null,                                      -- 집계 시각 (화면의 '집계 시각')
  settings_version text not null check (length(btrim(settings_version)) > 0), -- 계산에 쓴 설정 버전 (popular_rules · hot_weights)
  primary key (list, rank),
  unique (list, article_id),
  constraint article_rankings_window check (window_start < window_end),
  constraint article_rankings_window_hours check (
    date_trunc('hour', window_start at time zone 'UTC') = window_start at time zone 'UTC'
    and date_trunc('hour', window_end at time zone 'UTC') = window_end at time zone 'UTC'),
  constraint article_rankings_pin_hot check (list = 'hot' or not pinned)
);

comment on table public.article_rankings is '많이 본 기사·상담 사례 HOT 순위 (ART-11·HOME-05) — 1시간 집계 배치가 통째로 바꾼다. anon은 공개 기사의 순위·고정·집계 시각 칸만 (점수 비공개)';
comment on column public.article_rankings.score is '순위 점수 — popular = 사람 조회 수, hot = 조회×view + 공유×share + 30초 열람×engaged (비공개)';

alter table public.article_rankings enable row level security;
revoke all on table public.article_rankings from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_rankings to service_role;

grant select (list, rank, article_id, pinned, computed_at) on table public.article_rankings to anon, authenticated;
create policy article_rankings_public_read on public.article_rankings
  for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_rankings.article_id));

-- ─────────────────────────────────────────────────────────────
-- 집계 함수 (배치 전용 — service_role)
-- ─────────────────────────────────────────────────────────────

-- 바뀐 측정 이벤트 찾기 — 지난 실행이 본 마지막 이벤트 번호(p_after_id) 뒤에 들어온 기사 이벤트(조회·30초 열람·공유)의
-- UTC 정시 시간대 목록(p_since 이상 p_before 미만), 아직 끝나지 않은 시간대(p_before 이후)의 가장 작은 번호, 가장 큰 번호.
-- 늦게 들어온 이벤트(시각이 지난 시간대)도 번호는 새것이라 그 시간대를 다시 집계한다 (설계 8.2 '늦은 이벤트')
create function public.analytics_article_changes(p_after_id bigint, p_since timestamptz, p_before timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'hours', coalesce((
      select jsonb_agg(h order by h)
      from (
        select distinct date_trunc('hour', e.occurred_at at time zone 'UTC') at time zone 'UTC' as h
        from public.analytics_events e
        where e.id > p_after_id
          and e.name in ('article_viewed', 'article_engaged', 'article_shared')
          and e.occurred_at >= p_since and e.occurred_at < p_before
      ) t), '[]'::jsonb),
    'pending_min_id', (
      select min(e.id) from public.analytics_events e
      where e.id > p_after_id and e.name in ('article_viewed', 'article_engaged', 'article_shared') and e.occurred_at >= p_before),
    'max_id', (
      select max(e.id) from public.analytics_events e
      where e.id > p_after_id and e.name in ('article_viewed', 'article_engaged', 'article_shared')))
$$;

-- 시간 단위 집계 바꾸기 — [p_from, p_to) 안의 행을 지우고 새 행을 넣는다(한 트랜잭션). 같은 시간대를 다시 돌려도 같은 결과 (멱등).
-- 범위 밖 시각의 행이 오면 거부. 지금 없는 기사(지워진 기사)의 행은 넣지 않는다
create function public.article_stats_replace(p_from timestamptz, p_to timestamptz, p_rows jsonb, p_computed_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception '집계 범위가 비었습니다 (p_from < p_to)';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '집계 행은 JSON 배열이어야 합니다';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_rows) as r(hour timestamptz)
    where r.hour is null or r.hour < p_from or r.hour >= p_to) then
    raise exception '집계 범위 밖 시각의 행이 있습니다';
  end if;
  -- 겹치는 두 실행이 서로의 행을 지우다 기본 키 충돌을 내지 않게 한 줄로 세운다
  perform pg_advisory_xact_lock(hashtext('public.article_stats_replace'));
  delete from public.article_stats where hour >= p_from and hour < p_to;
  insert into public.article_stats (article_id, hour, views_all, views_human, shares, engaged_views, computed_at)
  select r.article_id, r.hour, r.views_all, r.views_human, r.shares, r.engaged_views, p_computed_at
  from jsonb_to_recordset(p_rows) as r(article_id bigint, hour timestamptz, views_all integer, views_human integer, shares integer, engaged_views integer)
  where exists (select 1 from public.articles a where a.id = r.article_id);
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- 창 [p_from, p_to) 동안 기사별 합계 — 사람 조회·공유·30초 열람 (JSON 배열 한 값 — API 행 상한 1,000과 상관없이 전부)
create function public.article_stats_totals(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'article_id', t.article_id, 'views_human', t.views_human, 'shares', t.shares, 'engaged_views', t.engaged_views) order by t.article_id), '[]'::jsonb)
  from (
    select s.article_id, sum(s.views_human)::bigint as views_human, sum(s.shares)::bigint as shares, sum(s.engaged_views)::bigint as engaged_views
    from public.article_stats s
    where s.hour >= p_from and s.hour < p_to
    group by s.article_id
  ) t
$$;

-- 순위 목록 바꾸기 — 그 목록의 행을 모두 지우고 새 행을 넣는다(한 트랜잭션 — 읽는 쪽에 빈 목록·반쪽 목록 0).
-- 지금 없는 기사는 빼고 순위를 1부터 다시 센다(빈 번호 0)
create function public.article_rankings_replace(
  p_list text, p_rows jsonb, p_window_start timestamptz, p_window_end timestamptz, p_computed_at timestamptz, p_settings_version text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '순위 행은 JSON 배열이어야 합니다';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.article_rankings_replace:' || coalesce(p_list, '')));
  delete from public.article_rankings where list = p_list;
  insert into public.article_rankings (list, rank, article_id, pinned, score, window_start, window_end, computed_at, settings_version)
  select p_list, row_number() over (order by r.rank), r.article_id, coalesce(r.pinned, false), r.score,
    p_window_start, p_window_end, p_computed_at, p_settings_version
  from jsonb_to_recordset(p_rows) as r(rank integer, article_id bigint, pinned boolean, score numeric)
  where exists (select 1 from public.articles a where a.id = r.article_id);
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- 원본 이벤트 보존 기한 정리 — p_before보다 앞선 이벤트를 오래된 것부터 최대 p_limit건 지운다 (배치가 여러 번 부른다)
create function public.analytics_events_purge(p_before timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception '한 번에 지울 건수는 1 이상이어야 합니다';
  end if;
  with doomed as (
    select e.id from public.analytics_events e
    where e.occurred_at < p_before
    order by e.occurred_at, e.id
    limit p_limit)
  delete from public.analytics_events e using doomed d where e.id = d.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- 시간 단위 집계 보존 기한 정리 — p_before보다 앞선 시간대 행을 최대 p_limit건 지운다
create function public.article_stats_purge(p_before timestamptz, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception '한 번에 지울 건수는 1 이상이어야 합니다';
  end if;
  with doomed as (
    select s.article_id, s.hour from public.article_stats s
    where s.hour < p_before
    order by s.hour, s.article_id
    limit p_limit)
  delete from public.article_stats s using doomed d where s.article_id = d.article_id and s.hour = d.hour;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.analytics_article_changes(bigint, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.article_stats_replace(timestamptz, timestamptz, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.article_stats_totals(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.article_rankings_replace(text, jsonb, timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.analytics_events_purge(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.article_stats_purge(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.analytics_article_changes(bigint, timestamptz, timestamptz) to service_role;
grant execute on function public.article_stats_replace(timestamptz, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.article_stats_totals(timestamptz, timestamptz) to service_role;
grant execute on function public.article_rankings_replace(text, jsonb, timestamptz, timestamptz, timestamptz, text) to service_role;
grant execute on function public.analytics_events_purge(timestamptz, integer) to service_role;
grant execute on function public.article_stats_purge(timestamptz, integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 설정 키 — popular_rules를 더한다 (W2-b 설계 2.3 settings.public_keys · W2-c 설계 2.5)
-- ─────────────────────────────────────────────────────────────
drop policy settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (key = any (array[
    'home_core_message', 'home_search_chips', 'hub_intros', 'amendment_confirmed_stage',
    'hub_situation_limit', 'feature_flags', 'next_action_priority', 'popular_rules']::text[]));
