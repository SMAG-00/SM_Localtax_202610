-- W10-g - 교육원 강좌 표시 · 위탁교육 견적 · 세미나 (PRD-02 BIZ-06 + 세미나·웨비나, docs/dev/2단계_설계.md 5.1 #27 #28, docs/dev/W10-g_설계.md)
-- 결정 #27 "연결로 시작": 결제·수료증은 교육원 사이트가 맡는다. 이 파일에는 결제·정원·수강 등록·수료증 표가 없다 (course_enrollments · certificates 0).
-- 이 파일에 실제 동의 문구·보관 기간 확정값·강좌·세미나 내용은 없다. 표 틀·검사·함수·공개 뷰만 정한다. 씨앗 행 0 (정책 기본값 하나만, 승인 전).
-- · 강좌·회차·세미나는 출처·확인일이 있어야 공개된다 (EDU-01). 신청은 official_links(kind edu_site)의 주소로 나가고 주 1회 점검 대상이다 (BIZ-06).
-- · 견적 요청(training_quotes)은 service_role만 읽고 쓴다. 결제 칸 0. 동의 버전·시각 없으면 저장 거부, 보관 기간(기본 365일 [법률 검토]) 뒤 개인 칸 파기, 철회는 즉시 파기.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (official_links 종류 제약은 값만 늘린 같은 이름 제약으로 바꾼다).

-- ─────────────────────────────────────────────────────────────
-- official_links 종류 확장 - edu_site (W10-b 마이그레이션 84가 이미 넣었으면 건너뛴다. 기존 값은 제약 정의에서 읽어 그대로 이어 붙인다)
-- ─────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_kinds text[];
begin
  for r in
    select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.conrelid = 'public.official_links'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%sm_calculator%'
  loop
    if r.def not like '%edu_site%' then
      select array_agg(m[1]) into v_kinds from regexp_matches(r.def, '''([a-z_]+)''', 'g') as m;
      execute format('alter table public.official_links drop constraint %I', r.conname);
      execute format('alter table public.official_links add constraint %I check (kind in (%s))', r.conname,
                     (select string_agg(quote_literal(k), ', ') from unnest(v_kinds || array['edu_site']) as k));
    end if;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사 - 견적 요청 정책
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('training_quote_policy',
   jsonb_build_object(
     'retention_days', 365, 'target_business_days', 3, 'message_max_chars', 1000,
     'consent_version', '', 'intro', '[]'::jsonb, 'consent_items', '[]'::jsonb,
     'approved', false, 'reviewed_by', null, 'reviewed_on', null, 'legal_review_ref', ''),
   '위탁교육 견적 요청 정책 (BIZ-06) - retention_days: 보관 기간(30~1825, 기본 365는 권고 기본값이며 [법률 검토] 전 확정 아님), target_business_days: 첫 회신 목표 영업일(1~10), message_max_chars: 문의 내용 상한(100~2000), consent_version·intro·consent_items는 법률 검토본만 넣는다. approved=true는 법률 검토 기록이 있어야 하고, 승인 전에는 기능 키 education_billing을 켜지 못한다. 씨앗은 비어 있다',
   'migration:20261025000098')
on conflict (key) do nothing;

create function public.training_quote_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[] := array['retention_days', 'target_business_days', 'message_max_chars', 'consent_version', 'intro', 'consent_items', 'approved', 'reviewed_by', 'reviewed_on', 'legal_review_ref'];
  v_item jsonb;
  k text;
begin
  if jsonb_typeof(new.value) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(new.value) x where x <> all (v_keys))
     or exists (select 1 from unnest(v_keys) x where not (new.value ? x)) then
    raise exception '견적 요청 정책(training_quote_policy)의 칸은 % 입니다', array_to_string(v_keys, ' · ') using errcode = 'check_violation';
  end if;
  foreach k in array array['retention_days', 'target_business_days', 'message_max_chars'] loop
    if jsonb_typeof(new.value -> k) is distinct from 'number' or (new.value ->> k) !~ '^[0-9]+$' then
      raise exception '견적 요청 정책의 %는 정수입니다', k using errcode = 'check_violation';
    end if;
  end loop;
  if (new.value ->> 'retention_days')::int not between 30 and 1825
     or (new.value ->> 'target_business_days')::int not between 1 and 10
     or (new.value ->> 'message_max_chars')::int not between 100 and 2000 then
    raise exception '견적 요청 정책의 범위 - retention_days 30~1825 · target_business_days 1~10 · message_max_chars 100~2000' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.value -> 'consent_version') is distinct from 'string'
     or jsonb_typeof(new.value -> 'approved') is distinct from 'boolean'
     or jsonb_typeof(new.value -> 'legal_review_ref') is distinct from 'string'
     or jsonb_typeof(new.value -> 'intro') is distinct from 'array' or jsonb_array_length(new.value -> 'intro') > 6
     or jsonb_typeof(new.value -> 'consent_items') is distinct from 'array' or jsonb_array_length(new.value -> 'consent_items') > 6 then
    raise exception '견적 요청 정책의 글자·배열 칸 모양이 틀렸습니다 (intro·consent_items는 6개 이하 배열)' using errcode = 'check_violation';
  end if;
  for v_item in select x.value from jsonb_array_elements((new.value -> 'intro') || (new.value -> 'consent_items')) as x loop
    if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 300 then
      raise exception '안내 문단·동의 항목은 1~300자 글자여야 합니다' using errcode = 'check_violation';
    end if;
  end loop;
  if (new.value -> 'approved') = 'true'::jsonb
     and (char_length(btrim(new.value ->> 'consent_version')) = 0
          or jsonb_array_length(new.value -> 'intro') = 0 or jsonb_array_length(new.value -> 'consent_items') = 0
          or char_length(btrim(coalesce(new.value ->> 'reviewed_by', ''))) = 0
          or coalesce(new.value ->> 'reviewed_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
          or char_length(btrim(new.value ->> 'legal_review_ref')) = 0) then
    raise exception '견적 요청 정책 승인에는 동의 버전·안내 문단·동의 항목·검토자·검토일과 법률 검토 기록 번호가 모두 필요합니다 (BIZ-06)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.training_quote_settings_guard() from public, anon, authenticated;
create trigger settings_training_quote_settings_guard
  before insert or update on public.settings
  for each row when (new.key = 'training_quote_policy')
  execute function public.training_quote_settings_guard();

-- 기능 키 켜기 - education_billing(견적 요청)은 edu가 같이 켜져 있고 정책이 승인돼 있어야 하고, seminars는 edu가 같이 켜져 있어야 한다
create function public.education_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_was boolean;
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    return new;
  end if;
  if (new.value -> 'education_billing') = 'true'::jsonb then
    v_was := tg_op = 'UPDATE' and jsonb_typeof(old.value) = 'object' and (old.value -> 'education_billing') = 'true'::jsonb;
    if not v_was then
      if (new.value -> 'edu') is distinct from 'true'::jsonb then
        raise exception '위탁교육 견적 요청(education_billing)은 교육(edu)이 같이 켜져 있어야 합니다' using errcode = 'check_violation';
      end if;
      select s.value into v_policy from public.settings s where s.key = 'training_quote_policy';
      if jsonb_typeof(v_policy) is distinct from 'object' or (v_policy -> 'approved') is distinct from 'true'::jsonb then
        raise exception '위탁교육 견적 요청(education_billing)은 설정 training_quote_policy에 법률 검토 기록이 있는 승인이 있어야 켭니다 (BIZ-06)' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  if (new.value -> 'seminars') = 'true'::jsonb then
    v_was := tg_op = 'UPDATE' and jsonb_typeof(old.value) = 'object' and (old.value -> 'seminars') = 'true'::jsonb;
    if not v_was and (new.value -> 'edu') is distinct from 'true'::jsonb then
      raise exception '세미나(seminars)는 교육(edu)이 같이 켜져 있어야 합니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.education_flag_guard() from public, anon, authenticated;
create trigger settings_education_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.education_flag_guard();

-- ─────────────────────────────────────────────────────────────
-- 강좌 · 회차 (EDU-01 - 출처·확인일이 있는 일정만, 결제·정원 칸 없음)
-- ─────────────────────────────────────────────────────────────
create function public.edu_apply_link_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.apply_link_id is not null
     and not exists (select 1 from public.official_links l where l.id = new.apply_link_id and l.kind = 'edu_site') then
    raise exception '신청 안내 링크는 바깥 연결 종류 edu_site인 행이어야 합니다 (BIZ-06 - 점검 대상)' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.edu_apply_link_guard() from public, anon, authenticated;

create table public.courses (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug not in ('quote', 'seminars')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 500),
  audience text not null default '' check (char_length(audience) <= 120),
  provider_name text not null check (char_length(btrim(provider_name)) between 1 and 80),
  apply_link_id bigint references public.official_links (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'stopped')),
  verified_on date,
  verified_ref text check (verified_ref is null or char_length(verified_ref) <= 200),
  edited_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_verified check (status <> 'published' or (verified_on is not null and char_length(btrim(coalesce(verified_ref, ''))) > 0))
);
comment on table public.courses is '교육원 강좌 안내 (EDU-01 · BIZ-06) - 결제·정원·수강 등록 칸 없음(연결 방식 - 결제·수료증은 교육원 사이트). 공개는 출처·확인일이 있는 published만';
create trigger courses_guard before insert or update on public.courses for each row execute function public.edu_apply_link_guard();

