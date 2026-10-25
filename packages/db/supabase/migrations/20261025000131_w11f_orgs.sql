-- W11-f 1단계 — 기관 · 계약 · 좌석 · 기관 관리자 · 보안·개인정보 확인표 (PRD-03 BIZ-07·PAY-04, docs/dev/W11-f_설계.md)
-- 이 파일에 실제 계약 문구·확인표 문항·가격은 없다. 표 틀·검사·판정 보조 함수만 정한다 (계약서·확인표 양식은 PO·법률 입력 - 빈 칸).
-- · 기관 쓰기는 service_role 전용. 좌석 표는 읽기만 열고 쓰기는 132의 함수로만 (좌석 수 잠금).
-- · 확인표(org_security_reviews)는 추가만이고, 가장 최근 행이 '승인'이어야 계약 개통·좌석 초대·수락이 된다.
-- · W11-0(110)에서 하기로 한 기능 키·정책 설정 씨앗 중 W11-f가 쓰는 것은 병렬 작업을 위해 여기에 둔다 (이미 있으면 건드리지 않는다).

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['institution_subscription', 'premium_reports', 'institution_inquiry']) as k where not (s.value ? k)),
       updated_by = 'migration:20261025000131'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['institution_subscription', 'premium_reports', 'institution_inquiry']) as k where not (s.value ? k));

insert into public.settings (key, value, description, updated_by) values
  ('premium_report_policy', '{}'::jsonb, '프리미엄 리포트 정책 - { preview_max_chars } (PO 입력, 비어 있으면 리포트 공개 0)', 'migration:20261025000131'),
  ('institution_inquiry_policy', '{"retention_days": 365}'::jsonb, '기관 견적 요청 정책 - { retention_days } 기본 1년 [법률 검토], 비어 있으면 접수 0', 'migration:20261025000131')
on conflict (key) do update set value = excluded.value, updated_by = 'migration:20261025000131'
  where public.settings.key = 'institution_inquiry_policy' and public.settings.value = '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 기관
