-- ADM-04 감사 로그: 누가(actor)·언제(at)·무엇을(action·target, before·after)·왜(reason).
-- 추가만 가능하다. UPDATE·DELETE·TRUNCATE는 권한으로 막고(service_role 포함), 테이블 소유자도 트리거로 막는다.
-- RLS는 켜고 정책을 두지 않는다 — anon·authenticated는 읽기·쓰기 0 (FND-04 기본 거부).

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor text not null check (length(btrim(actor)) > 0),      -- 사람: user:<uuid> · 작업: job:<이름>
  action text not null check (length(btrim(action)) > 0),    -- 예: article.publish · role.grant · expert_request.open
  target text not null check (length(btrim(target)) > 0),    -- 예: articles:<id>
  before jsonb,
  after jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  at timestamptz not null default now()
);

comment on table public.audit_logs is '감사 로그 (ADM-04) — 추가만 가능. 수정·삭제·비우기는 트리거와 권한으로 거부한다';

create index audit_logs_target_at_idx on public.audit_logs (target, at desc);
create index audit_logs_actor_at_idx on public.audit_logs (actor, at desc);

alter table public.audit_logs enable row level security;

-- 권한: 서버(service_role)만 추가·조회. 브라우저 역할은 아무것도 못 한다
revoke all on table public.audit_logs from anon, authenticated, service_role;
grant select, insert on table public.audit_logs to service_role;

-- 소유자·슈퍼유저 경로까지 막는 트리거
create function public.audit_logs_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs는 추가만 할 수 있습니다 (% 거부)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.audit_logs_append_only() from public, anon, authenticated;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_append_only();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_append_only();
