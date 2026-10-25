-- W11-f 4단계 — 기관 견적 요청(institution_inquiries) · 파기 (PRD-03 BIZ-07, PO 기본값 #16 보존 1년 [법률 검토])
-- · 보존 기간은 설정 institution_inquiry_policy.retention_days (비어 있으면 접수 0). 기본 365는 [법률 검토] 대상.
-- · 연락 동의(필수)가 없으면 DB가 거부, 소식 수신 동의는 별도 칸(기본 해제)이고 거부해도 접수된다.
-- · 파기는 W7c expert_requests 방식 - 보존일이 지나면 개인 칸을 비우고 purged_at만 남긴다.
-- · 동의 이력은 이 행의 동의 칸(시각·문서 버전)에 둔다. consents 표(종류 4개·비회원 이메일 제한)는 건드리지 않는다 [PRD 문구와 다름 - 설계 문서 결정 #5].

create function public.institution_inquiry_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(new.value) k where k <> 'retention_days')
     or (new.value ? 'retention_days' and (jsonb_typeof(new.value -> 'retention_days') is distinct from 'number'
          or (new.value ->> 'retention_days') !~ '^[0-9]+$' or (new.value ->> 'retention_days')::int not between 30 and 1095)) then
    raise exception '기관 견적 요청 설정(institution_inquiry_policy)은 { retention_days: 30~1095 정수 }이거나 빈 객체(접수 0)입니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.institution_inquiry_settings_guard() from public, anon, authenticated;
create trigger settings_institution_inquiry_settings_guard
  before insert or update on public.settings
  for each row when (new.key = 'institution_inquiry_policy')
  execute function public.institution_inquiry_settings_guard();

create table public.institution_inquiries (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique check (receipt_no ~ '^[A-Z0-9]{8,16}$'),
  org_type text not null check (org_type in ('local_government', 'tax_firm', 'financial')),
  org_name text check (org_name is null or char_length(btrim(org_name)) between 1 and 100),
  contact_name text check (contact_name is null or char_length(btrim(contact_name)) between 1 and 60),
  contact_email text check (contact_email is null or (char_length(contact_email) <= 320
    and contact_email = lower(btrim(contact_email)) and contact_email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')),
  contact_phone text check (contact_phone is null or contact_phone ~ '^[0-9+\-]{7,20}$'),
  seats_wanted integer not null check (seats_wanted between 1 and 10000),
  message text check (message is null or char_length(message) <= 2000),
  consent_contact_at timestamptz not null,
  consent_marketing boolean not null default false,
  consent_version_ref bigint[] not null default '{}',
  status text not null default 'received' check (status in ('received', 'contacted', 'quoted', 'closed')),
  org_id uuid references public.orgs (id),
  retention_until date not null,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_by text not null default 'system',
  constraint institution_inquiries_purge_shape check (
    (purged_at is null and org_name is not null and contact_name is not null and contact_email is not null)
    or (purged_at is not null and org_name is null and contact_name is null and contact_email is null
        and contact_phone is null and message is null))
);
comment on table public.institution_inquiries is '기관 견적 요청 (BIZ-07) - 연락 동의 필수, 소식 수신 동의 별도(기본 해제). 보존일이 지나면 개인 칸을 비운다(institution_inquiries_purge). anon·authenticated 0';
create index institution_inquiries_retention_idx on public.institution_inquiries (retention_until) where purged_at is null;

-- 접수 시 보존일 계산 (한국 날짜 + retention_days) - 정책이 비어 있으면 접수 거부
create function public.institution_inquiries_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_days integer;
begin
  if tg_op = 'INSERT' then
    select (s.value ->> 'retention_days')::int into v_days from public.settings s where s.key = 'institution_inquiry_policy' and s.value ? 'retention_days';
    if v_days is null then
      raise exception 'inquiry:policy_missing' using errcode = 'check_violation';
    end if;
    new.retention_until := (new.created_at at time zone 'Asia/Seoul')::date + v_days;
  else
    if old.purged_at is not null and new.purged_at is null then
      raise exception '파기된 견적 요청은 되살릴 수 없습니다' using errcode = 'check_violation';
    end if;
    if new.consent_contact_at is distinct from old.consent_contact_at or new.receipt_no is distinct from old.receipt_no then
      raise exception '접수번호와 동의 시각은 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.institution_inquiries_guard() from public, anon, authenticated;
create trigger institution_inquiries_guard before insert or update on public.institution_inquiries for each row execute function public.institution_inquiries_guard();

alter table public.institution_inquiries enable row level security;
revoke all on table public.institution_inquiries from public, anon, authenticated, service_role;
grant select, insert, update on table public.institution_inquiries to service_role;

-- 접수 함수 - 연락 동의 없음·이메일 형식 오류는 표 검사/함수가 거부
create function public.institution_inquiry_submit(
  p_receipt text, p_org_type text, p_org_name text, p_contact_name text, p_contact_email text, p_contact_phone text,
  p_seats integer, p_message text, p_consent_contact boolean, p_consent_marketing boolean, p_version_ref bigint[], p_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_consent_contact is not true then
    raise exception 'inquiry:consent_required' using errcode = 'check_violation';
  end if;
  insert into public.institution_inquiries (receipt_no, org_type, org_name, contact_name, contact_email, contact_phone, seats_wanted, message,
                                            consent_contact_at, consent_marketing, consent_version_ref, created_at)
  values (upper(btrim(p_receipt)), p_org_type, p_org_name, p_contact_name, lower(btrim(p_contact_email)), p_contact_phone, p_seats, p_message,
          p_at, coalesce(p_consent_marketing, false), coalesce(p_version_ref, '{}'), p_at)
  returning id into v_id;
  return v_id;
end;
$$;

-- 파기 - 보존일(한국 날짜)이 지난 요청의 개인 칸을 비운다. 작업 institution-inquiry-purge가 부른다
create function public.institution_inquiries_purge(p_now timestamptz) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.institution_inquiries
     set org_name = null, contact_name = null, contact_email = null, contact_phone = null, message = null,
         purged_at = p_now, updated_by = 'system:purge'
   where purged_at is null and retention_until < (p_now at time zone 'Asia/Seoul')::date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.institution_inquiry_submit(text, text, text, text, text, text, integer, text, boolean, boolean, bigint[], timestamptz),
  public.institution_inquiries_purge(timestamptz) from public, anon, authenticated;
grant execute on function public.institution_inquiry_submit(text, text, text, text, text, text, integer, text, boolean, boolean, bigint[], timestamptz),
  public.institution_inquiries_purge(timestamptz) to service_role;
