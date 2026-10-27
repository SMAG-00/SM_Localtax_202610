-- W13-e e2 - 리서치 코파일럿 월 사용량·실행 요약 (docs/dev/W13-e_설계.md, PRD-05 RES-05)
--  · 질문·메모·답변·입력 구조체를 저장하는 칸이 없다. 남기는 것은 종류·상태·모델 표지·인용 source_id·검증 요약·토큰·비용뿐이다.
--  · 표는 anon·authenticated·service_role 직접 접근을 모두 막고, 서버(service_role)가 아래 함수로만 읽고 쓴다 (169 방식).
--  · 월 한도 값은 이 파일에 없다 - 서버가 설정 copilot_monthly_limit에서 읽어 p_limit로 넘긴다. 비어 있거나 0 이하이면 차감은 거부된다(실행 0).

create table public.copilot_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  runs integer not null default 0 check (runs >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
comment on table public.copilot_usage is '코파일럿 월 실행 횟수 (RES-05) - 서버 함수로만 읽고 쓴다';
alter table public.copilot_usage enable row level security;
revoke all on table public.copilot_usage from anon, authenticated, service_role;

create table public.copilot_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('comparison', 'history', 'publications', 'issue_memo')),
  status text not null check (status in ('answer', 'fallback', 'error', 'clarify')),
  model text check (model is null or char_length(model) <= 100),
  citation_ids text[] not null default '{}' check (cardinality(citation_ids) <= 100),
  validation jsonb not null default '{}'::jsonb,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost numeric not null default 0 check (cost >= 0),
  created_at timestamptz not null default now()
);
comment on table public.copilot_runs is '코파일럿 실행 요약 (RES-05) - 질문·답변 글 칸 없음. 결과 글은 사용자가 메모·스크랩으로 직접 저장할 때만 남는다';
create index copilot_runs_user_idx on public.copilot_runs (user_id, created_at desc);
alter table public.copilot_runs enable row level security;
revoke all on table public.copilot_runs from anon, authenticated, service_role;

-- 한 번 차감 - 원자적. 한도 n이면 n번째까지 허용, n+1번째는 거부 (달 기준은 한국 시간)
create function public.copilot_consume(p_user uuid, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Seoul')::date;
  v_runs integer;
begin
  if p_user is null then
    raise exception using errcode = '22023', message = '사용자가 필요합니다';
  end if;
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('allowed', false, 'code', 'limit_unset', 'used', 0, 'limit', 0);
  end if;
  insert into public.copilot_usage as u (user_id, month, runs) values (p_user, v_month, 1)
    on conflict (user_id, month) do update set runs = u.runs + 1, updated_at = now() where u.runs < p_limit
    returning u.runs into v_runs;
  if v_runs is null then
    select u.runs into v_runs from public.copilot_usage u where u.user_id = p_user and u.month = v_month;
    return jsonb_build_object('allowed', false, 'code', 'limit_reached', 'used', coalesce(v_runs, 0), 'limit', p_limit);
  end if;
  return jsonb_build_object('allowed', true, 'code', 'ok', 'used', v_runs, 'limit', p_limit);
end;
$$;
revoke all on function public.copilot_consume(uuid, integer) from public, anon, authenticated;
grant execute on function public.copilot_consume(uuid, integer) to service_role;

-- 답을 못 낸 실행은 한 번 되돌린다 (0 아래로 내려가지 않는다)
create function public.copilot_refund(p_user uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update public.copilot_usage set runs = greatest(runs - 1, 0), updated_at = now()
   where user_id = p_user and month = date_trunc('month', now() at time zone 'Asia/Seoul')::date;
$$;
revoke all on function public.copilot_refund(uuid) from public, anon, authenticated;
grant execute on function public.copilot_refund(uuid) to service_role;

create function public.copilot_peek(p_user uuid, p_limit integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'used', coalesce((select u.runs from public.copilot_usage u where u.user_id = p_user and u.month = date_trunc('month', now() at time zone 'Asia/Seoul')::date), 0),
    'limit', case when p_limit is null or p_limit <= 0 then 0 else p_limit end);
$$;
revoke all on function public.copilot_peek(uuid, integer) from public, anon, authenticated;
grant execute on function public.copilot_peek(uuid, integer) to service_role;

-- 실행 요약 기록 - 허용한 칸만 읽는다 (질문·글 칸은 받지 않는다)
create function public.copilot_record_run(p jsonb) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ids text[];
begin
  if jsonb_typeof(p) is distinct from 'object' or (p ->> 'user_id') is null then
    raise exception using errcode = '22023', message = '기록 값이 올바르지 않습니다';
  end if;
  select coalesce(array_agg(left(x, 80)), '{}') into v_ids from jsonb_array_elements_text(coalesce(p -> 'citation_ids', '[]'::jsonb)) x;
  insert into public.copilot_runs (id, user_id, kind, status, model, citation_ids, validation, tokens_in, tokens_out, cost)
    values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), (p ->> 'user_id')::uuid, p ->> 'kind', p ->> 'status', nullif(left(coalesce(p ->> 'model', ''), 100), ''), v_ids,
            case when jsonb_typeof(p -> 'validation') = 'object' then p -> 'validation' else '{}'::jsonb end,
            coalesce((p ->> 'tokens_in')::integer, 0), coalesce((p ->> 'tokens_out')::integer, 0), coalesce((p ->> 'cost')::numeric, 0))
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.copilot_record_run(jsonb) from public, anon, authenticated;
grant execute on function public.copilot_record_run(jsonb) to service_role;
