-- W7c 2단계 — SM(선명) 소속 전문가 연락 요청 (PRD-01C EXPL-13 · 15 · 17 · 18 · 19 · 20 · 21, docs/dev/W7c_설계.md 1장 2단계 · 2장 · 11장 · 12장)
-- 이 파일에 실제 동의 문구·안내 문구는 없다. 표 틀·검사·함수·공개 뷰만 정한다. 씨앗 행 0 (정책 기본값은 비어 있고 승인 전).
-- · 요청(expert_requests)은 service_role만 읽고 쓴다(anon·authenticated 권한 0). 앱이 관리자(운영 책임자) 확인 뒤에만 읽는다 (EXPL-19).
--   담당·알림 대상은 사이트 관리자 계정이다(PO 결정 2026-10-24 - 당번표·순번 배정은 두지 않는다). 공개 뷰·검색 색인·평가셋·도우미 도구는 이 표를 참조하지 않는다.
-- · 동의 없는 전달 0 — 현재 동의 버전·동의 시각·내용 확인(summary_confirmed)이 없으면 저장 거부. 연락처는 이메일 또는 전화 중 하나 이상.
-- · 민감 입력 차단 — 요약·희망 시간에 9자리 이상 숫자(구분 문자를 섞은 우회 포함)가 있으면 저장 거부 (EXPL-20).
-- · 상태는 앞으로만(접수 -> 첫 연락 -> 종결), '첫 연락'은 수행 주체·안내 완료 체크가 있어야 하고 '종결'은 사유가 있어야 한다. 이력 추가만 (EXPL-17 · 21).
-- · 보관 기간(기본 365일) 지나면 이름·연락처·요약을 파기하고 통계 칸만 남긴다. 철회는 즉시 파기. 결제·금액 칸 없음 (EXPL-18 · 21).
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('expert_request_policy',
   jsonb_build_object(
     'retention_days', 365, 'target_business_days', 1, 'summary_max_chars', 1000,
     'consent_version', '', 'intro', '[]'::jsonb, 'consent_items', '[]'::jsonb,
     'approved', false, 'reviewed_by', null, 'reviewed_on', null, 'due_diligence_ref', '', 'legal_review_ref', ''),
   'SM 전문가 연락 요청 정책 (EXPL-13·15·18·21) — retention_days: 보관 기간(30~1825), target_business_days: 첫 연락 목표 영업일(1~10), summary_max_chars: 요약 상한(100~2000), consent_version·intro(양식 위 안내 문단)·consent_items(필수 동의 항목)는 법률 검토본만 넣는다. approved=true는 모든 검토 기록(실사 #12 · 감수 #20 기록 번호 포함)이 있어야 하고, 승인 전에는 기능 키 expert_requests를 켜지 못한다. 씨앗은 비어 있다',
   'migration:20261024000066')
on conflict (key) do nothing;

create function public.expert_request_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[] := array['retention_days', 'target_business_days', 'summary_max_chars', 'consent_version', 'intro', 'consent_items', 'approved', 'reviewed_by', 'reviewed_on', 'due_diligence_ref', 'legal_review_ref'];
  v_item jsonb;
  k text;