-- ─────────────────────────────────────────────────────────────
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  org_type text not null check (org_type in ('local_government', 'tax_firm', 'financial')),
  business_no text check (business_no is null or business_no ~ '^[0-9]{10}$'),
  business_address text check (business_address is null or char_length(btrim(business_address)) between 1 and 200),
  tax_invoice_email text check (tax_invoice_email is null or (char_length(tax_invoice_email) <= 320
    and tax_invoice_email = lower(btrim(tax_invoice_email)) and tax_invoice_email ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by text not null check (char_length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.orgs is '기관 (BIZ-07·PAY-04) - 사업자 정보는 세금계산서 요청 접수 조건. anon·authenticated 0';
create unique index orgs_business_no_idx on public.orgs (business_no) where business_no is not null;

create table public.org_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  product_id bigint references public.products (id),
  contract_ref text check (contract_ref is null or char_length(btrim(contract_ref)) between 1 and 200),
  seats integer not null check (seats between 1 and 10000),
  starts_on date not null,
  ends_on date not null,
  includes_digital boolean not null default true,
  includes_reports boolean not null default true,
  amount integer check (amount is null or (amount >= 0 and amount <= 2000000000)),
  status text not null default 'draft' check (status in ('draft', 'active', 'ended', 'cancelled')),
  edited_by text not null check (char_length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_contracts_period check (ends_on >= starts_on),
  constraint org_contracts_scope check (includes_digital or includes_reports),
  constraint org_contracts_record check (status not in ('active', 'ended') or contract_ref is not null)
);
comment on table public.org_contracts is '기관 계약 - 계약서 위치(contract_ref)는 PO 입력(빈 칸). ends_on은 종료일(당일 포함 열람), 권한은 종료일 다음 날 00:00(KST)에 끝난다. 가격(amount)은 데이터';
create unique index org_contracts_one_active_idx on public.org_contracts (org_id) where status = 'active';
create index org_contracts_org_idx on public.org_contracts (org_id);

create table public.org_seats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  contract_id uuid not null references public.org_contracts (id),
  user_id uuid references auth.users (id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'active', 'revoked')),
  invite_token_hash text not null unique check (invite_token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  invited_at timestamptz not null default now(),
  invite_expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 80),
  constraint org_seats_expiry check (invite_expires_at > invited_at),
  constraint org_seats_shape check (
    (status = 'invited' and user_id is null and accepted_at is null and revoked_at is null)
    or (status = 'active' and user_id is not null and accepted_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null))
);
comment on table public.org_seats is '기관 좌석 - 초대 링크 토큰은 해시만 둔다(메일 주소 저장 0). 초대·수락 상태가 계약 좌석 수를 쓴다(활성 좌석 합 <= 계약 좌석, 132 함수가 계약 행 잠금으로 보장)';
create unique index org_seats_one_active_user_idx on public.org_seats (org_id, user_id) where status = 'active';
create index org_seats_contract_idx on public.org_seats (contract_id, status);

create table public.org_admins (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  added_by text not null check (char_length(btrim(added_by)) > 0),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index org_admins_active_idx on public.org_admins (org_id, user_id) where revoked_at is null;

create table public.org_security_reviews (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id),
  status text not null check (status in ('requested', 'in_review', 'approved', 'rejected')),
  checklist_ref text check (checklist_ref is null or char_length(btrim(checklist_ref)) between 1 and 200),
  reviewer text check (reviewer is null or char_length(btrim(reviewer)) between 1 and 80),
  reviewed_on date,
  note text check (note is null or char_length(note) <= 500),
  created_by text not null check (char_length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  constraint org_security_reviews_approved_record check (
    status <> 'approved' or (checklist_ref is not null and reviewer is not null and reviewed_on is not null))
);
comment on table public.org_security_reviews is '보안·개인정보 확인표 (BIZ-07) - 양식·문항은 PO·법률 입력(빈 칸). 추가만, 가장 최근 행이 approved(확인표 위치·검토자·검토일 필수)여야 개통';
create index org_security_reviews_org_idx on public.org_security_reviews (org_id, id desc);

-- ─────────────────────────────────────────────────────────────
-- 보조 함수 · 트리거
-- ─────────────────────────────────────────────────────────────
create function public.org_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.org_touch() from public, anon, authenticated;
create trigger orgs_touch before update on public.orgs for each row execute function public.org_touch();
create trigger org_contracts_touch before update on public.org_contracts for each row execute function public.org_touch();

create function public.org_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception '% 표는 추가만 가능합니다', tg_table_name using errcode = 'check_violation';
end;
$$;
revoke all on function public.org_append_only() from public, anon, authenticated;
create trigger org_security_reviews_append_only before update or delete on public.org_security_reviews for each row execute function public.org_append_only();

-- 계약 시작일 00:00(KST) / 종료일 다음 날 00:00(KST) - 권한의 시작·끝(배타적)
create function public.org_contract_start_at(p_date date) returns timestamptz
language sql
immutable
set search_path = ''
as $$ select (p_date::timestamp at time zone 'Asia/Seoul'); $$;
create function public.org_contract_end_at(p_date date) returns timestamptz
language sql
immutable
set search_path = ''
as $$ select ((p_date + 1)::timestamp at time zone 'Asia/Seoul'); $$;

create function public.org_is_admin(p_user uuid, p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1 from public.org_admins a where a.org_id = p_org and a.user_id = p_user and a.revoked_at is null);
$$;

create function public.org_security_approved(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.status = 'approved' from public.org_security_reviews r where r.org_id = p_org order by r.id desc limit 1), false);
$$;
revoke all on function public.org_contract_start_at(date), public.org_contract_end_at(date),
  public.org_is_admin(uuid, uuid), public.org_security_approved(uuid) from public, anon, authenticated;
grant execute on function public.org_contract_start_at(date), public.org_contract_end_at(date),
  public.org_is_admin(uuid, uuid), public.org_security_approved(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 접근 - RLS 기본 거부, service_role만
-- ─────────────────────────────────────────────────────────────
alter table public.orgs enable row level security;
alter table public.org_contracts enable row level security;
alter table public.org_seats enable row level security;
alter table public.org_admins enable row level security;
alter table public.org_security_reviews enable row level security;
revoke all on table public.orgs, public.org_contracts, public.org_seats, public.org_admins, public.org_security_reviews
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.orgs, public.org_contracts, public.org_admins to service_role;
grant select, insert on table public.org_security_reviews to service_role;
grant select on table public.org_seats to service_role;

-- 측정 이벤트 이름 3종 더하기 (W11-0이 110에서 13종을 더하므로, 지금 있는 제약의 이름 목록을 읽어 W11-f 몫만 덧붙인다 - 목록을 통째로 다시 쓰지 않는다)
-- 기관 견적 요청 접수 · 기관 좌석 초대 수락 · 프리미엄 리포트 미리보기 보기 (속성 없음)
do $$
declare v_def text; v_names text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'analytics_events_name_check' and c.conrelid = 'public.analytics_events'::regclass;
  select array_agg(t.m[1] order by t.ord) into v_names from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as t(m, ord);
  v_names := v_names || array(select n from unnest(array['institution_inquiry_submitted', 'org_seat_accepted', 'report_previewed']) as n where n <> all (v_names));
  alter table public.analytics_events drop constraint analytics_events_name_check;
  execute format('alter table public.analytics_events add constraint analytics_events_name_check check (name = any (%L::text[]))', v_names);
end;
$$;