create table public.course_sessions (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  starts_on date not null,
  ends_on date,
  mode text not null check (mode in ('onsite', 'online', 'blended')),
  location_name text check (location_name is null or char_length(location_name) <= 120),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  verified_on date not null,
  verified_ref text not null check (char_length(btrim(verified_ref)) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint course_sessions_range check (ends_on is null or ends_on >= starts_on)
);
comment on table public.course_sessions is '강좌 회차 (EDU-01) - 출처·확인일이 없는 일정은 저장 불가. 정원·신청 인원 칸 없음';
create index course_sessions_course_idx on public.course_sessions (course_id, starts_on);

-- ─────────────────────────────────────────────────────────────
-- 세미나·웨비나 (PRD-02 4.14 메모 - 협찬 표기·연사 이해관계 공개, 신청은 바깥 링크)
-- ─────────────────────────────────────────────────────────────
create table public.seminars (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 500),
  topic text not null check (topic in ('amendment', 'dev_finance')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null check (mode in ('onsite', 'online', 'blended')),
  venue_name text check (venue_name is null or char_length(venue_name) <= 120),
  organizer_name text not null check (char_length(btrim(organizer_name)) between 1 and 80),
  sponsored boolean not null default false,
  sponsor_name text check (sponsor_name is null or char_length(sponsor_name) <= 80),
  speaker_disclosure text not null default '' check (char_length(speaker_disclosure) <= 500),
  apply_link_id bigint references public.official_links (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'changing')),
  verified_on date,
  verified_ref text check (verified_ref is null or char_length(verified_ref) <= 200),
  edited_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seminars_range check (ends_at >= starts_at),
  constraint seminars_published check (
    status = 'draft'
    or (verified_on is not null and char_length(btrim(coalesce(verified_ref, ''))) > 0
        and char_length(btrim(speaker_disclosure)) > 0
        and (not sponsored or char_length(btrim(coalesce(sponsor_name, ''))) > 0)))
);
comment on table public.seminars is '세미나·웨비나 안내 - 연사 이해관계 공개(비어 있으면 공개 불가)·협찬이면 협찬자 표기. 결제·신청 인원 칸 없음 (연결 방식)';
create trigger seminars_guard before insert or update on public.seminars for each row execute function public.edu_apply_link_guard();