begin
  if jsonb_typeof(new.value) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(new.value) x where x <> all (v_keys))
     or exists (select 1 from unnest(v_keys) x where not (new.value ? x)) then
    raise exception '연락 요청 정책(expert_request_policy)의 칸은 % 입니다', array_to_string(v_keys, ' · ') using errcode = 'check_violation';
  end if;
  foreach k in array array['retention_days', 'target_business_days', 'summary_max_chars'] loop
    if jsonb_typeof(new.value -> k) is distinct from 'number' or (new.value ->> k) !~ '^[0-9]+$' then
      raise exception '연락 요청 정책의 %는 정수입니다', k using errcode = 'check_violation';
    end if;
  end loop;
  if (new.value ->> 'retention_days')::int not between 30 and 1825
     or (new.value ->> 'target_business_days')::int not between 1 and 10
     or (new.value ->> 'summary_max_chars')::int not between 100 and 2000 then
    raise exception '연락 요청 정책의 범위 - retention_days 30~1825 · target_business_days 1~10 · summary_max_chars 100~2000' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.value -> 'consent_version') is distinct from 'string'
     or jsonb_typeof(new.value -> 'approved') is distinct from 'boolean'
     or jsonb_typeof(new.value -> 'due_diligence_ref') is distinct from 'string'
     or jsonb_typeof(new.value -> 'legal_review_ref') is distinct from 'string'
     or jsonb_typeof(new.value -> 'intro') is distinct from 'array' or jsonb_array_length(new.value -> 'intro') > 6
     or jsonb_typeof(new.value -> 'consent_items') is distinct from 'array' or jsonb_array_length(new.value -> 'consent_items') > 6 then
    raise exception '연락 요청 정책의 글자·배열 칸 모양이 틀렸습니다 (intro·consent_items는 6개 이하 배열)' using errcode = 'check_violation';
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
          or char_length(btrim(new.value ->> 'due_diligence_ref')) = 0
          or char_length(btrim(new.value ->> 'legal_review_ref')) = 0) then
    raise exception '연락 요청 정책 승인에는 동의 버전·안내 문단·동의 항목·검토자·검토일과 실사(#12)·감수(#20) 기록 번호가 모두 필요합니다 (EXPL-13)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.expert_request_settings_guard() from public, anon, authenticated;
create trigger settings_expert_request_settings_guard
  before insert or update on public.settings
  for each row when (new.key = 'expert_request_policy')
  execute function public.expert_request_settings_guard();

-- 연락 요청 켜기 — 전문가 소개가 같이 켜져 있고 정책이 승인돼 있어야 한다 (EXPL-13: 실사·감수 기록 없으면 켤 수 없음)
create function public.expert_request_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'expert_requests') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'expert_requests') is distinct from 'true'::jsonb) then
    if (new.value -> 'experts') is distinct from 'true'::jsonb then
      raise exception 'SM 전문가 연락 요청(expert_requests)은 전문가 소개(experts)가 같이 켜져 있어야 합니다' using errcode = 'check_violation';
    end if;
    select s.value into v_policy from public.settings s where s.key = 'expert_request_policy';
    if jsonb_typeof(v_policy) is distinct from 'object' or (v_policy -> 'approved') is distinct from 'true'::jsonb then
      raise exception 'SM 전문가 연락 요청(expert_requests)은 설정 expert_request_policy에 실사(#12)·감수(#20) 기록이 있는 승인이 있어야 켭니다 (EXPL-13)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.expert_request_flag_guard() from public, anon, authenticated;
create trigger settings_expert_request_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.expert_request_flag_guard();

