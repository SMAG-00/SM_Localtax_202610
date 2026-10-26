-- W12-e e3 - 게이트 리포트 · 승인 RPC (docs/dev/4단계_설계.md 1장 W12-e · 2.1 번호 164 · 4.2, PRD-04 EVAL-04 · 9장, docs/dev/W12-e_설계.md)
-- · eval_gate_thresholds 설정: 단계 4a·4b·4c와 범위(신탁·정비 / 상속 / 증여)별 게이트 값. 값은 PRD-04 9장의 운영 기준이며 세무 값이 아니다. 4c 기준(정답률 90%·인용 정밀도 98%·필수 근거 재현율 85%·
--   역질문 누락 5%·치명 오류 0)보다 낮은 값, 0이어야 하는 지표(지어낸 답·감면 단정·스냅샷 없는 실시간 인용)의 0 초과, 문항 수 하한(300 · 신탁정비 100 · 상속 30 · 증여 30)보다 작은 값은 트리거가 저장을 거부한다.
-- · eval_run_metrics(): 실행의 지표를 DB가 사람 판정(eval_answer_final)에서 계산한다. 미확정(2인 불일치)은 집계에서 빼고 따로 센다. 3인째 판정 전에는 확정으로 치지 않는다.
-- · eval_gate_evaluate(): 지표 대 기준 - 통과 여부는 DB가 계산한다 (앱이 통과 칸을 넣지 못한다).
-- · eval_gate_reports: 리포트 한 부(단계 4a·4b·4c 또는 범위). 컴파일 함수로만 만든다(통과 칸 직접 입력 불가). 시험용 문항이 든 판의 리포트와 게이트 미달·실제 API 재실행 없는 리포트는 확정되지 않는다.
-- · eval_gate_report_confirm / ask_rollout_approve / ask_scope_approve: 거부해도 예외를 던지지 않고 { ok:false, code, message }를 돌려주며 eval_audit에 정확히 1행(성공도 1행)을 남긴다.
--   공개 단계는 none -> 4a -> 4b -> 4c 한 칸씩만 올리고(내리는 것은 리포트 없이 언제든 가능, 감사 1행), 범위 플래그는 범위마다 따로 켠다(상속만 켜도 증여는 그대로).
--   settings의 ask_rollout·ask_scope_flags는 이 함수들 밖의 쓰기를 트리거가 막는다 (일반 설정 쓰기로 못 바꾼다).
-- · public_ask_gate(): 공개 위젯이 부르는 공개 판정 함수(공개 단계·범위 플래그 값만 돌려준다). anon 실행 허용 목록(verify-rls-remote)에 같은 커밋에서 더했다.
-- 승인자(admin)가 관리자인지는 DB가 모른다 - 서버가 eval.gate_approve·ask_rollout.approve·ask_scope.approve 권한을 확인한 뒤 부른다. 함수는 service_role만 부른다.