-- ─────────────────────────────────────────────────────────────
-- 위탁교육 견적 요청 (BIZ-06) - 결제 칸 0, 동의 기록, 보관 기간 뒤 파기
-- ─────────────────────────────────────────────────────────────
create table public.training_quotes (
  id bigint generated always as identity primary key,
  receipt_no text not null unique default ('TQ-' || upper(substr(md5(random()::text || clock_timestamp()::text || txid_current()::text), 1, 8))),
  org_name text,
  org_type text not null check (org_type in ('public', 'corporate', 'association', 'other')),
  contact_name text,
  phone text,
  email text,
  course_id bigint references public.courses (id) on delete set null,
  course_text text check (course_text is null or char_length(course_text) <= 100),
  headcount integer not null check (headcount between 1 and 100000),
  preferred_period text check (preferred_period is null or char_length(preferred_period) <= 100),
  message text,
  consent_version text not null check (char_length(btrim(consent_version)) between 1 and 40),
  consented_at timestamptz not null,
  status text not null default 'received' check (status in ('received', 'contacted', 'closed')),
  close_reason text check (close_reason in ('quoted', 'declined', 'unreachable', 'withdrawn')),
  purge_at date not null,
  purged_at timestamptz,
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_quotes_course check (course_id is not null or char_length(btrim(coalesce(course_text, ''))) > 0 or purged_at is not null),
  constraint training_quotes_personal check (
    (purged_at is null and org_name is not null and contact_name is not null and (phone is not null or email is not null))
    or (purged_at is not null and org_name is null and contact_name is null and phone is null and email is null and message is null)),
  constraint training_quotes_closed check ((status = 'closed') = (close_reason is not null))
);
comment on table public.training_quotes is '위탁교육 견적 요청 (BIZ-06) - service_role 전용. 결제·금액 칸 없음, 동의 버전·시각 필수, purge_at(마지막 보관일)이 지나면 기관명·담당자·연락처·내용을 파기하고 통계 칸(유형·인원·과정·상태)만 남는다. 공개 뷰·색인·도우미가 읽지 않는다';
comment on column public.training_quotes.purge_at is '마지막 보관일(한국 날짜) - 당일까지 보존, 다음 날 파기 [법률 검토: 보관 기간]';
create index training_quotes_status_idx on public.training_quotes (status, created_at);
create index training_quotes_purge_idx on public.training_quotes (purge_at) where purged_at is null;

