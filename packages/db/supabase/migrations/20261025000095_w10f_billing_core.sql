-- W10-f 1단계 — 결제 기반 · 디지털 구독 (PRD-02 PAY-01·02·03·05·07, BIZ-04, docs/dev/W10-f_설계.md)
-- 이 파일에 실제 가격·약관·정책 문구는 없다. 표 틀·검사·권한 판정 함수만 정한다. 가격은 product_plans 데이터, 고지 기한은 설정 renewal_notice_policy.
-- · 카드번호 칸은 어디에도 없다 (PAY-07). PG가 준 빌링키 문자열만 subscriptions.billing_key에 둔다.
-- · 결제·권한 표는 쓰기 함수(security definer, service_role 전용)로만 바뀐다. 웹훅은 서명 검증 뒤 PG 조회 결과를 이 함수들에 넘긴다.
-- · live 결제 주문은 commerce_readiness 행(PG 계약·통신판매업·약관·부가세 확인 기록)이 없으면 DB가 거부한다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (products는 종류·주문 방식 값만 늘린다).

-- ─────────────────────────────────────────────────────────────
-- 설정 모양 검사 (씨앗은 0차 80의 빈 객체 그대로)
-- ─────────────────────────────────────────────────────────────
create function public.billing_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '설정 %은 객체입니다', new.key using errcode = 'check_violation';
  end if;
  if new.key = 'renewal_notice_policy' then
    if exists (select 1 from jsonb_object_keys(new.value) k where k <> 'days')
       or (new.value ? 'days' and (jsonb_typeof(new.value -> 'days') is distinct from 'number'
            or (new.value ->> 'days') !~ '^[0-9]+$' or (new.value ->> 'days')::int not between 1 and 90)) then
      raise exception '갱신 사전 고지 설정(renewal_notice_policy)은 { days: 1~90 정수 }이거나 빈 객체(기본값 사용)입니다' using errcode = 'check_violation';
    end if;
  elsif new.key = 'billing_retry_policy' then
    if exists (select 1 from jsonb_object_keys(new.value) k where k not in ('max_retries', 'grace_days'))
       or (new.value ? 'max_retries' and (jsonb_typeof(new.value -> 'max_retries') is distinct from 'number'
            or (new.value ->> 'max_retries') !~ '^[0-9]+$' or (new.value ->> 'max_retries')::int not between 0 and 10))
       or (new.value ? 'grace_days' and (jsonb_typeof(new.value -> 'grace_days') is distinct from 'number'
            or (new.value ->> 'grace_days') !~ '^[0-9]+$' or (new.value ->> 'grace_days')::int not between 0 and 30)) then
      raise exception '결제 재시도 설정(billing_retry_policy)은 { max_retries: 0~10, grace_days: 0~30 } 정수이거나 빈 객체(재시도·유예 0)입니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.billing_settings_guard() from public, anon, authenticated;
create trigger settings_billing_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('renewal_notice_policy', 'billing_retry_policy'))
  execute function public.billing_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- products 확장 — 종류 digital_subscription · 주문 방식 pg · 결제 방식 칸 (기존 값은 그대로)
-- ─────────────────────────────────────────────────────────────
alter table public.products drop constraint products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('book', 'education', 'subscription', 'digital_subscription'));
alter table public.products drop constraint products_order_mode_check;
alter table public.products add constraint products_order_mode_check check (order_mode in ('existing_channel', 'request_form', 'pg'));
alter table public.products add column billing_mode text not null default 'none' check (billing_mode in ('none', 'pg'));
alter table public.products add constraint products_pg_shape check (
  ((kind = 'digital_subscription') = (order_mode = 'pg')) and ((order_mode = 'pg') = (billing_mode = 'pg')));
comment on column public.products.billing_mode is '결제 방식 - none(1단계 바깥 링크·문의함) / pg(디지털 구독, 결제 모듈). pg 상품은 W8 공개 뷰(public_store_products)에 나오지 않는다';

