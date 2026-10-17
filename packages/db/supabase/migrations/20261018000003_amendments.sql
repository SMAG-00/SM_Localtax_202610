-- W2-a 1단계 DB — 개정 트래커 (PRD-01B 5.2 amendments · amendment_events, TX-07·TX-08). CAT-04 진행 단계 배지가 읽는다.
-- 단계 6종: announced(발표) · pre_notice(입법예고) · submitted(국회 제출) · passed(의결) · promulgated(공포) · effective(시행)
-- · 단계 기록은 날짜·원문 URL·원본 스냅샷이 모두 있어야 저장된다. 건너뛴 단계는 skipped + 사유로 남긴다
-- · 추가만 — 앞 순서로 돌아가는 기록·같은 단계 재기록은 거부하고, 잘못된 기록은 사유가 있는 정정 기록(correction_of)으로만 고친다
-- · 현재 단계는 저장하지 않고 계산한다 — 정정되지 않은 기록 가운데 가장 늦은 순서 (뷰 amendment_current_stages)
-- · 확정 여부(공포 전 '확정 아님')는 settings.amendment_confirmed_stage 기준으로 서버가 계산한다

create table public.amendments (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (length(btrim(title)) > 0),
  law_names text[] not null default '{}',
  summary text,
  owner_id bigint references public.people (id),
  status text not null default 'draft' check (status in ('draft', 'public', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.amendments is '개정 트래커 (TX-07) — 현재 단계·확정 여부는 저장하지 않고 amendment_events에서 계산한다. 공개는 status=public';

create trigger amendments_touch before update on public.amendments
  for each row execute function public.touch_updated_at();

alter table public.amendments enable row level security;
revoke all on table public.amendments from anon, authenticated, service_role;
grant select, insert, update, delete on table public.amendments to service_role;

create table public.amendment_events (
  id bigint generated always as identity primary key,
  amendment_id bigint not null references public.amendments (id),
  stage text not null check (stage in ('announced', 'pre_notice', 'submitted', 'passed', 'promulgated', 'effective')),
  occurred_on date,
  source_url text,
  snapshot_id bigint references public.raw_snapshots (id),
  skipped boolean not null default false,              -- 해당 없음 (예: 국회 단계가 없는 시행령 개정) [감수 필요]
  skip_reason text,
  correction_of bigint references public.amendment_events (id),
  reason text,
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  constraint amendment_events_evidence check (
    skipped or (occurred_on is not null and length(btrim(coalesce(source_url, ''))) > 0 and snapshot_id is not null)),
  constraint amendment_events_skip_reason check (not skipped or length(btrim(coalesce(skip_reason, ''))) > 0),
  constraint amendment_events_correction_reason check (correction_of is null or length(btrim(coalesce(reason, ''))) > 0)
);

comment on table public.amendment_events is '개정 단계 기록 (TX-07) — 추가만. 앞 순서 단계 거부, 정정은 correction_of + reason으로만';

create index amendment_events_amendment_idx on public.amendment_events (amendment_id, recorded_at);
-- 한 기록은 한 번만 정정된다 (정정을 다시 고치려면 정정 기록을 정정한다)
create unique index amendment_events_one_correction on public.amendment_events (correction_of) where correction_of is not null;

create function public.amendment_events_check_order() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_order constant text[] := array['announced', 'pre_notice', 'submitted', 'passed', 'promulgated', 'effective'];
  v_target_amendment bigint;
  v_max int;
begin
  -- 같은 개정안에 동시에 들어오는 두 기록이 서로를 못 보는 일을 막는다
  perform pg_advisory_xact_lock(hashtextextended('amendment_events:' || new.amendment_id::text, 0));

  if new.correction_of is not null then
    select e.amendment_id into v_target_amendment from public.amendment_events e where e.id = new.correction_of;
    if v_target_amendment is distinct from new.amendment_id then
      raise exception '정정 대상(%)은 같은 개정안의 기록이어야 합니다', new.correction_of
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 같은 단계가 이미 유효하게(정정되지 않은 채) 기록되어 있으면 거부
  if exists (
    select 1 from public.amendment_events e
     where e.amendment_id = new.amendment_id and e.stage = new.stage
       and not exists (select 1 from public.amendment_events c where c.correction_of = e.id)
  ) then
    raise exception '이미 기록된 단계입니다 (%) — 고치려면 정정 기록(correction_of·reason)을 쓰세요', new.stage
      using errcode = 'check_violation';
  end if;

  -- 앞 순서로 돌아가는 기록 거부 (건너뛴 단계 기록은 현재 단계를 바꾸지 않으므로 순서 검사에서 뺀다)
  if not new.skipped then
    select max(array_position(c_order, e.stage)) into v_max
      from public.amendment_events e
     where e.amendment_id = new.amendment_id and not e.skipped
       and not exists (select 1 from public.amendment_events c where c.correction_of = e.id);
    if v_max is not null and array_position(c_order, new.stage) < v_max then
      raise exception '앞 순서 단계로 돌아가는 기록은 거부합니다 (현재 % → 새 기록 %) — 잘못된 기록은 정정 기록으로 고치세요', c_order[v_max], new.stage
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.amendment_events_check_order() from public, anon, authenticated;

create trigger amendment_events_check_order
  before insert on public.amendment_events
  for each row execute function public.amendment_events_check_order();

create trigger amendment_events_no_update_delete
  before update or delete on public.amendment_events
  for each row execute function public.append_only_guard();

create trigger amendment_events_no_truncate
  before truncate on public.amendment_events
  for each statement execute function public.append_only_guard();

alter table public.amendment_events enable row level security;
revoke all on table public.amendment_events from anon, authenticated, service_role;
grant select, insert on table public.amendment_events to service_role;

-- 현재 단계 — 정정되지 않은 기록 가운데 건너뛰지 않은 가장 늦은 순서 (CAT-04 배지는 이 값만 읽는다)
create view public.amendment_current_stages
with (security_invoker = true) as
select distinct on (e.amendment_id)
  e.amendment_id,
  e.stage as current_stage,
  e.occurred_on as current_stage_on,
  e.id as event_id
from public.amendment_events e
where not e.skipped
  and not exists (select 1 from public.amendment_events c where c.correction_of = e.id)
order by e.amendment_id,
  array_position(array['announced', 'pre_notice', 'submitted', 'passed', 'promulgated', 'effective']::text[], e.stage) desc,
  e.recorded_at desc,
  e.id desc;

comment on view public.amendment_current_stages is '개정안별 현재 단계 (TX-07 — 가장 늦은 순서의 유효 기록). security_invoker — 읽는 역할의 RLS를 따른다';

revoke all on table public.amendment_current_stages from anon, authenticated, service_role;
grant select on table public.amendment_current_stages to service_role;