create function public.training_quotes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_rank_old integer;
  v_rank_new integer;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    select s.value into v_policy from public.settings s where s.key = 'training_quote_policy';
    if jsonb_typeof(v_policy) is distinct from 'object' or (v_policy -> 'approved') is distinct from 'true'::jsonb then
      raise exception '견적 요청 정책이 승인되지 않아 요청을 받을 수 없습니다 (BIZ-06)' using errcode = 'check_violation';
    end if;
    if new.consent_version is distinct from (v_policy ->> 'consent_version') then
      raise exception '지금 게시된 동의 문구 버전으로 동의해야 합니다 (BIZ-06)' using errcode = 'check_violation';
    end if;
    if new.message is not null and char_length(new.message) > (v_policy ->> 'message_max_chars')::int then
      raise exception '문의 내용은 %자 이하여야 합니다', (v_policy ->> 'message_max_chars') using errcode = 'check_violation';
    end if;
    if public.expert_sensitive(new.message) or public.expert_sensitive(new.preferred_period) or public.expert_sensitive(new.course_text) then
      raise exception '문의 내용·희망 시기·과정에 주민등록번호·계좌번호 같은 긴 숫자를 적을 수 없습니다 (BIZ-06)' using errcode = 'check_violation';
    end if;
    if new.email is not null and new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '이메일 형식을 확인해 주세요' using errcode = 'check_violation';
    end if;
    if new.phone is not null and regexp_replace(new.phone, '\D', '', 'g') !~ '^\d{8,12}$' then
      raise exception '전화번호 형식을 확인해 주세요' using errcode = 'check_violation';
    end if;
    if char_length(new.org_name) > 80 or char_length(new.contact_name) > 40 then
      raise exception '기관명은 80자, 담당자 이름은 40자 이하입니다' using errcode = 'check_violation';
    end if;
    if new.course_id is not null and not exists (select 1 from public.courses c where c.id = new.course_id and c.status = 'published') then
      raise exception '견적을 받는 과정이 아닙니다' using errcode = 'check_violation';
    end if;
    new.purge_at := ((new.created_at at time zone 'Asia/Seoul')::date + (v_policy ->> 'retention_days')::int);
    new.status := 'received';
    new.close_reason := null;
    new.purged_at := null;
    return new;
  end if;

  -- 갱신: 개인 칸은 파기(지우기)만 바뀔 수 있고, 상태는 앞으로만
  if old.purged_at is not null and new.purged_at is null then
    raise exception '파기된 요청은 되살릴 수 없습니다' using errcode = 'check_violation';
  end if;
  if (new.org_name is distinct from old.org_name or new.contact_name is distinct from old.contact_name or new.phone is distinct from old.phone
      or new.email is distinct from old.email or new.message is distinct from old.message) and new.purged_at is null then
    raise exception '요청의 기관명·담당자·연락처·내용은 고칠 수 없습니다 (파기만 가능)' using errcode = 'check_violation';
  end if;
  if (new.consent_version, new.consented_at, new.receipt_no, new.purge_at, new.org_type, new.headcount, new.course_id)
     is distinct from (old.consent_version, old.consented_at, old.receipt_no, old.purge_at, old.org_type, old.headcount, old.course_id) then
    if not (new.course_id is distinct from old.course_id and new.course_id is null
            and (new.consent_version, new.consented_at, new.receipt_no, new.purge_at, new.org_type, new.headcount)
                is not distinct from (old.consent_version, old.consented_at, old.receipt_no, old.purge_at, old.org_type, old.headcount)) then
      raise exception '동의 기록·접수 정보는 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
  end if;
  v_rank_old := array_position(array['received', 'contacted', 'closed'], old.status);
  v_rank_new := array_position(array['received', 'contacted', 'closed'], new.status);
  if v_rank_new < v_rank_old then
    raise exception '상태를 거꾸로 되돌릴 수 없습니다 (% -> %)', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status = 'closed' and new.close_reason is distinct from old.close_reason then
    raise exception '종결 사유는 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.training_quotes_guard() from public, anon, authenticated;