-- ─────────────────────────────────────────────────────────────
-- 요금제 — 가격은 데이터 (코드 상수 0)
-- ─────────────────────────────────────────────────────────────
create table public.product_plans (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id),
  plan_key text not null check (plan_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(plan_key) <= 40),
  title text not null check (char_length(btrim(title)) between 1 and 60),
  period_months smallint not null check (period_months between 1 and 24),
  amount integer not null check (amount >= 0 and amount <= 100000000),
  currency text not null default 'KRW' check (currency = 'KRW'),
  entitlement_key text not null default 'digital' check (entitlement_key in ('digital')),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  sort_order smallint not null default 0,
  edited_by text not null check (length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, plan_key),
  constraint product_plans_active_amount check (status <> 'active' or amount > 0)
);
comment on table public.product_plans is '디지털 구독 요금제 (PAY-01) - 금액·기간은 이 표의 데이터이고 코드에 가격 상수가 없다. 주문은 주문 시점 금액을 따로 저장한다';
create index product_plans_product_idx on public.product_plans (product_id);

create function public.product_plans_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if not exists (select 1 from public.products p where p.id = new.product_id and p.billing_mode = 'pg' and p.kind = 'digital_subscription') then
    raise exception '요금제는 결제 방식 pg인 디지털 구독 상품에만 둘 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.product_plans_guard() from public, anon, authenticated;
create trigger product_plans_guard before insert or update on public.product_plans for each row execute function public.product_plans_guard();

-- ─────────────────────────────────────────────────────────────
-- 구독 · 주문 · 고지 · 웹훅 기록 · 권한 · 실결제 준비 기록
-- ─────────────────────────────────────────────────────────────
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id bigint not null references public.products (id),
  plan_id bigint not null references public.product_plans (id),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'expired')),
  auto_renew boolean not null default false,
  billing_key text check (billing_key is null or char_length(billing_key) between 8 and 200),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  grace_until timestamptz,
  retry_count smallint not null default 0 check (retry_count >= 0),
  cancel_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period check (current_period_end > current_period_start),
  constraint subscriptions_auto_renew_key check (not auto_renew or billing_key is not null)
);
comment on table public.subscriptions is '디지털 구독 (PAY-02) - billing_key는 PG가 준 빌링키 문자열이고 카드번호가 아니다 (PAY-07). 쓰기는 billing_* 함수로만';
create unique index subscriptions_one_live on public.subscriptions (user_id, product_id) where status in ('active', 'past_due');
create index subscriptions_due_idx on public.subscriptions (current_period_end) where status in ('active', 'past_due');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique check (order_no ~ '^[A-Za-z0-9_-]{8,64}$'),
  user_id uuid references auth.users (id) on delete set null,
  product_id bigint not null references public.products (id),
  plan_id bigint not null references public.product_plans (id),
  subscription_id uuid references public.subscriptions (id),
  kind text not null check (kind in ('initial', 'renewal')),
  amount integer not null check (amount > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  provider text not null check (provider in ('fake', 'toss')),
  mode text not null check (mode in ('test', 'live')),
  status text not null default 'created' check (status in ('created', 'paid', 'failed', 'canceled', 'refunded')),
  pg_payment_key text check (pg_payment_key is null or char_length(pg_payment_key) between 1 and 200),
  pg_status text check (pg_status is null or char_length(pg_status) <= 40),
  pg_checked_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) <= 40),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  terms_ack_at timestamptz,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_fake_is_test check (provider <> 'fake' or mode = 'test'),
  constraint orders_paid_has_time check (status <> 'paid' or paid_at is not null),
  constraint orders_initial_ack check (kind <> 'initial' or terms_ack_at is not null),
  unique (user_id, idempotency_key)
);
comment on table public.orders is '디지털 구독 주문 (PAY-01·02) - 카드 칸 0. amount는 주문 시점 요금제 금액의 복사본. live 주문은 commerce_readiness 행이 있어야 만들어진다';
create index orders_user_idx on public.orders (user_id, created_at desc);

create table public.renewal_notices (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  kind text not null check (kind in ('checkout', 'auto_renew', 'price_change')),
  period_end timestamptz not null,
  amount integer not null check (amount > 0),
  channel text not null default 'screen' check (channel in ('screen', 'mail', 'record')),
  notified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (subscription_id, period_end, kind)
);
comment on table public.renewal_notices is '자동갱신·가격 변경 사전 고지 기록 (PAY-05, 전자상거래 [감수 필요]) - 이 기록이 없으면 갱신 주문이 만들어지지 않는다. 추가만, 수정·삭제 거부';

