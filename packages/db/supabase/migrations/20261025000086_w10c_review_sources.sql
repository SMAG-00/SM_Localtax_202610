-- W10-c 1단계 — 공통 검수 큐 review_items · 원천 등록부 data_sources · 원문 스냅샷 raw_snapshots 칸 확장
-- (PRD-02 REV-01~03 · PIPE-07 · PIPE-08, docs/dev/2단계_설계.md 3장 W10-c, docs/dev/W10-c_설계.md)
-- 이 파일에 법령·세무 문장, 세율·기한 값은 없다 — 표와 규칙, 처리 과정의 라벨(체크 항목 키)만 만든다.
--
-- · data_sources — 외부 원천(법령·행정규칙·해석·결정례·판례·국세청 해석·분야 데이터) 등록부. 이용 조건(terms_status) 기본 `unchecked`,
--   `allowed`이고 견본 계약 확인(contract_verified_at)이 있는 원천만 수집기가 돌 수 있다 (data_source_runnable). 씨앗 6행은 모두 unchecked.
-- · review_items — 검수 큐 항목. 종류 8종, (kind, source_key) 하나에 1건(재감지도 1건), 상태 전이는 함수 review_item_transition 하나만
--   (표 UPDATE는 service_role에 열지 않고, 소유자 직접 UPDATE도 트리거가 막는다). 재시도 최대 3회, 72시간 넘게 머문 항목은 review_items_stale.
--   모든 생성·전이·배정은 review_item_events(추가만)에 같은 거래로 남는다.
-- · raw_snapshots — 수집기 칸(source_key·external_id·run_id) 추가. 수집기가 넣은 행은 고칠 수 없고 지울 수 없다. 주소에 인증키 모양이 있으면 새 행 거부.
-- 모든 표는 RLS 기본 거부, anon·authenticated 권한 0 (공개 화면은 이 표를 읽지 않는다).

-- ─────────────────────────────────────────────────────────────
-- 원천 등록부
-- ─────────────────────────────────────────────────────────────
create table public.data_sources (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in ('law', 'admrul', 'interpretation', 'tribunal', 'case', 'nts_interpretation', 'field_data')),
  api_target text check (api_target is null or length(btrim(api_target)) > 0),
  priority text not null default 'p0' check (priority in ('p0', 'p1')),
  terms_status text not null default 'unchecked' check (terms_status in ('unchecked', 'allowed', 'link_only', 'denied')),
  terms_note text,
  terms_checked_by text,
  terms_checked_at timestamptz,
  contract_verified_by text,
  contract_verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint data_sources_terms_checked check (
    terms_status = 'unchecked' or (length(btrim(coalesce(terms_checked_by, ''))) > 0 and terms_checked_at is not null)),
  constraint data_sources_contract_pair check ((contract_verified_by is null) = (contract_verified_at is null))
);

comment on table public.data_sources is '외부 원천 등록부 — terms_status가 allowed이고 견본 계약 확인이 있어야 수집기가 돈다 (W10-c). 확인 전 unchecked는 실행 0';
comment on column public.data_sources.api_target is '외부 API의 대상 이름(법제처 target 값 등) — 확인이 필요한 원천은 비워 둔다';

-- 수집기가 돌아도 되는 원천 — 이용 조건 허용 + 실응답 견본 계약 확인. 둘 중 하나라도 없으면 거짓 (미확인 원천 실행 0)
create function public.data_source_runnable(p_key text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.terms_status = 'allowed' and s.contract_verified_at is not null
                     from public.data_sources s where s.key = p_key), false);
$$;

revoke all on function public.data_source_runnable(text) from public, anon, authenticated;
grant execute on function public.data_source_runnable(text) to service_role;

insert into public.data_sources (key, name, kind, api_target, priority) values
  ('law_api', '국가법령정보 법령', 'law', 'law', 'p0'),
  ('admrul', '국가법령정보 행정규칙', 'admrul', 'admrul', 'p0'),
  ('mois_interpretation', '행정안전부 법령해석', 'interpretation', 'moisCgmExpc', 'p0'),
  ('tribunal_decision', '조세심판원 결정례', 'tribunal', 'ttSpecialDecc', 'p0'),
  ('court_case', '법원 판례', 'case', null, 'p1'),
  ('nts_interpretation', '국세청 법령해석', 'nts_interpretation', null, 'p1');

