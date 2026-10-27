-- W13-j j1·j2·j3 - 인증 추진 계획 승인·철회 함수, 기관 판매 게이트, 공개 뷰 (PRD-05 SEC-02, docs/dev/W13-j_설계.md)
-- · security_cert_plan_approve - 초안만. 운영 주체 명의·위험 평가일(오늘 이하)·종료일(오늘 이후)·인증 단정 표현 0. 이전 승인본은 superseded. 거부도 감사 1행
-- · security_cert_plan_withdraw - 초안·승인본을 철회. 승인본이 철회되면 게이트가 닫힌다
-- · security_cert_gate_open() - 승인된 계획이 있는가 (기관 결제 화면의 입력, service_role 전용)
-- · public_security_cert_status - /security '추진 중' 표기. 기능 키 security_cert_plan ∧ public_security_gate 열림 ∧ 승인본 1건일 때만 종류·승인일 1행

create function public.security_cert_audit_write(p_plan bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_cert_audit (plan_id, action, outcome, code, actor, detail)
  values (p_plan, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.security_cert_audit_write(bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.security_cert_audit_write(bigint, text, boolean, text, text, text) to service_role;

create function public.security_cert_plan_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.security_cert_plans;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_code text;
  v_msg text;
begin
  select * into p from public.security_cert_plans where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안만 승인할 수 있습니다';
  elsif p.entity_name is null or char_length(btrim(p.entity_name)) = 0 then
    v_code := 'entity_missing'; v_msg := '운영 주체 명의가 비어 있습니다';
  elsif p.risk_assessed_on is null then
    v_code := 'risk_missing'; v_msg := '위험 평가 실시일이 비어 있습니다';
  elsif p.risk_assessed_on > v_today then
    v_code := 'risk_future'; v_msg := '위험 평가 실시일이 오늘보다 뒤입니다';
  elsif p.target_end_on < v_today then
    v_code := 'schedule_past'; v_msg := '목표 종료일이 이미 지났습니다';
  elsif cardinality(public.security_text_violations(concat_ws(' ', p.scope, p.other_kind_name, p.owner_name, p.entity_name, p.note))) > 0 then
    v_code := 'cert_claim'; v_msg := '인증을 받은 것으로 읽히는 표현이 있습니다 - 인증 취득 전에는 쓸 수 없습니다';
  end if;
  if v_code is not null then
    perform public.security_cert_audit_write(coalesce(p_id, 0), 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.security_cert_gate', 'rpc', true);
  update public.security_cert_plans set status = 'superseded', closed_at = now() where status = 'approved';
  update public.security_cert_plans set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.security_cert_gate', '', true);
  perform public.security_cert_audit_write(p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '추진 계획을 승인했습니다');
end;
$$;

create function public.security_cert_plan_withdraw(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.security_cert_plans;
  v_code text;
  v_msg text;
begin
  select * into p from public.security_cert_plans where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p.status not in ('draft', 'approved') then
    v_code := 'not_open'; v_msg := '초안 또는 승인된 계획만 철회할 수 있습니다';
  end if;
  if v_code is not null then
    perform public.security_cert_audit_write(coalesce(p_id, 0), 'withdraw', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.security_cert_gate', 'rpc', true);
  update public.security_cert_plans set status = 'withdrawn', closed_at = now() where id = p_id;
  perform set_config('ltr.security_cert_gate', '', true);
  perform public.security_cert_audit_write(p_id, 'withdraw', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '철회했습니다');
end;
$$;

create function public.security_cert_gate_open() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.security_cert_plans p where p.status = 'approved');
$$;

revoke all on function public.security_cert_plan_approve(bigint, text), public.security_cert_plan_withdraw(bigint, text), public.security_cert_gate_open() from public, anon, authenticated;
grant execute on function public.security_cert_plan_approve(bigint, text), public.security_cert_plan_withdraw(bigint, text), public.security_cert_gate_open() to service_role;

create view public.public_security_cert_status as
select p.cert_kind, p.other_kind_name, (p.approved_at at time zone 'Asia/Seoul')::date as approved_on
  from public.security_cert_plans p
 where p.status = 'approved'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'security_cert_plan') = 'true'::jsonb)
   and exists (select 1 from public.public_security_gate);

revoke all on table public.public_security_cert_status from public, anon, authenticated, service_role;
grant select on table public.public_security_cert_status to anon, authenticated, service_role;