create table public.payment_events (
  id bigint generated always as identity primary key,
  pg_event_id text not null unique check (char_length(pg_event_id) between 1 and 200),
  provider text not null check (provider in ('fake', 'toss')),
  event_type text not null check (char_length(event_type) between 1 and 80),
  order_no text check (order_no is null or char_length(order_no) <= 64),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.payment_events is 'PG 웹훅 수신 기록 (PAY-02) - 서명 검증을 통과한 이벤트만. pg_event_id 유일이 멱등의 근거, 원문 대신 SHA-256 해시만 둔다';

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null check (key in ('digital')),
  source text not null check (source in ('subscription', 'paper_link', 'manual')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 80),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint entitlements_period check (valid_until > valid_from),
  unique (source, source_ref)
);
comment on table public.entitlements is '권한 (PAY-03) - 판정은 has_entitlement 함수 하나. valid_until은 이 시각부터 권한이 없는 끝 시각(배타적). 같은 구독의 갱신은 같은 행의 valid_until을 늘린다';
create index entitlements_user_idx on public.entitlements (user_id, key);

create table public.commerce_readiness (
  id bigint generated always as identity primary key,
  contract_ref text not null check (char_length(btrim(contract_ref)) between 1 and 200),
  business_report_ref text not null check (char_length(btrim(business_report_ref)) between 1 and 200),
  policy_ref text not null check (char_length(btrim(policy_ref)) between 1 and 200),
  vat_review_ref text not null check (char_length(btrim(vat_review_ref)) between 1 and 200),
  confirmed_by text not null check (char_length(btrim(confirmed_by)) between 1 and 80),
  confirmed_on date not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.commerce_readiness is '실결제 준비 확인 기록 (PO 입력) - PG 계약·통신판매업 신고·약관/환불 정책·부가세 감수의 근거 위치. 철회되지 않은 행이 하나도 없으면 live 주문 0. 추가만(철회 시각만 수정)';

-- 추가만 · 변경 제한
create function public.billing_append_only() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'commerce_readiness' and tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'revoked_at') is distinct from (to_jsonb(old) - 'revoked_at') or old.revoked_at is not null then
      raise exception '실결제 준비 기록은 철회 시각만 한 번 고칠 수 있습니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  raise exception '% 표는 추가만 가능합니다', tg_table_name using errcode = 'check_violation';
end;
$$;
revoke all on function public.billing_append_only() from public, anon, authenticated;
create trigger renewal_notices_append_only before update or delete on public.renewal_notices for each row execute function public.billing_append_only();
create trigger commerce_readiness_append_only before update or delete on public.commerce_readiness for each row execute function public.billing_append_only();
create trigger orders_no_delete before delete on public.orders for each row execute function public.billing_append_only();
create trigger payment_events_no_delete before delete on public.payment_events for each row execute function public.billing_append_only();

create function public.orders_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.mode = 'live' and not exists (select 1 from public.commerce_readiness r where r.revoked_at is null) then
      raise exception '실결제 준비 확인 기록(commerce_readiness)이 없어 live 주문을 만들 수 없습니다' using errcode = 'check_violation';
    end if;
  else
    if new.amount is distinct from old.amount or new.plan_id is distinct from old.plan_id or new.product_id is distinct from old.product_id
       or (new.user_id is distinct from old.user_id and new.user_id is not null) or new.mode is distinct from old.mode
       or new.provider is distinct from old.provider or new.order_no is distinct from old.order_no or new.kind is distinct from old.kind then
      raise exception '주문의 금액·요금제·방식은 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.orders_guard() from public, anon, authenticated;
create trigger orders_guard before insert or update on public.orders for each row execute function public.orders_guard();

-- ─────────────────────────────────────────────────────────────
-- 접근 (service_role 읽기만 - 쓰기는 아래 함수) · 공개 요금표 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.product_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.orders enable row level security;
alter table public.renewal_notices enable row level security;
alter table public.payment_events enable row level security;
alter table public.entitlements enable row level security;
alter table public.commerce_readiness enable row level security;
revoke all on table public.product_plans, public.subscriptions, public.orders, public.renewal_notices,
  public.payment_events, public.entitlements, public.commerce_readiness from public, anon, authenticated, service_role;
