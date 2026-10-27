-- W13-i i2 - 라이선스·제휴 계약 기록과 키 발급·폐기·피드 제공 함수 (PRD-05 BIZ-11 · PART-01, docs/dev/W13-i_설계.md)
-- 이 파일에 계약 조건 문장·가격은 없다. 범위·정산 조건·권리 근거는 PO가 적는 칸이다(비어 있으면 [확인 필요]).
-- 모든 함수는 서버(service_role)만 부른다. 익명 호출 함수 0.

create table public.license_contracts (
  id bigint generated always as identity primary key,
  counterparty text not null check (char_length(btrim(counterparty)) between 1 and 120),
  partner_id bigint references public.partners (id),
  kind text not null check (kind in ('naver_series', 'data_license')),
  scope text not null check (char_length(btrim(scope)) between 1 and 500),
  period_start date not null,
  period_end date not null,
  settlement_terms text check (settlement_terms is null or char_length(settlement_terms) <= 500),
  rights_ref text check (rights_ref is null or char_length(btrim(rights_ref)) between 1 and 200),
  allows_full boolean not null default false,
  status text not null default 'active' check (status in ('active', 'terminated')),
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  created_at timestamptz not null default now(),
  terminated_at timestamptz,
  constraint license_contracts_period check (period_end >= period_start),
  constraint license_contracts_full_rights check (not allows_full or (kind = 'data_license' and rights_ref is not null)),
  constraint license_contracts_term_pair check ((status = 'terminated') = (terminated_at is not null))
);
comment on table public.license_contracts is '라이선스·제휴 계약 기록 (BIZ-11) - 범위·정산 조건은 PO 입력, 금액 칸 없음. 종료 표시 외에는 고치지 못하고 지우지 못한다. 직접 읽기 0';
create index license_contracts_kind_idx on public.license_contracts (kind, status);

create function public.license_contracts_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception '계약 기록은 지우지 못합니다 - 종료로 남깁니다' using errcode = 'insufficient_privilege';
  end if;
  if old.status = 'terminated'
     or new.id is distinct from old.id or new.counterparty is distinct from old.counterparty or new.partner_id is distinct from old.partner_id
     or new.kind is distinct from old.kind or new.scope is distinct from old.scope or new.period_start is distinct from old.period_start
     or new.period_end is distinct from old.period_end or new.settlement_terms is distinct from old.settlement_terms
     or new.rights_ref is distinct from old.rights_ref or new.allows_full is distinct from old.allows_full
     or new.recorded_by is distinct from old.recorded_by or new.created_at is distinct from old.created_at then
    raise exception '계약 기록은 종료 표시 외에는 고치지 못합니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.license_contracts_guard() from public, anon, authenticated;
create trigger license_contracts_guard before update or delete on public.license_contracts for each row execute function public.license_contracts_guard();
create trigger license_contracts_no_truncate before truncate on public.license_contracts for each statement execute function public.license_contracts_guard();

alter table public.license_contracts enable row level security;
revoke all on table public.license_contracts from public, anon, authenticated, service_role;
grant select on table public.license_contracts to service_role;

alter table public.partner_feeds add constraint partner_feeds_contract_fk foreign key (contract_id) references public.license_contracts (id);

-- 계약 기록
create function public.license_contract_record(p_counterparty text, p_partner_id bigint, p_kind text, p_scope text, p_start date, p_end date, p_settlement text, p_rights_ref text, p_allows_full boolean, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text; v_id bigint;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif p_counterparty is null or char_length(btrim(p_counterparty)) not between 1 and 120 then v_code := 'counterparty_invalid';
  elsif p_kind is null or p_kind not in ('naver_series', 'data_license') then v_code := 'kind_invalid';
  elsif p_scope is null or char_length(btrim(p_scope)) not between 1 and 500 then v_code := 'scope_invalid';
  elsif p_start is null or p_end is null or p_end < p_start then v_code := 'period_invalid';
  elsif p_partner_id is not null and not exists (select 1 from public.partners where id = p_partner_id) then v_code := 'partner_missing';
  elsif coalesce(p_allows_full, false) and (p_kind <> 'data_license' or nullif(btrim(coalesce(p_rights_ref, '')), '') is null) then v_code := 'full_needs_rights';
  elsif p_settlement is not null and char_length(p_settlement) > 500 then v_code := 'settlement_invalid';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('contract', false, v_code, p_actor, null, p_kind);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  insert into public.license_contracts (counterparty, partner_id, kind, scope, period_start, period_end, settlement_terms, rights_ref, allows_full, recorded_by)
  values (btrim(p_counterparty), p_partner_id, p_kind, btrim(p_scope), p_start, p_end, nullif(btrim(coalesce(p_settlement, '')), ''), nullif(btrim(coalesce(p_rights_ref, '')), ''), coalesce(p_allows_full, false), p_actor)
  returning id into v_id;
  perform public.partner_feed_audit_write('contract', true, 'ok', p_actor, v_id, p_kind);
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id);
end;
$$;

