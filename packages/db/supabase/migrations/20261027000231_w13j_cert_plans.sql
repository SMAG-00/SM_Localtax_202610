-- W13-j j1 - 정보보호 인증 추진 계획 (PRD-05 SEC-02, docs/dev/W13-j_설계.md)
-- 이 파일에 인증 종류 선택·범위·일정·비용·담당·명의 값은 없다 (모두 PO 입력, 씨앗 0행). 인증 취득을 뜻하는 칸도 없다.
-- · security_cert_plans - 계획 항목(종류·범위·일정·비용 추정·담당 필수). 버전마다 새 행, 내용 불변. 승인·철회는 232의 함수로만.
-- · security_cert_audit - 승인·철회 감사. 추가만, 거부도 1행.

create table public.security_cert_plans (
  id bigint generated always as identity primary key,
  cert_kind text not null check (cert_kind in ('iso27001', 'ismsp', 'other')),
  other_kind_name text check (other_kind_name is null or char_length(btrim(other_kind_name)) between 1 and 80),
  scope text not null check (char_length(btrim(scope)) between 1 and 2000),
  target_start_on date not null,
  target_end_on date not null,
  cost_estimate_krw bigint not null check (cost_estimate_krw >= 0),
  owner_name text not null check (char_length(btrim(owner_name)) between 1 and 80),
  entity_name text check (entity_name is null or char_length(btrim(entity_name)) between 1 and 120),
  risk_assessed_on date,
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded', 'withdrawn')),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint security_cert_plans_dates check (target_end_on >= target_start_on),
  constraint security_cert_plans_other check ((cert_kind = 'other') = (other_kind_name is not null)),
  constraint security_cert_plans_approval check ((status in ('approved', 'superseded')) = (approved_by is not null and approved_at is not null) or status = 'withdrawn'),
  constraint security_cert_plans_closed check ((status in ('superseded', 'withdrawn')) = (closed_at is not null))
);
comment on table public.security_cert_plans is '정보보호 인증 추진 계획(SEC-02) - 승인된 1건이 기관 판매 게이트·/security 추진 중 표기의 근거. 인증 취득 기록 아님. 값은 PO 입력';
create unique index security_cert_plans_one_approved on public.security_cert_plans ((true)) where status = 'approved';

create function public.security_cert_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '인증 추진 계획·감사 기록은 지우거나 고치지 못합니다 (% 거부) - 철회하고 새 계획을 적습니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.security_cert_no_delete() from public, anon, authenticated;

create function public.security_cert_plans_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '인증 추진 계획은 초안(draft)으로만 만들 수 있습니다 - 승인은 security_cert_plan_approve 함수로만 합니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.cert_kind is distinct from old.cert_kind or new.other_kind_name is distinct from old.other_kind_name or new.scope is distinct from old.scope
     or new.target_start_on is distinct from old.target_start_on or new.target_end_on is distinct from old.target_end_on
     or new.cost_estimate_krw is distinct from old.cost_estimate_krw or new.owner_name is distinct from old.owner_name
     or new.entity_name is distinct from old.entity_name or new.risk_assessed_on is distinct from old.risk_assessed_on
     or new.note is distinct from old.note or new.drafted_by is distinct from old.drafted_by or new.created_at is distinct from old.created_at then
    raise exception '인증 추진 계획의 내용은 고칠 수 없습니다 - 새 계획을 적으세요' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at or new.closed_at is distinct from old.closed_at then
    if coalesce(current_setting('ltr.security_cert_gate', true), '') <> 'rpc' then
      raise exception '승인·철회 상태는 security_cert_plan_approve/security_cert_plan_withdraw 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.security_cert_plans_guard() from public, anon, authenticated;
create trigger security_cert_plans_guard before insert or update on public.security_cert_plans for each row execute function public.security_cert_plans_guard();
create trigger security_cert_plans_no_delete before delete on public.security_cert_plans for each row execute function public.security_cert_no_delete();
create trigger security_cert_plans_no_truncate before truncate on public.security_cert_plans for each statement execute function public.security_cert_no_delete();

create table public.security_cert_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  plan_id bigint not null,
  action text not null check (action in ('approve', 'withdraw')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint security_cert_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.security_cert_audit is '인증 추진 계획 승인·철회 감사 - 추가만, 거부도 1행(code가 사유)';
create index security_cert_audit_plan_idx on public.security_cert_audit (plan_id, at desc);
create trigger security_cert_audit_no_update_delete before update or delete on public.security_cert_audit for each row execute function public.security_cert_no_delete();
create trigger security_cert_audit_no_truncate before truncate on public.security_cert_audit for each statement execute function public.security_cert_no_delete();

alter table public.security_cert_plans enable row level security;
alter table public.security_cert_audit enable row level security;
revoke all on table public.security_cert_plans, public.security_cert_audit from anon, authenticated, service_role;
grant select, insert on table public.security_cert_plans, public.security_cert_audit to service_role;
