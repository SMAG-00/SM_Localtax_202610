-- W2-a 1단계 DB — 기사 기획 캘린더 story_assignments (NAV-09 · NAV-21 · REG1-17)
-- · 상태 7종: idea · assigned · reporting · fact_check · review · published · held
-- · 담당 기자·편집자·이해관계·전문 분야 관련성이 비면 assigned로 못 바꾼다. assigned를 건너뛰는 우회를 막으려고
--   assigned 이후 상태(reporting·fact_check·review·published) 전부에 같은 조건을 건다 (held는 예외 — 어느 상태에서나 갈 수 있다)
-- · 지역 태그(region_code)가 있는 기획은 편집 분야(4종)·공익적 질문이 있어야 assigned 이후로 간다 (REG1-17)
-- · fact_check·review를 거치지 않은 published는 거부 — 거쳐 온 상태는 story_assignment_events(트리거만 쓴다, 추가만)로 판정

create table public.story_assignments (
  id bigint generated always as identity primary key,
  section text not null check (section in ('tax', 'realestate', 'finance', 'local')),
  editorial_field text check (editorial_field in ('local_tax', 'realestate', 'local_finance', 'urban_policy')),
  kind text not null default 'general' check (kind in ('general', 'feature', 'investigative')),
  quarter text check (quarter ~ '^[0-9]{4}Q[1-4]$'),
  region_code text,
  hypothesis text,                         -- 기사 가설
  public_interest text,                    -- 공익성
  public_question text,                    -- 공익적 질문 (REG1-17)
  relevance text,                          -- 전문 분야 관련성
  subject_kind text,                       -- 소재 종류 (축제·명소·상권 등 — 규칙은 01B REG1-17)
  relation_types text[] not null default '{}', -- 관계 유형 (예산·세수·공유재산·개발·거래·주거 영향)
  method text check (method in ('quantitative', 'qualitative', 'mixed')), -- 취재 방식 (reporting_method와 같은 값)
  reporter_id bigint references public.people (id),
  editor_id bigint references public.people (id),
  plan text,
  due_at timestamptz,
  conflicts text,                          -- 이해관계
  status text not null default 'idea' check (status in ('idea', 'assigned', 'reporting', 'fact_check', 'review', 'published', 'held')),
  review_queue text check (review_queue in ('news', 'held', 'separate_product')),
  query_cluster_id bigint,                 -- 질의 지도 공백에서 온 기획 (OPT-04 — query_clusters 표는 뒤 단계에서 만든다)
  reject_reason text,
  updated_by text,                         -- 마지막으로 바꾼 사람 — 상태 기록에 옮겨 적는다
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_assignments_assigned_ready check (
    status not in ('assigned', 'reporting', 'fact_check', 'review', 'published') or (
      reporter_id is not null
      and editor_id is not null
      and length(btrim(coalesce(conflicts, ''))) > 0
      and length(btrim(coalesce(relevance, ''))) > 0)),
  constraint story_assignments_regional_ready check (
    status not in ('assigned', 'reporting', 'fact_check', 'review', 'published')
    or region_code is null
    or (editorial_field is not null and length(btrim(coalesce(public_question, ''))) > 0))
);

comment on table public.story_assignments is '기사 기획 캘린더 (NAV-09). assigned 이후는 담당 기자·편집자·이해관계·관련성 필수, published는 fact_check·review를 거친 뒤에만';

create index story_assignments_status_idx on public.story_assignments (status, due_at);

create trigger story_assignments_touch before update on public.story_assignments
  for each row execute function public.touch_updated_at();

alter table public.story_assignments enable row level security;
revoke all on table public.story_assignments from anon, authenticated, service_role;
grant select, insert, update, delete on table public.story_assignments to service_role;

-- 상태 기록 — 트리거만 쓴다 (서버도 직접 추가 불가 → 거쳐 온 상태를 꾸며 published 규칙을 우회할 수 없다).
-- 기획을 지워도 기록은 남는다 — audit_log_changes처럼 외래 키를 두지 않는다
create table public.story_assignment_events (
  id bigint generated always as identity primary key,
  assignment_id bigint not null,
  from_status text,
  to_status text not null,
  changed_by text,
  reason text,
  at timestamptz not null default now()
);

comment on table public.story_assignment_events is '기획 상태 변경 기록 (NAV-09 — 월간 점검·반려 사유). 추가만, 트리거만 쓴다';

create index story_assignment_events_assignment_idx on public.story_assignment_events (assignment_id, at);

create trigger story_assignment_events_no_update_delete
  before update or delete on public.story_assignment_events
  for each row execute function public.append_only_guard();

create trigger story_assignment_events_no_truncate
  before truncate on public.story_assignment_events
  for each statement execute function public.append_only_guard();

alter table public.story_assignment_events enable row level security;
revoke all on table public.story_assignment_events from anon, authenticated, service_role;
grant select on table public.story_assignment_events to service_role;

-- published 규칙: fact_check와 review를 모두 거친 기록이 있어야 한다
create function public.story_assignments_check_transition() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visited text[];
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if tg_op = 'INSERT' then
      v_visited := '{}';
    else
      select coalesce(array_agg(distinct e.to_status), '{}') into v_visited
        from public.story_assignment_events e where e.assignment_id = new.id;
    end if;
    if not (v_visited @> array['fact_check', 'review']::text[]) then
      raise exception 'fact_check·review를 거치지 않은 기획은 published로 바꿀 수 없습니다 (NAV-09 — 거쳐 온 상태: %)', v_visited
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create function public.story_assignments_log_status() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.story_assignment_events (assignment_id, from_status, to_status, changed_by, reason)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      new.updated_by,
      case when new.status = 'held' then new.reject_reason end);
  end if;
  return null;
end;
$$;

revoke all on function public.story_assignments_check_transition() from public, anon, authenticated;
revoke all on function public.story_assignments_log_status() from public, anon, authenticated;

create trigger story_assignments_check_transition
  before insert or update on public.story_assignments
  for each row execute function public.story_assignments_check_transition();

create trigger story_assignments_log_status
  after insert or update on public.story_assignments
  for each row execute function public.story_assignments_log_status();
