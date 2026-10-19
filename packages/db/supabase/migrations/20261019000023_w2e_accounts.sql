-- W2-e 1단계 DB — 계정 기반 (docs/dev/W2-e_설계.md 2.1 · 2.2 · 2.3 · 3.1 · 3.2 · 3.3 · 3.6 · 4.1, PRD-01A ACC-01~04 · 6.1)
-- · request_throttles — 시도 횟수 공용 표. 키는 서버가 HMAC으로 만든 32글자 해시뿐이라 이메일·IP 원문이 들어갈 수 없다(check).
--   창은 '첫 시도 때 열려 window_seconds 동안 가는 창'(고정 창이 아니라 첫 시도 기준 — 시계 경계에 걸려 횟수가 갈라지지 않는다).
--   함수 throttle_check(막혔나)·throttle_hit(1 올리기 — n번째 허용·n+1번째 차단)·throttle_clear(로그인 성공 때 초기화)·throttle_purge(오래된 창 지우기)
-- · profiles — 회원 프로필(표시 이름·등급·관심 분야·관심 지역·모드). 이메일·전화·주소 칸 없음, 관리자 권한 칸 없음.
--   트리거가 관심 분야(4대 분야 또는 공개 section:slug)·관심 지역(regions의 오늘 유효한 코드)과 상한(settings.member)을 막는다
-- · consents — 동의 이력. user_id 또는 email 중 정확히 하나(평문 이메일이 허용되는 두 칸 중 하나 — 사전 알림 신청자만). 철회되지 않은 같은 (종류, 주체)는 하나
-- · 새 표 모두 RLS 기본 거부 — anon·authenticated 직접 권한 0, service_role 전권(관리자 전권, 서버 코드가 본인 것만 읽는다 — 설계 3.1)
-- · settings 씨앗 member · auth_limits · privacy_retention (설계 2.2 — 시험 tests/w2e-values.test.mjs가 설계 문서의 블록과 대조한다)
-- · 기능 키 씨앗 page_terms · page_no_email · page_advertise · members · brief — 모두 꺼짐, 이미 값이 있으면 건드리지 않는다 (설계 2.3)

-- ─────────────────────────────────────────────────────────────
-- request_throttles
-- ─────────────────────────────────────────────────────────────
create table public.request_throttles (
  scope text not null check (scope in (
    'login_pair', 'login_account', 'login_ip', 'password_change', 'signup_ip', 'signup_email',
    'reset_ip', 'reset_email', 'form_ip', 'brief_ip', 'brief_email', 'confirm_resend')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{32}$'),      -- HMAC-SHA256(GUARD_SECRET, scope:값) 앞 32글자 — 원문(이메일·IP)은 이 모양이 될 수 없다
  window_start timestamptz not null,                                -- 이 창이 열린 시각(DB 시계)
  count integer not null check (count > 0),                         -- 이 창에서 센 횟수 (한도 + 1에서 멈춘다)
  primary key (scope, key_hash, window_start)
);

comment on table public.request_throttles is
  '시도 횟수 (W2-e 4.1) — 범위·키 해시·창 시작·횟수만. 이메일·IP 원문 0(해시 32글자 check), 기본 24시간 뒤 throttle_purge. anon·authenticated 0';
comment on column public.request_throttles.key_hash is 'HMAC-SHA256(GUARD_SECRET, 범위:값) 앞 32글자 — 값 = 소문자 이메일 · IP · 이메일|IP';
comment on column public.request_throttles.window_start is '창이 열린 시각 — window_start + 창 길이가 지나면 새 창. 창 길이와 한도는 호출하는 쪽이 settings.auth_limits에서 읽어 넘긴다';

alter table public.request_throttles enable row level security;
revoke all on table public.request_throttles from anon, authenticated, service_role;
grant select, insert, update, delete on table public.request_throttles to service_role;

-- 인자 검사는 세 함수가 같다 — 창 길이 1초~1일, 한도 1~100000, 키 해시 모양
create function public.throttle_args_check(p_scope text, p_key_hash text, p_window_seconds integer, p_limit integer)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_scope is null or p_scope not in (
    'login_pair', 'login_account', 'login_ip', 'password_change', 'signup_ip', 'signup_email',
    'reset_ip', 'reset_email', 'form_ip', 'brief_ip', 'brief_email', 'confirm_resend') then
    raise exception using errcode = '22023', message = '시도 횟수 범위 값이 목록 밖입니다';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{32}$' then
    raise exception using errcode = '22023', message = '키는 소문자 16진수 32글자 해시여야 합니다';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception using errcode = '22023', message = '창 길이는 1초~86400초여야 합니다';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception using errcode = '22023', message = '한도는 1~100000이어야 합니다';
  end if;
end;
$$;

-- 지금 막힌 상태인가 — 올리지 않는다. 열린 창의 횟수가 한도 이상이면 막힘(다음 창이 열릴 때까지 남은 초)
create function public.throttle_check(p_scope text, p_key_hash text, p_window_seconds integer, p_limit integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.request_throttles%rowtype;
begin
  perform public.throttle_args_check(p_scope, p_key_hash, p_window_seconds, p_limit);
  select * into v_row from public.request_throttles t
   where t.scope = p_scope and t.key_hash = p_key_hash
     and t.window_start > v_now - make_interval(secs => p_window_seconds)
   order by t.window_start desc
   limit 1;
  if found and v_row.count >= p_limit then
    return jsonb_build_object(
      'blocked', true,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_row.window_start + make_interval(secs => p_window_seconds) - v_now)))::integer));
  end if;
  return jsonb_build_object('blocked', false, 'retry_after_seconds', 0);
