-- W4 20단계 — 특례법 확인 기록 (PRD-01B PR-13, docs/dev/W4_설계.md 1장 20단계 · 2.5 · 6장 · 7장 · 12장 #14)
-- 이 파일에 특례법 이름·요건·법령 문구는 없다 — 기록 틀만 만든다. 공포 원문 주소·공포일은 관리자(PO)가 실사 뒤 직접 입력한다(12장 #14). 씨앗 0행 = 확인 전.
-- · special_law_confirmations — 추가만(고치기·지우기 0). 두 종류의 기록:
--     ① target_type = 'law'  — 특례법 공포 확인(enacted: 공포 원문 주소 + 공포일 필수) 또는 철회(withdrawn). 가장 최근 기록이 enacted일 때만 '확인됨'.
--     ② target_type = 'dev_method_fact' | 'dev_method_compare' — 특례법 근거로 표시된 한 행의 확인. 어느 판(target_version)을 어느 공포 확인(law_confirmation_id) 기준으로 봤는지 남긴다.
--        사실 행은 판(행 번호)이 새로 생기면, 비교 항목은 글·표시를 고치면 판 값이 달라져 앞 확인이 맞지 않는다 → 다시 확인해야 보인다.
-- · dev_method_facts · dev_method_compare 에 special_law_basis(특례법 근거 표시 칸, 기본 false). 표시를 켜 저장하려면 '확인됨'(가장 최근 공포 확인이 enacted)이어야 한다.
--   비교 항목의 표시만 바꿔도 감수 서명을 지운다(글을 고친 것과 같다). 사실 행은 새 판으로만 바뀐다.
-- · 공개 뷰 public_dev_method_compare · public_dev_method_facts 에 special_law_basis를 맨 뒤에 더한다(표시 + 공포 확인 + 그 행 확인이 모두 맞을 때만 true). public_special_law = 확인됨일 때만 1행.
-- 기존 표 칸·제약·값은 바꾸지 않는다.

alter table public.dev_method_facts add column special_law_basis boolean not null default false;
alter table public.dev_method_compare add column special_law_basis boolean not null default false;
comment on column public.dev_method_facts.special_law_basis is '특례법 근거 표시 (PR-13) — 켜려면 특례법 공포 확인(enacted)이 있어야 하고, 공개 화면에는 그 행의 확인 기록이 맞을 때만 나타난다. 새 판은 표시를 새로 정한다';
comment on column public.dev_method_compare.special_law_basis is '특례법 근거 표시 (PR-13) — 켜려면 특례법 공포 확인(enacted)이 있어야 하고, 고치면 감수 서명이 지워지며 그 칸의 확인도 다시 해야 한다';

-- 비교 항목의 판 값 — 글·표시·저장 시각이 모두 들어간다(같은 거래 안에서 고쳐도 달라진다)
create function public.special_law_compare_version(p_body text, p_basis boolean, p_drafted_at timestamptz) returns text
language sql
stable
set search_path = ''
as $$
  select md5(coalesce(p_body, '') || '|' || p_basis::text || '|' || floor(extract(epoch from p_drafted_at) * 1000000)::bigint::text);
$$;
revoke all on function public.special_law_compare_version(text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.special_law_compare_version(text, boolean, timestamptz) to service_role;

create table public.special_law_confirmations (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('law', 'dev_method_fact', 'dev_method_compare')),
  target_ref text check (target_ref is null or char_length(target_ref) between 1 and 80),
  target_version text check (target_version is null or char_length(target_version) between 1 and 80),
  law_confirmation_id bigint references public.special_law_confirmations (id),
  status text not null check (status in ('enacted', 'withdrawn')),
  promulgation_url text check (promulgation_url is null or (promulgation_url ~* '^https?://[^[:space:]]+$' and char_length(promulgation_url) <= 500)),
  promulgated_on date,
  confirmed_by text not null check (confirmed_by ~ '^user:[0-9a-fA-F-]{36}$'),
  confirmed_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) between 1 and 200),
  constraint special_law_confirmations_shape check (
    case when target_type = 'law'
      then target_ref is null and target_version is null and law_confirmation_id is null
           and ((status = 'enacted' and promulgation_url is not null and promulgated_on is not null)
             or (status = 'withdrawn' and promulgation_url is null and promulgated_on is null))
      else target_ref is not null and target_version is not null and promulgation_url is null and promulgated_on is null
           and ((status = 'enacted') = (law_confirmation_id is not null))
    end)
);
comment on table public.special_law_confirmations is '특례법 확인 기록 (PR-13) — 추가만. law = 공포 확인·철회(공포 원문 주소·공포일은 enacted에 필수), 나머지 = 특례법 근거로 표시된 한 행의 확인(어느 판·어느 공포 확인 기준). 가장 최근 기록이 결정한다. 관리자(PO)만 적는다';
comment on column public.special_law_confirmations.target_ref is '행 확인의 대상 — 사실 행은 행 번호, 비교 항목은 slug:항목. law는 비어 있다';
comment on column public.special_law_confirmations.target_version is '행 확인의 판 — 사실 행은 행 번호(새 판 = 새 번호), 비교 항목은 글·표시·저장 시각에서 계산한 값. 판이 달라지면 확인이 맞지 않는다';
comment on column public.special_law_confirmations.law_confirmation_id is '행 확인이 기준으로 본 공포 확인 기록 (enacted 행 확인에 필수)';
comment on column public.special_law_confirmations.promulgation_url is '공포 원문 주소 (enacted law 필수) — 공개 화면은 링크만';
comment on column public.special_law_confirmations.promulgated_on is '공포일 (enacted law 필수)';
comment on column public.special_law_confirmations.confirmed_by is '확인한 사람 (user:<id>) — 서버가 관리자(PO)만 통과시킨다';
comment on column public.special_law_confirmations.reason is '확인·철회 사유 (1~200자)';
create index special_law_confirmations_target_idx on public.special_law_confirmations (target_type, target_ref, id desc);