alter table public.data_sources enable row level security;
revoke all on table public.data_sources from anon, authenticated, service_role;
grant select, insert, update on table public.data_sources to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공통 검수 큐
-- ─────────────────────────────────────────────────────────────
-- 종류별 필수 체크 키 — 승인(approved)은 이 키를 모두 확인해야 한다. 키는 처리 과정의 라벨이고 법·세무 내용이 아니다
create function public.review_required_checks(p_kind text) returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'pipeline_failure' then array['cause_noted']
    when 'law_change' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'promulgation_effective_match']
    when 'legal_doc' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'rights_checked', 'anonymity_checked']
    when 'link_error' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'link_opened']
    when 'link_candidates' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'targets_exist']
    when 'amendment_stage' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'stage_matches_source']
    when 'field_data' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'terms_allowed']
    when 'ai_draft' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'no_unreviewed_claims']
  end;
$$;

revoke all on function public.review_required_checks(text) from public, anon, authenticated;
grant execute on function public.review_required_checks(text) to service_role;

create table public.review_items (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('law_change', 'legal_doc', 'link_error', 'link_candidates', 'amendment_stage', 'field_data', 'ai_draft', 'pipeline_failure')),
  source_key text not null check (length(btrim(source_key)) between 1 and 300),
  title text not null check (length(btrim(title)) between 1 and 200),
  data_source_key text references public.data_sources (key),
  snapshot_id bigint references public.raw_snapshots (id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 262144),
  parts text[] not null default '{}',
  required_checks text[] not null default '{}',
  checked_keys text[] not null default '{}',
  approved_parts text[],
  status text not null default 'drafted' check (status in ('drafted', 'in_review', 'approved', 'published', 'rejected', 'failed')),
  failed_from text check (failed_from in ('drafted', 'in_review', 'approved')),
  attempts int not null default 0 check (attempts between 0 and 3),
  last_error text check (last_error is null or length(last_error) <= 500),
  reject_reason text,
  assignee text check (assignee is null or length(btrim(assignee)) > 0),
  assigned_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  created_by text not null default 'system' check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  constraint review_items_once unique (kind, source_key),
  constraint review_items_failed_from check ((status = 'failed') = (failed_from is not null)),
  constraint review_items_rejected_reason check (status <> 'rejected' or length(btrim(coalesce(reject_reason, ''))) > 0),
  constraint review_items_decided check (status not in ('approved', 'published') or (length(btrim(coalesce(decided_by, ''))) > 0 and decided_at is not null)),
  constraint review_items_parts check (approved_parts is null or (cardinality(approved_parts) > 0 and approved_parts <@ parts)),
  constraint review_items_checked_all check (status not in ('approved', 'published') or required_checks <@ checked_keys),
  constraint review_items_assigned check ((assignee is null) = (assigned_at is null))
);

comment on table public.review_items is '공통 검수 큐 (REV-01~03) — 상태 전이는 review_item_transition 함수만. (kind, source_key) 하나에 1건';
comment on column public.review_items.payload is '후보 내용(구조화) — 원문 글자는 raw_snapshots, 여기에는 번호·일자·주소 같은 요약만';
comment on column public.review_items.parts is '부분 승인 단위 키 — 비어 있으면 통째로만 승인';

create index review_items_open_idx on public.review_items (status_changed_at) where status in ('drafted', 'in_review', 'approved', 'failed');
create index review_items_kind_idx on public.review_items (kind, status);

create table public.review_item_events (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.review_items (id),
  action text not null check (action in ('create', 'transition', 'retry', 'assign')),
  from_status text,
  to_status text not null,
  actor text not null check (length(btrim(actor)) > 0),
  note text check (note is null or length(note) <= 500),
  at timestamptz not null default now()
);

comment on table public.review_item_events is '검수 항목의 생성·전이·재시도·배정 기록 (추가만) — 모든 결정이 남는다 (REV-01)';
create index review_item_events_item_idx on public.review_item_events (item_id, id);

create trigger review_item_events_append_only
  before update or delete on public.review_item_events
  for each row execute function public.append_only_guard();

-- 만들 때: 필수 체크 키는 종류로 정하고(입력 무시), 상태·시도는 처음 값으로 고정한다
create function public.review_items_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.required_checks := public.review_required_checks(new.kind);
  new.checked_keys := '{}';
  new.approved_parts := null;
  new.status := 'drafted';
  new.failed_from := null;
  new.attempts := 0;
  new.decided_by := null;
  new.decided_at := null;
  new.reject_reason := null;
  new.status_changed_at := now();
  return new;
end;
$$;

create function public.review_items_after_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.review_item_events (item_id, action, from_status, to_status, actor)
  values (new.id, 'create', null, new.status, new.created_by);
  return new;
end;
$$;

