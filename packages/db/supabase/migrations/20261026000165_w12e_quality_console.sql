-- W12-e e5 품질 콘솔 뷰·표본 판정·경보 함수 (PRD-04 QUAL-01~04, docs/dev/W12-e_설계.md 4장)
--  · 뷰: 검증기 차단 로그 · 실시간 조회 기록 · 일별 질문당 비용 · 표본 후보 (service_role 읽기만)
--  · quality_judgments: 표본 판정 - 추가만, 판정자는 사람(user:uuid). 평가셋 후보 표시는 익명화된(마스킹본) 답변에만
--  · quality_alerts: 경보 - 멱등 키 유일. 차단율 5분 20% 초과(QUAL-03)·예산 80%/100%(QUAL-04)·표본 부족(QUAL-02)
--  · 차단율·예산 검사는 검증 기록·사용량 기록을 쓰는 거래 안에서 트리거가 부른다(크론은 하루 1회라 5분 창에 못 맞춤). 실패해도 사용자 경로를 막지 않는다.
--  · 예산 값은 PO 입력(settings ask_budget.monthly_won) - 비었거나 0이면 예산 경보 0. 법령·세무 문장·세율 값 없음.

create table public.quality_judgments (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.agent_messages (id) on delete cascade,
  judge text not null check (judge ~ '^user:[0-9a-fA-F-]{36}$'),
  verdict text not null check (verdict in ('good', 'minor_issue', 'wrong')),
  note text check (note is null or (char_length(note) <= 500 and not public.eval_text_has_pii(note))),
  eval_candidate boolean not null default false,
  judged_at timestamptz not null default now(),
  unique (message_id, judge)
);
comment on table public.quality_judgments is '표본 판정 (QUAL-02) - 추가만. eval_candidate는 평가셋 후보 표시이며 문항 등록은 /admin/eval에서 익명화 검토 뒤에';
create index quality_judgments_day_idx on public.quality_judgments (judged_at);

create function public.quality_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% 는 추가만 할 수 있습니다 (% 거부)', tg_table_name, tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.quality_append_only() from public, anon, authenticated;
create trigger quality_judgments_no_update before update or delete on public.quality_judgments for each row execute function public.quality_append_only();
create trigger quality_judgments_no_truncate before truncate on public.quality_judgments for each statement execute function public.quality_append_only();

create table public.quality_alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('block_rate', 'budget_warn', 'budget_over', 'sample_short')),
  alert_key text not null unique check (char_length(alert_key) between 1 and 80),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default now(),
  acked_by text,
  acked_at timestamptz,
  constraint quality_alerts_ack_pair check ((acked_by is null) = (acked_at is null))
);
comment on table public.quality_alerts is '품질 경보 (QUAL-02~04) - alert_key 유일로 멱등. 확인(ack)은 quality_alert_ack 함수로만';
create index quality_alerts_open_idx on public.quality_alerts (kind, created_at desc) where acked_at is null;

alter table public.quality_judgments enable row level security;
alter table public.quality_alerts enable row level security;
revoke all on table public.quality_judgments, public.quality_alerts from anon, authenticated, service_role;
grant select on table public.quality_judgments, public.quality_alerts to service_role;

