-- W6 2단계 — 행사안내 (PRD-01B LG-09 · LG-11 · LG-12 · LG-13 · LG-14 · REG-04 · REG1-04 · REG1-05, docs/dev/W6_설계.md 1장 2단계 · 2장 · 12장)
-- 이 파일에 실제 행사 사실은 없다. 표 틀·검사·공개 뷰만 정한다. 씨앗 행 0 (설정 기본값과 공식 주소로 쓸 수 없는 도메인 목록만).
-- · 설정 event_url_blocked_domains(단축 주소·개인 블로그 서비스) · event_recheck({ days: 7, hide_stale: false }) — 저장 검사 포함.
-- · local_events — 회차마다 한 행. 필수 칸은 NOT NULL이라 하나라도 비면 저장되지 않는다(= 비공개, LG-11). 기사 표(articles)와 분리 (원칙 ⑥).
--     공식 주소는 차단 도메인 밖 http(s) 주소 · 종료 ≥ 시작 · 영리 주최·상업 분류는 sponsored 필수(LG-13) · 취소는 출처 주소와 확인 시각 필수(REG1-04) ·
--     끝난 회차의 날짜는 고치지 못한다(새 회차는 새 행, REG1-05).
-- · event_status_history — 지정 상태(정상·취소·변경 확인 중)가 바뀔 때마다 트리거가 1행, 추가만 (LG-12).
-- · event_links — 편집자가 확인한 연결(프로젝트·기사). 공개 뷰는 대상이 공개 중일 때만 보인다 (LG-14).
-- · 공개 뷰 public_local_events(상태 계산 포함) · public_event_links — 키 local_events가 켜졌을 때만 행이 보인다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('event_url_blocked_domains',
   '["bit.ly", "tinyurl.com", "t.co", "goo.gl", "me2.do", "naver.me", "url.kr", "blog.naver.com", "cafe.naver.com", "cafe.daum.net", "tistory.com", "blogspot.com", "brunch.co.kr", "velog.io", "medium.com"]'::jsonb,
   '행사 공식 주소로 쓸 수 없는 도메인 목록 (LG-11) — 단축 주소·개인 블로그·카페 서비스. 이 도메인(하위 도메인 포함)의 주소는 행사 공식 URL로 저장되지 않는다',
   'migration:20261024000064'),
  ('event_recheck',
   '{"days": 7, "hide_stale": false}'::jsonb,
   '행사 재확인 기준 (REG1-05) — days: 마지막 확인일로부터 이 일수가 지나면 "일정 재확인 필요" 표시(1~90), hide_stale: true면 예정 목록에서도 숨긴다',
   'migration:20261024000064')
on conflict (key) do nothing;

create function public.event_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if new.key = 'event_url_blocked_domains' then
    if jsonb_typeof(new.value) is distinct from 'array' then
      raise exception '행사 공식 주소 차단 도메인(event_url_blocked_domains)은 도메인 배열입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$' then
        raise exception '행사 공식 주소 차단 도메인(event_url_blocked_domains)의 값은 소문자 도메인이어야 합니다 (지금 %)', v_item using errcode = 'check_violation';
      end if;
    end loop;
  elsif new.key = 'event_recheck' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) k where k not in ('days', 'hide_stale'))
       or jsonb_typeof(new.value -> 'days') is distinct from 'number'
       or (new.value ->> 'days') !~ '^[0-9]+$'
       or (new.value ->> 'days')::int not between 1 and 90
       or jsonb_typeof(new.value -> 'hide_stale') is distinct from 'boolean' then
      raise exception '행사 재확인 기준(event_recheck)은 { "days": 1~90 정수, "hide_stale": true/false }입니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.event_settings_guard() from public, anon, authenticated;
create trigger settings_event_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('event_url_blocked_domains', 'event_recheck'))
  execute function public.event_settings_guard();

