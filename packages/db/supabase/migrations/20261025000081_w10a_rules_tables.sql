-- W10-a a3 (1/3) - 룰셋 · 판정표 · 지방세 달력 · 감사 (PRD-02 RULE-01~04 · TX-05, docs/dev/2단계_설계.md 3장, docs/dev/W10-a_설계.md 11.2)
-- · 세 표(rulesets · determination_tables · tax_calendar)는 같은 생애를 가진다: draft(초안) -> reviewed(감수 서명) -> active(관리자 승인) -> retired.
--   내용(body)·버전·근거는 만든 뒤 바꾸지 못한다 (덮어쓰기 금지 - 고치려면 차수를 올려 새 행). 상태 전이는 83번의 sign_*/approve_* 함수로만 일어난다.
--   service_role도 직접 UPDATE 권한이 없고, 트리거가 함수 밖의 상태 변경을 한 번 더 막는다 (스크립트로 활성화하는 경로 0 - RULE-02).
-- · 룰셋 본문은 국세 구역이 없다 - 최상위 칸 목록(허용 칸만)과 국세 낱말 검사를 트리거가 한다.
-- · 이 파일의 값은 틀·검사뿐이다. 세율·한도·법령 문장·달력 날짜는 없고, 씨앗 0행.
-- · rules_audit는 추가만 - 서명·승인 성공도 거부도 1행 (RULE-03). law_event_id는 W10-c 법령 표(87번)가 생기기 전이라 연결 칸만 둔다.

-- 서명자 확인 - 세무 감수위원(reviewer) 역할이 있는 사용자인가 (app 권한 ruleset.sign과 같은 기준)
create function public.rules_is_reviewer(p_actor text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.staff_roles r
                  where r.user_id = substring(p_actor from 6)::uuid and r.role = 'reviewer');
$$;
revoke all on function public.rules_is_reviewer(text) from public, anon, authenticated;
grant execute on function public.rules_is_reviewer(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 세 표 공통 칸 (표마다 반복 - 상속 없이 단순하게)
-- ─────────────────────────────────────────────────────────────
create table public.rulesets (
  id bigint generated always as identity primary key,
  version text not null unique check (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'active', 'retired')),
  body jsonb not null check (jsonb_typeof(body) = 'object'
    and (body - array['version', 'status', 'effective_from', 'source_laws', 'acquisition', 'holding', 'oligopoly']) = '{}'::jsonb),
  body_sha256 text not null,
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 200),
  basis_event_id bigint references public.amendment_events (id),
  basis_note text check (basis_note is null or char_length(basis_note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  activated_by text,
  activated_at timestamptz,
  retired_at timestamptz,
  constraint rulesets_basis_given check (basis_event_id is not null or char_length(btrim(coalesce(basis_note, ''))) > 0),
  constraint rulesets_signed_record check (
    status not in ('reviewed', 'active')
    or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint rulesets_active_record check (status <> 'active' or (activated_by is not null and activated_at is not null)),
  constraint rulesets_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and activated_by is null and activated_at is null))
);
comment on table public.rulesets is '룰셋 버전 (RULE-01~04) - draft -> reviewed(감수 서명) -> active(관리자 승인). 본문 불변. 활성 1행. 국세 구역 없음. 값은 SM이 가진 AI 작성·미감수 값이라 감수 서명 전에는 draft';
create unique index rulesets_one_active on public.rulesets ((true)) where status = 'active';

create table public.determination_tables (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('refund', 'reduction')),
  version text not null check (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'active', 'retired')),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  body_sha256 text not null,
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 200),
  basis_event_id bigint references public.amendment_events (id),
  basis_note text check (basis_note is null or char_length(basis_note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  activated_by text,
  activated_at timestamptz,
  retired_at timestamptz,
  unique (kind, version),
  constraint determination_tables_basis_given check (basis_event_id is not null or char_length(btrim(coalesce(basis_note, ''))) > 0),
  constraint determination_tables_signed_record check (
    status not in ('reviewed', 'active')
    or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint determination_tables_active_record check (status <> 'active' or (activated_by is not null and activated_at is not null)),
  constraint determination_tables_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and activated_by is null and activated_at is null))
);
comment on table public.determination_tables is '판정표 (CALC-04 환급 · CALC-13 감면) - 룰셋과 같은 생애. 판정표 내용(요건·한도·기간)은 감수 입력이라 AI가 쓰지 않는다. 종류마다 활성 1행';
create unique index determination_tables_one_active on public.determination_tables (kind) where status = 'active';

create table public.tax_calendar (
  id bigint generated always as identity primary key,
  version text not null unique check (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'active', 'retired')),
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  body_sha256 text not null,
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 200),
  basis_event_id bigint references public.amendment_events (id),
  basis_note text check (basis_note is null or char_length(basis_note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  activated_by text,
  activated_at timestamptz,
  retired_at timestamptz,
  constraint tax_calendar_basis_given check (basis_event_id is not null or char_length(btrim(coalesce(basis_note, ''))) > 0),
  constraint tax_calendar_signed_record check (
    status not in ('reviewed', 'active')
    or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint tax_calendar_active_record check (status <> 'active' or (activated_by is not null and activated_at is not null)),
  constraint tax_calendar_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and activated_by is null and activated_at is null))
);
comment on table public.tax_calendar is '지방세 달력 (CALC-16, P1) - 룰셋과 같은 생애. 날짜는 편집자 작성 + 감수 서명, AI가 쓰지 않는다. 활성 1행';
create unique index tax_calendar_one_active on public.tax_calendar ((true)) where status = 'active';

