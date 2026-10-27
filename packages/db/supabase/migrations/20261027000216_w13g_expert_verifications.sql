-- W13-g g1 — SM 소속 전문가 계정 연결 (PRD-05 EXP-01 · EXP-02, docs/dev/W13-g_설계.md 2장)
-- · expert_verifications — 회원 계정(auth.users)을 W7c 공개 SM 소속 전문가 프로필(expert_profiles)에 잇는 새 표. 프로필 쪽 표·칸은 고치지 않는다.
--   외부 증빙(등록번호·증빙 파일 경로)·자기 신청 칸 0. 연결·해제·갱신은 관리자 RPC로만 (service_role 전용), 이력은 추가만.
-- · 배지가 유효한 조건 = 연결이 active ∧ 재검증 기한(expires_at) 전 ∧ 프로필이 공개(published)·철회 없음·SM 소속 형태 (함수 expert_badge_valid).
--   프로필이 공개에서 내려가거나 철회되면 트리거가 같은 트랜잭션에서 연결을 끝낸다 (SM 소속 종료 즉시 배지 해제).
-- · 재검증 기한 만료는 expert_links_expire()가 닫는다 (배치 expert-badge-expiry가 부른다). 닫기 전에도 expert_badge_valid는 기한을 따로 본다.

create table public.expert_verifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  expert_profile_id bigint not null references public.expert_profiles (id),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  linked_by text not null check (length(btrim(linked_by)) > 0),
  linked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text check (ended_reason is null or char_length(ended_reason) <= 300),
  ended_by text,
  constraint expert_verifications_expiry_after_link check (expires_at > linked_at),
  constraint expert_verifications_end_record check (
    (status = 'active') = (ended_at is null)
    and (status = 'active' or (length(btrim(coalesce(ended_reason, ''))) > 0 and length(btrim(coalesce(ended_by, ''))) > 0)))
);
comment on table public.expert_verifications is '라운지 SM 전문가 계정 연결 (EXP-01·02) - 회원 계정 1명 = 공개 SM 소속 프로필 1명. 외부 증빙·자기 신청 칸 없음. 검증 기록은 W7c 프로필 것을 참조만 한다';
create unique index expert_verifications_one_active_per_user on public.expert_verifications (user_id) where status = 'active';
create unique index expert_verifications_one_active_per_profile on public.expert_verifications (expert_profile_id) where status = 'active';
create index expert_verifications_profile_idx on public.expert_verifications (expert_profile_id);

create table public.expert_verification_events (
  id bigint generated always as identity primary key,
  verification_id bigint not null,
  user_id uuid not null,
  expert_profile_id bigint not null,
  action text not null check (action in ('linked', 'renewed', 'revoked', 'expired')),
  actor text not null,
  note text check (note is null or char_length(note) <= 300),
  at timestamptz not null default now()
);
comment on table public.expert_verification_events is '계정 연결 이력 (EXP-01·02) - 추가만. 연결·갱신·해제·만료와 행위자 (계정 삭제 뒤에도 남도록 외래 키 없음)';
create trigger expert_verification_events_no_change
  before update or delete on public.expert_verification_events
  for each row execute function public.append_only_guard();
create trigger expert_verification_events_no_truncate
  before truncate on public.expert_verification_events
  for each statement execute function public.append_only_guard();

create function public.expert_verifications_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      raise exception '연결은 active로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.expert_profiles p
                    where p.id = new.expert_profile_id and p.status = 'published' and p.withdrawn_at is null
                      and p.house_relation in ('employed', 'sm_corporation')) then
      raise exception 'SM 소속 공개 프로필이 없는 계정은 연결할 수 없습니다 (EXP-01)' using errcode = 'check_violation';
    end if;
  else
    if new.user_id <> old.user_id or new.expert_profile_id <> old.expert_profile_id
       or new.linked_by <> old.linked_by or new.linked_at <> old.linked_at then
      raise exception '연결의 계정·프로필·연결자·연결 시각은 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.status <> 'active' then
      raise exception '끝난 연결은 고칠 수 없습니다 - 새로 연결하세요' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.expert_verifications_guard() from public, anon, authenticated;
create trigger expert_verifications_guard
  before insert or update on public.expert_verifications
  for each row execute function public.expert_verifications_guard();

create function public.expert_verifications_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_actor text;
  v_note text;
begin
  if tg_op = 'INSERT' then
    v_action := 'linked'; v_actor := new.linked_by; v_note := null;
  elsif new.status = 'revoked' and old.status = 'active' then
    v_action := 'revoked'; v_actor := new.ended_by; v_note := new.ended_reason;
  elsif new.status = 'expired' and old.status = 'active' then
    v_action := 'expired'; v_actor := new.ended_by; v_note := new.ended_reason;
  elsif new.expires_at is distinct from old.expires_at then
    v_action := 'renewed'; v_actor := coalesce(nullif(current_setting('app.expert_link_actor', true), ''), 'unknown'); v_note := null;
  else
    return null;
  end if;
  insert into public.expert_verification_events (verification_id, user_id, expert_profile_id, action, actor, note)
  values (new.id, new.user_id, new.expert_profile_id, v_action, v_actor, v_note);
  return null;