-- 민감 입력 — 숫자 사이의 공백·점·하이픈·밑줄·슬래시를 지운 뒤 숫자 9개 이상이 이어지면 true (주민등록번호·계좌번호·전화번호 모양, 전각 숫자 포함)
create function public.expert_sensitive(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null
     and regexp_replace(normalize(p_text, nfkc), '(\d)[\s.\-–—·_/]+(?=\d)', '\1', 'g') ~ '\d{9,}'
$$;
revoke all on function public.expert_sensitive(text) from public, anon, authenticated;
grant execute on function public.expert_sensitive(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 요청 (EXPL-13 · 15 · 18 · 19 · 20 · 21)
-- ─────────────────────────────────────────────────────────────
create table public.expert_requests (
  id bigint generated always as identity primary key,
  receipt_no text not null unique default ('EX-' || upper(substr(md5(random()::text || clock_timestamp()::text || txid_current()::text), 1, 8))),
  source text not null check (source in ('assistant', 'experts', 'article')),
  category_code text not null references public.expert_categories (code),
  summary text,
  summary_origin text not null default 'user' check (summary_origin in ('user', 'ai_draft')),
  summary_confirmed boolean not null,
  name text,
  phone text,
  email text,
  preferred_time text,
  deadline_urgent boolean not null default false,
  consent_version text not null check (char_length(btrim(consent_version)) between 1 and 40),
  consented_at timestamptz not null,
  performing_entity text check (performing_entity is null or char_length(btrim(performing_entity)) between 1 and 100),
  scope_noted boolean not null default false,
  status text not null default 'received' check (status in ('received', 'contacted', 'closed')),
  close_reason text check (close_reason in ('contract', 'guidance_end', 'unreachable', 'withdrawn')),
  first_contact_at timestamptz,
  due_at timestamptz not null,
  retention_until date not null,
  purged_at timestamptz,
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_requests_consent check (summary_confirmed),
  constraint expert_requests_personal check (
    (purged_at is null and name is not null and summary is not null and (phone is not null or email is not null))
    or (purged_at is not null and name is null and phone is null and email is null and summary is null and preferred_time is null)),
  constraint expert_requests_closed check ((status = 'closed') = (close_reason is not null))
);
comment on table public.expert_requests is 'SM 전문가 연락 요청 (EXPL-13~21) — service_role 전용. 동의 버전·시각·내용 확인 없으면 저장 불가, 개인 칸은 보관 기간 뒤 파기(통계 칸만 남음). 결제·금액 칸 없음. 공개 뷰·색인·평가셋·도우미 도구가 읽지 않는다';
create index expert_requests_status_idx on public.expert_requests (status, due_at);

create function public.expert_requests_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_max integer;
  v_days integer;
  v_rank_old integer;
  v_rank_new integer;
begin
  new.updated_at := now();
  select s.value into v_policy from public.settings s where s.key = 'expert_request_policy';
  if tg_op = 'INSERT' then
    if jsonb_typeof(v_policy) is distinct from 'object' or (v_policy -> 'approved') is distinct from 'true'::jsonb then
      raise exception '연락 요청 정책이 승인되지 않아 요청을 받을 수 없습니다 (EXPL-13)' using errcode = 'check_violation';
    end if;
    if new.consent_version is distinct from (v_policy ->> 'consent_version') then
      raise exception '지금 게시된 동의 문구 버전으로 동의해야 합니다 (EXPL-15)' using errcode = 'check_violation';
    end if;
    v_max := (v_policy ->> 'summary_max_chars')::int;
    v_days := (v_policy ->> 'retention_days')::int;
    if char_length(btrim(coalesce(new.summary, ''))) = 0 or char_length(new.summary) > v_max then
      raise exception '요약은 1자 이상 %자 이하여야 합니다 (EXPL-14)', v_max using errcode = 'check_violation';
    end if;
    if public.expert_sensitive(new.summary) or public.expert_sensitive(new.preferred_time) then
      raise exception '요약·희망 시간에 주민등록번호·계좌번호 같은 긴 숫자를 적을 수 없습니다 (EXPL-20)' using errcode = 'check_violation';
    end if;
    if new.email is not null and new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '이메일 형식을 확인해 주세요' using errcode = 'check_violation';
    end if;
    if new.phone is not null and regexp_replace(new.phone, '\D', '', 'g') !~ '^\d{8,12}$' then
      raise exception '전화번호 형식을 확인해 주세요' using errcode = 'check_violation';
    end if;
    if char_length(new.name) > 40 or char_length(coalesce(new.preferred_time, '')) > 100 then
      raise exception '이름은 40자, 희망 시간은 100자 이하입니다' using errcode = 'check_violation';
    end if;
    -- 소개 중인 SM 전문가가 있는 분류만 (공개 중인 프로필이 1명 이상)
    if not exists (select 1 from public.public_expert_categories c where c.code = new.category_code) then
      raise exception '이 분야는 소개 중인 SM 전문가가 없어 요청을 받을 수 없습니다 (EXPL-17)' using errcode = 'check_violation';
    end if;
    new.retention_until := ((new.created_at at time zone 'Asia/Seoul')::date + v_days);
    new.status := 'received';
    return new;
  end if;

  -- 갱신: 개인 칸은 파기(지우기)만 바뀔 수 있고, 상태는 앞으로만
  if old.purged_at is not null and new.purged_at is null then
    raise exception '파기된 요청은 되살릴 수 없습니다 (EXPL-21)' using errcode = 'check_violation';
  end if;
  if (new.name is distinct from old.name or new.phone is distinct from old.phone or new.email is distinct from old.email
      or new.summary is distinct from old.summary or new.preferred_time is distinct from old.preferred_time)
     and new.purged_at is null then
    raise exception '요청의 이름·연락처·요약은 고칠 수 없습니다 (파기만 가능)' using errcode = 'check_violation';
  end if;
  if (new.consent_version, new.consented_at, new.summary_confirmed, new.source, new.category_code, new.receipt_no, new.due_at, new.retention_until)
     is distinct from (old.consent_version, old.consented_at, old.summary_confirmed, old.source, old.category_code, old.receipt_no, old.due_at, old.retention_until) then
    raise exception '동의 기록·접수 정보는 고칠 수 없습니다' using errcode = 'check_violation';
  end if;
  v_rank_old := array_position(array['received', 'contacted', 'closed'], old.status);
  v_rank_new := array_position(array['received', 'contacted', 'closed'], new.status);
  if v_rank_new < v_rank_old then
    raise exception '상태를 거꾸로 되돌릴 수 없습니다 (% -> %)', old.status, new.status using errcode = 'check_violation';
  end if;
  if old.status = 'closed' and (new.close_reason is distinct from old.close_reason) then
    raise exception '종결 사유는 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  if new.status = 'contacted' and old.status <> 'contacted' then
    if not new.scope_noted or char_length(btrim(coalesce(new.performing_entity, ''))) = 0 then
      raise exception '첫 연락으로 바꾸려면 수행 주체와 업무 범위·비용 기준 안내 완료 확인이 필요합니다 (EXPL-17)' using errcode = 'check_violation';
    end if;
    new.first_contact_at := coalesce(new.first_contact_at, now());
  end if;
  return new;
end;
$$;
revoke all on function public.expert_requests_guard() from public, anon, authenticated;
create trigger expert_requests_guard
  before insert or update on public.expert_requests
  for each row execute function public.expert_requests_guard();

-- 이력 (EXPL-21) — 추가만. 금액 칸 없음, 메모에는 개인정보를 싣지 않는다 (앱이 고정 문구만 넣는다)
create table public.expert_request_events (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.expert_requests (id),
  from_status text,
  to_status text not null check (to_status in ('received', 'contacted', 'closed')),
  actor text not null,
  note text check (note is null or char_length(note) <= 200),
  at timestamptz not null default now()
);
comment on table public.expert_request_events is '연락 요청 상태 이력 (EXPL-21) — 추가만. 계약 금액 칸 없음. 파기 뒤에도 상태·시각 통계로 남는다';
create index expert_request_events_request_idx on public.expert_request_events (request_id, at);

create function public.expert_requests_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.expert_request_events (request_id, from_status, to_status, actor, note)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, new.updated_by,
            case new.status when 'closed' then '종결 사유 ' || new.close_reason else null end);
  end if;
  return null;
end;
$$;
revoke all on function public.expert_requests_history() from public, anon, authenticated;
create trigger expert_requests_history
  after insert or update on public.expert_requests
  for each row execute function public.expert_requests_history();
create trigger expert_request_events_no_change
  before update or delete on public.expert_request_events
  for each row execute function public.append_only_guard();
create trigger expert_request_events_no_truncate
  before truncate on public.expert_request_events
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 함수 — 파기 · 철회
-- ─────────────────────────────────────────────────────────────
-- 보관 기간 파기 (EXPL-21): retention_until(기산일 + 보관 일수)이 오늘(한국)보다 이른 요청의 개인 칸을 지운다 — 당일은 보존, 다음 날 파기. 멱등, 건수만
create function public.expert_requests_purge(p_now timestamptz) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with gone as (
    update public.expert_requests
       set name = null, phone = null, email = null, summary = null, preferred_time = null, purged_at = p_now, updated_by = 'system:purge'
     where purged_at is null and retention_until < (p_now at time zone 'Asia/Seoul')::date
    returning 1)
  select count(*) into v_count from gone;
  return v_count;
end;
$$;
revoke all on function public.expert_requests_purge(timestamptz) from public, anon, authenticated;
grant execute on function public.expert_requests_purge(timestamptz) to service_role;

-- 철회 (EXPL-21): 접수 번호 + 제출한 이메일 또는 전화로 본인을 확인하고, 상태를 '이용자 철회'로 종결하며 개인 칸을 바로 파기한다. 맞지 않으면 false (이유를 구별해 알려 주지 않는다)
create function public.expert_request_withdraw(p_receipt text, p_contact text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.expert_requests;
  v_digits text := regexp_replace(coalesce(p_contact, ''), '\D', '', 'g');
begin
  select * into r from public.expert_requests where receipt_no = upper(btrim(coalesce(p_receipt, ''))) and purged_at is null for update;
  if not found then
    return false;
  end if;
  if not ((r.email is not null and lower(btrim(coalesce(p_contact, ''))) = lower(r.email))
          or (r.phone is not null and v_digits <> '' and v_digits = regexp_replace(r.phone, '\D', '', 'g'))) then
    return false;
  end if;
  update public.expert_requests
     set name = null, phone = null, email = null, summary = null, preferred_time = null, purged_at = now(),
         status = 'closed', close_reason = coalesce(close_reason, 'withdrawn'), updated_by = 'user:withdraw'
   where id = r.id;
  return true;
end;
$$;
revoke all on function public.expert_request_withdraw(text, text) from public, anon, authenticated;
grant execute on function public.expert_request_withdraw(text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰 (양식에 필요한 값만 — 요청 내용은 나가지 않는다)
-- ─────────────────────────────────────────────────────────────
alter table public.expert_requests enable row level security;
alter table public.expert_request_events enable row level security;
revoke all on table public.expert_requests, public.expert_request_events from anon, authenticated, service_role;
grant select, insert, update on table public.expert_requests to service_role;
grant select on table public.expert_request_events to service_role;

-- 양식 분야 선택지 — 연락 요청이 열려 있고, 공개 중인 SM 전문가가 1명 이상인 분류만
create view public.public_expert_request_options as
select c.code, c.name, c.sort_order
  from public.public_expert_categories c
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'experts') = 'true'::jsonb and (f.value -> 'expert_requests') = 'true'::jsonb)
   and exists (select 1 from public.settings p where p.key = 'expert_request_policy' and (p.value -> 'approved') = 'true'::jsonb);

-- 양식 안내·동의 문구 — 승인된 법률 검토본만
create view public.public_expert_request_notice as
select p.value ->> 'consent_version' as consent_version,
       p.value -> 'intro' as intro,
       p.value -> 'consent_items' as consent_items,
       (p.value ->> 'retention_days')::int as retention_days,
       (p.value ->> 'target_business_days')::int as target_business_days,
       (p.value ->> 'summary_max_chars')::int as summary_max_chars
  from public.settings p
 where p.key = 'expert_request_policy' and (p.value -> 'approved') = 'true'::jsonb
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'experts') = 'true'::jsonb and (f.value -> 'expert_requests') = 'true'::jsonb);

revoke all on table public.public_expert_request_options, public.public_expert_request_notice from public, anon, authenticated, service_role;
grant select on table public.public_expert_request_options, public.public_expert_request_notice to anon, authenticated, service_role;