create function public.eval_num(p jsonb, p_path text[]) returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p #> p_path) = 'number' then (p #>> p_path)::numeric end;
$$;
revoke all on function public.eval_num(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.eval_num(jsonb, text[]) to service_role;

-- 게이트 값 검사 - 문제가 있으면 사유 글, 없으면 null. 하한은 PRD-04 9장(4c 값은 PRD_최종 v1.7 5.2 수치)이고 낮추지 못한다
create function public.eval_thresholds_problem(p jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_stage text;
  v_scope text;
  v_key text;
  v_n numeric;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'stages') is distinct from 'object' or jsonb_typeof(p -> 'scopes') is distinct from 'object' then
    return '게이트 값은 stages(4a·4b·4c)와 scopes 두 묶음을 가진 객체여야 합니다';
  end if;
  foreach v_stage in array array['4a', '4b', '4c'] loop
    foreach v_key in array array['accuracy_min', 'citation_precision_min', 'recall_min', 'clarify_omission_max', 'invented_max', 'benefit_assertion_max', 'live_without_snapshot_max', 'fatal_max', 'min_items'] loop
      v_n := public.eval_num(p, array['stages', v_stage, v_key]);
      if v_n is null then
        return format('stages.%s.%s: 숫자 값이 필요합니다', v_stage, v_key);
      end if;
      if v_n < 0 or (v_key in ('accuracy_min', 'citation_precision_min', 'recall_min', 'clarify_omission_max') and v_n > 1) then
        return format('stages.%s.%s: 범위를 벗어났습니다', v_stage, v_key);
      end if;
    end loop;
    foreach v_key in array array['clarify', 'benefits', 'live'] loop
      if public.eval_num(p, array['stages', v_stage, 'min_cross', v_key]) is null then
        return format('stages.%s.min_cross.%s: 숫자 값이 필요합니다', v_stage, v_key);
      end if;
    end loop;
    -- 모든 단계에서 0이어야 하는 지표
    if public.eval_num(p, array['stages', v_stage, 'invented_max']) > 0 or public.eval_num(p, array['stages', v_stage, 'benefit_assertion_max']) > 0
       or public.eval_num(p, array['stages', v_stage, 'live_without_snapshot_max']) > 0 then
      return format('stages.%s: 지어낸 답·감면 단정·스냅샷 없는 실시간 인용의 허용 값은 0입니다', v_stage);
    end if;
    -- 문항 수 하한 (기본 300문항 · 교차 유형 최소 역질문 60·감면 안내 30·실시간 조회 15)
    if public.eval_num(p, array['stages', v_stage, 'min_items']) < 300
       or public.eval_num(p, array['stages', v_stage, 'min_cross', 'clarify']) < 60
       or public.eval_num(p, array['stages', v_stage, 'min_cross', 'benefits']) < 30
       or public.eval_num(p, array['stages', v_stage, 'min_cross', 'live']) < 15 then
      return format('stages.%s: 문항 수 하한(기본 300 · 역질문 60 · 감면 안내 30 · 실시간 조회 15)보다 낮게 저장할 수 없습니다', v_stage);
    end if;
  end loop;
  if public.eval_num(p, array['stages', '4a', 'fatal_max']) > 2 then
    return 'stages.4a.fatal_max: 4a 치명 오류 허용은 2건을 넘을 수 없습니다';
  end if;
  if public.eval_num(p, array['stages', '4b', 'fatal_max']) > 0 or public.eval_num(p, array['stages', '4c', 'fatal_max']) > 0 then
    return '4b·4c의 치명 오류 허용은 0입니다';
  end if;
  -- 4c 하한 - 낮추지 않는다
  if public.eval_num(p, array['stages', '4c', 'accuracy_min']) < 0.90 or public.eval_num(p, array['stages', '4c', 'citation_precision_min']) < 0.98
     or public.eval_num(p, array['stages', '4c', 'recall_min']) < 0.85 or public.eval_num(p, array['stages', '4c', 'clarify_omission_max']) > 0.05 then
    return '4c 기준(정답률 90% · 인용 정밀도 98% · 필수 근거 재현율 85% · 역질문 누락 5%)보다 낮은 값은 저장할 수 없습니다';
  end if;
  -- 범위별 게이트 (신탁·정비 100 · 상속 30 이상 · 증여 30 이상, 정답률·인용 정밀도는 4c 값)
  foreach v_scope in array array['trust_redevelopment', 'inheritance', 'gift'] loop
    foreach v_key in array array['accuracy_min', 'citation_precision_min', 'fatal_max', 'min_items', 'national_block_min'] loop
      v_n := public.eval_num(p, array['scopes', v_scope, v_key]);
      if v_n is null then
        return format('scopes.%s.%s: 숫자 값이 필요합니다', v_scope, v_key);
      end if;
      if v_n < 0 or (v_key in ('accuracy_min', 'citation_precision_min') and v_n > 1) then
        return format('scopes.%s.%s: 범위를 벗어났습니다', v_scope, v_key);
      end if;
    end loop;
    if public.eval_num(p, array['scopes', v_scope, 'accuracy_min']) < 0.90 or public.eval_num(p, array['scopes', v_scope, 'citation_precision_min']) < 0.98
       or public.eval_num(p, array['scopes', v_scope, 'fatal_max']) > 0 then
      return format('scopes.%s: 4c 기준(정답률 90% · 인용 정밀도 98% · 치명 오류 0)보다 낮은 값은 저장할 수 없습니다', v_scope);
    end if;
    if public.eval_num(p, array['scopes', v_scope, 'min_items']) < (case v_scope when 'trust_redevelopment' then 100 else 30 end) then
      return format('scopes.%s.min_items: 문항 수 하한(신탁·정비 100 · 상속·증여 30)보다 낮게 저장할 수 없습니다', v_scope);
    end if;
    if v_scope in ('inheritance', 'gift') and public.eval_num(p, array['scopes', v_scope, 'national_block_min']) < 1 then
      return format('scopes.%s.national_block_min: 국세 금액·공제 차단 문항은 1개 이상이어야 합니다', v_scope);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.eval_thresholds_problem(jsonb) from public, anon, authenticated;
grant execute on function public.eval_thresholds_problem(jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 감사 - 추가만. 성공도 거부도 1행
-- ─────────────────────────────────────────────────────────────
create table public.eval_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null check (action in ('report_compile', 'report_confirm', 'rollout', 'scope')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  report_id bigint,
  target text check (target is null or char_length(target) <= 60),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint eval_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.eval_audit is '평가 게이트 리포트·공개 단계·범위 플래그 승인 감사 (EVAL-04) - 추가만. 거부도 1행(code가 사유)';
create index eval_audit_report_idx on public.eval_audit (report_id, at desc);

create function public.eval_audit_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'eval_audit는 추가만 할 수 있습니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.eval_audit_append_only() from public, anon, authenticated;
create trigger eval_audit_no_update_delete before update or delete on public.eval_audit for each row execute function public.eval_audit_append_only();
create trigger eval_audit_no_truncate before truncate on public.eval_audit for each statement execute function public.eval_audit_append_only();

create function public.eval_audit_write(p_action text, p_ok boolean, p_code text, p_actor text, p_report_id bigint, p_target text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.eval_audit (action, outcome, code, actor, report_id, target, detail)
  values (p_action, case when p_ok then 'ok' else 'refused' end, case when p_ok then 'ok' else p_code end,
          coalesce(nullif(btrim(p_actor), ''), 'unknown'), p_report_id, left(p_target, 60), left(p_detail, 500));
$$;
revoke all on function public.eval_audit_write(text, boolean, text, text, bigint, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 지표 계산 (사람 판정만)
-- ─────────────────────────────────────────────────────────────
create function public.eval_run_metrics(p_run_id bigint) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set bigint;
  v_result jsonb;
begin
  select r.set_id into v_set from public.eval_runs r where r.id = p_run_id;
  if not found then
    return null;
  end if;
  with it as (
    select * from public.eval_items where set_id = v_set
  ),
  ans as (
    select a.id as answer_id, a.behavior, a.cited_ids, a.live_without_snapshot, f.status, f.verdict, f.fatal_error, f.citations_supported,
           f.clarify_missed, f.invented_answer, f.benefit_asserted, i.item_key, i.cross_types, i.expected_behavior, i.category, i.required_citation_ids
      from public.eval_answers a
      join public.eval_answer_final f on f.answer_id = a.id
      join it i on i.id = a.item_id
     where a.run_id = p_run_id
  ),
  conf as (
    select * from ans where status in ('confirmed', 'confirmed_third')
  )
  select jsonb_build_object(
    'set_items', (select count(*) from it),
    'set_items_excl_national', (select count(*) from it where category is distinct from 'national_tax_amount'),
    'national_block_items', (select count(*) from it where category = 'national_tax_amount'),
    'cross_counts', jsonb_build_object(
      'clarify', (select count(*) from it where 'clarify' = any (cross_types)),
      'benefits', (select count(*) from it where 'benefits' = any (cross_types)),
      'live', (select count(*) from it where 'live' = any (cross_types))),
    'has_test_items', exists (select 1 from it where is_test),
    'answered', (select count(*) from ans),
    'confirmed', (select count(*) from conf),
    'unconfirmed', (select count(*) from ans where status = 'disputed'),
    'ungraded', (select count(*) from ans where status in ('ungraded', 'one_grade')),
    'accuracy', (select case when count(*) > 0 then round(count(*) filter (where verdict = 'correct')::numeric / count(*), 4) end from conf),
    'citation_precision', (select case when sum(cardinality(cited_ids)) > 0
        then round(sum(least(citations_supported, cardinality(cited_ids)))::numeric / sum(cardinality(cited_ids)), 4) end from conf),
    'recall', (select case when sum(cardinality(required_citation_ids)) > 0
        then round(sum(cardinality(array(select unnest(required_citation_ids) intersect select unnest(cited_ids))))::numeric / sum(cardinality(required_citation_ids)), 4) end
        from conf where cardinality(required_citation_ids) > 0),
    'clarify_omission', (select case when count(*) > 0 then round(count(*) filter (where clarify_missed)::numeric / count(*), 4) end from conf where 'clarify' = any (cross_types)),
    'invented', (select count(*) filter (where invented_answer) from conf),
    'benefit_assertion', (select count(*) filter (where benefit_asserted) from conf),
    'live_without_snapshot', (select coalesce(sum(live_without_snapshot), 0) from ans),
    'fatal', (select count(*) filter (where fatal_error is not null) from conf),
    'fatal_list', coalesce((select jsonb_agg(jsonb_build_object('answer_id', answer_id, 'item_key', item_key, 'fatal_error', fatal_error) order by answer_id)
                             from conf where fatal_error is not null), '[]'::jsonb),
    'blocked_total', (select count(*) from conf where expected_behavior = 'blocked'),
    'blocked_correct', (select count(*) from conf where expected_behavior = 'blocked' and verdict = 'correct' and behavior = 'blocked'),
    'national_block_confirmed', (select count(*) from conf where category = 'national_tax_amount'),
    'national_block_correct', (select count(*) from conf where category = 'national_tax_amount' and verdict = 'correct' and behavior = 'blocked'),
    'by_cross_type', jsonb_build_object(
      'clarify', (select jsonb_build_object('n', count(*), 'accuracy', case when count(*) > 0 then round(count(*) filter (where verdict = 'correct')::numeric / count(*), 4) end,
                          'fatal', count(*) filter (where fatal_error is not null)) from conf where 'clarify' = any (cross_types)),
      'benefits', (select jsonb_build_object('n', count(*), 'accuracy', case when count(*) > 0 then round(count(*) filter (where verdict = 'correct')::numeric / count(*), 4) end,
                          'fatal', count(*) filter (where fatal_error is not null)) from conf where 'benefits' = any (cross_types)),
      'live', (select jsonb_build_object('n', count(*), 'accuracy', case when count(*) > 0 then round(count(*) filter (where verdict = 'correct')::numeric / count(*), 4) end,
                          'fatal', count(*) filter (where fatal_error is not null)) from conf where 'live' = any (cross_types)))
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.eval_run_metrics(bigint) from public, anon, authenticated;
grant execute on function public.eval_run_metrics(bigint) to service_role;

-- 지표 대 기준 - { passed, shortfalls[] }. 값이 비어 있어 재지 못한 지표도 미달로 센다
create function public.eval_gate_evaluate(p_metrics jsonb, p_th jsonb) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text[] := '{}';
  v_k text;
begin
  if p_metrics is null or p_th is null then
    return jsonb_build_object('passed', false, 'shortfalls', jsonb_build_array('no_metrics'));
  end if;
  if coalesce((p_metrics ->> 'has_test_items')::boolean, true) then v := array_append(v, 'test_items'::text); end if;
  if coalesce((p_metrics ->> 'answered')::int, 0) < coalesce((p_metrics ->> 'set_items')::int, 1) then v := array_append(v, 'unanswered'::text); end if;
  if coalesce((p_metrics ->> 'unconfirmed')::int, 0) > 0 then v := array_append(v, 'unconfirmed'::text); end if;
  if coalesce((p_metrics ->> 'ungraded')::int, 0) > 0 then v := array_append(v, 'ungraded'::text); end if;
  if coalesce((p_metrics ->> 'set_items_excl_national')::numeric, 0) < coalesce(public.eval_num(p_th, array['min_items']), 1e9) then v := array_append(v, 'min_items'::text); end if;
  if p_th ? 'min_cross' then
    foreach v_k in array array['clarify', 'benefits', 'live'] loop
      if coalesce((p_metrics #>> array['cross_counts', v_k])::numeric, 0) < coalesce(public.eval_num(p_th, array['min_cross', v_k]), 1e9) then v := array_append(v, ('min_cross_' || v_k)::text); end if;
    end loop;
  end if;
  if (p_metrics ->> 'accuracy') is null or (p_metrics ->> 'accuracy')::numeric < coalesce(public.eval_num(p_th, array['accuracy_min']), 1) then v := array_append(v, 'accuracy'::text); end if;
  if (p_metrics ->> 'citation_precision') is null or (p_metrics ->> 'citation_precision')::numeric < coalesce(public.eval_num(p_th, array['citation_precision_min']), 1) then v := array_append(v, 'citation_precision'::text); end if;
  if p_th ? 'recall_min' and ((p_metrics ->> 'recall') is null or (p_metrics ->> 'recall')::numeric < public.eval_num(p_th, array['recall_min'])) then v := array_append(v, 'recall'::text); end if;
  if p_th ? 'clarify_omission_max' and ((p_metrics ->> 'clarify_omission') is null or (p_metrics ->> 'clarify_omission')::numeric > public.eval_num(p_th, array['clarify_omission_max'])) then v := array_append(v, 'clarify_omission'::text); end if;
  if p_th ? 'invented_max' and coalesce((p_metrics ->> 'invented')::numeric, 1) > public.eval_num(p_th, array['invented_max']) then v := array_append(v, 'invented'::text); end if;
  if p_th ? 'benefit_assertion_max' and coalesce((p_metrics ->> 'benefit_assertion')::numeric, 1) > public.eval_num(p_th, array['benefit_assertion_max']) then v := array_append(v, 'benefit_assertion'::text); end if;
  if p_th ? 'live_without_snapshot_max' and coalesce((p_metrics ->> 'live_without_snapshot')::numeric, 1) > public.eval_num(p_th, array['live_without_snapshot_max']) then v := array_append(v, 'live_without_snapshot'::text); end if;
  if coalesce((p_metrics ->> 'fatal')::numeric, 1) > coalesce(public.eval_num(p_th, array['fatal_max']), 0) then v := array_append(v, 'fatal'::text); end if;
  if p_th ? 'national_block_min' then
    if coalesce((p_metrics ->> 'national_block_items')::numeric, 0) < public.eval_num(p_th, array['national_block_min'])
       or coalesce((p_metrics ->> 'national_block_correct')::numeric, 0) < coalesce((p_metrics ->> 'national_block_items')::numeric, 1) then
      v := array_append(v, 'national_block'::text);
    end if;
  end if;
  return jsonb_build_object('passed', cardinality(v) = 0, 'shortfalls', to_jsonb(v));
end;
$$;
revoke all on function public.eval_gate_evaluate(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.eval_gate_evaluate(jsonb, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 게이트 리포트
-- ─────────────────────────────────────────────────────────────
create table public.eval_gate_reports (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('stage', 'scope')),
  stage text check (stage in ('4a', '4b', '4c')),
  scope text check (scope in ('trust_redevelopment', 'inheritance', 'gift')),
  run_id bigint not null references public.eval_runs (id),
  live_run_id bigint references public.eval_runs (id),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  thresholds jsonb not null,
  metrics jsonb not null,
  live_metrics jsonb,
  evaluation jsonb not null,
  live_evaluation jsonb,
  passed boolean not null,
  live_ok boolean not null,
  includes_test_items boolean not null,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  constraint eval_gate_reports_kind_shape check ((kind = 'stage' and stage is not null and scope is null) or (kind = 'scope' and scope is not null and stage is null)),
  constraint eval_gate_reports_confirm_shape check ((confirmed_by is null) = (confirmed_at is null)),
  -- 시험용 문항이 든 판·미달·실제 API 재실행 없는 리포트는 확정 불가 (이중 방어 - 함수도 같은 사유로 거부)
  constraint eval_gate_reports_confirm_ok check (confirmed_at is null or (passed and live_ok and not includes_test_items))
);
comment on table public.eval_gate_reports is '평가 게이트 리포트 (EVAL-04) - 4a·4b·4c 단계별 또는 범위별 1부. 통과 여부는 DB가 계산(컴파일 함수로만 생성). 확정·승인 전 공개 단계·범위 플래그 변경 불가';
create index eval_gate_reports_idx on public.eval_gate_reports (kind, stage, scope, id desc);

create function public.eval_gate_reports_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('ltr.eval_gate', true), '') <> 'rpc' then
    raise exception '게이트 리포트는 eval_gate_report_compile·eval_gate_report_confirm 함수로만 만들고 확정합니다' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['confirmed_by', 'confirmed_at']) is distinct from (to_jsonb(old) - array['confirmed_by', 'confirmed_at']) then
    raise exception '리포트 내용은 고칠 수 없습니다 - 새 리포트를 만드세요' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_gate_reports_guard() from public, anon, authenticated;
create trigger eval_gate_reports_guard before insert or update on public.eval_gate_reports for each row execute function public.eval_gate_reports_guard();
create trigger eval_gate_reports_no_delete before delete on public.eval_gate_reports for each row execute function public.eval_no_delete();
create trigger eval_gate_reports_no_truncate before truncate on public.eval_gate_reports for each statement execute function public.eval_no_delete();

-- 현재 게이트 값에서 단계·범위 묶음 하나를 꺼낸다 (없으면 null)
create function public.eval_threshold_for(p_kind text, p_key text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select s.value #> (case when p_kind = 'stage' then array['stages', p_key] else array['scopes', p_key] end)
    from public.settings s where s.key = 'eval_gate_thresholds' and public.eval_thresholds_problem(s.value) is null;
$$;
revoke all on function public.eval_threshold_for(text, text) from public, anon, authenticated;
grant execute on function public.eval_threshold_for(text, text) to service_role;

-- 컴파일 - 지표와 통과 여부는 DB가 계산해서 넣는다
create function public.eval_gate_report_compile(p_kind text, p_stage text, p_scope text, p_run_id bigint, p_live_run_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run record;
  v_live record;
  v_th jsonb;
  v_metrics jsonb;
  v_live_metrics jsonb;
  v_eval jsonb;
  v_live_eval jsonb;
  v_code text;
  v_msg text;
  v_id bigint;
  v_target text := coalesce(p_stage, p_scope);
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '실행자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p_kind not in ('stage', 'scope') or (p_kind = 'stage' and (p_stage is null or p_stage not in ('4a', '4b', '4c') or p_scope is not null))
        or (p_kind = 'scope' and (p_scope is null or p_scope not in ('trust_redevelopment', 'inheritance', 'gift') or p_stage is not null)) then
    v_code := 'kind_invalid'; v_msg := '리포트 종류·단계·범위 조합이 올바르지 않습니다';
  end if;
  if v_code is null then
    select r.id, r.status, r.fingerprint, r.set_id, s.scope as set_scope, s.status as set_status into v_run
      from public.eval_runs r join public.eval_sets s on s.id = r.set_id where r.id = p_run_id;
    if v_run.id is null then
      v_code := 'run_not_found'; v_msg := '평가 실행이 없습니다';
    elsif v_run.status <> 'done' then
      v_code := 'run_not_done'; v_msg := '끝난 실행만 리포트로 만들 수 있습니다';
    elsif v_run.set_status <> 'frozen' then
      v_code := 'set_not_frozen'; v_msg := '동결한 평가셋의 실행만 리포트로 만들 수 있습니다';
    elsif (p_kind = 'stage' and v_run.set_scope <> 'base') or (p_kind = 'scope' and v_run.set_scope <> p_scope) then
      v_code := 'scope_mismatch'; v_msg := '실행의 평가셋 범위가 리포트 종류와 맞지 않습니다';
    end if;
  end if;
  if v_code is null and p_live_run_id is not null then
    select r.id, r.status, r.answer_source, r.set_id, r.fingerprint into v_live from public.eval_runs r where r.id = p_live_run_id;
    if v_live.id is null or v_live.status <> 'done' or v_live.answer_source <> 'live_api' or v_live.set_id <> v_run.set_id or v_live.fingerprint <> v_run.fingerprint then
      v_code := 'live_run_invalid'; v_msg := '실제 API 재실행은 같은 평가셋·같은 조건(지시문·모델·색인·룰셋·판정표)으로 끝난 live_api 실행이어야 합니다';
    end if;
  end if;
  if v_code is null then
    v_th := public.eval_threshold_for(p_kind, v_target);
    if v_th is null then
      v_code := 'thresholds_missing'; v_msg := '게이트 값(eval_gate_thresholds)이 없거나 하한 검사를 통과하지 못했습니다';
    end if;
  end if;
  if v_code is not null then
    perform public.eval_audit_write('report_compile', false, v_code, p_actor, null, v_target, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;

  v_metrics := public.eval_run_metrics(p_run_id);
  v_eval := public.eval_gate_evaluate(v_metrics, v_th);
  if p_live_run_id is not null then
    v_live_metrics := public.eval_run_metrics(p_live_run_id);
    v_live_eval := public.eval_gate_evaluate(v_live_metrics, v_th);
  end if;
  perform set_config('ltr.eval_gate', 'rpc', true);
  insert into public.eval_gate_reports (kind, stage, scope, run_id, live_run_id, fingerprint, thresholds, metrics, live_metrics, evaluation, live_evaluation,
                                        passed, live_ok, includes_test_items, created_by)
  values (p_kind, p_stage, p_scope, p_run_id, p_live_run_id, v_run.fingerprint, v_th, v_metrics, v_live_metrics, v_eval, v_live_eval,
          (v_eval ->> 'passed')::boolean, coalesce((v_live_eval ->> 'passed')::boolean, false), coalesce((v_metrics ->> 'has_test_items')::boolean, true), p_actor)
  returning id into v_id;
  perform set_config('ltr.eval_gate', '', true);
  perform public.eval_audit_write('report_compile', true, 'ok', p_actor, v_id, v_target, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '리포트를 만들었습니다', 'report_id', v_id,
    'passed', (v_eval ->> 'passed')::boolean, 'shortfalls', v_eval -> 'shortfalls', 'live_ok', coalesce((v_live_eval ->> 'passed')::boolean, false));
end;
$$;
revoke all on function public.eval_gate_report_compile(text, text, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.eval_gate_report_compile(text, text, text, bigint, bigint, text) to service_role;

-- 확정 - 통과·실제 API 재실행·시험용 문항 없음, 지금 게이트 값으로 다시 재도 통과
create function public.eval_gate_report_confirm(p_report_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rep record;
  v_th jsonb;
  v_code text;
  v_msg text;
begin
  select * into v_rep from public.eval_gate_reports where id = p_report_id for update;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif v_rep.id is null then
    v_code := 'report_not_found'; v_msg := '리포트가 없습니다';
  elsif v_rep.confirmed_at is not null then
    v_code := 'already_confirmed'; v_msg := '이미 확정한 리포트입니다';
  elsif v_rep.includes_test_items then
    v_code := 'test_items_in_report'; v_msg := '시험용 문항이 든 평가셋의 리포트는 운영 승인에 쓸 수 없습니다';
  elsif not v_rep.passed then
    v_code := 'gate_not_met'; v_msg := '게이트 기준에 미달한 리포트는 확정할 수 없습니다';
  elsif not v_rep.live_ok then
    v_code := 'live_check_missing'; v_msg := '게이트 판정 때 실제 API로 다시 돌린 실행이 통과해야 합니다 (4단계 설계 4.2)';
  else
    v_th := public.eval_threshold_for(v_rep.kind, coalesce(v_rep.stage, v_rep.scope));
    if v_th is null or not coalesce((public.eval_gate_evaluate(v_rep.metrics, v_th) ->> 'passed')::boolean, false)
       or not coalesce((public.eval_gate_evaluate(v_rep.live_metrics, v_th) ->> 'passed')::boolean, false) then
      v_code := 'gate_not_met'; v_msg := '지금의 게이트 값으로 다시 재면 미달입니다';
    end if;
  end if;
  if v_code is not null then
    perform public.eval_audit_write('report_confirm', false, v_code, p_actor, p_report_id, coalesce(v_rep.stage, v_rep.scope), v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.eval_gate', 'rpc', true);
  update public.eval_gate_reports set confirmed_by = p_actor, confirmed_at = now() where id = p_report_id;
  perform set_config('ltr.eval_gate', '', true);
  perform public.eval_audit_write('report_confirm', true, 'ok', p_actor, p_report_id, coalesce(v_rep.stage, v_rep.scope), null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '리포트를 확정했습니다');
end;
$$;
revoke all on function public.eval_gate_report_confirm(bigint, text) from public, anon, authenticated;
grant execute on function public.eval_gate_report_confirm(bigint, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 쓰기 가드 - 공개 단계·범위 플래그는 승인 함수만, 게이트 값은 하한 검사
-- ─────────────────────────────────────────────────────────────
create function public.eval_settings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_problem text;
  v_key text;
begin
  if tg_op = 'DELETE' then
    raise exception '평가 게이트 설정(%)은 지울 수 없습니다', old.key using errcode = 'insufficient_privilege';
  end if;
  if new.key = 'eval_gate_thresholds' then
    v_problem := public.eval_thresholds_problem(new.value);
    if v_problem is not null then
      raise exception '게이트 값을 저장할 수 없습니다 - %', v_problem using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.key = 'ask_rollout' then
    if jsonb_typeof(new.value) is distinct from 'object' or (new.value ->> 'stage') is null or (new.value ->> 'stage') not in ('none', '4a', '4b', '4c')
       or (new.value - array['stage', 'report_id', 'approved_by', 'approved_at', 'note']) <> '{}'::jsonb then
      raise exception 'ask_rollout 값 모양이 올바르지 않습니다 (stage는 none·4a·4b·4c)' using errcode = 'check_violation';
    end if;
  else
    if jsonb_typeof(new.value) is distinct from 'object' or (select count(*) from jsonb_object_keys(new.value)) <> 3
       or not (new.value ?& array['trust_redevelopment', 'inheritance', 'gift'])
       or exists (select 1 from jsonb_each(new.value) e where jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'ask_scope_flags 값 모양이 올바르지 않습니다 (신탁·정비 / 상속 / 증여 세 칸, 참·거짓)' using errcode = 'check_violation';
    end if;
  end if;
  v_key := new.key;
  if (tg_op = 'INSERT' or new.value is distinct from old.value) and coalesce(current_setting('ltr.eval_gate', true), '') <> 'rpc' then
    raise exception '% 는 평가 게이트 리포트와 승인 함수(ask_rollout_approve·ask_scope_approve)로만 바꿉니다', v_key using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_settings_guard() from public, anon, authenticated;
create trigger settings_eval_guard
  before insert or update on public.settings
  for each row when (new.key in ('eval_gate_thresholds', 'ask_rollout', 'ask_scope_flags'))
  execute function public.eval_settings_guard();
create trigger settings_eval_no_delete
  before delete on public.settings
  for each row when (old.key in ('eval_gate_thresholds', 'ask_rollout', 'ask_scope_flags'))
  execute function public.eval_settings_guard();

-- 게이트 값 씨앗 - PRD-04 9장 운영 기준 (세무 값 아님). 하한 검사를 통과해야 들어간다
insert into public.settings (key, value, description, updated_by) values
  ('eval_gate_thresholds', $json$
{
  "stages": {
    "4a": {"accuracy_min": 0.80, "citation_precision_min": 0.95, "recall_min": 0.70, "clarify_omission_max": 0.10, "invented_max": 0, "benefit_assertion_max": 0, "live_without_snapshot_max": 0, "fatal_max": 2, "min_items": 300, "min_cross": {"clarify": 60, "benefits": 30, "live": 15}},
    "4b": {"accuracy_min": 0.85, "citation_precision_min": 0.97, "recall_min": 0.80, "clarify_omission_max": 0.07, "invented_max": 0, "benefit_assertion_max": 0, "live_without_snapshot_max": 0, "fatal_max": 0, "min_items": 300, "min_cross": {"clarify": 60, "benefits": 30, "live": 15}},
    "4c": {"accuracy_min": 0.90, "citation_precision_min": 0.98, "recall_min": 0.85, "clarify_omission_max": 0.05, "invented_max": 0, "benefit_assertion_max": 0, "live_without_snapshot_max": 0, "fatal_max": 0, "min_items": 300, "min_cross": {"clarify": 60, "benefits": 30, "live": 15}}
  },
  "scopes": {
    "trust_redevelopment": {"accuracy_min": 0.90, "citation_precision_min": 0.98, "fatal_max": 0, "min_items": 100, "national_block_min": 0},
    "inheritance": {"accuracy_min": 0.90, "citation_precision_min": 0.98, "fatal_max": 0, "min_items": 30, "national_block_min": 1},
    "gift": {"accuracy_min": 0.90, "citation_precision_min": 0.98, "fatal_max": 0, "min_items": 30, "national_block_min": 1}
  }
}$json$::jsonb,
   '지방세봇 평가 게이트 값 (PRD-04 9장 - 운영 기준이며 세무 값 아님). 4c 기준·문항 수 하한보다 낮은 값은 트리거가 저장 거부. 감수위원 협의로 4a·4b 값 조정', 'migration:20261026000164')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 공개 단계 · 범위 플래그 승인 RPC
-- ─────────────────────────────────────────────────────────────
create function public.ask_rollout_approve(p_stage text, p_report_id bigint, p_actor text, p_fingerprint text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order text[] := array['none', '4a', '4b', '4c'];
  v_cur text;
  v_rep record;
  v_th jsonb;
  v_code text;
  v_msg text;
  v_lower boolean := false;
begin
  select coalesce(s.value ->> 'stage', 'none') into v_cur from public.settings s where s.key = 'ask_rollout' for update;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p_stage is null or not (p_stage = any (v_order)) then
    v_code := 'stage_invalid'; v_msg := '공개 단계는 none·4a·4b·4c 중 하나입니다';
  elsif v_cur is null then
    v_code := 'setting_missing'; v_msg := 'ask_rollout 설정이 없습니다';
  elsif p_stage = v_cur then
    v_code := 'already_stage'; v_msg := '이미 같은 단계입니다';
  elsif array_position(v_order, p_stage) < array_position(v_order, v_cur) then
    v_lower := true; -- 내리는 것은 리포트 없이 언제든 가능
  elsif array_position(v_order, p_stage) <> array_position(v_order, v_cur) + 1 then
    v_code := 'stage_skip'; v_msg := '공개 단계는 none, 4a, 4b, 4c 순서로 한 칸씩만 올립니다';
  elsif p_report_id is null then
    v_code := 'report_required'; v_msg := '게이트 리포트 없이 공개 단계를 올릴 수 없습니다 (EVAL-04)';
  elsif p_fingerprint is null then
    v_code := 'fingerprint_required'; v_msg := '현재 조건의 fingerprint가 필요합니다 (낡은 리포트 승인 방지)';
  else
    select * into v_rep from public.eval_gate_reports where id = p_report_id;
    if v_rep.id is null then
      v_code := 'report_not_found'; v_msg := '리포트가 없습니다';
    elsif v_rep.kind <> 'stage' or v_rep.stage is distinct from p_stage then
      v_code := 'report_mismatch'; v_msg := '리포트의 단계가 올리려는 단계와 다릅니다';
    elsif v_rep.includes_test_items then
      v_code := 'test_items_in_report'; v_msg := '시험용 문항이 든 평가셋의 리포트로는 운영 승인을 할 수 없습니다';
    elsif v_rep.confirmed_at is null then
      v_code := 'report_not_confirmed'; v_msg := '확정하지 않은 리포트입니다';
    elsif p_fingerprint <> v_rep.fingerprint then
      v_code := 'report_stale'; v_msg := '리포트 이후 지시문·모델·색인·룰셋·판정표가 바뀌었습니다 - 다시 평가하세요 (EVAL-03)';
    else
      v_th := public.eval_threshold_for('stage', p_stage);
      if v_th is null or not coalesce((public.eval_gate_evaluate(v_rep.metrics, v_th) ->> 'passed')::boolean, false)
         or not coalesce((public.eval_gate_evaluate(v_rep.live_metrics, v_th) ->> 'passed')::boolean, false) then
        v_code := 'gate_not_met'; v_msg := '지금의 게이트 값으로 다시 재면 미달입니다';
      end if;
    end if;
  end if;
  if v_code is not null then
    perform public.eval_audit_write('rollout', false, v_code, p_actor, p_report_id, p_stage, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.eval_gate', 'rpc', true);
  update public.settings
     set value = jsonb_build_object('stage', p_stage, 'report_id', case when v_lower then null else p_report_id end, 'approved_by', p_actor, 'approved_at', now()),
         updated_by = p_actor
   where key = 'ask_rollout';
  perform set_config('ltr.eval_gate', '', true);
  perform public.eval_audit_write('rollout', true, 'ok', p_actor, case when v_lower then null else p_report_id end, p_stage,
                                  case when v_lower then format('낮춤: %s -> %s', v_cur, p_stage) else format('올림: %s -> %s', v_cur, p_stage) end);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', case when v_lower then '공개 단계를 낮췄습니다' else '공개 단계를 올렸습니다' end, 'stage', p_stage);
end;
$$;
revoke all on function public.ask_rollout_approve(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.ask_rollout_approve(text, bigint, text, text) to service_role;

create function public.ask_scope_approve(p_scope text, p_enabled boolean, p_report_id bigint, p_actor text, p_fingerprint text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cur boolean;
  v_rep record;
  v_th jsonb;
  v_code text;
  v_msg text;
begin
  select coalesce((s.value ->> p_scope)::boolean, false) into v_cur from public.settings s where s.key = 'ask_scope_flags' for update;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p_scope is null or p_scope not in ('trust_redevelopment', 'inheritance', 'gift') or p_enabled is null then
    v_code := 'scope_invalid'; v_msg := '범위는 신탁·정비(trust_redevelopment) / 상속(inheritance) / 증여(gift) 중 하나이고 켜기·끄기 값이 필요합니다';
  elsif v_cur is null then
    v_code := 'setting_missing'; v_msg := 'ask_scope_flags 설정이 없습니다';
  elsif v_cur = p_enabled then
    v_code := 'already_set'; v_msg := '이미 같은 상태입니다';
  elsif p_enabled then
    if p_report_id is null then
      v_code := 'report_required'; v_msg := '범위 게이트 리포트 없이 범위 플래그를 켤 수 없습니다 (EVAL-04)';
    elsif p_fingerprint is null then
      v_code := 'fingerprint_required'; v_msg := '현재 조건의 fingerprint가 필요합니다 (낡은 리포트 승인 방지)';
    else
      select * into v_rep from public.eval_gate_reports where id = p_report_id;
      if v_rep.id is null then
        v_code := 'report_not_found'; v_msg := '리포트가 없습니다';
      elsif v_rep.kind <> 'scope' or v_rep.scope is distinct from p_scope then
        v_code := 'report_mismatch'; v_msg := '리포트의 범위가 켜려는 범위와 다릅니다 (범위마다 따로 리포트 1부)';
      elsif v_rep.includes_test_items then
        v_code := 'test_items_in_report'; v_msg := '시험용 문항이 든 평가셋의 리포트로는 운영 승인을 할 수 없습니다';
      elsif v_rep.confirmed_at is null then
        v_code := 'report_not_confirmed'; v_msg := '확정하지 않은 리포트입니다';
      elsif p_fingerprint <> v_rep.fingerprint then
        v_code := 'report_stale'; v_msg := '리포트 이후 지시문·모델·색인·룰셋·판정표가 바뀌었습니다 - 다시 평가하세요 (EVAL-03)';
      else
        v_th := public.eval_threshold_for('scope', p_scope);
        if v_th is null or not coalesce((public.eval_gate_evaluate(v_rep.metrics, v_th) ->> 'passed')::boolean, false)
           or not coalesce((public.eval_gate_evaluate(v_rep.live_metrics, v_th) ->> 'passed')::boolean, false) then
          v_code := 'gate_not_met'; v_msg := '지금의 게이트 값으로 다시 재면 미달입니다';
        end if;
      end if;
    end if;
  end if;
  if v_code is not null then
    perform public.eval_audit_write('scope', false, v_code, p_actor, p_report_id, p_scope, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.eval_gate', 'rpc', true);
  update public.settings set value = jsonb_set(value, array[p_scope], to_jsonb(p_enabled)), updated_by = p_actor where key = 'ask_scope_flags';
  perform set_config('ltr.eval_gate', '', true);
  perform public.eval_audit_write('scope', true, 'ok', p_actor, case when p_enabled then p_report_id else null end, p_scope, case when p_enabled then '켬' else '끔' end);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', case when p_enabled then '범위 플래그를 켰습니다' else '범위 플래그를 껐습니다' end, 'scope', p_scope, 'enabled', p_enabled);
end;
$$;
revoke all on function public.ask_scope_approve(text, boolean, bigint, text, text) from public, anon, authenticated;
grant execute on function public.ask_scope_approve(text, boolean, bigint, text, text) to service_role;

-- 공개 판정 함수 - 공개 위젯이 공개 키로 부른다. 공개 단계와 범위 플래그 값만 돌려준다 (리포트·지표·승인자 0)
create function public.public_ask_gate() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'stage', coalesce((select s.value ->> 'stage' from public.settings s where s.key = 'ask_rollout'), 'none'),
    'scopes', jsonb_build_object(
      'trust_redevelopment', coalesce((select (s.value ->> 'trust_redevelopment')::boolean from public.settings s where s.key = 'ask_scope_flags'), false),
      'inheritance', coalesce((select (s.value ->> 'inheritance')::boolean from public.settings s where s.key = 'ask_scope_flags'), false),
      'gift', coalesce((select (s.value ->> 'gift')::boolean from public.settings s where s.key = 'ask_scope_flags'), false)));
$$;
revoke all on function public.public_ask_gate() from public;
grant execute on function public.public_ask_gate() to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한 - 공개 0, 서버(service_role)는 읽기만. 쓰기는 함수만
-- ─────────────────────────────────────────────────────────────
alter table public.eval_audit enable row level security;
alter table public.eval_gate_reports enable row level security;
revoke all on table public.eval_audit, public.eval_gate_reports from anon, authenticated, service_role;
grant select on table public.eval_audit, public.eval_gate_reports to service_role;
