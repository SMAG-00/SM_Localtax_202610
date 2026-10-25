-- W11-f 5단계 — 세금계산서·영수증 요청 기록 (PRD-03 PAY-04, PO 기본값 #13 온라인 결제 없음 · #14 요청 기록 + 수기 발행)
-- · 요청은 기관 관리자(또는 운영자)가 올리고, 발행은 사람이 따로 하고 발행 기록(번호·날짜)만 남긴다. 발행 연동·자동 발행 코드 0.
-- · 사업자등록번호·세금계산서 수신 이메일이 기관에 없으면 접수되지 않는다.
-- · 매출 원장 뷰 org_revenue_ledger는 상품·기간·좌석·금액·기관 유형만 낸다 - 기관명·사업자번호·회원·이메일 칸 0 (BIZ-09).
-- 오류 문장은 'tax_invoice:코드'로 시작한다.

create table public.tax_invoice_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id),
  contract_id uuid not null references public.org_contracts (id),
  kind text not null check (kind in ('tax_invoice', 'receipt')),
  supply_amount integer not null check (supply_amount >= 0 and supply_amount <= 2000000000),
  business_no_snapshot text not null check (business_no_snapshot ~ '^[0-9]{10}$'),
  email_snapshot text not null check (char_length(email_snapshot) <= 320),
  status text not null default 'requested' check (status in ('requested', 'issued', 'cancelled')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  issued_ref text check (issued_ref is null or char_length(btrim(issued_ref)) between 1 and 100),
  issued_on date,
  issued_by text check (issued_by is null or char_length(btrim(issued_by)) between 1 and 80),
  constraint tax_invoice_requests_issue_record check (
    (status = 'issued') = (issued_ref is not null and issued_on is not null and issued_by is not null))
);
comment on table public.tax_invoice_requests is '세금계산서·영수증 요청 (PAY-04) - 요청 기록 + 수기 발행(발행 번호·날짜·담당자 기록). 사업자 정보 없는 기관은 접수 불가. anon·authenticated 0';
create index tax_invoice_requests_org_idx on public.tax_invoice_requests (org_id, requested_at desc);

alter table public.tax_invoice_requests enable row level security;
revoke all on table public.tax_invoice_requests from public, anon, authenticated, service_role;
grant select on table public.tax_invoice_requests to service_role;

create function public.tax_invoice_request_create(p_actor uuid, p_org uuid, p_contract uuid, p_kind text, p_supply_amount integer) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orgs; c public.org_contracts; v_id uuid;
begin
  if p_actor is not null and not public.org_is_admin(p_actor, p_org) then
    raise exception 'tax_invoice:not_admin' using errcode = 'check_violation';
  end if;
  select * into o from public.orgs where id = p_org;
  if not found then raise exception 'tax_invoice:org_not_found' using errcode = 'check_violation'; end if;
  if o.business_no is null or o.tax_invoice_email is null then
    raise exception 'tax_invoice:business_info_missing' using errcode = 'check_violation';
  end if;
  select * into c from public.org_contracts where id = p_contract and org_id = p_org and status in ('active', 'ended');
  if not found then raise exception 'tax_invoice:no_contract' using errcode = 'check_violation'; end if;
  insert into public.tax_invoice_requests (org_id, contract_id, kind, supply_amount, business_no_snapshot, email_snapshot, requested_by)
  values (p_org, p_contract, p_kind, p_supply_amount, o.business_no, o.tax_invoice_email, p_actor) returning id into v_id;
  return v_id;
end;
$$;

create function public.tax_invoice_mark_issued(p_id uuid, p_issued_ref text, p_issued_on date, p_by text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tax_invoice_requests set status = 'issued', issued_ref = p_issued_ref, issued_on = p_issued_on, issued_by = p_by
   where id = p_id and status = 'requested';
  if not found then raise exception 'tax_invoice:not_requested' using errcode = 'check_violation'; end if;
end;
$$;
revoke all on function public.tax_invoice_request_create(uuid, uuid, uuid, text, integer),
  public.tax_invoice_mark_issued(uuid, text, date, text) from public, anon, authenticated;
grant execute on function public.tax_invoice_request_create(uuid, uuid, uuid, text, integer),
  public.tax_invoice_mark_issued(uuid, text, date, text) to service_role;

-- 매출 원장 뷰 - 개인·기관 식별 칸 0
create view public.org_revenue_ledger as
select c.product_id, o.org_type, c.starts_on, c.ends_on, c.seats, c.amount, c.status
  from public.org_contracts c
  join public.orgs o on o.id = c.org_id
 where c.status in ('active', 'ended') and c.amount is not null;
comment on view public.org_revenue_ledger is '기관 계약 매출 원장 (BIZ-09) - 상품·기간·좌석·금액·기관 유형만. 기관명·사업자번호·회원·메일 칸 0';
revoke all on table public.org_revenue_ledger from public, anon, authenticated, service_role;
grant select on table public.org_revenue_ledger to service_role;