-- 고치기·지우기 보호 — 함수가 연 거래 안에서만 UPDATE 가능, 종류·키·필수 체크·생성 정보는 어떤 경우에도 불변
create function public.review_items_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '검수 항목은 지울 수 없습니다 (REV-01)' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(current_setting('ltr.review_write', true), '') <> '1' then
    raise exception '검수 항목은 review_item_transition 함수로만 바꿀 수 있습니다 (REV-02)' using errcode = 'insufficient_privilege';
  end if;
  if new.kind is distinct from old.kind or new.source_key is distinct from old.source_key
     or new.required_checks is distinct from old.required_checks or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by or new.parts is distinct from old.parts
     or new.snapshot_id is distinct from old.snapshot_id or new.payload is distinct from old.payload then
    raise exception '검수 항목의 종류·키·필수 체크·부분 단위·원문·후보 내용은 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.review_items_before_insert() from public, anon, authenticated;
revoke all on function public.review_items_after_insert() from public, anon, authenticated;
revoke all on function public.review_items_guard() from public, anon, authenticated;

create trigger review_items_before_insert before insert on public.review_items
  for each row execute function public.review_items_before_insert();
create trigger review_items_after_insert after insert on public.review_items
  for each row execute function public.review_items_after_insert();
create trigger review_items_guard before update or delete on public.review_items
  for each row execute function public.review_items_guard();

-- 상태 전이 한 곳 (REV-02)
--   drafted → in_review · rejected · failed / in_review → approved · rejected · failed / approved → published · failed / failed → retry(= 실패 직전 상태로, 최대 3회)
--   approved 는 필수 체크 키를 모두 확인해야 하고(부분 승인이면 p_parts), rejected 는 사유, failed 는 오류 요약이 필요하다. published·rejected 는 끝 상태
create function public.review_item_transition(
  p_id bigint, p_to text, p_actor text,
  p_reason text default null, p_checked text[] default null, p_parts text[] default null
) returns public.review_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.review_items;
  v_to text := p_to;
  v_action text := 'transition';
  v_from text;
  v_note text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '결정한 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  select * into r from public.review_items where id = p_id for update;
  if not found then
    raise exception '검수 항목 %가 없습니다', p_id using errcode = 'no_data_found';
  end if;
  v_from := r.status;

  if p_to = 'retry' then
    if r.status <> 'failed' then
      raise exception '실패한 항목만 다시 시도할 수 있습니다 (현재 %)', r.status using errcode = 'check_violation';
    end if;
    if r.attempts >= 3 then
      raise exception '재시도는 최대 3회입니다 (항목 %)', p_id using errcode = 'check_violation';
    end if;
    v_to := r.failed_from;
    v_action := 'retry';
  elsif not (
       (r.status = 'drafted' and p_to in ('in_review', 'rejected', 'failed'))
    or (r.status = 'in_review' and p_to in ('approved', 'rejected', 'failed'))
    or (r.status = 'approved' and p_to in ('published', 'failed'))
  ) then
    raise exception '허용되지 않은 상태 전이입니다: % → %', r.status, p_to using errcode = 'check_violation';
  end if;

  if p_to = 'approved' then
    if not (r.required_checks <@ coalesce(p_checked, '{}')) then
      raise exception '체크리스트를 모두 확인해야 승인할 수 있습니다 (빠진 항목: %)',
        array(select k from unnest(r.required_checks) k where not (k = any (coalesce(p_checked, '{}')))) using errcode = 'check_violation';
    end if;
    if p_parts is not null and (cardinality(r.parts) = 0 or cardinality(p_parts) = 0 or not (p_parts <@ r.parts)) then
      raise exception '부분 승인 단위가 항목의 단위 안에 있어야 합니다' using errcode = 'check_violation';
    end if;
  elsif p_to = 'rejected' and v_note is null then
    raise exception '반려는 사유가 필요합니다' using errcode = 'check_violation';
  elsif p_to = 'failed' and v_note is null then
    raise exception '실패는 오류 요약이 필요합니다' using errcode = 'check_violation';
  end if;

  perform set_config('ltr.review_write', '1', true);
  update public.review_items set
    status = v_to,
    status_changed_at = now(),
    failed_from = case when p_to = 'failed' then r.status else null end,
    attempts = case when p_to = 'retry' then r.attempts + 1 else r.attempts end,
    last_error = case when p_to = 'failed' then left(v_note, 500) else last_error end,
    reject_reason = case when p_to = 'rejected' then v_note else reject_reason end,
    checked_keys = case when p_to = 'approved' then coalesce(p_checked, '{}') else checked_keys end,
    approved_parts = case when p_to = 'approved' then p_parts else approved_parts end,
    decided_by = case when p_to in ('approved', 'published', 'rejected') then p_actor else decided_by end,
    decided_at = case when p_to in ('approved', 'published', 'rejected') then now() else decided_at end
  where id = p_id
  returning * into r;
  perform set_config('ltr.review_write', '', true);

  insert into public.review_item_events (item_id, action, from_status, to_status, actor, note)
  values (p_id, v_action, v_from, r.status, p_actor, left(v_note, 500));
  return r;