-- 계약 종료 - 종료한 계약에 묶인 키는 다음 요청부터 401
create function public.license_contract_terminate(p_contract bigint, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif not exists (select 1 from public.license_contracts where id = p_contract) then v_code := 'not_found';
  elsif exists (select 1 from public.license_contracts where id = p_contract and status = 'terminated') then v_code := 'already_terminated';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('contract', false, v_code, p_actor, p_contract, 'terminate');
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  update public.license_contracts set status = 'terminated', terminated_at = p_now where id = p_contract;
  perform public.partner_feed_audit_write('contract', true, 'ok', p_actor, p_contract, 'terminate');
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

-- 키 발급 - 유효한 데이터 라이선스 계약이 있어야 한다. 해시는 서버가 후추로 만들어 넘긴다 (원문은 이 함수에 오지 않는다)
create function public.partner_feed_issue(p_partner bigint, p_contract bigint, p_scope text, p_key_hash text, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare c public.license_contracts; v_code text; v_id bigint; v_today date := (p_now at time zone 'Asia/Seoul')::date;
begin
  select * into c from public.license_contracts where id = p_contract;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then v_code := 'hash_invalid';
  elsif p_scope is null or p_scope not in ('summary', 'full') then v_code := 'scope_invalid';
  elsif not exists (select 1 from public.partners where id = p_partner) then v_code := 'partner_missing';
  elsif c.id is null then v_code := 'contract_missing';
  elsif c.kind <> 'data_license' then v_code := 'contract_kind';
  elsif c.status <> 'active' or v_today < c.period_start or v_today > c.period_end then v_code := 'contract_inactive';
  elsif c.partner_id is not null and c.partner_id <> p_partner then v_code := 'contract_partner_mismatch';
  elsif p_scope = 'full' and (not c.allows_full or c.rights_ref is null) then v_code := 'full_not_allowed';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('issue', false, v_code, p_actor, p_contract, null);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  insert into public.partner_feeds (partner_id, contract_id, key_hash, scope, issued_by) values (p_partner, p_contract, p_key_hash, p_scope, p_actor) returning id into v_id;
  perform public.partner_feed_audit_write('issue', true, 'ok', p_actor, v_id, p_scope);
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id);
end;
$$;

create function public.partner_feed_revoke(p_feed bigint, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif not exists (select 1 from public.partner_feeds where id = p_feed) then v_code := 'not_found';
  elsif exists (select 1 from public.partner_feeds where id = p_feed and revoked_at is not null) then v_code := 'already_revoked';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('revoke', false, v_code, p_actor, p_feed, null);
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  update public.partner_feeds set revoked_at = p_now, revoked_by = p_actor where id = p_feed;
  perform public.partner_feed_audit_write('revoke', true, 'ok', p_actor, p_feed, null);
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

-- 피드 제공 - 인증·계약 기간·기능 키·분당 한도·내용 선택·사용 기록을 한 트랜잭션(키별 잠금)에서 한다.
-- 내용은 무료 공개 기사뿐이다(프리미엄 칼럼·유료 기사 0). 전문은 계약 플래그 ∧ 계약 권리 근거 ∧ 기사에 이관 자료 표시 없음.
create function public.partner_feed_serve(p_feed_id bigint, p_key_hash text, p_limit int default 20, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.partner_feeds;
  c public.license_contracts;
  v_today date := (p_now at time zone 'Asia/Seoul')::date;
  v_per_minute int;
  v_used int;
  v_full boolean;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_items jsonb;
  v_flag boolean;
begin
  if p_feed_id is null then return jsonb_build_object('ok', false, 'status', 401, 'code', 'unauthorized'); end if;
  perform pg_advisory_xact_lock(hashtextextended('partner_feed:' || p_feed_id, 0));
  select * into f from public.partner_feeds where id = p_feed_id;
  if not found or p_key_hash is null or f.key_hash <> p_key_hash then
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'unauthorized');
  end if;
  select * into c from public.license_contracts where id = f.contract_id;
  if f.revoked_at is not null then
    insert into public.partner_feed_usage (feed_id, at, response_code, scope) values (f.id, p_now, 401, f.scope);
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'revoked');
  end if;
  if c.status <> 'active' or v_today < c.period_start or v_today > c.period_end then
    insert into public.partner_feed_usage (feed_id, at, response_code, scope) values (f.id, p_now, 401, f.scope);
    return jsonb_build_object('ok', false, 'status', 401, 'code', 'contract_ended');
  end if;
  select exists (select 1 from public.settings s where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and (s.value -> 'partner_feeds') = 'true'::jsonb) into v_flag;
  select case when s.value ->> 'per_minute' ~ '^[1-9][0-9]{0,5}$' then (s.value ->> 'per_minute')::int end into v_per_minute
    from public.settings s where s.key = 'partner_feed_rate_limit' and jsonb_typeof(s.value) = 'object';
  if not v_flag or v_per_minute is null then
    insert into public.partner_feed_usage (feed_id, at, response_code, scope) values (f.id, p_now, 503, f.scope);
    return jsonb_build_object('ok', false, 'status', 503, 'code', 'closed');
  end if;
  select count(*) into v_used from public.partner_feed_usage u where u.feed_id = f.id and u.response_code = 200 and u.at > p_now - interval '1 minute' and u.at <= p_now;
  if v_used >= v_per_minute then
    insert into public.partner_feed_usage (feed_id, at, response_code, scope) values (f.id, p_now, 429, f.scope);
    return jsonb_build_object('ok', false, 'status', 429, 'code', 'rate_limited', 'retry_after', 60);
  end if;
  v_full := f.scope = 'full' and c.allows_full and c.rights_ref is not null;
  select coalesce(jsonb_agg(x.item order by x.published desc, x.id desc), '[]'::jsonb) into v_items
    from (
      select a.id, a.first_published_at as published,
             jsonb_strip_nulls(jsonb_build_object(
               'id', a.id, 'slug', a.slug, 'title', a.title, 'section', a.section,
               'published_at', a.first_published_at, 'summary', a.summary,
               'body_text', case when v_full and a.legacy_source is null and jsonb_typeof(a.body) = 'object' then
                 (select string_agg(b ->> 'text', E'\n\n' order by o) from jsonb_array_elements(coalesce(a.body -> 'blocks', '[]'::jsonb)) with ordinality as t(b, o) where b ->> 'type' in ('paragraph', 'heading') and b ->> 'text' is not null)
                 end)) as item
        from public.articles a
       where a.status = 'published' and a.access_tier = 'public' and not a.is_paid
         and a.first_published_at is not null and a.first_published_at <= p_now
         and (v_full or a.summary is not null)
       order by a.first_published_at desc, a.id desc
       limit v_limit
    ) x;
  insert into public.partner_feed_usage (feed_id, at, response_code, item_count, scope) values (f.id, p_now, 200, jsonb_array_length(v_items), f.scope);
  return jsonb_build_object('ok', true, 'status', 200, 'code', 'ok', 'scope', f.scope, 'full', v_full, 'partner_id', f.partner_id, 'items', v_items);
end;
$$;

revoke all on function public.license_contract_record(text, bigint, text, text, date, date, text, text, boolean, text),
  public.license_contract_terminate(bigint, text, timestamptz),
  public.partner_feed_issue(bigint, bigint, text, text, text, timestamptz),
  public.partner_feed_revoke(bigint, text, timestamptz),
  public.partner_feed_serve(bigint, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.license_contract_record(text, bigint, text, text, date, date, text, text, boolean, text),
  public.license_contract_terminate(bigint, text, timestamptz),
  public.partner_feed_issue(bigint, bigint, text, text, text, timestamptz),
  public.partner_feed_revoke(bigint, text, timestamptz),
  public.partner_feed_serve(bigint, text, int, timestamptz) to service_role;