create trigger training_quotes_guard
  before insert or update on public.training_quotes
  for each row execute function public.training_quotes_guard();

-- 보관 기간 파기: purge_at(마지막 보관일)이 오늘(한국)보다 이른 요청의 개인 칸을 지운다 - 당일은 보존, 다음 날 파기. 멱등, 건수만
create function public.training_quotes_purge(p_now timestamptz) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    update public.training_quotes
       set org_name = null, contact_name = null, phone = null, email = null, message = null, purged_at = p_now, updated_by = 'system:purge'
     where purged_at is null and purge_at < (p_now at time zone 'Asia/Seoul')::date
    returning 1)
  select count(*) into v_count from gone;
  return v_count;
end;
$$;
revoke all on function public.training_quotes_purge(timestamptz) from public, anon, authenticated;
grant execute on function public.training_quotes_purge(timestamptz) to service_role;

-- 철회: 접수 번호 + 제출한 이메일 또는 전화로 본인을 확인하고, 종결(이용자 철회)하며 개인 칸을 바로 파기한다. 맞지 않으면 false (이유를 구별해 알려 주지 않는다)
create function public.training_quote_withdraw(p_receipt text, p_contact text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.training_quotes;
  v_digits text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
begin
  select * into r from public.training_quotes where receipt_no = upper(btrim(coalesce(p_receipt, ''))) and purged_at is null for update;
  if not found then
    return false;
  end if;
  if not ((r.email is not null and lower(btrim(coalesce(p_contact, ''))) = lower(r.email))
          or (r.phone is not null and v_digits <> '' and v_digits = regexp_replace(r.phone, '\D', '', 'g'))) then
    return false;
  end if;
  update public.training_quotes
     set org_name = null, contact_name = null, phone = null, email = null, message = null, purged_at = now(),
         status = 'closed', close_reason = coalesce(close_reason, 'withdrawn'), updated_by = 'user:withdraw'
   where id = r.id;
  return true;
end;
$$;
revoke all on function public.training_quote_withdraw(text, text) from public, anon, authenticated;
grant execute on function public.training_quote_withdraw(text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰 (화면에 필요한 값만 - 견적 요청 내용은 나가지 않는다)
-- ─────────────────────────────────────────────────────────────
alter table public.courses enable row level security;
alter table public.course_sessions enable row level security;
alter table public.seminars enable row level security;
alter table public.training_quotes enable row level security;
revoke all on table public.courses, public.course_sessions, public.seminars, public.training_quotes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.courses, public.course_sessions, public.seminars to service_role;
grant select, insert, update on table public.training_quotes to service_role;

-- 기능 키 edu가 켜져 있고 출처·확인일이 있는 published 강좌. 신청 주소는 점검 대상 official_links에서 (주소가 비면 null)
create view public.public_courses as
select c.id, c.slug, c.title, c.summary, c.audience, c.provider_name, c.verified_on, l.url as apply_url, l.status as apply_status
  from public.courses c
  left join public.official_links l on l.id = c.apply_link_id and l.active and l.url is not null
 where c.status = 'published'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'edu') = 'true'::jsonb);

