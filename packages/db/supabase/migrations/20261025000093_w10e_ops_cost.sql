-- W10-e e4 - 운영 AI 비용 기록 (PRD-02 AIOPS-04, docs/dev/W10-e_설계.md 3장)
-- · agent_runs에 실행마다 모델·토큰·비용 칸을 더한다. 단가·월 한도·경보 비율은 settings.ops_ai_budget(코드 상수 0), 경보 판정은 앱이 한다.
-- · ops_ai_month_cost(p_at) - 한국 달력 기준 그 달의 비용 합계 (cost_unit이 같은 행끼리만 의미가 있어 단위별로 돌려준다).
-- 기존 칸·제약은 바꾸지 않는다.

alter table public.agent_runs
  add column model text check (model is null or length(btrim(model)) between 1 and 100),
  add column input_tokens integer check (input_tokens is null or input_tokens >= 0),
  add column output_tokens integer check (output_tokens is null or output_tokens >= 0),
  add column cost numeric(14, 6) check (cost is null or cost >= 0),
  add column cost_unit text check (cost_unit is null or cost_unit ~ '^[A-Z]{3}$');

alter table public.agent_runs add constraint agent_runs_cost_unit_pair check ((cost is null) = (cost_unit is null));

comment on column public.agent_runs.cost is '운영 AI 실행 비용 - 단가는 settings.ops_ai_budget에서 계산해 넣는다 (AIOPS-04). AI를 안 쓴 실행은 비어 있다';

create index agent_runs_cost_month_idx on public.agent_runs (started_at) where cost is not null;

create function public.ops_ai_month_cost(p_at timestamptz default now()) returns table (cost_unit text, total numeric)
language sql
stable
set search_path = ''
as $$
  select r.cost_unit, sum(r.cost)
    from public.agent_runs r
   where r.cost is not null
     and (r.started_at at time zone 'Asia/Seoul') >= date_trunc('month', p_at at time zone 'Asia/Seoul')
     and (r.started_at at time zone 'Asia/Seoul') < date_trunc('month', p_at at time zone 'Asia/Seoul') + interval '1 month'
   group by r.cost_unit;
$$;

revoke all on function public.ops_ai_month_cost(timestamptz) from public, anon, authenticated;
grant execute on function public.ops_ai_month_cost(timestamptz) to service_role;