-- 지금 '확인됨'인 공포 확인 기록의 번호 (가장 최근 law 기록이 enacted일 때만, 아니면 null)
create function public.special_law_current() returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted';
$$;
revoke all on function public.special_law_current() from public, anon, authenticated;
grant execute on function public.special_law_current() to service_role;

create function public.special_law_confirmations_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current bigint := public.special_law_current();
  v_fact public.dev_method_facts;
  v_cmp public.dev_method_compare;
  v_method_id bigint;
  v_slug text;
  v_item text;
begin
  new.confirmed_at := now();
  if new.target_type = 'law' then
    if new.status = 'withdrawn' and v_current is null then
      raise exception '철회할 특례법 공포 확인이 없습니다 (지금 확인됨 상태가 아닙니다)' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.status = 'withdrawn' then
    if not exists (select 1 from public.special_law_confirmations p where p.target_type = new.target_type and p.target_ref = new.target_ref) then
      raise exception '철회할 행 확인이 없습니다 (%)', new.target_ref using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if v_current is null or new.law_confirmation_id is distinct from v_current then
    raise exception '행 확인은 지금 확인됨인 특례법 공포 확인(%)을 기준으로 해야 합니다 — 공포 확인이 없거나 철회됐습니다', coalesce(v_current::text, '없음') using errcode = 'check_violation';
  end if;
  if new.target_type = 'dev_method_fact' then
    if new.target_ref !~ '^[0-9]+$' then
      raise exception '사실 행 확인의 대상은 행 번호입니다' using errcode = 'check_violation';
    end if;
    select f.* into v_fact from public.dev_method_facts f where f.id = new.target_ref::bigint;
    if v_fact.id is null or not v_fact.special_law_basis then
      raise exception '특례법 근거로 표시된 사실 행이 아닙니다 (%)', new.target_ref using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.dev_method_facts n where n.supersedes_id = v_fact.id) then
      raise exception '사실 행(%)은 최신 판이 아닙니다 — 최신 판을 확인하세요', new.target_ref using errcode = 'check_violation';
    end if;
    if new.target_version is distinct from v_fact.id::text then
      raise exception '사실 행 확인의 판 값이 행 번호와 다릅니다' using errcode = 'check_violation';
    end if;
  else
    v_slug := split_part(new.target_ref, ':', 1);
    v_item := split_part(new.target_ref, ':', 2);
    select m.id into v_method_id from public.dev_methods m where m.slug = v_slug;
    select c.* into v_cmp from public.dev_method_compare c where c.method_id = v_method_id and c.item = v_item;
    if v_cmp.method_id is null or not v_cmp.special_law_basis then
      raise exception '특례법 근거로 표시된 비교 항목이 아닙니다 (%)', new.target_ref using errcode = 'check_violation';
    end if;
    if new.target_version is distinct from public.special_law_compare_version(v_cmp.body, v_cmp.special_law_basis, v_cmp.drafted_at) then
      raise exception '비교 항목(%)의 글·표시가 그 사이 바뀌었습니다 — 새로 불러와 확인하세요', new.target_ref using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.special_law_confirmations_guard() from public, anon, authenticated;
