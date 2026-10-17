-- W2-a 1단계 DB (docs/dev/W2-a_설계.md) — 공용 트리거 함수 · 인물(people) · 서비스 역할(staff_roles)
-- 모든 표는 RLS 기본 거부로 시작한다 (FND-04). 공개 읽기 정책은 20261018000008_public_read.sql에 모은다.
-- Supabase 기본 권한이 새 표·함수를 anon·authenticated에 열어 두므로, 표마다 revoke 후 service_role에만 다시 준다.

-- ─────────────────────────────────────────────────────────────
-- 공용 트리거 함수
-- ─────────────────────────────────────────────────────────────

-- 추가만 되는 표의 UPDATE·DELETE·TRUNCATE 거부 (소유자·service_role 모두). 감사 로그(audit_logs)와 같은 방식
create function public.append_only_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%는 추가만 할 수 있습니다 (% 거부)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- updated_at 자동 갱신
create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.append_only_guard() from public, anon, authenticated;
revoke all on function public.touch_updated_at() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- people — 기자·편집자·필자·감수자·전문가 공용 인물 표 (PRD-01C 5장 + PRD-01A 6.1 편집국 칸, NAV-19 등록부)
-- v1.2 authors를 대신한다. 평문 이메일·연락처 칸을 두지 않는다.
-- 약력(bio_items)은 [{item, evidence_id, verified_by, verified_at}] — 증빙 ID 없는 항목은 공개 약력(bio_items_public)에서 빠진다 (BR-01)
-- ─────────────────────────────────────────────────────────────
create table public.people (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  roles text[] not null check (cardinality(roles) > 0 and roles <@ array['reporter', 'editor', 'writer', 'reviewer', 'expert']::text[]),
  affiliation text,
  bio_items jsonb not null default '[]'::jsonb check (jsonb_typeof(bio_items) = 'array'),
  bio_items_public jsonb generated always as (
    jsonb_path_query_array(bio_items, '$[*] ? (@.evidence_id like_regex "[^[:space:]]")')
  ) stored,
  consent_doc_version text,                                   -- 동의서 버전 (BR-07 — 동의 범위는 consents와 연결)
  visibility text not null default 'hidden' check (visibility in ('public', 'hidden')),
  last_verified_at timestamptz,
  employment text check (employment in ('staff', 'external')), -- 고용 형태 [실사] — writer 중 external이 외부 기고자
  beat text,                                                  -- 담당 분야
  staff_user_id uuid unique references auth.users (id) on delete set null, -- 편집국 계정 (한 계정에 인물 행 하나)
  conflicts text,                                             -- 이해관계 (등록부 메모)
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.people is '인물 — 기자·편집자·필자·감수자·전문가 공용 (/people/[slug], NAV-19 등록부). 평문 이메일 칸 없음. 공개는 visibility=public 행의 공개 칸만';
comment on column public.people.bio_items_public is '증빙 ID가 있는 약력 항목만 — 계산 칸 (BR-01)';

create trigger people_touch before update on public.people
  for each row execute function public.touch_updated_at();

alter table public.people enable row level security;
revoke all on table public.people from anon, authenticated, service_role;
grant select, insert, update, delete on table public.people to service_role;

-- ─────────────────────────────────────────────────────────────
-- staff_roles — 서비스 역할 7종 (ACC-04, PRD-00 6장). 관리자는 환경변수 화이트리스트(ADMIN_EMAILS)라 이 표에 없다.
-- 편집 승인 역할(editor)과 편집국 외 역할(ad_ops·store_ops·brand_ops·expert_ops)을 한 사람에게 함께 주면 거부한다.
-- 관리자(PO)도 예외가 없다 (PO 결정 2026-10-17) — 트리거라 service_role·소유자 경로 모두 막힌다.
-- ─────────────────────────────────────────────────────────────
create table public.staff_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('reporter', 'editor', 'reviewer', 'ad_ops', 'store_ops', 'brand_ops', 'expert_ops')),
  granted_by text not null check (length(btrim(granted_by)) > 0),   -- 부여한 사람 — admin:<이메일> · user:<uuid>
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

comment on table public.staff_roles is '서비스 역할 (ACC-04). service_role만 쓴다. editor와 편집국 외 역할의 겸직은 트리거가 거부한다 (관리자 포함)';

create function public.staff_roles_separation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict text;
begin
  -- 같은 사람에게 동시에 두 역할을 주는 두 요청이 서로를 못 보는 일을 막는다
  perform pg_advisory_xact_lock(hashtextextended('staff_roles:' || new.user_id::text, 0));

  if new.role = 'editor' then
    select r.role into v_conflict
      from public.staff_roles r
     where r.user_id = new.user_id
       and r.role in ('ad_ops', 'store_ops', 'brand_ops', 'expert_ops')
       and (tg_op = 'INSERT' or (r.user_id, r.role) is distinct from (old.user_id, old.role))
     limit 1;
  elsif new.role in ('ad_ops', 'store_ops', 'brand_ops', 'expert_ops') then
    select r.role into v_conflict
      from public.staff_roles r
     where r.user_id = new.user_id
       and r.role = 'editor'
       and (tg_op = 'INSERT' or (r.user_id, r.role) is distinct from (old.user_id, old.role))
     limit 1;
  end if;

  if v_conflict is not null then
    raise exception '편집 승인 역할(editor)과 편집국 외 역할은 한 사람에게 함께 줄 수 없습니다 (ACC-04 — 이미 %, 새로 %)', v_conflict, new.role
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.staff_roles_separation() from public, anon, authenticated;

create trigger staff_roles_separation
  before insert or update on public.staff_roles
  for each row execute function public.staff_roles_separation();

alter table public.staff_roles enable row level security;
revoke all on table public.staff_roles from anon, authenticated, service_role;
grant select, insert, update, delete on table public.staff_roles to service_role;
