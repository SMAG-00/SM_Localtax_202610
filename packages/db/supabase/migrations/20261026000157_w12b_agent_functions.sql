-- W12-b 지방세봇 기록·런타임 함수 (docs/dev/W12-b_설계.md 3장)
--  · agent_register_prompt - 현재 지시문을 draft로 등록 (같은 본문은 한 줄, 평가 없이 active 0)
--  · agent_runtime - 공개 단계·범위 플래그·한도·실시간 조회 정책·예산/단가·이번 달 사용액을 한 덩어리로 (값만, 승인자·리포트 0)
--  · agent_session_state - 세션의 턴 수·역질문 라운드 수 (역질문 상한을 서버 값으로 강제)
--  · agent_record_turn - 한 턴 기록 (세션 upsert + 메시지 + 인용 + 도구 호출 + 검증 + 일일 사용량). 입력 모양을 검사한다
-- 모두 security definer + search_path 빈 값. 질문 원문은 받지 않는다(마스킹본만 - 표 check가 한 번 더 거른다).

create function public.agent_register_prompt(p_role text, p_version text, p_body text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_body, ''), 'UTF8')), 'hex');
  v_id bigint;
begin
  if p_role is null or p_role not in ('agent_answer', 'agent_utility') or p_body is null or btrim(p_body) = '' or char_length(p_body) > 20000 then
    raise exception using errcode = '22023', message = '지시문 역할·본문이 올바르지 않습니다';
  end if;
  select pv.id into v_id from public.prompt_versions pv where pv.role = p_role and pv.body_hash = v_hash;
  if v_id is null then
    insert into public.prompt_versions (role, version, body_hash, body, created_by)
      values (p_role, left(coalesce(p_version, 'v?'), 60), v_hash, p_body, 'server')
      on conflict (role, body_hash) do nothing
      returning id into v_id;
    if v_id is null then
      select pv.id into v_id from public.prompt_versions pv where pv.role = p_role and pv.body_hash = v_hash;
    end if;
  end if;
  return v_id;
end;
$$;

create function public.agent_runtime() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'taxbot', coalesce((select s.value ->> 'taxbot' = 'true' from public.settings s where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'), false),
    'stage', coalesce((select s.value ->> 'stage' from public.settings s where s.key = 'ask_rollout'), 'none'),
    -- 164(public_ask_gate)보다 앞 번호라 같은 값을 설정에서 직접 읽는다 (불리언 true만 켜짐)
    'scopes', jsonb_build_object(
      'trust_redevelopment', coalesce((select s.value ->> 'trust_redevelopment' = 'true' from public.settings s where s.key = 'ask_scope_flags'), false),
      'inheritance', coalesce((select s.value ->> 'inheritance' = 'true' from public.settings s where s.key = 'ask_scope_flags'), false),
      'gift', coalesce((select s.value ->> 'gift' = 'true' from public.settings s where s.key = 'ask_scope_flags'), false)),
    'limits', coalesce((select s.value from public.settings s where s.key = 'ask_limits'), '{}'::jsonb),
    'live_policy', coalesce((select s.value from public.settings s where s.key = 'ask_live_fetch_policy'), '{}'::jsonb),
    'official_search', coalesce((select s.value from public.settings s where s.key = 'ask_official_search'), '{}'::jsonb),
    'budget', coalesce((select s.value from public.settings s where s.key = 'ask_budget'), '{}'::jsonb),
    'pricing', coalesce((select s.value from public.settings s where s.key = 'ask_pricing'), '{}'::jsonb),
    'spent_month_won', coalesce((select sum(u.cost) from public.agent_usage_daily u where u.day >= date_trunc('month', now() at time zone 'Asia/Seoul')::date), 0)
  );
$$;

create function public.agent_session_state(p_session uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('turns', s.turn_count, 'clarify_rounds', s.clarify_rounds)
       from public.agent_sessions s
      where s.id = p_session and (s.user_id is null or s.user_id is not distinct from auth.uid())),
    jsonb_build_object('turns', 0, 'clarify_rounds', 0));
$$;