create trigger special_law_confirmations_guard
  before insert on public.special_law_confirmations
  for each row execute function public.special_law_confirmations_guard();
create trigger special_law_confirmations_no_update
  before update on public.special_law_confirmations
  for each row execute function public.append_only_guard();
create trigger special_law_confirmations_no_delete
  before delete on public.special_law_confirmations
  for each row execute function public.append_only_guard();
create trigger special_law_confirmations_no_truncate
  before truncate on public.special_law_confirmations
  for each statement execute function public.append_only_guard();

alter table public.special_law_confirmations enable row level security;
revoke all on table public.special_law_confirmations from public, anon, authenticated, service_role;
grant select, insert on table public.special_law_confirmations to service_role;

-- 표시를 켠 사실 행·비교 항목은 공포 확인이 있어야 저장된다 (확인 기록 없이 저장 거부)
create function public.dev_method_facts_special_law_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.special_law_basis and public.special_law_current() is null then
    raise exception '특례법 근거 표시는 특례법 공포 확인(공포 원문 주소·공포일·확인자)이 있어야 저장됩니다 — 관리자(PO)가 먼저 확인 기록을 남깁니다 (PR-13)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.dev_method_facts_special_law_guard() from public, anon, authenticated;
create trigger dev_method_facts_special_law_guard
  before insert on public.dev_method_facts
  for each row execute function public.dev_method_facts_special_law_guard();

-- 비교 항목: 기존 저장 검사(dev_method_compare_guard) 뒤에 돈다 (이름 순서). 표시만 바꿔도 서명을 지운다
create function public.dev_method_compare_special_law_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.special_law_basis and public.special_law_current() is null then
    raise exception '특례법 근거 표시는 특례법 공포 확인(공포 원문 주소·공포일·확인자)이 있어야 저장됩니다 — 관리자(PO)가 먼저 확인 기록을 남깁니다 (PR-13)' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.special_law_basis is distinct from old.special_law_basis and new.body is not distinct from old.body then
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_status := case when old.review_status = 'draft' then 'draft' else 'rereview_needed' end;
    new.drafted_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.dev_method_compare_special_law_guard() from public, anon, authenticated;
create trigger dev_method_compare_z_special_law_guard
  before insert or update on public.dev_method_compare
  for each row execute function public.dev_method_compare_special_law_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 읽기 — 행이 '표시 + 공포 확인 + 그 행 확인(판 일치)'일 때만 true. 함수는 부르는 사람 권한으로 실행되므로 식은 뷰 몸에 적는다(special_law_compare_version과 같은 식)
