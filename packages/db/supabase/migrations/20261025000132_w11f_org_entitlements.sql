-- W11-f 2단계 — 기관 권한(source org) · 상품 확장 · 좌석 함수 (PRD-03 BIZ-07·PAY-04)
-- · 권한 판정은 W10-f의 has_entitlement 하나. 클라이언트가 보낸 좌석·등급 값은 어디에도 인자로 받지 않는다.
-- · 좌석 수는 계약 행 잠금(for update) 아래에서 센다 - 동시 초대에도 활성(초대+수락) 좌석 <= 계약 좌석.
-- · 계약 종료일 = 마지막 열람일, 권한 끝 = 종료일 다음 날 00:00(KST) (valid_until은 배타적 끝 시각).
-- · 오류 문장은 'org:코드'로 시작한다.

alter table public.entitlements drop constraint entitlements_source_check;
alter table public.entitlements add constraint entitlements_source_check check (source in ('subscription', 'paper_link', 'manual', 'org'));
alter table public.entitlements drop constraint entitlements_key_check;
alter table public.entitlements add constraint entitlements_key_check check (key in ('digital', 'premium_report'));
alter table public.products drop constraint products_kind_check;
alter table public.products add constraint products_kind_check check (kind in ('book', 'education', 'subscription', 'digital_subscription', 'institution'));

-- 개통 관문 - 계약이 active로 바뀌려면 확인표 승인. 좌석 수를 사용량 아래로 줄일 수 없다
create function public.org_contracts_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_used integer;
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    if not public.org_security_approved(new.org_id) then
      raise exception 'org:security_not_approved' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id then
      raise exception 'org:org_immutable' using errcode = 'check_violation';
    end if;
    if new.seats < old.seats then
      select count(*) into v_used from public.org_seats s where s.contract_id = new.id and s.status in ('invited', 'active');
      if new.seats < v_used then
        raise exception 'org:seats_below_usage' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.org_contracts_guard() from public, anon, authenticated;
create trigger org_contracts_guard before insert or update on public.org_contracts for each row execute function public.org_contracts_guard();

-- 계약 개통
create function public.org_contract_activate(p_contract uuid, p_by text, p_at timestamptz default now()) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.org_contracts;
begin
  select * into v from public.org_contracts where id = p_contract for update;
  if not found then raise exception 'org:contract_not_found' using errcode = 'check_violation'; end if;
  if v.status <> 'draft' then raise exception 'org:contract_not_draft' using errcode = 'check_violation'; end if;
  if v.contract_ref is null then raise exception 'org:contract_ref_missing' using errcode = 'check_violation'; end if;
  if public.org_contract_end_at(v.ends_on) <= p_at then raise exception 'org:contract_expired' using errcode = 'check_violation'; end if;
  begin
    update public.org_contracts set status = 'active', edited_by = p_by where id = p_contract;
  exception when unique_violation then
    raise exception 'org:already_active' using errcode = 'check_violation';
  end;
end;
$$;

-- 좌석 초대 - 기관 관리자(p_actor) 또는 운영자(p_actor null, 화면 권한은 서버가 확인). 토큰은 서버가 만든 값의 SHA-256만 받는다
create function public.org_seat_invite(p_actor uuid, p_org uuid, p_token_hash text, p_expires_at timestamptz, p_at timestamptz default now()) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v public.org_contracts; v_used integer; v_id uuid;
begin
  if p_actor is not null and not public.org_is_admin(p_actor, p_org) then
    raise exception 'org:not_admin' using errcode = 'check_violation';
  end if;
  select * into v from public.org_contracts c
   where c.org_id = p_org and c.status = 'active' and public.org_contract_end_at(c.ends_on) > p_at
   order by c.created_at desc limit 1 for update;
  if not found then raise exception 'org:no_active_contract' using errcode = 'check_violation'; end if;
  if not public.org_security_approved(p_org) then raise exception 'org:security_not_approved' using errcode = 'check_violation'; end if;
  select count(*) into v_used from public.org_seats s where s.contract_id = v.id and s.status in ('invited', 'active');
  if v_used >= v.seats then raise exception 'org:seat_limit' using errcode = 'check_violation'; end if;
  insert into public.org_seats (org_id, contract_id, invite_token_hash, invited_by, invited_at, invite_expires_at)
  values (p_org, v.id, p_token_hash, p_actor, p_at, p_expires_at) returning id into v_id;
  return v_id;
end;
$$;

