-- 감사 기록 수정·삭제 — PO만 (2026-10-17 PO 결정, ADM-04 개정)
-- · 직접 UPDATE·DELETE·TRUNCATE는 계속 거부한다 (service_role·소유자 모두)
-- · 전용 함수 audit_log_amend · audit_log_delete로만 바꾼다. 함수는 service_role(서버)만 실행하고,
--   서버는 PO 계정(감사 기록 관리자 설정)일 때만 부른다 — DB는 이름·이유·변경 기록을 강제한다
-- · 바꾼 사실은 audit_log_changes에 자동으로 남고, 이 변경 기록은 누구도 고치거나 지울 수 없다

create table public.audit_log_changes (
  id bigint generated always as identity primary key,
  log_id bigint not null,                                   -- 바뀐 감사 기록 번호 (삭제된 행도 가리키므로 외래 키를 두지 않는다)
  op text not null check (op in ('update', 'delete')),
  old_row jsonb not null,                                   -- 바꾸기 전 행 전체
  new_row jsonb,                                            -- 바꾼 뒤 행 전체 (삭제면 비움)
  actor text not null check (length(btrim(actor)) > 0),     -- 바꾼 사람 — admin:<이메일>
  reason text not null check (length(btrim(reason)) > 0),   -- 바꾼 이유
  at timestamptz not null default now(),
  check ((op = 'update') = (new_row is not null))
);

comment on table public.audit_log_changes is '감사 기록 변경 기록 — PO가 감사 기록을 고치거나 지운 사실. 추가만 가능하고, 전용 함수로만 생긴다';

create index audit_log_changes_log_idx on public.audit_log_changes (log_id, at desc);

alter table public.audit_log_changes enable row level security;
revoke all on table public.audit_log_changes from anon, authenticated, service_role;
grant select on table public.audit_log_changes to service_role;

create function public.audit_log_changes_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_changes는 추가만 할 수 있습니다 (% 거부)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.audit_log_changes_append_only() from public, anon, authenticated;

create trigger audit_log_changes_no_update_delete
  before update or delete on public.audit_log_changes
  for each row execute function public.audit_log_changes_append_only();

create trigger audit_log_changes_no_truncate
  before truncate on public.audit_log_changes
  for each statement execute function public.audit_log_changes_append_only();

-- 감사 기록 트리거: 전용 함수가 연 통로(트랜잭션 안 설정 ltr.audit_amend = on)일 때만 UPDATE·DELETE를 통과시킨다
create or replace function public.audit_logs_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and coalesce(current_setting('ltr.audit_amend', true), '') = 'on' then
    if tg_op = 'UPDATE' then
      return new;
    end if;
    return old;
  end if;
  raise exception 'audit_logs는 추가만 할 수 있습니다 — 수정·삭제는 전용 함수(audit_log_amend·audit_log_delete)로만 (% 거부)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create function public.audit_log_amend(p_id bigint, p_changes jsonb, p_actor text, p_reason text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.audit_logs;
  v_new public.audit_logs;
  v_key text;
  v_change_id bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception '감사 기록 수정: 누가(actor)가 비어 있습니다';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception '감사 기록 수정: 왜(reason)가 비어 있습니다';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception '감사 기록 수정: 고칠 내용이 없습니다';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('actor', 'action', 'target', 'before', 'after', 'reason') then
      raise exception '감사 기록 수정: 고칠 수 없는 칸입니다 (%)', v_key;
    end if;
  end loop;

  select * into v_old from public.audit_logs where id = p_id for update;
  if not found then
    raise exception '감사 기록 %번이 없습니다', p_id;
  end if;

  perform set_config('ltr.audit_amend', 'on', true);
  update public.audit_logs set
    actor  = case when p_changes ? 'actor'  then p_changes ->> 'actor'  else actor  end,
    action = case when p_changes ? 'action' then p_changes ->> 'action' else action end,
    target = case when p_changes ? 'target' then p_changes ->> 'target' else target end,
    before = case when p_changes ? 'before' then p_changes -> 'before'  else before end,
    after  = case when p_changes ? 'after'  then p_changes -> 'after'   else after  end,
    reason = case when p_changes ? 'reason' then p_changes ->> 'reason' else reason end
  where id = p_id
  returning * into v_new;
  perform set_config('ltr.audit_amend', 'off', true);

  insert into public.audit_log_changes (log_id, op, old_row, new_row, actor, reason)
  values (p_id, 'update', to_jsonb(v_old), to_jsonb(v_new), p_actor, p_reason)
  returning id into v_change_id;
  return v_change_id;
exception when others then
  perform set_config('ltr.audit_amend', 'off', true);
  raise;
end;
$$;

create function public.audit_log_delete(p_id bigint, p_actor text, p_reason text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.audit_logs;
  v_change_id bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception '감사 기록 삭제: 누가(actor)가 비어 있습니다';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception '감사 기록 삭제: 왜(reason)가 비어 있습니다';
  end if;

  select * into v_old from public.audit_logs where id = p_id for update;
  if not found then
    raise exception '감사 기록 %번이 없습니다', p_id;
  end if;

  perform set_config('ltr.audit_amend', 'on', true);
  delete from public.audit_logs where id = p_id;
  perform set_config('ltr.audit_amend', 'off', true);

  insert into public.audit_log_changes (log_id, op, old_row, new_row, actor, reason)
  values (p_id, 'delete', to_jsonb(v_old), null, p_actor, p_reason)
  returning id into v_change_id;
  return v_change_id;
exception when others then
  perform set_config('ltr.audit_amend', 'off', true);
  raise;
end;
$$;

revoke all on function public.audit_log_amend(bigint, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.audit_log_delete(bigint, text, text) from public, anon, authenticated;
grant execute on function public.audit_log_amend(bigint, jsonb, text, text) to service_role;
grant execute on function public.audit_log_delete(bigint, text, text) to service_role;