grant select, insert, update on table public.product_plans to service_role;
grant select, insert, update on table public.commerce_readiness to service_role;
grant select on table public.subscriptions, public.orders, public.renewal_notices, public.payment_events, public.entitlements to service_role;

-- 공개 요금표 - 기능 키 billing·digital_subscription 켜짐 + 판매 중 상품(확인일·근거) + 활성 요금제.
-- (판매 권리 확인된 유료 본문이 있어야 한다는 조건은 96의 뷰 public_digital_plans_sellable이 더한다)
create view public.public_digital_plans as
select pl.id as plan_id, pl.plan_key, pl.title as plan_title, pl.period_months, pl.amount, pl.currency, pl.sort_order,
       p.id as product_id, p.slug, p.title as product_title, p.summary
  from public.product_plans pl
  join public.products p on p.id = pl.product_id
 where pl.status = 'active' and p.status = 'on_sale' and p.kind = 'digital_subscription' and p.billing_mode = 'pg'
   and p.verified_on is not null and char_length(btrim(coalesce(p.verified_ref, ''))) > 0
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'billing') = 'true'::jsonb and (f.value -> 'digital_subscription') = 'true'::jsonb);
revoke all on table public.public_digital_plans from public, anon, authenticated, service_role;
grant select on table public.public_digital_plans to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한 판정 함수 하나 (PAY-03) · 사전 고지 기한 · 한국 날짜 경계
-- ─────────────────────────────────────────────────────────────
create function public.has_entitlement(p_user uuid, p_key text, p_at timestamptz default now()) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.entitlements e
     where e.user_id = p_user and e.key = p_key
       and e.valid_from <= p_at and p_at < e.valid_until
       and (e.revoked_at is null or p_at < e.revoked_at));
$$;
comment on function public.has_entitlement(uuid, text, timestamptz) is '권한 판정 - 서버(service_role)만 부른다. 클라이언트가 보낸 등급 값은 쓰지 않는다. valid_until 직전은 허용, 그 시각부터 거부';
revoke all on function public.has_entitlement(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.has_entitlement(uuid, text, timestamptz) to service_role;

-- 사전 고지 기한 일수 - 설정 days(없으면 30, 감수 필요), 구독 기간보다 길 수 없다
create function public.billing_notice_lead_days(p_start timestamptz, p_end timestamptz) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    coalesce((select (s.value ->> 'days')::int from public.settings s where s.key = 'renewal_notice_policy' and s.value ? 'days'), 30),
    greatest(1, round(extract(epoch from (p_end - p_start)) / 86400)::int));