-- ─────────────────────────────────────────────────────────────
-- 공통 트리거 - 만들 때는 항상 초안 + 본문 해시 계산 + 국세 낱말 거부, 만든 뒤 본문·버전·근거 불변, 상태 전이는 함수 안에서만
-- ─────────────────────────────────────────────────────────────
create function public.rule_versions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '룰셋·판정표·달력은 초안(draft)으로만 만들 수 있습니다 - 활성화는 감수 서명 뒤 approve 함수로만 합니다 (RULE-02)' using errcode = 'check_violation';
    end if;
    -- 국세 구역 0: 본문 글자에 국세 세목 낱말이 있으면 거부 (PRD-00 원칙 17·18)
    if new.body::text ~ '(상속|증여|양도)세|양도소득|inheritance_?tax|gift_?tax|transfer_?(tax|income)|capital_?gain' then
      raise exception '본문에 국세 세목 낱말이 있어 저장할 수 없습니다 - 이 사이트는 국세 금액을 만들지 않습니다 (원칙 4)' using errcode = 'check_violation';
    end if;
    new.body_sha256 := encode(sha256(convert_to(new.body::text, 'UTF8')), 'hex');
    return new;
  end if;
  if new.version is distinct from old.version or new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.source_ref is distinct from old.source_ref or new.basis_event_id is distinct from old.basis_event_id
     or new.basis_note is distinct from old.basis_note or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception '버전·본문·근거는 고칠 수 없습니다 - 차수를 올려 새 행으로 만드세요 (RULE-01)' using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'determination_tables' then
    if new.kind is distinct from old.kind then
      raise exception '판정표 종류는 고칠 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.status is distinct from old.status or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at
     or new.activated_by is distinct from old.activated_by or new.activated_at is distinct from old.activated_at then
    if coalesce(current_setting('ltr.rules_gate', true), '') <> 'rpc' then
      raise exception '서명·활성화 상태는 sign_*/approve_* 함수로만 바뀝니다 (RULE-02)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.rule_versions_guard() from public, anon, authenticated;
create trigger rulesets_guard before insert or update on public.rulesets for each row execute function public.rule_versions_guard();
create trigger determination_tables_guard before insert or update on public.determination_tables for each row execute function public.rule_versions_guard();
create trigger tax_calendar_guard before insert or update on public.tax_calendar for each row execute function public.rule_versions_guard();

-- 삭제·비우기 거부 (버전은 남긴다)
create function public.rule_versions_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '룰셋·판정표·달력 버전은 지우지 못합니다 (% 거부) - 내리려면 retired로 바꿉니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.rule_versions_no_delete() from public, anon, authenticated;
create trigger rulesets_no_delete before delete on public.rulesets for each row execute function public.rule_versions_no_delete();
create trigger determination_tables_no_delete before delete on public.determination_tables for each row execute function public.rule_versions_no_delete();
create trigger tax_calendar_no_delete before delete on public.tax_calendar for each row execute function public.rule_versions_no_delete();
create trigger rulesets_no_truncate before truncate on public.rulesets for each statement execute function public.rule_versions_no_delete();
create trigger determination_tables_no_truncate before truncate on public.determination_tables for each statement execute function public.rule_versions_no_delete();
create trigger tax_calendar_no_truncate before truncate on public.tax_calendar for each statement execute function public.rule_versions_no_delete();

-- ─────────────────────────────────────────────────────────────
-- 감사 - 추가만 (RULE-03). 성공도 거부도 1행
-- ─────────────────────────────────────────────────────────────
create table public.rules_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('ruleset', 'determination_table', 'tax_calendar')),
  target_id bigint not null,
  version text,
  action text not null check (action in ('sign', 'approve')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  basis_event_id bigint references public.amendment_events (id),
  -- O1 개정 감지(W10-c law_events) 연결 - 표가 87번에서 생기므로 지금은 번호만 (외래키는 87 이후 단위가 더한다)
  law_event_id bigint,
  impact jsonb,
  detail text check (detail is null or char_length(detail) <= 500),
  constraint rules_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.rules_audit is '룰셋·판정표·달력 서명·승인 감사 (RULE-03) - 추가만. 거부도 1행(code가 사유). 개정 근거는 amendment_events/law_events ID로 연결';
create index rules_audit_target_idx on public.rules_audit (kind, target_id, at desc);

create function public.rules_audit_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'rules_audit는 추가만 할 수 있습니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.rules_audit_append_only() from public, anon, authenticated;
create trigger rules_audit_no_update_delete before update or delete on public.rules_audit for each row execute function public.rules_audit_append_only();
create trigger rules_audit_no_truncate before truncate on public.rules_audit for each statement execute function public.rules_audit_append_only();

-- ─────────────────────────────────────────────────────────────
-- 권한 - 서버(service_role)는 읽기와 초안 추가만. 수정은 함수(83번)만
-- ─────────────────────────────────────────────────────────────
alter table public.rulesets enable row level security;
alter table public.determination_tables enable row level security;
alter table public.tax_calendar enable row level security;
alter table public.rules_audit enable row level security;
revoke all on table public.rulesets, public.determination_tables, public.tax_calendar, public.rules_audit from anon, authenticated, service_role;
grant select, insert on table public.rulesets, public.determination_tables, public.tax_calendar, public.rules_audit to service_role;
