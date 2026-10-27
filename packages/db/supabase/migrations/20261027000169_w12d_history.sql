-- W12-d d5 - 대화 기록·저장 끄기·보존 기한·파기 (docs/dev/W12-d_설계.md, PRD-04 ASK-12 · COMPLY-03)
--  · agent_record_turn(157)을 create or replace로 고친다 (157은 원격 적용됨). 바뀐 것: ① anon·authenticated 실행 회수 - 서버(service_role)만 기록한다(W12-b 남은 과제: 기록 위조 차단)
--    ② 등급과 소유자는 세션 행(user_id)으로 정한다 ③ 세션의 save_enabled=false이면 질문·답변·도구 입력 글을 저장하지 않는다(수치만)
--  · 회원 대화 글은 settings.ask_retention.member_days가 있을 때만 저장한다 (씨앗은 빈 값 - 초안 90일은 PO 결정 전). 비회원은 서버가 넘긴 일수(도우미와 같은 설정)
--  · agent_purge: 비회원·회원 기한을 각자 값으로 판정해 글 칸을 비운다 (수치·인용 행은 남는다)
-- 서비스 함수는 모두 service_role만 부른다.

create table public.agent_member_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  save_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.agent_member_prefs is '회원 대화 저장 끄기 설정 (ASK-12) - 서버 함수로만 읽고 쓴다';
alter table public.agent_member_prefs enable row level security;
revoke all on table public.agent_member_prefs from anon, authenticated, service_role;