$$;
revoke all on function public.billing_notice_lead_days(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_notice_lead_days(timestamptz, timestamptz) to service_role;

-- 한국 날짜 기준 다음 날 0시 (유예 마지막 날까지 이용, 다음 날 회수)
create function public.billing_kst_next_day(p_at timestamptz) returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((date_trunc('day', p_at at time zone 'Asia/Seoul') + interval '1 day') at time zone 'Asia/Seoul');
$$;
revoke all on function public.billing_kst_next_day(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_kst_next_day(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 쓰기 함수 (service_role 전용) — 오류 문장은 'billing:코드'로 시작한다
-- ─────────────────────────────────────────────────────────────

-- 주문 만들기 — 같은 (회원, 멱등 키)는 같은 주문을 돌려준다. 금액은 요금제 데이터에서 복사
create function public.billing_create_order(p_user uuid, p_plan bigint, p_provider text, p_mode text, p_idem text, p_order_no text, p_terms_ack boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.orders;
  v_plan public.product_plans;
  v_product_status text;
  v_order public.orders;
begin
  if p_user is null then
    raise exception 'billing:login_required' using errcode = 'P0001';
  end if;
  select * into v_existing from public.orders o where o.user_id = p_user and o.idempotency_key = p_idem;
  if found then
    return jsonb_build_object('id', v_existing.id, 'order_no', v_existing.order_no, 'amount', v_existing.amount, 'status', v_existing.status, 'replayed', true);
  end if;
  if not coalesce(p_terms_ack, false) then
    raise exception 'billing:terms_ack_required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                  and (f.value -> 'billing') = 'true'::jsonb and (f.value -> 'digital_subscription') = 'true'::jsonb) then
    raise exception 'billing:closed' using errcode = 'P0001';
  end if;
  select * into v_plan from public.product_plans pl where pl.id = p_plan;
  select p.status into v_product_status from public.products p where p.id = v_plan.product_id;
  if v_plan.id is null or v_plan.status <> 'active' or v_product_status is distinct from 'on_sale' then
    raise exception 'billing:plan_unavailable' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subscriptions s where s.user_id = p_user and s.product_id = v_plan.product_id and s.status in ('active', 'past_due'))
     or public.has_entitlement(p_user, v_plan.entitlement_key) then
    raise exception 'billing:already_subscribed' using errcode = 'P0001';
  end if;
  insert into public.orders (order_no, user_id, product_id, plan_id, kind, amount, provider, mode, idempotency_key, terms_ack_at)
  values (p_order_no, p_user, v_plan.product_id, v_plan.id, 'initial', v_plan.amount, p_provider, p_mode, p_idem, now())
  returning * into v_order;
  return jsonb_build_object('id', v_order.id, 'order_no', v_order.order_no, 'amount', v_order.amount, 'status', v_order.status, 'replayed', false);
end;
$$;

-- 웹훅 이벤트 기록 — 'new'(처음) / 'retry'(받았지만 처리 못 끝냄) / 'duplicate'(이미 처리됨)
create function public.billing_record_event(p_event_id text, p_provider text, p_type text, p_order_no text, p_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  insert into public.payment_events (pg_event_id, provider, event_type, order_no, payload_hash)
  values (p_event_id, p_provider, p_type, p_order_no, p_hash)
  on conflict (pg_event_id) do nothing;
  if found then
    return 'new';
  end if;
  select e.status into v_status from public.payment_events e where e.pg_event_id = p_event_id;
  return case when v_status in ('processed', 'ignored') then 'duplicate' else 'retry' end;
end;
$$;

create function public.billing_mark_event(p_event_id text, p_status text) returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_events set status = p_status, processed_at = now()
   where pg_event_id = p_event_id and p_status in ('processed', 'ignored', 'failed');
$$;

-- 결제 실패 처리 — 재시도·유예는 설정 billing_retry_policy(없으면 0). 유예 마지막 날까지 이용, 다음 날 0시(한국) 회수
create function public.billing_mark_charge_failed(p_sub uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_policy jsonb;
  v_max int;
  v_grace int;
  v_grace_until timestamptz;
  v_status text;
begin
  select * into v_sub from public.subscriptions s where s.id = p_sub for update;
  if not found or v_sub.status not in ('active', 'past_due') then
    return jsonb_build_object('status', coalesce(v_sub.status, 'missing'), 'changed', false);
  end if;
  select s.value into v_policy from public.settings s where s.key = 'billing_retry_policy';
  v_max := coalesce((v_policy ->> 'max_retries')::int, 0);
  v_grace := coalesce((v_policy ->> 'grace_days')::int, 0);
  v_grace_until := case when v_grace > 0 then public.billing_kst_next_day(v_sub.current_period_end + make_interval(days => v_grace)) else null end;
  v_status := case when v_sub.retry_count + 1 > v_max then 'expired' else 'past_due' end;
  update public.subscriptions
     set status = v_status, retry_count = v_sub.retry_count + 1, grace_until = coalesce(v_grace_until, grace_until),
         auto_renew = case when v_status = 'expired' then false else auto_renew end, updated_at = now()
   where id = p_sub;
  if v_grace_until is not null then
    update public.entitlements set valid_until = greatest(valid_until, v_grace_until), updated_at = now()
     where source = 'subscription' and source_ref = p_sub::text;
  end if;
  return jsonb_build_object('status', v_status, 'changed', true, 'retry_count', v_sub.retry_count + 1);
end;
$$;

-- 결제 반영 — 호출자는 PG 조회 결과(상태·금액·조회 시각)를 넘긴다. 웹훅 본문의 값은 쓰지 않는다 (PAY-02).
-- 조회 시각이 이미 반영한 조회보다 오래되면 무시(취소 웹훅이 승인 웹훅보다 먼저 와도 최종 상태 = 가장 최근 PG 조회).
create function public.billing_apply_payment(p_order_no text, p_pg_status text, p_amount integer, p_payment_key text, p_billing_key text, p_looked_up_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_new text;
  v_plan public.product_plans;
  v_sub public.subscriptions;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := now();
begin
  select * into o from public.orders x where x.order_no = p_order_no for update;
  if not found then
    raise exception 'billing:order_not_found' using errcode = 'P0001';
  end if;
  if o.pg_checked_at is not null and p_looked_up_at < o.pg_checked_at then
    return jsonb_build_object('order_status', o.status, 'changed', false, 'stale', true);
  end if;
  v_new := case upper(p_pg_status)
    when 'DONE' then 'paid'
    when 'CANCELED' then 'refunded'
    when 'PARTIAL_CANCELED' then 'refunded'
    when 'ABORTED' then 'failed'
    when 'EXPIRED' then 'failed'
    else null end;
  update public.orders
     set pg_status = left(p_pg_status, 40), pg_checked_at = p_looked_up_at, pg_payment_key = coalesce(p_payment_key, pg_payment_key)
   where id = o.id;
  if v_new is null then
    return jsonb_build_object('order_status', o.status, 'changed', false);
  end if;

  if v_new = 'paid' then
    if o.status <> 'created' then
      -- 웹훅이 먼저 반영해 빌링키 없이 만들어진 구독에 뒤늦게 온 빌링키를 붙인다 (자동갱신은 빌링키가 있어야 켜진다)
      if o.status = 'paid' and p_billing_key is not null and o.subscription_id is not null then
        update public.subscriptions set billing_key = p_billing_key, auto_renew = (cancel_requested_at is null), updated_at = now()
         where id = o.subscription_id and billing_key is null and status = 'active';
      end if;
      return jsonb_build_object('order_status', o.status, 'changed', false);
    end if;
    if p_amount is distinct from o.amount then
      update public.orders set status = 'failed', failure_code = 'amount_mismatch' where id = o.id;
      return jsonb_build_object('order_status', 'failed', 'changed', true, 'reason', 'amount_mismatch');
    end if;
    select * into v_plan from public.product_plans pl where pl.id = o.plan_id;
    if o.kind = 'initial' then
      v_start := v_now;
      v_end := v_start + make_interval(months => v_plan.period_months);
      insert into public.subscriptions (user_id, product_id, plan_id, status, auto_renew, billing_key, current_period_start, current_period_end)
      values (o.user_id, o.product_id, o.plan_id, 'active', p_billing_key is not null, p_billing_key, v_start, v_end)
      returning * into v_sub;
      insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until)
      values (o.user_id, v_plan.entitlement_key, 'subscription', v_sub.id::text, v_start, v_end)
      on conflict (source, source_ref) do update set valid_until = excluded.valid_until, revoked_at = null, revoke_reason = null, updated_at = now();
      insert into public.renewal_notices (subscription_id, kind, period_end, amount, channel, notified_at)
      values (v_sub.id, 'checkout', v_end, o.amount, 'screen', o.terms_ack_at)
      on conflict do nothing;
      update public.orders set status = 'paid', paid_at = v_now, subscription_id = v_sub.id where id = o.id;
    else
      select * into v_sub from public.subscriptions s where s.id = o.subscription_id for update;
      v_start := v_sub.current_period_end;
      v_end := v_start + make_interval(months => v_plan.period_months);
      if v_end <= v_now then
        v_start := v_now;
        v_end := v_start + make_interval(months => v_plan.period_months);
      end if;
      update public.subscriptions
         set status = 'active', current_period_start = v_start, current_period_end = v_end, retry_count = 0, grace_until = null, updated_at = now()
       where id = v_sub.id;
      update public.entitlements set valid_until = v_end, revoked_at = null, revoke_reason = null, updated_at = now()
       where source = 'subscription' and source_ref = v_sub.id::text;
      -- 결제 확인 화면·영수증에 다음 갱신 예정일·금액이 보인다 (이 기록의 근거 - 인정 범위는 법률 검토 [감수 필요])
      insert into public.renewal_notices (subscription_id, kind, period_end, amount, channel, notified_at)
      values (v_sub.id, 'auto_renew', v_end, o.amount, 'screen', v_now)
      on conflict do nothing;
      update public.orders set status = 'paid', paid_at = v_now where id = o.id;
    end if;
    return jsonb_build_object('order_status', 'paid', 'changed', true);
  end if;

  if v_new = 'refunded' then
    if o.status = 'paid' then
      update public.orders set status = 'refunded', canceled_at = v_now where id = o.id;
      update public.entitlements set revoked_at = v_now, revoke_reason = 'refund', updated_at = now()
       where source = 'subscription' and source_ref = o.subscription_id::text and revoked_at is null;
      update public.subscriptions set status = 'canceled', auto_renew = false, updated_at = now() where id = o.subscription_id;
      return jsonb_build_object('order_status', 'refunded', 'changed', true);
    elsif o.status = 'created' then
      update public.orders set status = 'canceled', canceled_at = v_now where id = o.id;
      return jsonb_build_object('order_status', 'canceled', 'changed', true);
    end if;
    return jsonb_build_object('order_status', o.status, 'changed', false);
  end if;

  -- failed
  if o.status = 'created' then
    update public.orders set status = 'failed', failure_code = left(lower(p_pg_status), 40) where id = o.id;
    if o.kind = 'renewal' then
      perform public.billing_mark_charge_failed(o.subscription_id);
    end if;
    return jsonb_build_object('order_status', 'failed', 'changed', true);
  end if;
  return jsonb_build_object('order_status', o.status, 'changed', false);
end;
$$;

-- 갱신 주문 — 자동갱신 중, 만기 시각이 지났고, 사전 고지 기록(같은 금액, 기한 전)이 있을 때만 (PAY-05)
create function public.billing_create_renewal_order(p_sub uuid, p_provider text, p_mode text, p_order_no text, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_plan public.product_plans;
  v_lead int;
  v_idem text;
  v_existing public.orders;
  v_order public.orders;
begin
  select * into v_sub from public.subscriptions s where s.id = p_sub for update;
  if not found or v_sub.status not in ('active', 'past_due') or not v_sub.auto_renew or v_sub.billing_key is null or v_sub.cancel_requested_at is not null then
    raise exception 'billing:not_renewable' using errcode = 'P0001';
  end if;
  if p_now < v_sub.current_period_end then
    raise exception 'billing:not_due' using errcode = 'P0001';
  end if;
  select * into v_plan from public.product_plans pl where pl.id = v_sub.plan_id;
  if v_plan.status <> 'active' then
    raise exception 'billing:plan_unavailable' using errcode = 'P0001';
  end if;
  v_lead := public.billing_notice_lead_days(v_sub.current_period_start, v_sub.current_period_end);
  if not exists (
       select 1 from public.renewal_notices n
        where n.subscription_id = v_sub.id and n.period_end = v_sub.current_period_end and n.amount = v_plan.amount
          and n.notified_at <= v_sub.current_period_end - make_interval(days => v_lead)) then
    raise exception 'billing:renewal_notice_missing' using errcode = 'P0001';
  end if;
  v_idem := 'renew:' || v_sub.id::text || ':' || extract(epoch from v_sub.current_period_end)::bigint::text || ':' || v_sub.retry_count::text;
  select * into v_existing from public.orders o where o.user_id = v_sub.user_id and o.idempotency_key = v_idem;
  if found then
    return jsonb_build_object('id', v_existing.id, 'order_no', v_existing.order_no, 'amount', v_existing.amount, 'status', v_existing.status, 'replayed', true);
  end if;
  insert into public.orders (order_no, user_id, product_id, plan_id, subscription_id, kind, amount, provider, mode, idempotency_key)
  values (p_order_no, v_sub.user_id, v_sub.product_id, v_sub.plan_id, v_sub.id, 'renewal', v_plan.amount, p_provider, p_mode, v_idem)
  returning * into v_order;
  return jsonb_build_object('id', v_order.id, 'order_no', v_order.order_no, 'amount', v_order.amount, 'status', v_order.status, 'replayed', false,
                            'billing_key', v_sub.billing_key, 'user_id', v_sub.user_id);
end;
$$;

-- 가격 변경 사전 고지 — 요금제 금액이 마지막 고지 금액과 다른 구독에 기록 (작업 renewal-notice)
create function public.billing_record_price_notices(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select s.id as sub_id, s.current_period_end, pl.amount
      from public.subscriptions s join public.product_plans pl on pl.id = s.plan_id
     where s.status in ('active', 'past_due') and s.auto_renew and s.cancel_requested_at is null and pl.status = 'active' and pl.amount > 0
       and not exists (select 1 from public.renewal_notices n
                        where n.subscription_id = s.id and n.period_end = s.current_period_end and n.amount = pl.amount)
  ), ins as (
    insert into public.renewal_notices (subscription_id, kind, period_end, amount, channel, notified_at)
    select sub_id, 'price_change', current_period_end, amount, 'screen', p_now from due
    on conflict do nothing
    returning 1)
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- 해지 — 자동갱신만 끄고 남은 기간 끝까지 이용, 끝에 회수 (PAY-03·05). 본인 구독만
create function public.billing_cancel_subscription(p_user uuid, p_sub uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions s where s.id = p_sub and s.user_id = p_user for update;
  if not found or v_sub.status not in ('active', 'past_due') then
    raise exception 'billing:subscription_not_found' using errcode = 'P0001';
  end if;
  update public.subscriptions
     set auto_renew = false, cancel_requested_at = coalesce(cancel_requested_at, now()), updated_at = now()
   where id = p_sub;
  return jsonb_build_object('ends_at', v_sub.current_period_end, 'already', v_sub.cancel_requested_at is not null);
end;
$$;

-- 만기 정리 — 자동갱신이 아니거나(해지 포함) 갱신을 못 하는 구독을 닫는다. 권한 자체는 valid_until로 이미 끝난다
create function public.billing_close_lapsed(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with closed as (
    update public.subscriptions s
       set status = case when s.cancel_requested_at is not null then 'canceled' else 'expired' end, auto_renew = false, updated_at = now()
     where s.status in ('active', 'past_due') and coalesce(s.grace_until, s.current_period_end) <= p_now
       and (not s.auto_renew or s.cancel_requested_at is not null or (s.grace_until is not null and s.grace_until <= p_now))
    returning 1)
  select count(*) into v_count from closed;
  return v_count;
end;
$$;

-- 갱신 불가(고지 기록 없음 등)로 닫기
create function public.billing_lapse_subscription(p_sub uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscriptions set status = 'expired', auto_renew = false, updated_at = now()
   where id = p_sub and status in ('active', 'past_due');
$$;

-- 모든 쓰기 함수는 service_role 전용
revoke all on function public.billing_create_order(uuid, bigint, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.billing_record_event(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.billing_mark_event(text, text) from public, anon, authenticated;
revoke all on function public.billing_mark_charge_failed(uuid) from public, anon, authenticated;
revoke all on function public.billing_apply_payment(text, text, integer, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_create_renewal_order(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.billing_record_price_notices(timestamptz) from public, anon, authenticated;
revoke all on function public.billing_cancel_subscription(uuid, uuid) from public, anon, authenticated;
revoke all on function public.billing_close_lapsed(timestamptz) from public, anon, authenticated;
revoke all on function public.billing_lapse_subscription(uuid) from public, anon, authenticated;
grant execute on function public.billing_create_order(uuid, bigint, text, text, text, text, boolean) to service_role;
grant execute on function public.billing_record_event(text, text, text, text, text) to service_role;
grant execute on function public.billing_mark_event(text, text) to service_role;
grant execute on function public.billing_mark_charge_failed(uuid) to service_role;
grant execute on function public.billing_apply_payment(text, text, integer, text, text, timestamptz) to service_role;
grant execute on function public.billing_create_renewal_order(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.billing_record_price_notices(timestamptz) to service_role;
grant execute on function public.billing_cancel_subscription(uuid, uuid) to service_role;
grant execute on function public.billing_close_lapsed(timestamptz) to service_role;
grant execute on function public.billing_lapse_subscription(uuid) to service_role;
