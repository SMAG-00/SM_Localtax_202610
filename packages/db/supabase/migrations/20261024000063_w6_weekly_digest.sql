-- W6 1단계 — 금주 핫뉴스 (PRD-01B LG-01 · LG-02 · LG-03 · LG-05 · LG-06, docs/dev/W6_설계.md 1장 1단계 · 2장 · 12장)
-- 이 파일에 실제 보도자료·행사·법령 내용은 없다. 표 틀·검사·공개 뷰만 정한다. 씨앗 행 0 (설정 기본값만).
-- · 설정 digest_sidos([]) · digest_summary_max_chars(300) · digest_sources([]) — 저장 검사 포함. 공개 읽기 정책에는 넣지 않는다.
-- · 기능 키 weekly_digest(W4부터 꺼진 채) — 켜기는 digest_sidos가 시·도 2곳 이상일 때만 (PRD_최종 §13 #7).
-- · ISO 8601 주 함수 iso_week_key(date) · iso_week_start(text) — 존재하지 않는 주(2027-53)는 null.
-- · hot_news_candidates(후보) — 조회수·클릭 칸 없음. 허용 근거가 설정에 있는 출처만, 같은 원문 주소는 한 번만 (LG-05).
-- · weekly_digests(주간 페이지) + digest_items(항목) — 발행은 항목 1건 이상·유사도 통과 기록(요약 해시 일치)·수치 확인이 모두 있어야 한다 (LG-02·03).
--     발행된 주는 되돌리지 않고(주소 영속), 그 주의 항목은 기획 전환 연결(assignment_id) 말고는 고치지 못한다.
-- · digest_item_to_assignment — 항목 → 기사 기획 카드(idea) 한 번만 (LG-06).
-- · 공개 뷰 public_weekly_digests · public_digest_items — 키 weekly_digest가 켜졌을 때만 행이 보인다. 유사도·원문·기획 번호 칸 0.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (articles.digest_id 외래 키는 더하지 않는다 — 주간 페이지는 기사 행이 아니다, 설계 12장 #3).

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('digest_sidos',
   '[]'::jsonb,
   '금주 핫뉴스를 내는 시·도 코드 목록 (LG-01 · PRD_최종 §13 #7) — 법정동코드 10자리 시·도. 이 목록의 시·도만 주간 페이지를 발행할 수 있고, 2곳 이상이어야 기능 키 weekly_digest를 켤 수 있다',
   'migration:20261024000063'),
  ('digest_summary_max_chars',
   '300'::jsonb,
   '핫뉴스 항목 요약 길이 상한(글자) (LG-02) — 50~2000. 초기값은 편집국 초안',
   'migration:20261024000063'),
  ('digest_sources',
   '[]'::jsonb,
   '핫뉴스 후보를 받을 수 있는 출처 목록 (LG-05) — [{ "id": 영문 소문자·숫자·밑줄, "name": 출처 이름, "host": 도메인, "kind": "rss" 또는 "board", "basis": 허용 근거(약관·robots 확인 내용), "checked_on": 확인일 YYYY-MM-DD }]. 허용 근거와 확인일이 없는 출처의 후보는 저장되지 않는다',
   'migration:20261024000063')
on conflict (key) do nothing;

create function public.digest_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_ids text[] := '{}';
begin
  if new.key = 'digest_sidos' then
    if jsonb_typeof(new.value) is distinct from 'array' then
      raise exception '핫뉴스 시·도 목록(digest_sidos)은 시·도 코드 배열입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string'
         or not exists (select 1 from public.regions r where r.code = (v_item #>> '{}') and r.level = 'sido') then
        raise exception '핫뉴스 시·도 목록(digest_sidos)의 값은 등록된 시·도 코드(10자리)여야 합니다 (지금 %)', v_item using errcode = 'check_violation';
      end if;
      if (v_item #>> '{}') = any (v_ids) then
        raise exception '핫뉴스 시·도 목록(digest_sidos)에 같은 시·도가 두 번 있습니다 (%)', v_item using errcode = 'check_violation';
      end if;
      v_ids := v_ids || (v_item #>> '{}');
    end loop;
  elsif new.key = 'digest_summary_max_chars' then
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]+$' or (new.value #>> '{}')::int not between 50 and 2000 then
      raise exception '핫뉴스 요약 길이 상한(digest_summary_max_chars)은 50~2000 사이의 정수입니다' using errcode = 'check_violation';
    end if;
  elsif new.key = 'digest_sources' then
    if jsonb_typeof(new.value) is distinct from 'array' then
      raise exception '핫뉴스 출처 목록(digest_sources)은 배열입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or coalesce(v_item ->> 'id', '') !~ '^[a-z0-9_]{2,30}$'
         or char_length(btrim(coalesce(v_item ->> 'name', ''))) not between 1 and 60
         or char_length(btrim(coalesce(v_item ->> 'host', ''))) not between 3 and 100
         or coalesce(v_item ->> 'kind', '') not in ('rss', 'board')
         or char_length(btrim(coalesce(v_item ->> 'basis', ''))) not between 1 and 200
         or coalesce(v_item ->> 'checked_on', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception '핫뉴스 출처(digest_sources)는 { id, name, host, kind(rss·board), basis(허용 근거), checked_on(YYYY-MM-DD) }가 모두 있어야 합니다 (LG-05)' using errcode = 'check_violation';
      end if;
      if (v_item ->> 'id') = any (v_ids) then
        raise exception '핫뉴스 출처(digest_sources)의 id가 겹칩니다 (%)', v_item ->> 'id' using errcode = 'check_violation';
      end if;
      v_ids := v_ids || (v_item ->> 'id');
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.digest_settings_guard() from public, anon, authenticated;
create trigger settings_digest_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('digest_sidos', 'digest_summary_max_chars', 'digest_sources'))
  execute function public.digest_settings_guard();

-- 기능 키 켜기 — 시·도 2곳 이상. 끄기·이미 켜진 값은 검사하지 않는다
create function public.weekly_digest_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sidos jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'weekly_digest') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'weekly_digest') is distinct from 'true'::jsonb) then
    select s.value into v_sidos from public.settings s where s.key = 'digest_sidos';
    if jsonb_typeof(v_sidos) is distinct from 'array' or jsonb_array_length(v_sidos) < 2 then
      raise exception '금주 핫뉴스(weekly_digest)는 설정 digest_sidos에 시·도가 2곳 이상 있어야 켭니다 (LG-01 · PRD_최종 §13 #7)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.weekly_digest_flag_guard() from public, anon, authenticated;
create trigger settings_weekly_digest_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.weekly_digest_flag_guard();

-- ─────────────────────────────────────────────────────────────
-- ISO 8601 주 (월요일 시작) — 주차 문자열 'YYYY-WW'
-- ─────────────────────────────────────────────────────────────
create function public.iso_week_key(d date) returns text
language sql
immutable
set search_path = ''
as $$ select to_char(d, 'IYYY-IW') $$;

-- 주차 문자열 → 그 주의 월요일. 형식이 틀리거나 존재하지 않는 주(예: 2027-53)면 null
create function public.iso_week_start(k text) returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_year int;
  v_week int;
  v_jan4 date;
  v_monday date;
begin
  if k is null or k !~ '^[0-9]{4}-[0-9]{2}$' then
    return null;
  end if;
  v_year := substr(k, 1, 4)::int;
  v_week := substr(k, 6, 2)::int;
  if v_year < 2000 or v_week < 1 or v_week > 53 then
    return null;
  end if;
  v_jan4 := make_date(v_year, 1, 4);
  v_monday := v_jan4 - (extract(isodow from v_jan4)::int - 1) + (v_week - 1) * 7;
  if to_char(v_monday, 'IYYY-IW') <> k then
    return null;
  end if;
  return v_monday;
end;
$$;
revoke all on function public.iso_week_key(date), public.iso_week_start(text) from public, anon, authenticated;
grant execute on function public.iso_week_key(date), public.iso_week_start(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 후보 (LG-05)
-- ─────────────────────────────────────────────────────────────
create table public.hot_news_candidates (
  id bigint generated always as identity primary key,
  sido_code text not null references public.regions (code),
  region_code text not null references public.regions (code),
  source_id text not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  press_org text not null check (char_length(btrim(press_org)) between 1 and 80),
  announced_at timestamptz not null,
  source_url text not null unique check (source_url ~* '^https?://[^[:space:]]+$'),
  license_type text not null default 'unknown' check (license_type in ('kogl1', 'kogl2', 'kogl3', 'kogl4', 'none', 'unknown')),
  original_text text check (original_text is null or char_length(original_text) <= 20000),
  status text not null default 'new' check (status in ('new', 'selected', 'dismissed')),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hot_news_candidates is '핫뉴스 후보 (LG-05) — 조회수·클릭 칸 없음(정렬은 발표 시각뿐), 출처는 설정 digest_sources의 허용 근거가 있어야 하고 같은 원문 주소는 한 번만. 공개 전 공개 0. original_text는 유사도 비교용 내부 칸';
create index hot_news_candidates_order_idx on public.hot_news_candidates (status, announced_at desc);

create function public.hot_news_candidates_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src jsonb;
begin
  if tg_op = 'INSERT' then
    select e into v_src
      from jsonb_array_elements(case when jsonb_typeof((select s.value from public.settings s where s.key = 'digest_sources')) = 'array'
                                     then (select s.value from public.settings s where s.key = 'digest_sources') else '[]'::jsonb end) as t(e)
     where e ->> 'id' = new.source_id
     limit 1;
    if v_src is null or coalesce(btrim(v_src ->> 'basis'), '') = '' or coalesce(v_src ->> 'checked_on', '') = '' then
      raise exception '수집 허용 근거(약관·robots 확인일)가 설정 digest_sources에 없는 출처입니다 (%) - 후보를 받지 않습니다 (LG-05)', new.source_id
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (select 1 from public.regions r where r.code = new.sido_code and r.level = 'sido') then
    raise exception '후보의 sido_code는 시·도 코드여야 합니다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.regions r where r.code = new.region_code and (r.code = new.sido_code or r.parent_code = new.sido_code)) then
    raise exception '후보의 지역 코드는 그 시·도 또는 그 아래 시·군·구여야 합니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.hot_news_candidates_guard() from public, anon, authenticated;
create trigger hot_news_candidates_guard
  before insert or update on public.hot_news_candidates
  for each row execute function public.hot_news_candidates_guard();
create trigger hot_news_candidates_touch
  before update on public.hot_news_candidates
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 주간 페이지 (LG-01)
-- ─────────────────────────────────────────────────────────────
create table public.weekly_digests (
  id bigint generated always as identity primary key,
  sido_code text not null references public.regions (code),
  week_key text not null check (week_key ~ '^[0-9]{4}-[0-9]{2}$'),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by text check (published_by is null or length(btrim(published_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weekly_digests_unique unique (sido_code, week_key),
  constraint weekly_digests_published_record check ((status = 'published') = (published_at is not null and published_by is not null))
);
comment on table public.weekly_digests is '시·도별 주간 핫뉴스 페이지 (LG-01) — ISO 8601 주(월요일 시작, 한국 날짜). 존재하지 않는 주 거부, 발행은 항목·유사도·수치 확인 검사 뒤에만, 발행 뒤 되돌리지 않는다(주소 영속)';

create function public.weekly_digests_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_n int;
  r record;
begin
  if tg_op = 'INSERT' then
    v_start := public.iso_week_start(new.week_key);
    if v_start is null then
      raise exception '존재하지 않는 주입니다 (%) - ISO 8601 주차(YYYY-WW)가 아닙니다', new.week_key using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.regions g where g.code = new.sido_code and g.level = 'sido') then
      raise exception '주간 페이지의 sido_code는 시·도 코드여야 합니다' using errcode = 'check_violation';
    end if;
    if new.status <> 'draft' then
      raise exception '주간 페이지는 초안으로 만들고 항목 검사를 거쳐 발행합니다' using errcode = 'check_violation';
    end if;
    new.starts_on := v_start;
    new.ends_on := v_start + 6;
    new.published_at := null;
    new.published_by := null;
    return new;
  end if;

  if (new.sido_code, new.week_key, new.starts_on, new.ends_on) is distinct from (old.sido_code, old.week_key, old.starts_on, old.ends_on) then
    raise exception '주간 페이지의 시·도와 주차는 고칠 수 없습니다' using errcode = 'check_violation';
  end if;
  if old.status = 'published' then
    if (new.status, new.published_at, new.published_by) is distinct from (old.status, old.published_at, old.published_by) then
      raise exception '발행된 주간 페이지는 되돌리거나 발행 기록을 고칠 수 없습니다 (주소 영속)' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status = 'published' then
    if not coalesce((select s.value @> to_jsonb(new.sido_code) from public.settings s where s.key = 'digest_sidos'), false) then
      raise exception '이 시·도는 설정 digest_sidos에 없어 주간 페이지를 발행할 수 없습니다 (LG-01)' using errcode = 'check_violation';
    end if;
    select count(*) into v_n from public.digest_items i where i.digest_id = new.id;
    if v_n = 0 then
      raise exception '항목이 0건인 주는 발행할 수 없습니다 (LG-01)' using errcode = 'check_violation';
    end if;
    for r in select i.id, i.summary, i.sim_status, i.sim_checked_hash, i.figures_checked from public.digest_items i where i.digest_id = new.id order by i.id loop
      if r.sim_status is distinct from 'pass' or r.sim_checked_hash is distinct from md5(r.summary) then
        raise exception '항목 %: 유사도 검사 통과 기록이 없거나 요약이 검사 뒤에 바뀌었습니다 - 다시 검사하세요 (LG-03)', r.id using errcode = 'check_violation';
      end if;
      if r.summary ~ '[0-9]' and not r.figures_checked then
        raise exception '항목 %: 요약의 수치를 원문과 대조했다는 편집자 확인이 필요합니다 (LG-02)', r.id using errcode = 'check_violation';
      end if;
    end loop;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.weekly_digests_guard() from public, anon, authenticated;
create trigger weekly_digests_guard
  before insert or update on public.weekly_digests
  for each row execute function public.weekly_digests_guard();
create trigger weekly_digests_touch
  before update on public.weekly_digests
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 항목 (LG-02 · LG-03 · LG-06)
-- ─────────────────────────────────────────────────────────────
create table public.digest_items (
  id bigint generated always as identity primary key,
  digest_id bigint not null references public.weekly_digests (id),
  candidate_id bigint unique references public.hot_news_candidates (id),
  region_code text not null references public.regions (code),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source_url text not null check (source_url ~* '^https?://[^[:space:]]+$'),
  press_org text not null check (char_length(btrim(press_org)) between 1 and 80),
  announced_on date not null,
  license_type text not null default 'unknown' check (license_type in ('kogl1', 'kogl2', 'kogl3', 'kogl4', 'none', 'unknown')),
  summary text not null check (char_length(btrim(summary)) >= 1),
  figures_checked boolean not null default false,
  original_text text check (original_text is null or char_length(original_text) <= 20000),
  sim_status text check (sim_status is null or sim_status in ('pass', 'blocked', 'no_sources', 'no_body')),
  sim_max numeric check (sim_max is null or (sim_max >= 0 and sim_max <= 1)),
  sim_ratio numeric check (sim_ratio is null or (sim_ratio >= 0 and sim_ratio <= 1)),
  sim_matches jsonb not null default '[]'::jsonb,
  sim_rules_version text,
  sim_checked_hash text,
  sim_checked_at timestamptz,
  assignment_id bigint unique references public.story_assignments (id),
  position int not null default 0,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.digest_items is '핫뉴스 항목 (LG-02·03) — 원문 주소·발표기관·발표일·편집자 요약. 원문을 전재하지 않는다. sim_*는 유사도 검사 결과(발행은 sim_status pass + sim_checked_hash = md5(summary)일 때만). original_text는 비교용 내부 칸(공개 뷰에 없음)';
create index digest_items_digest_idx on public.digest_items (digest_id, position, id);

create function public.digest_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.weekly_digests;
  v_max int;
begin
  if tg_op = 'DELETE' then
    select * into d from public.weekly_digests w where w.id = old.digest_id;
    if d.status = 'published' then
      raise exception '발행된 주간 페이지의 항목은 지울 수 없습니다' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  select * into d from public.weekly_digests w where w.id = new.digest_id;
  if tg_op = 'UPDATE' then
    if new.digest_id <> old.digest_id then
      raise exception '항목을 다른 주로 옮길 수 없습니다 - 지우고 새로 만드세요' using errcode = 'check_violation';
    end if;
    if d.status = 'published' then
      if (to_jsonb(new) - 'assignment_id' - 'updated_at') is distinct from (to_jsonb(old) - 'assignment_id' - 'updated_at') then
        raise exception '발행된 주간 페이지의 항목은 고칠 수 없습니다 (기획 전환 연결만 가능)' using errcode = 'check_violation';
      end if;
      return new;
    end if;
  elsif d.status = 'published' then
    raise exception '발행된 주간 페이지에는 항목을 더할 수 없습니다' using errcode = 'check_violation';
  end if;

  if new.announced_on < d.starts_on or new.announced_on > d.ends_on then
    raise exception '발표일(%)이 이 주(% ~ %) 밖입니다 - 발표일이 속한 주의 페이지에 넣습니다 (LG-01)', new.announced_on, d.starts_on, d.ends_on using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.regions r where r.code = new.region_code and (r.code = d.sido_code or r.parent_code = d.sido_code)) then
    raise exception '항목의 지역 코드는 이 주간 페이지의 시·도 또는 그 아래 시·군·구여야 합니다' using errcode = 'check_violation';
  end if;
  select coalesce((select (s.value #>> '{}')::int from public.settings s where s.key = 'digest_summary_max_chars' and jsonb_typeof(s.value) = 'number'), 300) into v_max;
  if char_length(btrim(new.summary)) > v_max then
    raise exception '요약이 길이 상한(%자)을 넘습니다 (지금 %자) - 원문을 옮기지 말고 줄여 쓰세요 (LG-02)', v_max, char_length(btrim(new.summary)) using errcode = 'check_violation';
  end if;
  -- 요약을 고쳤는데 유사도 기록을 새로 쓰지 않았다면 이전 기록은 무효 — 지운다
  if tg_op = 'UPDATE' and new.summary is distinct from old.summary and new.sim_checked_hash is not distinct from old.sim_checked_hash then
    new.sim_status := null;
    new.sim_max := null;
    new.sim_ratio := null;
    new.sim_matches := '[]'::jsonb;
    new.sim_rules_version := null;
    new.sim_checked_hash := null;
    new.sim_checked_at := null;
    new.figures_checked := false;
  end if;
  return new;
end;
$$;
revoke all on function public.digest_items_guard() from public, anon, authenticated;
create trigger digest_items_guard
  before insert or update or delete on public.digest_items
  for each row execute function public.digest_items_guard();
create trigger digest_items_touch
  before update on public.digest_items
  for each row execute function public.touch_updated_at();

-- 항목 → 기사 기획 카드 (LG-06) — 이미 전환된 항목이면 기존 카드를 돌려준다
create function public.digest_item_to_assignment(p_item bigint, p_actor text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.digest_items;
  v_id bigint;
begin
  select * into i from public.digest_items x where x.id = p_item for update;
  if not found then
    raise exception '그런 핫뉴스 항목이 없습니다' using errcode = 'no_data_found';
  end if;
  if i.assignment_id is not null then
    return i.assignment_id;
  end if;
  insert into public.story_assignments (section, region_code, hypothesis, kind, status, updated_by)
  values ('local', i.region_code, i.title, 'general', 'idea', p_actor)
  returning id into v_id;
  update public.digest_items set assignment_id = v_id where id = i.id;
  return v_id;
end;
$$;
revoke all on function public.digest_item_to_assignment(bigint, text) from public, anon, authenticated;
grant execute on function public.digest_item_to_assignment(bigint, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.hot_news_candidates enable row level security;
alter table public.weekly_digests enable row level security;
alter table public.digest_items enable row level security;
revoke all on table public.hot_news_candidates, public.weekly_digests, public.digest_items from anon, authenticated, service_role;
grant select, insert, update on table public.hot_news_candidates to service_role;
grant select, insert, update on table public.weekly_digests to service_role;
grant select, insert, update, delete on table public.digest_items to service_role;

create view public.public_weekly_digests as
select w.id, w.sido_code, w.week_key, w.starts_on, w.ends_on, w.published_at
  from public.weekly_digests w
 where w.status = 'published'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'weekly_digest') = 'true'::jsonb);

create view public.public_digest_items as
select i.id, i.digest_id, i.region_code, i.title, i.source_url, i.press_org, i.announced_on, i.license_type, i.summary, i.position
  from public.digest_items i
  join public.weekly_digests w on w.id = i.digest_id and w.status = 'published'
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'weekly_digest') = 'true'::jsonb);

revoke all on table public.public_weekly_digests, public.public_digest_items from public, anon, authenticated, service_role;
grant select on table public.public_weekly_digests, public.public_digest_items to anon, authenticated, service_role;
