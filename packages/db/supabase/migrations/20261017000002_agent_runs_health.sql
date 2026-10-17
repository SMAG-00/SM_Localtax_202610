-- 배치 실행 기록 agent_runs (PRD-00 9장 운영 — 1단계 workflows/*부터, FND-07)
-- Vercel Cron과 사내 스케줄러가 같은 /api/jobs/* 를 부르고, 실행마다 같은 형식의 행 1건을 남긴다.
create table public.agent_runs (
  id bigint generated always as identity primary key,
  job text not null check (length(btrim(job)) > 0),
  trigger text not null check (trigger in ('vercel-cron', 'scheduler', 'manual')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  detail jsonb,
  error text,
  check ((status = 'running') = (finished_at is null))
);

comment on table public.agent_runs is '배치 실행 기록 — 작업 이름·호출 경로(vercel-cron·scheduler)·상태·시각. 서버(service_role)만 쓴다';

create index agent_runs_job_started_idx on public.agent_runs (job, started_at desc);

alter table public.agent_runs enable row level security;
revoke all on table public.agent_runs from anon, authenticated, service_role;
grant select, insert, update on table public.agent_runs to service_role;

-- 상태 확인(/api/health)용 DB 응답 함수 — 데이터를 읽지 않고 DB가 응답하는지만 본다 (FND-06)
create function public.health_ping() returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;

revoke all on function public.health_ping() from public;
grant execute on function public.health_ping() to anon, authenticated, service_role;