end;
$$;

-- 담당자 배정 — 열린 항목만 (REV-03)
create function public.review_item_assign(p_id bigint, p_assignee text, p_actor text) returns public.review_items
language plpgsql
security definer
set search_path = ''
as $$
declare r public.review_items;
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 or length(btrim(coalesce(p_assignee, ''))) = 0 then
    raise exception '배정하는 사람과 담당자가 필요합니다' using errcode = 'check_violation';
  end if;
  select * into r from public.review_items where id = p_id for update;
  if not found then
    raise exception '검수 항목 %가 없습니다', p_id using errcode = 'no_data_found';
  end if;
  if r.status in ('published', 'rejected') then
    raise exception '끝난 항목에는 담당자를 배정할 수 없습니다 (현재 %)', r.status using errcode = 'check_violation';
  end if;
  perform set_config('ltr.review_write', '1', true);
  update public.review_items set assignee = btrim(p_assignee), assigned_at = now() where id = p_id returning * into r;
  perform set_config('ltr.review_write', '', true);
  insert into public.review_item_events (item_id, action, from_status, to_status, actor, note)
  values (p_id, 'assign', r.status, r.status, p_actor, left(btrim(p_assignee), 500));
  return r;
end;
$$;

-- 72시간 넘게 머문 열린 항목 (REV-03) — 기준 시각을 넘겨 시험한다. 71시간 59분 = 경고 0, 72시간 초과 = 경고
create function public.review_items_stale(p_at timestamptz default now())
returns table (id bigint, kind text, status text, assignee text, status_changed_at timestamptz, hours_open numeric)
language sql
stable
set search_path = ''
as $$
  select i.id, i.kind, i.status, i.assignee, i.status_changed_at,
         round(extract(epoch from (p_at - i.status_changed_at)) / 3600, 2)
    from public.review_items i
   where i.status in ('drafted', 'in_review', 'approved', 'failed')
     and p_at - i.status_changed_at > interval '72 hours'
   order by i.status_changed_at;
$$;

revoke all on function public.review_item_transition(bigint, text, text, text, text[], text[]) from public, anon, authenticated;
revoke all on function public.review_item_assign(bigint, text, text) from public, anon, authenticated;
revoke all on function public.review_items_stale(timestamptz) from public, anon, authenticated;
grant execute on function public.review_item_transition(bigint, text, text, text, text[], text[]) to service_role;
grant execute on function public.review_item_assign(bigint, text, text) to service_role;
grant execute on function public.review_items_stale(timestamptz) to service_role;

alter table public.review_items enable row level security;
alter table public.review_item_events enable row level security;
revoke all on table public.review_items, public.review_item_events from anon, authenticated, service_role;
grant select, insert on table public.review_items to service_role;   -- UPDATE는 열지 않는다 — 전이 함수가 한다
grant select, insert on table public.review_item_events to service_role;

-- ─────────────────────────────────────────────────────────────
-- raw_snapshots 확장 — 수집기 칸 (PIPE-07 · PIPE-08)
-- ─────────────────────────────────────────────────────────────
alter table public.raw_snapshots
  add column source_key text references public.data_sources (key),
  add column external_id text check (external_id is null or length(btrim(external_id)) > 0),
  add column run_id bigint references public.agent_runs (id),
  add column http_status int check (http_status is null or http_status between 100 and 599);

comment on column public.raw_snapshots.source_key is '수집기가 넣은 행의 원천 — 이 칸이 있는 행은 고치거나 지울 수 없다';
comment on column public.raw_snapshots.external_id is '원천의 문서 번호(법령ID·일련번호 등) — 같은 번호·같은 해시는 한 행';

-- 같은 원천·번호·해시의 응답은 한 행 (재수집이 행을 늘리지 않는다)
create unique index raw_snapshots_collector_once on public.raw_snapshots (source_key, external_id, content_hash) where source_key is not null;

-- 수집기 행은 추가만
create function public.raw_snapshots_collector_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source_key is not null then
    raise exception '수집기가 보관한 원문 스냅샷은 고치거나 지울 수 없습니다 (PIPE-07)' using errcode = 'insufficient_privilege';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.raw_snapshots_collector_guard() from public, anon, authenticated;
create trigger raw_snapshots_collector_guard before update or delete on public.raw_snapshots
  for each row execute function public.raw_snapshots_collector_guard();

-- 주소에 인증키 모양(OC·serviceKey·apikey 등)이 있는 새 행 거부 — 기존 행은 검사하지 않는다 (PIPE-08)
alter table public.raw_snapshots add constraint raw_snapshots_url_no_credential
  check (url !~* '[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key)=') not valid;
