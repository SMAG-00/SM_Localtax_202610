-- W10-a a3 (3/3) - 감수 서명 · 관리자 승인 함수 (PRD-02 RULE-02·03·04 · TX-05, docs/dev/2단계_설계.md 1.1 a3)
-- · 룰셋 · 판정표 · 지방세 달력은 같은 경로: 초안 -> sign_*()(세무 감수위원 서명) -> approve_*()(관리자 승인). 스크립트로 바로 활성화하는 경로 0.
-- · 함수는 거부해도 예외를 던지지 않고 { ok:false, code, message }를 돌려준다 - 예외면 거래가 되돌려져 거부 감사 행이 사라지기 때문이다.
--   성공이든 거부든 rules_audit에 정확히 1행을 남긴다 (RULE-03).
-- · approve가 보는 것: 서명이 있는가 · 서명 이후 본문이 그대로인가 · 근거 개정 단계가 공포(promulgated)·시행(effective)인가
--   (발표·입법예고·국회 제출·의결 단계 근거는 거부 - TX-05) · 정정으로 대체된 기록이나 '해당 없음' 기록이 아닌가.
--   근거 개정이 없으면(개정과 무관한 감수 정정) 사유 글(basis_note)이 있어야 한다.
-- · 승인자(approver)가 관리자인지는 DB가 모른다(관리자 목록은 서버 환경변수) - 서버가 ruleset.approve 권한을 확인한 뒤 부른다. 서명자는 DB가 staff_roles로 한 번 더 확인한다.
-- · 함수는 service_role만 부를 수 있다 (anon·authenticated 호출 0).