-- 초대 수락 - 회원 번호는 서버가 세션에서 정한 값. 권한(entitlements)은 여기서만 만든다
create function public.org_seat_accept(p_user uuid, p_token_hash text, p_at timestamptz default now()) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare s public.org_seats; v public.org_contracts; v_from timestamptz; v_until timestamptz;
begin
  if p_user is null then raise exception 'org:login_required' using errcode = 'check_violation'; end if;
  select * into s from public.org_seats where invite_token_hash = p_token_hash for update;
  if not found or s.status <> 'invited' then raise exception 'org:invite_invalid' using errcode = 'check_violation'; end if;
  if s.invite_expires_at <= p_at then raise exception 'org:invite_expired' using errcode = 'check_violation'; end if;
  select * into v from public.org_contracts where id = s.contract_id for update;
  if v.status <> 'active' or public.org_contract_end_at(v.ends_on) <= p_at then
    raise exception 'org:no_active_contract' using errcode = 'check_violation';
  end if;
  if not public.org_security_approved(s.org_id) then raise exception 'org:security_not_approved' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.org_seats o where o.org_id = s.org_id and o.user_id = p_user and o.status = 'active') then
    raise exception 'org:already_seated' using errcode = 'check_violation';
  end if;
  v_from := greatest(p_at, public.org_contract_start_at(v.starts_on));
  v_until := public.org_contract_end_at(v.ends_on);
  update public.org_seats set status = 'active', user_id = p_user, accepted_at = p_at where id = s.id;
  if v.includes_digital then
    insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until)
    values (p_user, 'digital', 'org', s.id::text || ':digital', v_from, v_until);
  end if;
  if v.includes_reports then
    insert into public.entitlements (user_id, key, source, source_ref, valid_from, valid_until)
    values (p_user, 'premium_report', 'org', s.id::text || ':report', v_from, v_until);
  end if;
  return s.id;
end;
$$;

-- 좌석 회수 - 회수 시각부터 거부(다음 요청부터), 좌석 수는 즉시 돌아온다
create function public.org_seat_revoke(p_actor uuid, p_seat uuid, p_reason text default 'admin_revoke', p_at timestamptz default now()) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.org_seats;
begin
  select * into s from public.org_seats where id = p_seat for update;
  if not found then raise exception 'org:seat_not_found' using errcode = 'check_violation'; end if;
  if p_actor is not null and not public.org_is_admin(p_actor, s.org_id) then
    raise exception 'org:not_admin' using errcode = 'check_violation';
  end if;
  if s.status = 'revoked' then return; end if;
  update public.org_seats set status = 'revoked', revoked_at = p_at, revoke_reason = left(p_reason, 80) where id = p_seat;
  update public.entitlements set revoked_at = greatest(p_at, valid_from), revoke_reason = left(p_reason, 80), updated_at = now()
   where source = 'org' and split_part(source_ref, ':', 1) = p_seat::text and revoked_at is null;
end;
$$;

-- 종료일 변경(연장·조기 종료) - 모든 좌석 권한의 끝을 종료일 다음 날 00:00(KST)로 함께 옮긴다
create function public.org_contract_set_end(p_contract uuid, p_ends_on date, p_by text, p_at timestamptz default now()) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.org_contracts; v_until timestamptz;
begin
  select * into v from public.org_contracts where id = p_contract for update;
  if not found then raise exception 'org:contract_not_found' using errcode = 'check_violation'; end if;
  if v.status not in ('active', 'ended') then raise exception 'org:contract_not_active' using errcode = 'check_violation'; end if;
  if p_ends_on < v.starts_on then raise exception 'org:end_before_start' using errcode = 'check_violation'; end if;
  v_until := public.org_contract_end_at(p_ends_on);
  update public.entitlements e set valid_until = v_until, updated_at = now()
    from public.org_seats s
   where e.source = 'org' and split_part(e.source_ref, ':', 1) = s.id::text and s.contract_id = p_contract
     and e.revoked_at is null and v_until > e.valid_from;
  update public.entitlements e set revoked_at = e.valid_from, revoke_reason = 'contract_end', updated_at = now()
    from public.org_seats s
   where e.source = 'org' and split_part(e.source_ref, ':', 1) = s.id::text and s.contract_id = p_contract
     and e.revoked_at is null and v_until <= e.valid_from;
  update public.org_contracts
     set ends_on = p_ends_on, edited_by = p_by,
         status = case when v_until <= p_at then 'ended' else 'active' end
   where id = p_contract;
end;
$$;

-- 정리 작업 - 종료 시각이 지난 계약을 ended로, 남은 좌석을 회수 처리 (권한은 이미 valid_until로 끝나 있다)
create function public.org_contracts_close_expired(p_now timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.org_seats s set status = 'revoked', revoked_at = public.org_contract_end_at(c.ends_on), revoke_reason = 'contract_end'
    from public.org_contracts c
   where s.contract_id = c.id and c.status = 'active' and public.org_contract_end_at(c.ends_on) <= p_now and s.status in ('invited', 'active');
  update public.org_contracts c set status = 'ended'
   where c.status = 'active' and public.org_contract_end_at(c.ends_on) <= p_now;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.org_contract_activate(uuid, text, timestamptz), public.org_seat_invite(uuid, uuid, text, timestamptz, timestamptz),
  public.org_seat_accept(uuid, text, timestamptz), public.org_seat_revoke(uuid, uuid, text, timestamptz),
  public.org_contract_set_end(uuid, date, text, timestamptz), public.org_contracts_close_expired(timestamptz) from public, anon, authenticated;
grant execute on function public.org_contract_activate(uuid, text, timestamptz), public.org_seat_invite(uuid, uuid, text, timestamptz, timestamptz),
  public.org_seat_accept(uuid, text, timestamptz), public.org_seat_revoke(uuid, uuid, text, timestamptz),
  public.org_contract_set_end(uuid, date, text, timestamptz), public.org_contracts_close_expired(timestamptz) to service_role;