-- 세션을 먼저 연다 - 회원 소유자·저장 여부·보존 기한을 첫 턴 기록 전에 확정한다 (이미 있으면 그대로)
create function public.agent_session_open(p_session uuid, p_user uuid, p_mode text, p_entry text, p_internal boolean, p_retain_days integer, p_save boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ret jsonb := coalesce((select s.value from public.settings s where s.key = 'ask_retention' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb);
  v_days integer;
  v_pref boolean;
  v_save boolean;
  v_owner uuid;
  v_exists boolean;
begin
  if p_session is null or p_mode not in ('general', 'expert') or (p_entry is not null and p_entry not in ('mode_switch', 'search_results', 'law', 'case', 'calc', 'article', 'step', 'issue_map')) then
    raise exception using errcode = '22023', message = '세션 값이 올바르지 않습니다';
  end if;
  select true, s.user_id, s.save_enabled into v_exists, v_owner, v_save from public.agent_sessions s where s.id = p_session;
  if coalesce(v_exists, false) then
    if v_owner is distinct from p_user then
      raise exception using errcode = '42501', message = '다른 사용자의 세션입니다';
    end if;
    return jsonb_build_object('save', v_save, 'existing', true);
  end if;
  select coalesce(p.save_enabled, true) into v_pref from public.agent_member_prefs p where p.user_id = p_user;
  v_save := coalesce(p_save, true) and coalesce(v_pref, true);
  v_days := case
    when p_user is null then greatest(1, least(coalesce(p_retain_days, 30), 365))
    when jsonb_typeof(v_ret -> 'member_days') = 'number' and (v_ret ->> 'member_days')::numeric >= 1 then (v_ret ->> 'member_days')::numeric::integer
    else 1 end;
  insert into public.agent_sessions (id, user_id, mode, as_of_date, save_enabled, retain_until, entry, internal)
    values (p_session, p_user, p_mode, (now() at time zone 'Asia/Seoul')::date, v_save, now() + make_interval(days => v_days), p_entry, coalesce(p_internal, false));
  return jsonb_build_object('save', v_save, 'existing', false);
end;
$$;
revoke all on function public.agent_session_open(uuid, uuid, text, text, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.agent_session_open(uuid, uuid, text, text, boolean, integer, boolean) to service_role;

-- 지금 이 세션의 저장을 끈다 - 이미 쌓인 글은 바로 비운다. 회원이면 다음 세션부터도 꺼 둔다(p_remember)
create function public.agent_session_save_off(p_session uuid, p_user uuid, p_remember boolean) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_found boolean;
begin
  select true, s.user_id into v_found, v_owner from public.agent_sessions s where s.id = p_session;
  if p_user is not null and coalesce(p_remember, false) then
    insert into public.agent_member_prefs (user_id, save_enabled) values (p_user, false)
      on conflict (user_id) do update set save_enabled = false, updated_at = now();
  end if;
  if not coalesce(v_found, false) or v_owner is distinct from p_user then
    return false;
  end if;
  update public.agent_sessions s set save_enabled = false where s.id = p_session;
  update public.agent_messages m set question_masked = null, answer_masked = null where m.session_id = p_session;
  update public.agent_tool_calls t set input_summary = null where t.message_id in (select m.id from public.agent_messages m where m.session_id = p_session);
  return true;
end;
$$;
revoke all on function public.agent_session_save_off(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.agent_session_save_off(uuid, uuid, boolean) to service_role;

create function public.agent_member_save_set(p_user uuid, p_save boolean) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.agent_member_prefs (user_id, save_enabled) values (p_user, coalesce(p_save, true))
    on conflict (user_id) do update set save_enabled = excluded.save_enabled, updated_at = now();
$$;
revoke all on function public.agent_member_save_set(uuid, boolean) from public, anon, authenticated;
grant execute on function public.agent_member_save_set(uuid, boolean) to service_role;

create function public.agent_member_save_get(p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.save_enabled from public.agent_member_prefs p where p.user_id = p_user), true);
$$;
revoke all on function public.agent_member_save_get(uuid) from public, anon, authenticated;
grant execute on function public.agent_member_save_get(uuid) to service_role;

-- 내 대화 목록·검색 (질문 글이 저장된 세션만 글이 보인다)
create function public.agent_my_sessions(p_user uuid, p_query text, p_limit integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(r order by r.last_at desc), '[]'::jsonb)
    from (
      select s.id, s.last_at, s.retain_until, s.save_enabled, s.turn_count,
             (select m.question_masked from public.agent_messages m where m.session_id = s.id and m.turn = 1) as first_question
        from public.agent_sessions s
       where s.user_id = p_user and p_user is not null
         and (p_query is null or btrim(p_query) = '' or exists (
               select 1 from public.agent_messages m
                where m.session_id = s.id and (m.question_masked ilike '%' || replace(replace(p_query, '%', ''), '_', '') || '%' or m.answer_masked ilike '%' || replace(replace(p_query, '%', ''), '_', '') || '%')))
       order by s.last_at desc
       limit greatest(1, least(coalesce(p_limit, 30), 100))
    ) r;
$$;
revoke all on function public.agent_my_sessions(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.agent_my_sessions(uuid, text, integer) to service_role;

-- 한 세션의 글 (본인 것만)
create function public.agent_my_session_messages(p_user uuid, p_session uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('turn', m.turn, 'question', m.question_masked, 'answer', m.answer_masked, 'kind', m.kind, 'at', m.created_at) order by m.turn), '[]'::jsonb)
    from public.agent_messages m join public.agent_sessions s on s.id = m.session_id
   where s.id = p_session and s.user_id = p_user and p_user is not null;
$$;
revoke all on function public.agent_my_session_messages(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_my_session_messages(uuid, uuid) to service_role;

-- 삭제 - 세션과 딸린 기록(메시지·인용·도구·검증·피드백)을 모두 지운다
create function public.agent_session_delete(p_user uuid, p_session uuid) returns boolean
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.agent_sessions s where s.id = p_session and s.user_id = p_user and p_user is not null returning 1)
  select exists (select 1 from d);
$$;
revoke all on function public.agent_session_delete(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_session_delete(uuid, uuid) to service_role;

-- 기한 파기 (COMPLY-03) - 비회원·회원을 각자 retain_until로 판정. retain_until <= p_now이면 만료
create function public.agent_purge(p_now timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guest integer;
  v_member integer;
begin
  with ids as (select s.id, (s.user_id is null) as guest from public.agent_sessions s where s.retain_until <= p_now),
       m as (update public.agent_messages m set question_masked = null, answer_masked = null
              from ids where m.session_id = ids.id and (m.question_masked is not null or m.answer_masked is not null) returning ids.guest)
  select count(*) filter (where guest), count(*) filter (where not guest) into v_guest, v_member from m;
  update public.agent_tool_calls t set input_summary = null
   where t.input_summary is not null and t.message_id in (select m.id from public.agent_messages m join public.agent_sessions s on s.id = m.session_id where s.retain_until <= p_now);
  return jsonb_build_object('guest_messages', coalesce(v_guest, 0), 'member_messages', coalesce(v_member, 0));
end;
$$;
revoke all on function public.agent_purge(timestamptz) from public, anon, authenticated;
grant execute on function public.agent_purge(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────
-- agent_record_turn 재정의 (157 대비 변경은 위 머리말 3가지)
-- ─────────────────────────────────────────────────────────────
create or replace function public.agent_record_turn(p jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session uuid;
  v_mode text;
  v_kind text;
  v_ret jsonb := coalesce((select s.value from public.settings s where s.key = 'ask_retention' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb);
  v_days integer;
  v_store boolean;
  v_owner uuid;
  v_save boolean;
  v_exists boolean;
  v_tier text;
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

  select true, s.user_id, s.save_enabled into v_exists, v_owner, v_save from public.agent_sessions s where s.id = v_session;
  if not coalesce(v_exists, false) then
    -- 서버가 세션을 먼저 열지 않은 경우(비회원 첫 턴) - 비회원 세션으로 만든다
    v_days := greatest(1, least(coalesce((p ->> 'retention_days')::integer, 30), 365));
    insert into public.agent_sessions (id, user_id, mode, as_of_date, retain_until, entry, internal)
      values (v_session, null, v_mode, coalesce((p ->> 'as_of_date')::date, (now() at time zone 'Asia/Seoul')::date),
              now() + make_interval(days => v_days), nullif(p ->> 'entry', ''), coalesce((p ->> 'internal')::boolean, false));
    v_owner := null;
    v_save := true;
  end if;
  v_tier := case when v_owner is null then 'guest' else 'member' end;
  -- 글 저장: 저장 끔이면 0, 회원은 member_days가 있어야만 (없으면 수치만)
  v_store := coalesce(v_save, true) and (v_tier = 'guest' or (jsonb_typeof(v_ret -> 'member_days') = 'number' and (v_ret ->> 'member_days')::numeric >= 1));

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
revoke all on function public.agent_record_turn(jsonb) from public, anon, authenticated;
grant execute on function public.agent_record_turn(jsonb) to service_role;

-- 세션 상태(서버용) - 157의 agent_session_state는 anon의 auth.uid()로 소유자를 가려 회원 세션을 못 읽는다. 소유자가 맞을 때만 값을 준다
create function public.agent_session_state_for(p_session uuid, p_user uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('turns', s.turn_count, 'clarify_rounds', s.clarify_rounds)
       from public.agent_sessions s where s.id = p_session and s.user_id is not distinct from p_user),
    jsonb_build_object('turns', 0, 'clarify_rounds', 0));
$$;
revoke all on function public.agent_session_state_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.agent_session_state_for(uuid, uuid) to service_role;