create function public.rules_kind_table(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'ruleset' then 'rulesets' when 'determination_table' then 'determination_tables' when 'tax_calendar' then 'tax_calendar' end;
$$;
revoke all on function public.rules_kind_table(text) from public, anon, authenticated;

create function public.rules_audit_write(p_kind text, p_id bigint, p_version text, p_action text, p_ok boolean, p_code text, p_actor text,
                                         p_basis bigint, p_impact jsonb, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.rules_audit (kind, target_id, version, action, outcome, code, actor, basis_event_id, law_event_id, impact, detail)
  values (p_kind, p_id, p_version, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'),
          p_basis, null, p_impact, left(p_detail, 500));
$$;
revoke all on function public.rules_audit_write(text, bigint, text, text, boolean, text, text, bigint, jsonb, text) from public, anon, authenticated;

-- 서명 - 세무 감수위원만, 초안만, 감수 시트 위치 필수
create function public.rule_sign(p_kind text, p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := public.rules_kind_table(p_kind);
  v_row jsonb;
  v_code text;
  v_msg text;
begin
  if v_table is null then
    raise exception '알 수 없는 종류입니다' using errcode = 'invalid_parameter_value';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using p_id;
  if v_row is null then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif not public.rules_is_reviewer(p_signer) then
    v_code := 'signer_not_reviewer'; v_msg := '감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다 (RULE-04)';
  elsif v_row ->> 'status' <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안(draft)만 서명할 수 있습니다';
  elsif char_length(btrim(coalesce(p_sheet_ref, ''))) not between 1 and 200 then
    v_code := 'sheet_missing'; v_msg := '감수 시트 위치(1~200자)가 필요합니다 (RULE-04)';
  end if;
  if v_code is not null then
    perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'sign', false, v_code, p_signer, nullif(v_row ->> 'basis_event_id', '')::bigint, p_impact, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.rules_gate', 'rpc', true);
  execute format('update public.%I set status = ''reviewed'', signed_by = $2, signed_at = now(), sheet_ref = btrim($3), signed_body_sha256 = body_sha256 where id = $1', v_table)
    using p_id, p_signer, p_sheet_ref;
  perform set_config('ltr.rules_gate', '', true);
  perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'sign', true, 'ok', p_signer, nullif(v_row ->> 'basis_event_id', '')::bigint, p_impact, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '서명했습니다');
end;
$$;

-- 승인 - 서명 뒤에만, 근거 개정이 공포·시행일 때만, 이전 활성본은 retired
create function public.rule_approve(p_kind text, p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := public.rules_kind_table(p_kind);
  v_row jsonb;
  v_basis bigint;
  v_ev record;
  v_code text;
  v_msg text;
begin
  if v_table is null then
    raise exception '알 수 없는 종류입니다' using errcode = 'invalid_parameter_value';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using p_id;
  v_basis := nullif(v_row ->> 'basis_event_id', '')::bigint;
  if v_row is null then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_approver is null or p_approver !~ '^(user|admin):.+' then
    v_code := 'approver_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif v_row ->> 'status' = 'active' then
    v_code := 'already_active'; v_msg := '이미 활성입니다';
  elsif v_row ->> 'status' = 'retired' then
    v_code := 'retired'; v_msg := '내려간 버전은 다시 활성화할 수 없습니다 - 새 차수를 만드세요';
  elsif v_row ->> 'status' <> 'reviewed' or v_row ->> 'signed_at' is null then
    v_code := 'not_signed'; v_msg := '감수 서명이 없는 버전은 승인할 수 없습니다 (RULE-02·04)';
  elsif v_row ->> 'signed_body_sha256' is distinct from v_row ->> 'body_sha256' then
    v_code := 'signature_stale'; v_msg := '서명한 본문과 지금 본문이 다릅니다';
  elsif v_basis is null and char_length(btrim(coalesce(v_row ->> 'basis_note', ''))) = 0 then
    v_code := 'basis_missing'; v_msg := '근거 개정도 사유 글도 없습니다';
  end if;
  if v_code is null and v_basis is not null then
    select e.stage, e.skipped, exists (select 1 from public.amendment_events c where c.correction_of = e.id) as corrected
      into v_ev from public.amendment_events e where e.id = v_basis;
    if not found then
      v_code := 'basis_not_found'; v_msg := '근거 개정 기록이 없습니다';
    elsif v_ev.skipped then
      v_code := 'basis_skipped'; v_msg := '근거 기록이 ''해당 없음'' 단계입니다';
    elsif v_ev.corrected then
      v_code := 'basis_corrected'; v_msg := '근거 기록이 정정으로 대체되었습니다 - 정정 기록을 근거로 다시 만드세요';
    elsif v_ev.stage not in ('promulgated', 'effective') then
      v_code := 'basis_stage'; v_msg := '근거 개정의 단계가 공포 또는 시행이 아니라 반영할 수 없습니다 (TX-05)';
    end if;
  end if;
  if v_code is not null then
    perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'approve', false, v_code, p_approver, v_basis, p_impact, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.rules_gate', 'rpc', true);
  if p_kind = 'determination_table' then
    execute format('update public.%I set status = ''retired'', retired_at = now() where status = ''active'' and id <> $1 and kind = $2', v_table) using p_id, v_row ->> 'kind';
  else
    execute format('update public.%I set status = ''retired'', retired_at = now() where status = ''active'' and id <> $1', v_table) using p_id;
  end if;
  execute format('update public.%I set status = ''active'', activated_by = $2, activated_at = now() where id = $1', v_table) using p_id, p_approver;
  perform set_config('ltr.rules_gate', '', true);
  perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'approve', true, 'ok', p_approver, v_basis, p_impact, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '활성화했습니다');
end;
$$;

-- 종류별 이름 - approve_*() (PRD-02 RULE-02)
create function public.sign_ruleset(p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_sign('ruleset', p_id, p_signer, p_sheet_ref, p_impact); $$;
create function public.sign_determination_table(p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_sign('determination_table', p_id, p_signer, p_sheet_ref, p_impact); $$;
create function public.sign_tax_calendar(p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_sign('tax_calendar', p_id, p_signer, p_sheet_ref, p_impact); $$;
create function public.approve_ruleset(p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_approve('ruleset', p_id, p_approver, p_impact); $$;
create function public.approve_determination_table(p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_approve('determination_table', p_id, p_approver, p_impact); $$;
create function public.approve_tax_calendar(p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_approve('tax_calendar', p_id, p_approver, p_impact); $$;

revoke all on function public.rule_sign(text, bigint, text, text, jsonb), public.rule_approve(text, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.sign_ruleset(bigint, text, text, jsonb), public.sign_determination_table(bigint, text, text, jsonb), public.sign_tax_calendar(bigint, text, text, jsonb),
  public.approve_ruleset(bigint, text, jsonb), public.approve_determination_table(bigint, text, jsonb), public.approve_tax_calendar(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.sign_ruleset(bigint, text, text, jsonb), public.sign_determination_table(bigint, text, text, jsonb), public.sign_tax_calendar(bigint, text, text, jsonb),
  public.approve_ruleset(bigint, text, jsonb), public.approve_determination_table(bigint, text, jsonb), public.approve_tax_calendar(bigint, text, jsonb) to service_role;