end;
$$;

-- 횟수를 1 올린다 — 열린 창이 없으면 새 창(1회). n번째까지 allowed, n+1번째부터 not allowed (횟수는 한도 + 1에서 멈춘다).
-- 같은 키의 동시 요청은 자문 잠금으로 한 줄로 세운다 (창이 둘 열려 횟수가 갈라지는 것 방지)
create function public.throttle_hit(p_scope text, p_key_hash text, p_window_seconds integer, p_limit integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_row public.request_throttles%rowtype;
  v_count integer;
  v_start timestamptz;
begin
  perform public.throttle_args_check(p_scope, p_key_hash, p_window_seconds, p_limit);
  perform pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_key_hash, 0));
  select * into v_row from public.request_throttles t
   where t.scope = p_scope and t.key_hash = p_key_hash
     and t.window_start > v_now - make_interval(secs => p_window_seconds)
   order by t.window_start desc
   limit 1;
  if found then
    update public.request_throttles t
       set count = least(t.count + 1, p_limit + 1)
     where t.scope = v_row.scope and t.key_hash = v_row.key_hash and t.window_start = v_row.window_start
    returning t.count, t.window_start into v_count, v_start;
  else
    insert into public.request_throttles as t (scope, key_hash, window_start, count)
    values (p_scope, p_key_hash, v_now, 1)
    returning t.count, t.window_start into v_count, v_start;
  end if;
  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'retry_after_seconds', case when v_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - v_now)))::integer) end);
end;
$$;