end;
$$;
revoke all on function public.expert_verifications_history() from public, anon, authenticated;
create trigger expert_verifications_history
  after insert or update on public.expert_verifications
  for each row execute function public.expert_verifications_history();

-- 프로필이 공개에서 내려가거나 철회되면 연결을 같은 트랜잭션에서 끝낸다 (EXP-02 - SM 소속 종료 즉시 배지 해제)
create function public.expert_profiles_end_links() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.expert_verifications
     set status = 'revoked', ended_at = now(), ended_reason = 'SM 소속 프로필이 공개 상태가 아니게 되어 자동 해제', ended_by = 'system'
   where expert_profile_id = new.id and status = 'active';
  return null;
end;
$$;
revoke all on function public.expert_profiles_end_links() from public, anon, authenticated;
create trigger expert_profiles_end_links
  after update of status on public.expert_profiles
  for each row when (old.status = 'published' and new.status <> 'published')
  execute function public.expert_profiles_end_links();

-- 지금 유효한 배지의 프로필 번호 (없으면 null) - p_at 기준
create function public.expert_badge_valid(p_user uuid, p_at timestamptz default now()) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select v.expert_profile_id
    from public.expert_verifications v
    join public.expert_profiles p on p.id = v.expert_profile_id
   where v.user_id = p_user and v.status = 'active' and v.expires_at > p_at
     and p.status = 'published' and p.withdrawn_at is null and p.house_relation in ('employed', 'sm_corporation')
   limit 1
$$;

-- 재검증 기한이 지난 연결을 닫는다 - 닫은 건수
create function public.expert_links_expire(p_at timestamptz default now()) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.expert_verifications
     set status = 'expired', ended_at = now(), ended_reason = '재검증 기한 만료', ended_by = 'system'
   where status = 'active' and expires_at <= p_at;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 연결 만들기 - 거부는 { ok:false, code }
create function public.expert_link_create(p_user uuid, p_profile bigint, p_expires_at timestamptz, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_expires_at is null or p_expires_at <= now() then return jsonb_build_object('ok', false, 'code', 'bad_expiry'); end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then return jsonb_build_object('ok', false, 'code', 'no_user'); end if;
  if not exists (select 1 from public.expert_profiles p where p.id = p_profile) then return jsonb_build_object('ok', false, 'code', 'no_profile'); end if;
  if not exists (select 1 from public.expert_profiles p where p.id = p_profile and p.status = 'published' and p.withdrawn_at is null
                    and p.house_relation in ('employed', 'sm_corporation')) then
    return jsonb_build_object('ok', false, 'code', 'profile_not_published');
  end if;
  perform public.expert_links_expire();
  if exists (select 1 from public.expert_verifications v where v.user_id = p_user and v.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'user_already_linked');
  end if;
  if exists (select 1 from public.expert_verifications v where v.expert_profile_id = p_profile and v.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'profile_already_linked');
  end if;
  begin
    insert into public.expert_verifications (user_id, expert_profile_id, linked_by, expires_at)
    values (p_user, p_profile, btrim(p_actor), p_expires_at)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'already_linked');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 연결 해제 (사유 필수)
create function public.expert_link_end(p_id bigint, p_reason text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or char_length(p_reason) > 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  select v.status into v_status from public.expert_verifications v where v.id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_status <> 'active' then return jsonb_build_object('ok', false, 'code', 'already_ended'); end if;
  update public.expert_verifications
     set status = 'revoked', ended_at = now(), ended_reason = btrim(p_reason), ended_by = btrim(p_actor)
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- 재검증 기한 갱신 (연 1회 재확인 - EXP-02). 새 기한은 지금과 지금 기한보다 뒤여야 한다
create function public.expert_link_renew(p_id bigint, p_expires_at timestamptz, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.expert_verifications%rowtype;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  select * into v_row from public.expert_verifications v where v.id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_row.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'not_active'); end if;
  if p_expires_at is null or p_expires_at <= now() or p_expires_at <= v_row.expires_at then
    return jsonb_build_object('ok', false, 'code', 'bad_expiry');
  end if;
  perform set_config('app.expert_link_actor', btrim(p_actor), true);
  update public.expert_verifications set expires_at = p_expires_at where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

alter table public.expert_verifications enable row level security;
alter table public.expert_verification_events enable row level security;
revoke all on table public.expert_verifications, public.expert_verification_events from anon, authenticated, service_role;
grant select on table public.expert_verifications, public.expert_verification_events to service_role;

revoke all on function public.expert_badge_valid(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.expert_links_expire(timestamptz) from public, anon, authenticated;
revoke all on function public.expert_link_create(uuid, bigint, timestamptz, text) from public, anon, authenticated;
revoke all on function public.expert_link_end(bigint, text, text) from public, anon, authenticated;
revoke all on function public.expert_link_renew(bigint, timestamptz, text) from public, anon, authenticated;
grant execute on function public.expert_badge_valid(uuid, timestamptz) to service_role;
grant execute on function public.expert_links_expire(timestamptz) to service_role;
grant execute on function public.expert_link_create(uuid, bigint, timestamptz, text) to service_role;
grant execute on function public.expert_link_end(bigint, text, text) to service_role;
grant execute on function public.expert_link_renew(bigint, timestamptz, text) to service_role;