-- 한국 날짜
create function public.quality_kst_day(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$ select (p_at at time zone 'Asia/Seoul')::date $$;
revoke all on function public.quality_kst_day(timestamptz) from public, anon, authenticated;
grant execute on function public.quality_kst_day(timestamptz) to service_role;

-- 경보 한 건 넣기 - 같은 키는 한 번만. 새로 넣었으면 true
create function public.quality_alert_put(p_kind text, p_key text, p_detail jsonb) returns boolean
language plpgsql
set search_path = ''
as $$
declare v_id bigint;
begin
  insert into public.quality_alerts (kind, alert_key, detail) values (p_kind, p_key, coalesce(p_detail, '{}'::jsonb))
    on conflict (alert_key) do nothing returning id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.quality_alert_put(text, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- QUAL-03 차단율: 최근 5분 검증 기록 중 하나라도 실패한 비율이 20%를 넘으면 경보 1건
-- 표본이 min_samples(settings quality_alert.min_samples, 없으면 5) 미만이면 판단하지 않는다. 열린(미확인) 경보나 5분 안의 경보가 있으면 새로 만들지 않는다.
-- ─────────────────────────────────────────────────────────────
create function public.quality_check_block_rate(p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
  v_blocked int;
  v_min int := coalesce((select case when jsonb_typeof(s.value -> 'min_samples') = 'number' then (s.value ->> 'min_samples')::int end from public.settings s where s.key = 'quality_alert'), 5);
  v_created boolean := false;
begin
  select count(*)::int, count(*) filter (where not (v.v1 and v.v2 and v.v3 and v.v4 and v.v5 and v.v6))::int
    into v_total, v_blocked
    from public.agent_validations v
   where v.created_at > p_now - interval '5 minutes' and v.created_at <= p_now;
  if v_total >= greatest(v_min, 1) and v_blocked * 100 > v_total * 20 then
    if not exists (select 1 from public.quality_alerts a where a.kind = 'block_rate' and (a.acked_at is null or a.created_at > p_now - interval '5 minutes')) then
      v_created := public.quality_alert_put('block_rate', 'block_rate:' || to_char(p_now at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'), jsonb_build_object('total', v_total, 'blocked', v_blocked, 'window_minutes', 5));
    end if;
  end if;
  return jsonb_build_object('total', v_total, 'blocked', v_blocked, 'alert_created', v_created);
end;
$$;
revoke all on function public.quality_check_block_rate(timestamptz) from public, anon, authenticated;
grant execute on function public.quality_check_block_rate(timestamptz) to service_role;

-- ─────────────────────────────────────────────────────────────
-- QUAL-04 예산: 이번 달(한국) 사용 비용이 월 예산의 80% 이상이면 경보, 100% 이상이면 초과 경보 (달마다 각 1건)
-- 예산 값(settings ask_budget.monthly_won)이 없거나 0 이하면 경보 0 (기본 꺼짐)
-- ─────────────────────────────────────────────────────────────
create function public.quality_check_budget(p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget numeric;
  v_spent numeric;
  v_month text := to_char(p_now at time zone 'Asia/Seoul', 'YYYY-MM');
  v_level text := 'unset';
begin
  select case when jsonb_typeof(s.value -> 'monthly_won') = 'number' then (s.value ->> 'monthly_won')::numeric end into v_budget
    from public.settings s where s.key = 'ask_budget';
  if v_budget is null or v_budget <= 0 then
    return jsonb_build_object('level', 'unset', 'spent', 0);
  end if;
  select coalesce(sum(u.cost), 0) into v_spent from public.agent_usage_daily u
   where u.day >= date_trunc('month', p_now at time zone 'Asia/Seoul')::date and u.day <= public.quality_kst_day(p_now);
  if v_spent * 100 >= v_budget * 100 then
    v_level := 'over';
    perform public.quality_alert_put('budget_warn', 'budget_warn:' || v_month, jsonb_build_object('month', v_month, 'budget', v_budget, 'spent', v_spent));
    perform public.quality_alert_put('budget_over', 'budget_over:' || v_month, jsonb_build_object('month', v_month, 'budget', v_budget, 'spent', v_spent));
  elsif v_spent * 100 >= v_budget * 80 then
    v_level := 'warn';
    perform public.quality_alert_put('budget_warn', 'budget_warn:' || v_month, jsonb_build_object('month', v_month, 'budget', v_budget, 'spent', v_spent));
  else
    v_level := 'ok';
  end if;
  return jsonb_build_object('level', v_level, 'spent', v_spent, 'budget', v_budget);
end;
$$;
revoke all on function public.quality_check_budget(timestamptz) from public, anon, authenticated;
grant execute on function public.quality_check_budget(timestamptz) to service_role;

-- 기록 거래 안에서 부르는 트리거 - 검사가 실패해도 사용자 경로의 기록은 막지 않는다
create function public.quality_trg_validation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin perform public.quality_check_block_rate(now()); exception when others then null; end;
  return null;
end;
$$;
create function public.quality_trg_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin perform public.quality_check_budget(now()); exception when others then null; end;
  return null;
end;
$$;
revoke all on function public.quality_trg_validation() from public, anon, authenticated;
revoke all on function public.quality_trg_usage() from public, anon, authenticated;
create trigger quality_after_validation after insert on public.agent_validations for each row execute function public.quality_trg_validation();
create trigger quality_after_usage after insert or update on public.agent_usage_daily for each row execute function public.quality_trg_usage();

-- ─────────────────────────────────────────────────────────────
-- QUAL-02 표본 감수: 4c 공개일(공개 단계 4c 승인 성공 감사의 첫 행)부터 28일, 날마다 판정 50건 이상. 끝난 날 중 모자란 날마다 경보 1건
-- ─────────────────────────────────────────────────────────────
create function public.quality_sample_check(p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
  v_day date;
  v_n int;
  v_short int := 0;
  v_today date := public.quality_kst_day(p_now);
begin
  select public.quality_kst_day(min(a.at)) into v_start from public.eval_audit a where a.action = 'rollout' and a.outcome = 'ok' and a.target = '4c';
  if v_start is null then
    return jsonb_build_object('started', false, 'short_days', 0);
  end if;
  for v_day in select d::date from generate_series(v_start, least(v_start + 27, v_today - 1), interval '1 day') d loop
    select count(*)::int into v_n from public.quality_judgments j where public.quality_kst_day(j.judged_at) = v_day;
    if v_n < 50 then
      v_short := v_short + 1;
      perform public.quality_alert_put('sample_short', 'sample_short:' || v_day::text, jsonb_build_object('day', v_day, 'judged', v_n, 'required', 50));
    end if;
  end loop;
  return jsonb_build_object('started', true, 'start', v_start, 'short_days', v_short);
end;
$$;
revoke all on function public.quality_sample_check(timestamptz) from public, anon, authenticated;
grant execute on function public.quality_sample_check(timestamptz) to service_role;

-- 작업 quality-daily가 부르는 묶음 (회귀 감지는 앱 쪽)
create function public.quality_daily_run(p_now timestamptz default now()) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('block_rate', public.quality_check_block_rate(p_now), 'budget', public.quality_check_budget(p_now), 'sample', public.quality_sample_check(p_now));
$$;
revoke all on function public.quality_daily_run(timestamptz) from public, anon, authenticated;
grant execute on function public.quality_daily_run(timestamptz) to service_role;

-- 표본 판정 기록 (사람만)
create function public.quality_judge(p_message bigint, p_judge text, p_verdict text, p_note text, p_candidate boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_judge is null or p_judge !~ '^user:[0-9a-fA-F-]{36}$' then
    return jsonb_build_object('ok', false, 'code', 'judge_not_human', 'message', '판정자는 사람 계정이어야 합니다');
  end if;
  if not exists (select 1 from public.agent_messages m where m.id = p_message and m.kind = 'answer') then
    return jsonb_build_object('ok', false, 'code', 'message_not_found', 'message', '판정할 답변이 없습니다');
  end if;
  insert into public.quality_judgments (message_id, judge, verdict, note, eval_candidate)
    values (p_message, p_judge, p_verdict, nullif(btrim(p_note), ''), coalesce(p_candidate, false));
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '');
exception
  when unique_violation then return jsonb_build_object('ok', false, 'code', 'already_judged', 'message', '이미 판정했습니다');
  when check_violation then return jsonb_build_object('ok', false, 'code', 'invalid', 'message', '판정 값 또는 메모(번호·이메일 금지, 500자 이하)를 확인하세요');
end;
$$;
revoke all on function public.quality_judge(bigint, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.quality_judge(bigint, text, text, text, boolean) to service_role;

create function public.quality_alert_ack(p_id bigint, p_actor text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  if coalesce(btrim(p_actor), '') = '' then return false; end if;
  update public.quality_alerts set acked_by = p_actor, acked_at = now() where id = p_id and acked_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;
revoke all on function public.quality_alert_ack(bigint, text) from public, anon, authenticated;
grant execute on function public.quality_alert_ack(bigint, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 콘솔 뷰 (QUAL-01) - service_role만 읽는다
-- ─────────────────────────────────────────────────────────────
create view public.quality_blocked_log with (security_invoker = true) as
  select m.id as message_id, m.created_at, m.scope, m.tier, m.kind, m.fallback_reason, v.regenerated, v.failure_codes,
         not v.v1 as v1_failed, not v.v2 as v2_failed, not v.v3 as v3_failed, not v.v4 as v4_failed, not v.v5 as v5_failed, not v.v6 as v6_failed
    from public.agent_validations v join public.agent_messages m on m.id = v.message_id
   where not (v.v1 and v.v2 and v.v3 and v.v4 and v.v5 and v.v6);

create view public.quality_live_log with (security_invoker = true) as
  select t.id as tool_call_id, m.id as message_id, m.created_at, t.tool, t.ok, t.latency_ms, t.target_type, t.snapshot_id
    from public.agent_tool_calls t join public.agent_messages m on m.id = t.message_id
   where t.tool in ('fetch_official_source', 'web_search_official');

create view public.quality_cost_daily with (security_invoker = true) as
  select u.day, u.tier, u.turns, u.cost, case when u.turns > 0 then round(u.cost / u.turns, 4) else 0 end as cost_per_turn
    from public.agent_usage_daily u;

-- 표본 후보 - 답변이 있는 최근 대화와 판정 수 (질문·답변은 마스킹본)
create view public.quality_sample_candidates with (security_invoker = true) as
  select m.id as message_id, m.created_at, m.scope, m.tier, m.question_masked, m.answer_masked,
         (select count(*)::int from public.quality_judgments j where j.message_id = m.id) as judgments
    from public.agent_messages m where m.kind = 'answer';

revoke all on table public.quality_blocked_log, public.quality_live_log, public.quality_cost_daily, public.quality_sample_candidates from anon, authenticated;
grant select on table public.quality_blocked_log, public.quality_live_log, public.quality_cost_daily, public.quality_sample_candidates to service_role;