-- 로그인 성공 때 그 키의 횟수를 모두 지운다 — 지운 줄 수
create function public.throttle_clear(p_scope text, p_key_hash text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed integer;
begin
  perform public.throttle_args_check(p_scope, p_key_hash, 1, 1);
  delete from public.request_throttles t where t.scope = p_scope and t.key_hash = p_key_hash;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- 오래된 창 지우기 — 창이 열린 지 p_older_than_hours 시간이 지난 줄. 가장 긴 창(auth_limits)보다 길어야 하므로 1시간 이상만 받는다. 지운 줄 수
create function public.throttle_purge(p_older_than_hours integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_removed integer;
begin
  if p_older_than_hours is null or p_older_than_hours < 1 or p_older_than_hours > 8760 then
    raise exception using errcode = '22023', message = '지울 기준 시간은 1~8760시간이어야 합니다';
  end if;
  delete from public.request_throttles t where t.window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  tier text not null default 'basic' check (tier in ('basic', 'premium', 'institution')),
  interests text[] not null default '{}',
  interest_region_codes text[] not null default '{}',
  mode_pref text not null default 'general' check (mode_pref in ('general', 'expert')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_shape check (display_name is null or (char_length(display_name) between 1 and 30 and display_name = btrim(display_name))),
  -- 이메일 모양(설계 2.7 정규식, 전각 ＠은 NFKC로 먼저 바꾼다)이면 거부 — 표시 이름에 이메일이 새지 않게 (서버 가림과 함께 두 겹)
  constraint profiles_display_name_no_email check (display_name is null or normalize(display_name, NFKC) !~ '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
);

comment on table public.profiles is
  '회원 프로필 (PRD-01A 6.1 · W2-e 3.2) — 표시 이름·등급·관심 분야·관심 지역·모드. 이메일·전화·주소 칸 0, 관리자 권한 칸 0. anon·authenticated 0';
comment on column public.profiles.interests is '관심 분야 — 4대 분야(tax·realestate·finance·local) 또는 공개 하위 분야 section:slug(local은 하위 분야 없음). 상한 settings.member.interest_max';
comment on column public.profiles.interest_region_codes is '관심 지역 — regions의 오늘(한국 날짜) 유효한 시·도 또는 시·군·구 코드. 상한 settings.member.interest_region_limit';

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- 관심 분야·관심 지역 검사 — 값 모양·중복·상한, 분야는 공개 하위 분야만, 지역은 regions에 있는 코드(새로 단 코드는 오늘 유효해야 한다 — 이미 있던 코드는 나중에 폐지돼도 남는다)
create function public.profiles_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member jsonb;
  v_interest_max integer;
  v_region_limit integer;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_value text;
  v_seen text[] := '{}';
  v_region public.regions%rowtype;
begin
  select s.value into v_member from public.settings s where s.key = 'member';
  if v_member is null
     or jsonb_typeof(v_member -> 'interest_max') is distinct from 'number'
     or jsonb_typeof(v_member -> 'interest_region_limit') is distinct from 'number' then
    raise exception using errcode = '22023', message = '설정 member(관심 분야·지역 상한)를 읽지 못했습니다 — 회원 프로필을 저장할 수 없습니다';
  end if;
  v_interest_max := (v_member ->> 'interest_max')::integer;
  v_region_limit := (v_member ->> 'interest_region_limit')::integer;

  if cardinality(new.interests) > v_interest_max then
    raise exception '관심 분야는 %개까지 고를 수 있습니다 (지금 %개) — W2-e 3.2', v_interest_max, cardinality(new.interests)
      using errcode = 'check_violation';
  end if;
  foreach v_value in array new.interests loop
    if v_value is null or v_value !~ '^(tax|realestate|finance|local|(tax|realestate|finance):[a-z0-9]+(-[a-z0-9]+)*)$' then
      raise exception '관심 분야 값이 목록 밖입니다: % (4대 분야 또는 section:하위분야)', coalesce(v_value, '(빈 값)')
        using errcode = 'check_violation';
    end if;
    if v_value = any(v_seen) then
      raise exception '관심 분야가 겹칩니다: %', v_value using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_value;
    if position(':' in v_value) > 0
       and not exists (
         select 1 from public.categories c
          where c.section = split_part(v_value, ':', 1) and c.slug = split_part(v_value, ':', 2) and c.visible) then
      raise exception '없거나 공개되지 않은 하위 분야입니다: %', v_value using errcode = 'check_violation';
    end if;
  end loop;

  if cardinality(new.interest_region_codes) > v_region_limit then
    raise exception '관심 지역은 %곳까지 고를 수 있습니다 (지금 %곳) — W2-e 3.2', v_region_limit, cardinality(new.interest_region_codes)
      using errcode = 'check_violation';
  end if;
  v_seen := '{}';
  foreach v_value in array new.interest_region_codes loop
    if v_value is null then
      raise exception '관심 지역 코드가 비어 있습니다' using errcode = 'check_violation';
    end if;
    if v_value = any(v_seen) then
      raise exception '관심 지역이 겹칩니다: %', v_value using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_value;
    select * into v_region from public.regions r where r.code = v_value;
    if not found then
      raise exception '없는 행정구역 코드입니다: % (regions에 있는 코드만 고릅니다)', v_value using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' or not (coalesce(old.interest_region_codes, '{}'::text[]) @> array[v_value]) then
      if (v_region.valid_to is not null and v_region.valid_to < v_today) or (v_region.valid_from is not null and v_region.valid_from > v_today) then
        raise exception '유효하지 않은 행정구역 코드입니다: % (%) — 폐지되었거나 시작 전인 코드는 새로 고를 수 없습니다', v_value, v_region.name
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.profiles_guard() from public, anon, authenticated;

create trigger profiles_guard
  before insert or update of interests, interest_region_codes on public.profiles
  for each row execute function public.profiles_guard();

alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated, service_role;
grant select, insert, update, delete on table public.profiles to service_role;

-- ─────────────────────────────────────────────────────────────
-- consents
-- ─────────────────────────────────────────────────────────────
create table public.consents (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,          -- 회원이면 채움 — 계정이 지워지면 함께 지워진다(탈퇴 처리도 지운다 — 설계 9.3)
  email text,                                                         -- 비회원 사전 알림 신청일 때만 — 평문이 허용된 두 칸 중 하나(다른 하나는 inquiries.contact_email)
  kind text not null check (kind in ('signup', 'receive', 'marketing', 'brief_prereg')),
  channel text not null check (channel in ('web_signup', 'web_my', 'web_brief')),
  version_ref bigint[] not null default '{}',                         -- 동의한 문서 버전(policy_versions 번호 목록 — 4단계 표) — 문구가 바뀌어도 그때 무엇에 동의했는지 남는다
  agreed_at timestamptz not null default now(),
  confirmed_at timestamptz,                                           -- 확인 메일을 눌러야 채움 (이중 확인)
  revoked_at timestamptz,
  confirm_token_hash text,                                            -- 확인 링크 토큰의 SHA-256 16진수 64글자 — 원문 저장 0
  revoke_token_hash text,
  created_at timestamptz not null default now(),
  constraint consents_one_subject check (num_nonnulls(user_id, email) = 1),
  constraint consents_email_shape check (
    email is null or (char_length(email) <= 320 and email = lower(btrim(email)) and email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')),
  constraint consents_email_only_prereg check (email is null or kind = 'brief_prereg'),
  constraint consents_confirm_token_shape check (confirm_token_hash is null or confirm_token_hash ~ '^[0-9a-f]{64}$'),
  constraint consents_revoke_token_shape check (revoke_token_hash is null or revoke_token_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.consents is
  '동의 이력 (PRD-01A 6.1 · W2-e 3.3) — 회원은 user_id, 비회원 사전 알림만 email(평문 허용 칸). 같은 (종류, 주체)의 철회되지 않은 행은 하나. 관심 분야·지역 저장은 이 표에 행을 만들지 않는다. anon·authenticated 0';

-- 철회되지 않은 같은 (종류, 주체)는 하나 — 같은 이메일 다시 신청 때 중복 저장 0
create unique index consents_active_user_uidx on public.consents (kind, user_id) where user_id is not null and revoked_at is null;
create unique index consents_active_email_uidx on public.consents (kind, email) where email is not null and revoked_at is null;
create unique index consents_confirm_token_uidx on public.consents (confirm_token_hash) where confirm_token_hash is not null;
create unique index consents_revoke_token_uidx on public.consents (revoke_token_hash) where revoke_token_hash is not null;
create index consents_user_idx on public.consents (user_id) where user_id is not null;

alter table public.consents enable row level security;
revoke all on table public.consents from anon, authenticated, service_role;
grant select, insert, update, delete on table public.consents to service_role;

-- ─────────────────────────────────────────────────────────────
-- 함수 권한 — 모두 service_role만 (익명 실행 허용 목록은 늘리지 않는다 — 설계 3.1)
-- ─────────────────────────────────────────────────────────────
revoke all on function public.throttle_args_check(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.throttle_check(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.throttle_hit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.throttle_clear(text, text) from public, anon, authenticated;
revoke all on function public.throttle_purge(integer) from public, anon, authenticated;
grant execute on function public.throttle_args_check(text, text, integer, integer) to service_role;
grant execute on function public.throttle_check(text, text, integer, integer) to service_role;
grant execute on function public.throttle_hit(text, text, integer, integer) to service_role;
grant execute on function public.throttle_clear(text, text) to service_role;
grant execute on function public.throttle_purge(integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 (설계 2.2 — 이미 있으면 건드리지 않는다)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('member',
   '{"version":"2026-10-20.1","interest_region_limit":3,"interest_max":20,"display_name_chars":30,"signup_confirm_hours":24,"password_min_chars":10,"password_max_bytes":72}'::jsonb,
   '회원 한도 (ACC-01·02) — interest_region_limit 관심 지역 상한 · interest_max 관심 분야 상한 · display_name_chars 표시 이름 글자 상한 · signup_confirm_hours 가입 확인 링크 유효 시간 · password_min_chars 비밀번호 최소 글자 · password_max_bytes 비밀번호 최대 바이트(UTF-8, bcrypt 72) [결정 안건: 초기값]',
   'migration:20261019000023'),
  ('auth_limits',
   '{"version":"2026-10-20.1","login_pair":{"window":900,"limit":5},"login_account":{"window":900,"limit":20},"login_ip":{"window":900,"limit":30},"password_change":{"window":900,"limit":5},"signup_ip":{"window":3600,"limit":5},"signup_email":{"window":3600,"limit":3},"reset_ip":{"window":3600,"limit":10},"reset_email":{"window":3600,"limit":3},"form_ip":{"window":3600,"limit":10},"brief_ip":{"window":3600,"limit":10},"brief_email":{"window":3600,"limit":3},"confirm_resend":{"window":3600,"limit":3}}'::jsonb,
   '로그인·가입·재설정·폼 시도 제한 (W2-e 4.1) — 범위마다 window(초) 동안 limit번까지 허용하고 limit+1번째부터 막는다. 잠금 범위를 이메일+IP 짝과 이메일 전체로 나눠 남이 계정을 잠그기 어렵게 한다 [결정 안건: 초기값]',
   'migration:20261019000023'),
  ('privacy_retention',
   '{"version":"2026-10-20.1","unconfirmed_signup_days":7,"unconfirmed_consent_days":7,"revoked_consent_days":30,"inquiry_contact_days":365,"inquiry_attachment_days":365,"throttle_hours":24}'::jsonb,
   '개인정보 보존 기한 (W2-e 9.3) — 확인 안 된 가입·사전 알림 7일 · 철회된 동의 30일 · 문의 연락처·첨부 365일 · 시도 횟수 해시 24시간 [결정 안건: 초기값 — 법률 확인]',
   'migration:20261019000023')
on conflict (key) do nothing;

-- 기능 키 (설계 2.3) — 모두 꺼짐으로 시작, 이미 값이 있는 키는 건드리지 않는다
update public.settings s
   set value = s.value || (
         select jsonb_object_agg(k, false)
           from unnest(array['page_terms', 'page_no_email', 'page_advertise', 'members', 'brief']) as k
          where not (s.value ? k)),
       updated_by = 'migration:20261019000023'
 where s.key = 'feature_flags'
   and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['page_terms', 'page_no_email', 'page_advertise', 'members', 'brief']) as k where not (s.value ? k));
