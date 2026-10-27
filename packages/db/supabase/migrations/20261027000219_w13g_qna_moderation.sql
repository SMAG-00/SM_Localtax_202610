-- W13-g g7 — 신고 접수·처리와 보류 해제 (PRD-05 QNA-03 · 05, docs/dev/W13-g_설계.md 4장)
-- · 모든 함수는 service_role 전용이고 거부는 { ok:false, code }로 돌려준다 (감사 로그는 서버 라우트가 남긴다).
-- · qna_report_create - 공개 중인 남의 글만 신고할 수 있고, 처리 목표 시각(due_at)은 서버가 영업일 규칙(addBusinessDays, 1영업일)으로 넘긴다.
-- · qna_report_handle - 받아들임(upheld)이면 글 숨김·제재를 한 트랜잭션에서 함께 할 수 있다. 처리 메모는 필수.
-- · qna_release - 게시 보류(held) 글을 운영자가 확인한 뒤 공개로 푼다. 숨김 글은 풀 수 없다.
-- · qna_hide / qna_sanction_lift - 신고 없이 숨기기, 제재 해제.

create function public.qna_report_create(p_reporter uuid, p_type text, p_target bigint, p_reason text, p_note text, p_due_at timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author uuid;
  v_id bigint;
begin
  if p_type = 'question' then
    select q.author_id into v_author from public.qna_questions q where q.id = p_target and q.status = 'open';
  elsif p_type = 'answer' then
    select a.author_id into v_author from public.qna_answers a
      join public.qna_questions q on q.id = a.question_id and q.status = 'open'
     where a.id = p_target and a.status = 'published';
  else
    return jsonb_build_object('ok', false, 'code', 'bad_type');
  end if;
  if v_author is null then return jsonb_build_object('ok', false, 'code', 'target_not_found'); end if;
  if v_author = p_reporter then return jsonb_build_object('ok', false, 'code', 'own_post'); end if;
  if p_due_at is null or p_due_at <= now() then return jsonb_build_object('ok', false, 'code', 'bad_due'); end if;
  begin
    insert into public.qna_reports (target_type, target_id, reporter_id, reason, note, due_at)
    values (p_type, p_target, p_reporter, p_reason, coalesce(p_note, ''), p_due_at)
    returning id into v_id;
  exception
    when unique_violation then return jsonb_build_object('ok', false, 'code', 'duplicate');
    when check_violation then return jsonb_build_object('ok', false, 'code', 'bad_input');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 글 숨기기 (내부 공용)
create function public.qna_hide_target(p_type text, p_target bigint, p_reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_type = 'question' then
    update public.qna_questions set status = 'hidden', hold_reason = null, hidden_at = now(), hidden_reason = p_reason
     where id = p_target and status <> 'hidden';
  else
    update public.qna_answers set status = 'hidden', hold_reason = null, hidden_at = now(), hidden_reason = p_reason
     where id = p_target and status <> 'hidden';
  end if;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function public.qna_hide(p_type text, p_target bigint, p_reason text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_type not in ('question', 'answer') then return jsonb_build_object('ok', false, 'code', 'bad_type'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or char_length(p_reason) > 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  if not public.qna_hide_target(p_type, p_target, btrim(p_reason)) then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.qna_report_handle(p_report bigint, p_decision text, p_hide boolean, p_sanction_days integer, p_note text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.qna_reports%rowtype;
  v_author uuid;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_decision not in ('upheld', 'dismissed') then return jsonb_build_object('ok', false, 'code', 'bad_decision'); end if;
  if p_note is null or length(btrim(p_note)) = 0 or char_length(p_note) > 300 then return jsonb_build_object('ok', false, 'code', 'note_required'); end if;
  if p_decision = 'dismissed' and (coalesce(p_hide, false) or p_sanction_days is not null) then return jsonb_build_object('ok', false, 'code', 'dismiss_has_action'); end if;
  if p_sanction_days is not null and p_sanction_days < 1 then return jsonb_build_object('ok', false, 'code', 'bad_sanction_days'); end if;
  select * into v_r from public.qna_reports r where r.id = p_report for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_r.status <> 'received' then return jsonb_build_object('ok', false, 'code', 'already_handled'); end if;
  if v_r.target_type = 'question' then
    select q.author_id into v_author from public.qna_questions q where q.id = v_r.target_id;
  else
    select a.author_id into v_author from public.qna_answers a where a.id = v_r.target_id;
  end if;
  if p_decision = 'upheld' and coalesce(p_hide, false) then
    perform public.qna_hide_target(v_r.target_type, v_r.target_id, '신고 처리: ' || btrim(p_note));
  end if;
  if p_decision = 'upheld' and p_sanction_days is not null and v_author is not null then
    insert into public.qna_sanctions (user_id, reason, report_id, ends_at, created_by)
    values (v_author, '신고 처리: ' || left(btrim(p_note), 280), p_report, now() + make_interval(days => p_sanction_days), btrim(p_actor));
  end if;
  update public.qna_reports set status = p_decision, handled_by = btrim(p_actor), handled_at = now(), resolution_note = btrim(p_note) where id = p_report;
  return jsonb_build_object('ok', true);
end;
$$;

-- 제재 직접 부과 (기간 없음 = 해제할 때까지)
create function public.qna_sanction_add(p_user uuid, p_reason text, p_days integer, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or char_length(p_reason) > 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  if p_days is not null and p_days < 1 then return jsonb_build_object('ok', false, 'code', 'bad_sanction_days'); end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then return jsonb_build_object('ok', false, 'code', 'no_user'); end if;
  insert into public.qna_sanctions (user_id, reason, ends_at, created_by)
  values (p_user, btrim(p_reason), case when p_days is null then null else now() + make_interval(days => p_days) end, btrim(p_actor));
  return jsonb_build_object('ok', true);
end;
$$;

create function public.qna_sanction_lift(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  update public.qna_sanctions set lifted_at = now(), lifted_by = btrim(p_actor) where id = p_id and lifted_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 게시 보류 풀기 - 운영자가 가림·표현을 확인한 뒤. 숨김 글은 풀 수 없다
create function public.qna_release(p_type text, p_target bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_type = 'question' then
    update public.qna_questions set status = 'open', hold_reason = null where id = p_target and status = 'held';
  elsif p_type = 'answer' then
    update public.qna_answers set status = 'published', hold_reason = null where id = p_target and status = 'held';
  else
    return jsonb_build_object('ok', false, 'code', 'bad_type');
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'code', 'not_held'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.qna_report_create(uuid, text, bigint, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.qna_hide_target(text, bigint, text) from public, anon, authenticated;
revoke all on function public.qna_hide(text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.qna_report_handle(bigint, text, boolean, integer, text, text) from public, anon, authenticated;
revoke all on function public.qna_sanction_add(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.qna_sanction_lift(bigint, text) from public, anon, authenticated;
revoke all on function public.qna_release(text, bigint, text) from public, anon, authenticated;
grant execute on function public.qna_report_create(uuid, text, bigint, text, text, timestamptz) to service_role;
grant execute on function public.qna_hide(text, bigint, text, text) to service_role;
grant execute on function public.qna_report_handle(bigint, text, boolean, integer, text, text) to service_role;
grant execute on function public.qna_sanction_add(uuid, text, integer, text) to service_role;
grant execute on function public.qna_sanction_lift(bigint, text) to service_role;
grant execute on function public.qna_release(text, bigint, text) to service_role;