-- ─────────────────────────────────────────────────────────────
create view public.special_law_visible as
select 'dev_method_fact'::text as target_type, f.id::text as target_ref
  from public.dev_method_facts f
 where f.special_law_basis
   and (select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted') is not null
   and exists (
     select 1 from (
       select r.* from public.special_law_confirmations r
        where r.target_type = 'dev_method_fact' and r.target_ref = f.id::text
        order by r.id desc limit 1) r
      where r.status = 'enacted' and r.target_version = f.id::text and r.law_confirmation_id = (select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted'))
union all
select 'dev_method_compare'::text, m.slug || ':' || c.item
  from public.dev_method_compare c
  join public.dev_methods m on m.id = c.method_id
 where c.special_law_basis
   and (select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted') is not null
   and exists (
     select 1 from (
       select r.* from public.special_law_confirmations r
        where r.target_type = 'dev_method_compare' and r.target_ref = m.slug || ':' || c.item
        order by r.id desc limit 1) r
      where r.status = 'enacted'
        and r.target_version = md5(coalesce(c.body, '') || '|' || c.special_law_basis::text || '|' || floor(extract(epoch from c.drafted_at) * 1000000)::bigint::text)
        and r.law_confirmation_id = (select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted'));
comment on view public.special_law_visible is '특례법 근거 표시가 공개돼도 되는 행 (표시 + 공포 확인 + 그 행 확인의 판 일치). service_role만 — 공개 뷰가 읽는다';
revoke all on table public.special_law_visible from public, anon, authenticated, service_role;
grant select on table public.special_law_visible to service_role;

create view public.public_special_law as
select l.promulgation_url, l.promulgated_on, l.confirmed_at
  from public.special_law_confirmations l
 where l.id = (select x.id from (select l.id, l.status from public.special_law_confirmations l where l.target_type = 'law' order by l.id desc limit 1) x where x.status = 'enacted');
comment on view public.public_special_law is '특례법 공포 확인 (PR-13) — 확인됨일 때만 1행(공포 원문 주소·공포일·확인일). 확인자·사유 칸 0';
revoke all on table public.public_special_law from public, anon, authenticated, service_role;
grant select on table public.public_special_law to anon, authenticated, service_role;

create or replace view public.public_dev_method_compare as
select
  m.slug,
  m.sort,
  c.item,
  array_position(array['legal_basis', 'actor', 'target', 'procedure', 'numeric_requirements', 'tax_issues']::text[], c.item) as item_position,
  c.body,
  c.reviewed_at,
  (select pe.name from public.people pe
    where pe.visibility = 'public' and pe.staff_user_id is not null
      and 'user:' || pe.staff_user_id::text = lower(c.reviewed_by)
    order by pe.id limit 1) as reviewer_name,
  exists (select 1 from public.special_law_visible v where v.target_type = 'dev_method_compare' and v.target_ref = m.slug || ':' || c.item) as special_law_basis
from public.dev_method_compare c
join public.dev_methods m on m.id = c.method_id
where m.slug in (select p.slug from public.public_dev_methods p);

create or replace view public.public_dev_method_facts as
select
  m.slug,
  m.sort,
  f.fact_key,
  f.label,
  f.value,
  f.unit,
  f.law_ref,
  f.reference_date,
  f.source_url,
  f.version,
  f.reviewed_at,
  pr.name as reviewer_name,
  exists (select 1 from public.source_review_queue q where q.target_type = 'dev_method_fact' and q.target_id = f.id and q.status = 'open') as under_review,
  exists (select 1 from public.special_law_visible v where v.target_type = 'dev_method_fact' and v.target_ref = f.id::text) as special_law_basis
from public.dev_method_facts f
join public.dev_methods m on m.id = f.method_id
join lateral (
  select pe.name from public.people pe
   where pe.visibility = 'public' and pe.staff_user_id is not null
     and 'user:' || pe.staff_user_id::text = lower(f.reviewed_by)
   order by pe.id limit 1
) pr on true
where m.slug in (select p.slug from public.public_dev_methods p)
  and not exists (select 1 from public.dev_method_facts n where n.supersedes_id = f.id)
  and f.reviewed_by is not null
  and f.reference_date is not null
  and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(f.reviewed_by));