-- 공식 주소 검사 — 문제 문장 또는 null
create function public.event_url_problem(p_url text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_blocked jsonb;
  d text;
begin
  if p_url is null or p_url !~* '^https?://[^/?#[:space:]@]+([/?#][^[:space:]]*)?$' then
    return '공식 주소는 http:// 또는 https://로 시작하는 주소 한 개여야 합니다';
  end if;
  v_host := lower(substring(p_url from '^[a-zA-Z]+://([^/?#:]+)'));
  select s.value into v_blocked from public.settings s where s.key = 'event_url_blocked_domains';
  if jsonb_typeof(v_blocked) = 'array' then
    for d in select jsonb_array_elements_text(v_blocked) loop
      if v_host = lower(d) or v_host like '%.' || lower(d) then
        return '단축 주소·개인 블로그 주소는 공식 주소가 될 수 없습니다 (' || d || ')';
      end if;
    end loop;
  end if;
  return null;
end;
$$;
revoke all on function public.event_url_problem(text) from public, anon, authenticated;
grant execute on function public.event_url_problem(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 행사 회차 (LG-09 · LG-11 · LG-13 · REG1-04)
-- ─────────────────────────────────────────────────────────────
create table public.local_events (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  series_key text not null check (series_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(series_key) <= 80),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  category text not null check (category in ('tax_finance', 'development', 'festival', 'commercial', 'other')),
  organizer text not null check (char_length(btrim(organizer)) between 1 and 80),
  organizer_type text not null check (organizer_type in ('government', 'public_body', 'nonprofit', 'commercial')),
  venue text not null check (char_length(btrim(venue)) between 1 and 120),
  region_code text not null references public.regions (code),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  official_url text not null,
  source_name text not null check (char_length(btrim(source_name)) between 1 and 80),
  confirmed_on date not null,
  status_override text check (status_override is null or status_override in ('cancelled', 'changing')),
  status_source_url text,
  status_confirmed_at timestamptz,
  sponsored boolean not null default false,
  published boolean not null default false,
  edited_by text not null check (length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_events_period check (ends_at >= starts_at),
  constraint local_events_series_unique unique (series_key, starts_at),
  constraint local_events_cancel_record check (status_override is distinct from 'cancelled' or (status_source_url is not null and status_confirmed_at is not null)),
  constraint local_events_commercial_sponsored check ((organizer_type <> 'commercial' and category <> 'commercial') or sponsored)
);
comment on table public.local_events is '행사안내 회차 (LG-09·11·13, REG1-04) — 기사가 아닌 정보 목록. 필수 칸 NOT NULL(누락 = 저장 불가 = 비공개), 영리 주최·상업 분류는 sponsored, 취소는 출처 주소·확인 시각 필수, 끝난 회차 날짜 수정 거부. 상태 예정·진행·종료는 시각으로 계산(공개 뷰)';
create index local_events_period_idx on public.local_events (starts_at) where published;
create index local_events_region_idx on public.local_events (region_code);

create function public.local_events_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  v_problem := public.event_url_problem(new.official_url);
  if v_problem is not null then
    raise exception '행사 공식 주소: %', v_problem using errcode = 'check_violation';
  end if;
  if new.status_source_url is not null then
    v_problem := public.event_url_problem(new.status_source_url);
    if v_problem is not null then
      raise exception '행사 상태 출처 주소: %', v_problem using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' or new.region_code is distinct from old.region_code then
    if not exists (select 1 from public.regions r where r.code = new.region_code and (r.valid_to is null or r.valid_to >= (now() at time zone 'Asia/Seoul')::date)) then
      raise exception '행사 지역 코드는 오늘 유효한 지역이어야 합니다 (%)', new.region_code using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.ends_at < now() and (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
    raise exception '끝난 회차의 날짜는 고치지 않습니다 - 새 회차는 새 행으로 만듭니다 (REG1-05)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.local_events_guard() from public, anon, authenticated;
create trigger local_events_guard
  before insert or update on public.local_events
  for each row execute function public.local_events_guard();
create trigger local_events_touch
  before update on public.local_events
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 상태 이력 (LG-12) — 추가만
-- ─────────────────────────────────────────────────────────────
create table public.event_status_history (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.local_events (id),
  from_state text not null check (from_state in ('normal', 'cancelled', 'changing')),
  to_state text not null check (to_state in ('normal', 'cancelled', 'changing')),
  source_url text,
  confirmed_at timestamptz,
  changed_by text not null,
  created_at timestamptz not null default now()
);
comment on table public.event_status_history is '행사 지정 상태 변경 이력 (LG-12) — 이전·이후 상태·근거 주소·확인 시각·변경자. 추가만 (트리거가 쓴다)';
create index event_status_history_event_idx on public.event_status_history (event_id, id);

create function public.local_events_status_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status_override is not null then
      insert into public.event_status_history (event_id, from_state, to_state, source_url, confirmed_at, changed_by)
      values (new.id, 'normal', new.status_override, new.status_source_url, new.status_confirmed_at, new.edited_by);
    end if;
  elsif new.status_override is distinct from old.status_override then
    insert into public.event_status_history (event_id, from_state, to_state, source_url, confirmed_at, changed_by)
    values (new.id, coalesce(old.status_override, 'normal'), coalesce(new.status_override, 'normal'), new.status_source_url, new.status_confirmed_at, new.edited_by);
  end if;
  return null;
end;
$$;
revoke all on function public.local_events_status_history() from public, anon, authenticated;
create trigger local_events_status_history
  after insert or update on public.local_events
  for each row execute function public.local_events_status_history();

create trigger event_status_history_no_change
  before update or delete on public.event_status_history
  for each row execute function public.append_only_guard();
create trigger event_status_history_no_truncate
  before truncate on public.event_status_history
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 연결 (LG-14)
-- ─────────────────────────────────────────────────────────────
create table public.event_links (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.local_events (id),
  target_kind text not null check (target_kind in ('project', 'article')),
  target_id bigint not null check (target_id > 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  confirmed_by text not null check (length(btrim(confirmed_by)) > 0),
  confirmed_at timestamptz not null default now(),
  constraint event_links_unique unique (event_id, target_kind, target_id)
);
comment on table public.event_links is '행사 연결 (LG-14) — 행 하나 = 편집자가 확인한 연결(프로젝트·기사). 공개 뷰는 대상이 공개 중일 때만 보인다';

create function public.event_links_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.target_kind = 'project' and not exists (select 1 from public.projects p where p.id = new.target_id))
     or (new.target_kind = 'article' and not exists (select 1 from public.articles a where a.id = new.target_id)) then
    raise exception '연결 대상이 없습니다 (% %)', new.target_kind, new.target_id using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.event_links_guard() from public, anon, authenticated;
create trigger event_links_guard
  before insert on public.event_links
  for each row execute function public.event_links_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.local_events enable row level security;
alter table public.event_status_history enable row level security;
alter table public.event_links enable row level security;
revoke all on table public.local_events, public.event_status_history, public.event_links from anon, authenticated, service_role;
grant select, insert, update on table public.local_events to service_role;
grant select on table public.event_status_history to service_role;
grant select, insert, delete on table public.event_links to service_role;

-- 상태: 취소·변경 확인 중은 지정값, 나머지는 현재 시각으로 예정·진행·종료. 재확인 필요 = 확인일 + N일이 오늘(한국)보다 이른 때
create view public.public_local_events as
select e.id, e.slug, e.series_key, e.title, e.category, e.organizer, e.organizer_type, e.venue, e.region_code,
       e.starts_at, e.ends_at, e.official_url, e.source_name, e.confirmed_on, e.sponsored,
       e.status_source_url, e.status_confirmed_at,
       case e.status_override
         when 'cancelled' then 'cancelled'
         when 'changing' then 'changing'
         else case when now() < e.starts_at then 'upcoming' when now() <= e.ends_at then 'ongoing' else 'ended' end
       end as status,
       (e.confirmed_on + coalesce((select (s.value ->> 'days')::int from public.settings s where s.key = 'event_recheck' and jsonb_typeof(s.value) = 'object'), 7)
          < (now() at time zone 'Asia/Seoul')::date) as recheck_due,
       coalesce((select (s.value ->> 'hide_stale')::boolean from public.settings s where s.key = 'event_recheck' and jsonb_typeof(s.value) = 'object'), false) as hide_stale
  from public.local_events e
 where e.published
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'local_events') = 'true'::jsonb);

create view public.public_event_links as
select l.id, l.event_id, l.target_kind, l.target_id, l.reason,
       coalesce(p.name, a.title) as target_label,
       coalesce(p.slug, a.slug) as target_slug
  from public.event_links l
  join public.public_local_events e on e.id = l.event_id
  left join public.public_projects p on l.target_kind = 'project' and p.id = l.target_id
  left join public.public_articles a on l.target_kind = 'article' and a.id = l.target_id
 where p.id is not null or a.id is not null;

revoke all on table public.public_local_events, public.public_event_links from public, anon, authenticated, service_role;
grant select on table public.public_local_events, public.public_event_links to anon, authenticated, service_role;