create function public.agent_record_turn(p jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_uid uuid := auth.uid();
  v_tier text := case when auth.uid() is null then 'guest' else 'member' end;
  v_mode text;
  v_kind text;
  v_ret jsonb := coalesce((select s.value from public.settings s where s.key = 'ask_retention' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb);
  v_days integer;
  v_store boolean;
  v_existing_user uuid;
  v_exists boolean;
  v_turn integer;
  v_msg bigint;
  v_in integer := greatest(coalesce((p ->> 'tokens_in')::integer, 0), 0);
  v_out integer := greatest(coalesce((p ->> 'tokens_out')::integer, 0), 0);
  v_cost numeric := greatest(coalesce((p ->> 'cost')::numeric, 0), 0);
  v_val jsonb := coalesce(p -> 'validation', '{}'::jsonb);
  v_fail text[];
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception using errcode = '22023', message = '기록 모양이 올바르지 않습니다';
  end if;
  v_session := (p ->> 'session_id')::uuid;
  v_mode := p ->> 'mode';
  v_kind := p ->> 'kind';
  if v_session is null or v_mode not in ('general', 'expert') or v_kind not in ('answer', 'clarify', 'fallback', 'error') then
    raise exception using errcode = '22023', message = '세션·모드·종류 값이 올바르지 않습니다';
  end if;
  if jsonb_typeof(coalesce(p -> 'citations', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p -> 'tool_calls', '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = '인용·도구 호출은 배열이어야 합니다';
  end if;

  -- 보존 - 비회원은 서버가 넘긴 일수(도우미와 같은 설정), 회원은 ask_retention.member_days가 있어야만 글을 저장한다 (없으면 글 0, 수치만)
  v_days := case
    when v_tier = 'guest' then greatest(1, least(coalesce((p ->> 'retention_days')::integer, 30), 365))
    when jsonb_typeof(v_ret -> 'member_days') = 'number' then (v_ret ->> 'member_days')::integer
    else null end;
  v_store := v_days is not null and v_days > 0;

  select true, s.user_id into v_exists, v_existing_user from public.agent_sessions s where s.id = v_session;
  if coalesce(v_exists, false) and v_existing_user is not null and v_existing_user is distinct from v_uid then
    raise exception using errcode = '42501', message = '다른 사용자의 세션입니다';
  end if;
  if not coalesce(v_exists, false) then
    insert into public.agent_sessions (id, user_id, mode, as_of_date, retain_until, entry, internal)
      values (v_session, v_uid, v_mode, coalesce((p ->> 'as_of_date')::date, (now() at time zone 'Asia/Seoul')::date),
              now() + make_interval(days => coalesce(v_days, 1)), nullif(p ->> 'entry', ''), coalesce((p ->> 'internal')::boolean, false));
  end if;
  update public.agent_sessions s
     set turn_count = s.turn_count + 1,
         clarify_rounds = s.clarify_rounds + case when v_kind = 'clarify' then 1 else 0 end,
         last_at = now()
   where s.id = v_session
   returning s.turn_count into v_turn;

  insert into public.agent_messages (session_id, turn, question_masked, answer_masked, kind, fallback_reason, scope, tier, model, prompt_version_id,
                                     tokens_in, tokens_out, tokens_cached, cost, model_calls)
    values (v_session, v_turn,
            case when v_store then nullif(p ->> 'question_masked', '') end,
            case when v_store then nullif(p ->> 'answer_masked', '') end,
            v_kind, nullif(p ->> 'fallback_reason', ''), coalesce(p ->> 'scope', 'base'), v_tier, p ->> 'model', (p ->> 'prompt_version_id')::bigint,
            v_in, v_out, greatest(coalesce((p ->> 'tokens_cached')::integer, 0), 0), v_cost, greatest(coalesce((p ->> 'model_calls')::integer, 0), 0))
    returning id into v_msg;

  insert into public.agent_citations (message_id, position, source_id, source_type, chunk_id, is_live, snapshot_id)
    select v_msg, (t.ord - 1)::integer, c ->> 'source_id', c ->> 'source_type', nullif(c ->> 'chunk_id', '')::bigint,
           coalesce((c ->> 'is_live')::boolean, false), nullif(c ->> 'snapshot_id', '')::bigint
      from jsonb_array_elements(coalesce(p -> 'citations', '[]'::jsonb)) with ordinality as t(c, ord);

  insert into public.agent_tool_calls (message_id, tool, input_summary, result_id, latency_ms, ok, target_type, snapshot_id)
    select v_msg, c ->> 'tool', case when v_store then nullif(c ->> 'input_summary', '') end, nullif(c ->> 'result_id', ''),
           greatest(coalesce((c ->> 'latency_ms')::integer, 0), 0), coalesce((c ->> 'ok')::boolean, false), nullif(c ->> 'target_type', ''), nullif(c ->> 'snapshot_id', '')::bigint
      from jsonb_array_elements(coalesce(p -> 'tool_calls', '[]'::jsonb)) as t(c);

  select coalesce(array_agg(x), '{}') into v_fail from jsonb_array_elements_text(coalesce(v_val -> 'failure_codes', '[]'::jsonb)) as f(x);
  insert into public.agent_validations (message_id, v1, v2, v3, v4, v5, v6, regenerated, fallback_reason, failure_codes)
    values (v_msg, coalesce((v_val ->> 'v1')::boolean, true), coalesce((v_val ->> 'v2')::boolean, true), coalesce((v_val ->> 'v3')::boolean, true),
            coalesce((v_val ->> 'v4')::boolean, true), coalesce((v_val ->> 'v5')::boolean, true), coalesce((v_val ->> 'v6')::boolean, true),
            coalesce((v_val ->> 'regenerated')::boolean, false), nullif(p ->> 'fallback_reason', ''), v_fail);

  insert into public.agent_usage_daily (day, tier, turns, tokens_in, tokens_out, cost)
    values ((now() at time zone 'Asia/Seoul')::date, v_tier, 1, v_in, v_out, v_cost)
    on conflict (day, tier) do update
      set turns = public.agent_usage_daily.turns + 1,
          tokens_in = public.agent_usage_daily.tokens_in + excluded.tokens_in,
          tokens_out = public.agent_usage_daily.tokens_out + excluded.tokens_out,
          cost = public.agent_usage_daily.cost + excluded.cost;
  return v_msg;
end;
$$;

revoke all on function public.agent_register_prompt(text, text, text) from public, anon, authenticated;
revoke all on function public.agent_runtime() from public, anon, authenticated;
revoke all on function public.agent_session_state(uuid) from public, anon, authenticated;
revoke all on function public.agent_record_turn(jsonb) from public, anon, authenticated;
grant execute on function public.agent_register_prompt(text, text, text) to anon, authenticated, service_role;
grant execute on function public.agent_runtime() to anon, authenticated, service_role;
grant execute on function public.agent_session_state(uuid) to anon, authenticated, service_role;
grant execute on function public.agent_record_turn(jsonb) to anon, authenticated, service_role;
