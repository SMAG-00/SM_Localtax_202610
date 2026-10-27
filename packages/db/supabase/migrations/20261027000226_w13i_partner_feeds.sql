-- W13-i i1 - 제휴 피드 키·사용 기록 (PRD-05 PART-01, docs/dev/W13-i_설계.md 2장)
-- 이 파일에 키 원문·계약 조건 문장·가격은 없다. 키는 후추(서버 비밀) HMAC 해시만 저장한다.
-- 계약 표(license_contracts)는 227에서 만들고 partner_feeds.contract_id 외래키도 227에서 건다.

create function public.feed_no_update_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '제휴 피드 사용·감사 기록은 지우거나 고치지 못합니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.feed_no_update_delete() from public, anon, authenticated;

create table public.partner_feeds (
  id bigint generated always as identity primary key,
  partner_id bigint not null references public.partners (id),
  contract_id bigint not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scope text not null check (scope in ('summary', 'full')),
  issued_by text not null check (length(btrim(issued_by)) > 0),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  constraint partner_feeds_revoke_pair check ((revoked_at is null) = (revoked_by is null))
);
comment on table public.partner_feeds is '제휴 피드 키 (PART-01) - 키 원문 저장 0, key_hash만. 발급은 partner_feed_issue, 폐기는 revoked_at 하나만 채운다. 직접 읽기 0(서버 service_role)';
create index partner_feeds_partner_idx on public.partner_feeds (partner_id);

create function public.partner_feeds_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception '제휴 피드 키는 지우지 못합니다 - 폐기로 남깁니다' using errcode = 'insufficient_privilege';
  end if;
  if old.revoked_at is not null
     or new.id is distinct from old.id or new.partner_id is distinct from old.partner_id or new.contract_id is distinct from old.contract_id
     or new.key_hash is distinct from old.key_hash or new.scope is distinct from old.scope
     or new.issued_by is distinct from old.issued_by or new.issued_at is distinct from old.issued_at then
    raise exception '제휴 피드 키는 폐기 표시 외에는 고치지 못합니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.partner_feeds_guard() from public, anon, authenticated;
create trigger partner_feeds_guard before update or delete on public.partner_feeds for each row execute function public.partner_feeds_guard();
create trigger partner_feeds_no_truncate before truncate on public.partner_feeds for each statement execute function public.partner_feeds_guard();

create table public.partner_feed_usage (
  id bigint generated always as identity primary key,
  feed_id bigint not null references public.partner_feeds (id),
  at timestamptz not null default now(),
  response_code int not null check (response_code in (200, 401, 429, 503)),
  item_count int not null default 0 check (item_count >= 0),
  scope text not null check (scope in ('summary', 'full'))
);
comment on table public.partner_feed_usage is '제휴 피드 요청 기록 (PART-01) - 키가 맞은 요청만 한 줄씩, 추가만. 분당 한도는 이 표의 200 응답 수로 센다';
create index partner_feed_usage_feed_idx on public.partner_feed_usage (feed_id, at desc);
create trigger partner_feed_usage_no_update_delete before update or delete on public.partner_feed_usage for each row execute function public.feed_no_update_delete();
create trigger partner_feed_usage_no_truncate before truncate on public.partner_feed_usage for each statement execute function public.feed_no_update_delete();

create table public.partner_feed_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('contract', 'issue', 'revoke', 'manuscript')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  target_id bigint,
  detail text check (detail is null or char_length(detail) <= 300),
  constraint partner_feed_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.partner_feed_audit is '계약·키 발급/폐기·연재 원고 감사 - 추가만, 거부도 1행. 키 값은 적지 않는다';
create trigger partner_feed_audit_no_update_delete before update or delete on public.partner_feed_audit for each row execute function public.feed_no_update_delete();
create trigger partner_feed_audit_no_truncate before truncate on public.partner_feed_audit for each statement execute function public.feed_no_update_delete();

create function public.partner_feed_audit_write(p_action text, p_ok boolean, p_code text, p_actor text, p_target bigint, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.partner_feed_audit (action, outcome, code, actor, target_id, detail)
  values (p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), p_target, left(p_detail, 300));
$$;
revoke all on function public.partner_feed_audit_write(text, boolean, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.partner_feed_audit_write(text, boolean, text, text, bigint, text) to service_role;

alter table public.partner_feeds enable row level security;
alter table public.partner_feed_usage enable row level security;
alter table public.partner_feed_audit enable row level security;
revoke all on table public.partner_feeds, public.partner_feed_usage, public.partner_feed_audit from public, anon, authenticated, service_role;
grant select on table public.partner_feeds, public.partner_feed_usage, public.partner_feed_audit to service_role;

insert into public.settings (key, value, description, updated_by) values
  ('partner_feed_rate_limit', '{}'::jsonb, '제휴 피드 키별 분당 요청 한도 {"per_minute": 정수} (PO 입력 - 비어 있으면 피드 닫힘 503)', 'migration:20261027000226')
on conflict (key) do nothing;