create view public.public_course_sessions as
select s.id, s.course_id, s.starts_on, s.ends_on, s.mode, s.location_name, s.status, s.verified_on
  from public.course_sessions s
  join public.courses c on c.id = s.course_id and c.status = 'published'
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'edu') = 'true'::jsonb);

-- 기능 키 seminars가 켜져 있고 공개 상태(안내 중·취소·변경 확인 중)인 세미나
create view public.public_seminars as
select m.id, m.slug, m.title, m.summary, m.topic, m.starts_at, m.ends_at, m.mode, m.venue_name, m.organizer_name, m.sponsored, m.sponsor_name,
       m.speaker_disclosure, m.status, m.verified_on, l.url as apply_url, l.status as apply_status
  from public.seminars m
  left join public.official_links l on l.id = m.apply_link_id and l.active and l.url is not null
 where m.status in ('published', 'cancelled', 'changing')
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'seminars') = 'true'::jsonb and (f.value -> 'edu') = 'true'::jsonb);

-- 견적 양식 안내·동의 문구 - 승인된 법률 검토본만 (+ 기능 키 education_billing)
create view public.public_training_quote_notice as
select p.value ->> 'consent_version' as consent_version,
       p.value -> 'intro' as intro,
       p.value -> 'consent_items' as consent_items,
       (p.value ->> 'retention_days')::int as retention_days,
       (p.value ->> 'target_business_days')::int as target_business_days,
       (p.value ->> 'message_max_chars')::int as message_max_chars
  from public.settings p
 where p.key = 'training_quote_policy' and (p.value -> 'approved') = 'true'::jsonb
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'education_billing') = 'true'::jsonb and (f.value -> 'edu') = 'true'::jsonb);

-- 견적 양식의 과정 선택지
create view public.public_quote_course_options as
select c.id, c.title
  from public.courses c
 where c.status = 'published'
   and exists (select 1 from public.public_training_quote_notice);

revoke all on table public.public_courses, public.public_course_sessions, public.public_seminars, public.public_training_quote_notice, public.public_quote_course_options
  from public, anon, authenticated, service_role;
grant select on table public.public_courses, public.public_course_sessions, public.public_seminars, public.public_training_quote_notice, public.public_quote_course_options
  to anon, authenticated, service_role;
