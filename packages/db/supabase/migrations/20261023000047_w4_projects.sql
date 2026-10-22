-- W4 12단계 — 프로젝트 DB·가격 칸 검사 (PRD-01B PR-02 · PR-03 · PR-05, docs/dev/W4_설계.md 1장 12단계 · 2.1 · 2.2 · 2.10 · 3장 · 12장 #10·#19)
-- 이 파일에 실제 프로젝트·사업 유형·단계 이름·고시 번호는 없다 — 사업 유형·표준 단계 목록은 편집국 초안 + 세무·법률 감수 뒤 설정에 넣는다(12장 #10). 씨앗은 빈 값.
-- · 설정 project_types { "유형 키": { "label" } } · project_stage_lists { "유형 키": [{ "key", "label" }, …] — 배열 순서 = 단계 순서 }.
--     저장 검사(project_settings_guard): 모양 · 단계 목록의 유형은 project_types에 있어야 함 · 프로젝트가 쓰는 유형·단계 기록이 쓰는 단계는 뺄 수 없음.
-- · projects — 가격·분양가·분담금·수익률·시세 칸을 두지 않는다(PR-05 — 시험 tests/w4-price-fields.test.mjs가 2.10 사전으로 칸 이름·칸 설명을 본다).
--     지역 코드 = 오늘(KST) 유효한 regions 코드 · 사업 유형 = 단계 목록이 있는 유형 · 단계 기록이 생기면 유형을 바꾸지 못한다.
--     공개(status public)는 공개 단계 기록 1건 이상 + 데이터 출처(source_name)·정보 확인일(last_verified_at)이 있어야 한다.
-- · project_events — 추가만(고치기·지우기 0, W2-a 개정 트래커 방식). kind:
--     stage          단계 기록 — 고시 번호·고시일·고시 기관·원문 URL·원본 스냅샷·공공누리 유형이 모두 있어야 저장(제약 project_events_evidence)
--     not_applicable 이 프로젝트에 없는 단계 — 사유 필수, 현재 단계를 바꾸지 않는다
--     correction     정정 — 대상(correction_of)·사유 필수, 한 기록은 한 번만 정정(정정을 다시 고치려면 정정 기록을 정정). 단계가 있으면 바꿔 적는 기록(증거 필수), 단계가 없으면 거두기
--     같은 단계를 두 번 적거나 앞 순서로 돌아가는 단계 기록은 거부한다 — 잘못 적은 기록은 정정으로만 고친다.
--     메모(note)에 숫자 + 원·%가 있으면 저장 경고(raise warning — 차단 아님, PR-05 '가격 정보는 편집 승인을 거친 기사로만').
-- · 현재 단계 = 정정되지 않은 공개 단계 기록 가운데 단계 목록 순서가 가장 늦은 것 (뷰 project_current_stages — 저장하지 않는다).
-- · 원문 다시 받기(6단계 source_snapshot_refetched)가 같은 원문 주소를 쓴 단계 기록도 비교한다 — 해시가 다르면 검수 큐 1건(target_type project_event)
--     + 공개 단계 기록의 `검토 중`(public_project_events.under_review). 검수 큐 대상 검사가 단계 기록을 받는다(개발방법 사실 행은 18단계).
-- · 공개 읽기는 공개 뷰만 — public_projects · public_project_events (메모·사유·기록자·정정 관계·스냅샷 글자 0). 표·현재 단계 뷰는 service_role만.
-- · 기존 표·칸·제약·값은 바꾸지 않는다 (검수 큐의 대상 검사·다시 받기 함수만 같은 이름으로 바꿔 적는다).

-- ─────────────────────────────────────────────────────────────
-- 프로젝트
-- ─────────────────────────────────────────────────────────────
create table public.projects (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  region_code text not null references public.regions (code),
  project_type text not null check (project_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  landmark boolean not null default false,
  summary text,
  status text not null default 'draft' check (status in ('draft', 'public', 'hidden')),
  source_name text,
  last_verified_at timestamptz,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.projects is '프로젝트 트래커 (PR-02) — 가격·분양가·분담금·수익률·시세 칸 없음(PR-05, 시험 w4-price-fields). 현재 단계는 저장하지 않고 project_events에서 계산한다. 공개는 status=public + 공개 단계 기록 1건 이상';
comment on column public.projects.region_code is '지역 — 오늘(KST) 유효한 행정구역 코드만 (PR-02)';
comment on column public.projects.project_type is '사업 유형 키 — 설정 project_types에 있고 project_stage_lists에 단계 목록이 있는 유형';
comment on column public.projects.landmark is '지역을 대표하는 대형 개발 프로젝트 표시 (/realestate 랜드마크 카드)';
comment on column public.projects.source_name is '데이터 출처 줄의 출처 이름 — 공개 전 필수';
comment on column public.projects.last_verified_at is '정보 확인일 — 공개 전 필수';

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 단계 기록 (추가만)
-- ─────────────────────────────────────────────────────────────
create table public.project_events (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id),
  kind text not null check (kind in ('stage', 'not_applicable', 'correction')),
  stage text check (stage is null or stage ~ '^[a-z][a-z0-9_]{1,39}$'),
  notice_no text,
  notice_date date,
  issuer text,
  source_url text,
  snapshot_id bigint references public.raw_snapshots (id),
  license_type text check (license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  note text,
  correction_of bigint references public.project_events (id),
  reason text,
  public boolean not null default true,
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  constraint project_events_stage_required check (kind = 'correction' or stage is not null),
  constraint project_events_evidence check (
    stage is null or kind = 'not_applicable'
    or (length(btrim(coalesce(notice_no, ''))) > 0
        and notice_date is not null
        and length(btrim(coalesce(issuer, ''))) > 0
        and coalesce(source_url, '') ~* '^https?://[^[:space:]]+$'
        and snapshot_id is not null
        and license_type is not null)),
  constraint project_events_correction check ((kind = 'correction') = (correction_of is not null)),
  constraint project_events_reason check (kind = 'stage' or length(btrim(coalesce(reason, ''))) > 0)
);

comment on table public.project_events is '프로젝트 단계 기록 (PR-02 · PR-03) — 추가만. 단계 기록은 고시 번호·고시일·고시 기관·원문 URL·원본 스냅샷·공공누리 유형 필수, 같은 단계·앞 순서 거부, 정정은 correction_of + reason으로 한 번만. 가격 칸 없음(PR-05)';
comment on column public.project_events.stage is '단계 키 — 그 프로젝트 사업 유형의 단계 목록(project_stage_lists) 값만. 거두는 정정 기록은 비어 있다';
comment on column public.project_events.notice_no is '고시 번호 (PR-03)';
comment on column public.project_events.notice_date is '고시일 (PR-03)';
comment on column public.project_events.issuer is '고시 기관 (PR-03)';
comment on column public.project_events.source_url is '고시 원문 주소 — 공개 화면은 링크만(12장 #19)';
comment on column public.project_events.snapshot_id is '원본 스냅샷 — 글자는 어떤 공개 화면에도 그리지 않는다';
comment on column public.project_events.license_type is '원문의 공공누리 유형 (PR-07)';
comment on column public.project_events.note is '편집 메모 — 공개 뷰에 없다. 숫자와 원·% 표현은 저장 경고';
comment on column public.project_events.public is '공개 기록 — 현재 단계·공개 타임라인은 공개 기록만. 고치지 않는다(바꾸려면 정정)';

create index project_events_project_idx on public.project_events (project_id, recorded_at);
create index project_events_source_url_idx on public.project_events (source_url) where source_url is not null;
-- 한 기록은 한 번만 정정된다 (정정을 다시 고치려면 정정 기록을 정정한다)
create unique index project_events_one_correction on public.project_events (correction_of) where correction_of is not null;

-- 메모의 금액·비율 표현 — 숫자(쉼표·소수점) + 큰 수 낱말(조·억·천·백·만) + 원 또는 %. '원문'·'원본'의 원은 금액이 아니다.
-- 웹 규칙(apps/web/lib/admin/project-rules.ts NOTE_AMOUNT_RE)과 같은 식 — 시험이 같은 견본으로 둘을 본다
create function public.project_note_has_amount(p_note text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_note, '') ~ '[0-9][0-9,.]*([[:space:]]*(조|억|천|백|만))*[[:space:]]*(원(?!문|본)|%|％)';
$$;
revoke all on function public.project_note_has_amount(text) from public, anon, authenticated;
grant execute on function public.project_note_has_amount(text) to service_role;

-- 단계 목록 안 순서 (1부터, 목록 밖이면 null) — 트리거가 쓴다. 공개 뷰는 같은 식을 몸에 적는다(anon 실행 함수 0)
create function public.project_stage_position(p_lists jsonb, p_type text, p_stage text) returns integer
language sql
immutable
set search_path = ''
as $$
  select x.ord::integer
    from jsonb_array_elements(case when jsonb_typeof(p_lists -> p_type) = 'array' then p_lists -> p_type else '[]'::jsonb end)
         with ordinality as x(item, ord)
   where x.item ->> 'key' = p_stage
   limit 1;
$$;
revoke all on function public.project_stage_position(jsonb, text, text) from public, anon, authenticated;
grant execute on function public.project_stage_position(jsonb, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 + 저장 검사 — 2.2 project_types · project_stage_lists (빈 값 — 12장 #10)
-- ─────────────────────────────────────────────────────────────
create function public.project_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_key constant text := '^[a-z][a-z0-9_]{1,39}$';
  v_other jsonb;
  v_k text;
  v_v jsonb;
  v_item jsonb;
  v_keys text[];
  v_labels text[];
  v_used text;
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '%는 JSON 객체입니다 (빈 값은 {})', new.key using errcode = 'check_violation';
  end if;

  if new.key = 'project_types' then
    if (select count(*) from jsonb_object_keys(new.value)) > 30 then
      raise exception '사업 유형(project_types)은 30개까지입니다' using errcode = 'check_violation';
    end if;
    v_labels := '{}';
    for v_k, v_v in select e.key, e.value from jsonb_each(new.value) e loop
      if v_k !~ c_key then
        raise exception '사업 유형 키 %는 영문 소문자로 시작하는 영문 소문자·숫자·_ 2~40자입니다', v_k using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_v) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_v) k) is distinct from array['label']
         or jsonb_typeof(v_v -> 'label') is distinct from 'string'
         or length(btrim(v_v ->> 'label')) = 0 or length(v_v ->> 'label') > 40 then
        raise exception '사업 유형 %의 값은 { "label": "1~40자" }입니다', v_k using errcode = 'check_violation';
      end if;
      if btrim(v_v ->> 'label') = any (v_labels) then
        raise exception '사업 유형 글자 %가 두 번 있습니다', btrim(v_v ->> 'label') using errcode = 'check_violation';
      end if;
      v_labels := v_labels || btrim(v_v ->> 'label');
    end loop;
    select s.value into v_other from public.settings s where s.key = 'project_stage_lists';
    if jsonb_typeof(v_other) = 'object' then
      select k into v_used from jsonb_object_keys(v_other) k where not (new.value ? k) order by k limit 1;
      if v_used is not null then
        raise exception '단계 목록이 있는 사업 유형 %는 뺄 수 없습니다 — 먼저 project_stage_lists에서 빼세요', v_used using errcode = 'check_violation';
      end if;
    end if;
    select p.project_type into v_used from public.projects p where not (new.value ? p.project_type) order by p.id limit 1;
    if v_used is not null then
      raise exception '프로젝트가 쓰고 있는 사업 유형 %는 뺄 수 없습니다', v_used using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- project_stage_lists
  select s.value into v_other from public.settings s where s.key = 'project_types';
  for v_k, v_v in select e.key, e.value from jsonb_each(new.value) e loop
    if jsonb_typeof(v_other) is distinct from 'object' or not (v_other ? v_k) then
      raise exception '단계 목록의 사업 유형 %가 project_types에 없습니다 — 사업 유형을 먼저 넣으세요', v_k using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_v) is distinct from 'array' or jsonb_array_length(v_v) < 2 or jsonb_array_length(v_v) > 40 then
      raise exception '사업 유형 %의 단계 목록은 2~40단계 배열입니다 (첫 단계 … 마지막 단계 순서)', v_k using errcode = 'check_violation';
    end if;
    v_keys := '{}';
    v_labels := '{}';
    for v_item in select x.value from jsonb_array_elements(v_v) x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_item) k) is distinct from array['key', 'label']
         or jsonb_typeof(v_item -> 'key') is distinct from 'string' or (v_item ->> 'key') !~ c_key
         or jsonb_typeof(v_item -> 'label') is distinct from 'string'
         or length(btrim(v_item ->> 'label')) = 0 or length(v_item ->> 'label') > 40 then
        raise exception '사업 유형 %의 단계는 { "key": "영문 소문자·숫자·_ 2~40자", "label": "1~40자" }입니다', v_k using errcode = 'check_violation';
      end if;
      if (v_item ->> 'key') = any (v_keys) then
        raise exception '사업 유형 %의 단계 키 %가 두 번 있습니다', v_k, v_item ->> 'key' using errcode = 'check_violation';
      end if;
      if btrim(v_item ->> 'label') = any (v_labels) then
        raise exception '사업 유형 %의 단계 글자 %가 두 번 있습니다', v_k, btrim(v_item ->> 'label') using errcode = 'check_violation';
      end if;
      v_keys := v_keys || (v_item ->> 'key');
      v_labels := v_labels || btrim(v_item ->> 'label');
    end loop;
  end loop;
  select p.project_type into v_used from public.projects p where not (new.value ? p.project_type) order by p.id limit 1;
  if v_used is not null then
    raise exception '프로젝트가 쓰고 있는 사업 유형 %의 단계 목록은 뺄 수 없습니다', v_used using errcode = 'check_violation';
  end if;
  select p.project_type || ' · ' || e.stage into v_used
    from public.project_events e join public.projects p on p.id = e.project_id
   where e.stage is not null and public.project_stage_position(new.value, p.project_type, e.stage) is null
   order by e.id limit 1;
  if v_used is not null then
    raise exception '단계 기록이 쓰고 있는 단계(%)는 뺄 수 없습니다 — 단계 글자·순서는 바꿀 수 있습니다', v_used using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.project_settings_guard() from public, anon, authenticated;
create trigger settings_project_guard
  before insert or update on public.settings
  for each row when (new.key in ('project_types', 'project_stage_lists'))
  execute function public.project_settings_guard();

insert into public.settings (key, value, description, updated_by) values
  ('project_types', '{}'::jsonb,
   '프로젝트 사업 유형 (PR-02) — { "유형 키": { "label": "화면 글자" } }. 편집국 초안 + 세무·법률 감수 뒤 입력(W4 12장 #10). 비면 프로젝트를 만들 수 없다',
   'migration:20261023000047'),
  ('project_stage_lists', '{}'::jsonb,
   '사업 유형별 표준 단계 목록 (PR-02) — { "유형 키": [{ "key": "단계 키", "label": "화면 글자" }, …] }, 배열 순서 = 단계 순서(첫 단계 … 마지막 단계 [감수 필요]), 2~40단계. 단계 기록이 쓰는 단계는 뺄 수 없다',
   'migration:20261023000047')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 프로젝트 저장 검사 — 지역 코드 · 사업 유형 · 공개 조건
-- ─────────────────────────────────────────────────────────────
create function public.projects_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_region_changed boolean := tg_op = 'INSERT';
  v_type_changed boolean := tg_op = 'INSERT';
  v_publishing boolean := tg_op = 'INSERT' and new.status = 'public';
  v_types jsonb;
  v_lists jsonb;
begin
  if tg_op = 'UPDATE' then
    v_region_changed := new.region_code is distinct from old.region_code;
    v_type_changed := new.project_type is distinct from old.project_type;
    v_publishing := new.status = 'public' and old.status is distinct from 'public';
  end if;

  if v_region_changed and not exists (
    select 1 from public.regions r
     where r.code = new.region_code
       and (r.valid_from is null or r.valid_from <= v_today)
       and (r.valid_to is null or r.valid_to >= v_today)
  ) then
    raise exception '프로젝트 지역 코드 %는 오늘 유효한 행정구역(regions)이 아닙니다', new.region_code using errcode = 'check_violation';
  end if;

  if v_type_changed then
    if tg_op = 'UPDATE' and exists (select 1 from public.project_events e where e.project_id = new.id) then
      raise exception '단계 기록이 있는 프로젝트(%)는 사업 유형을 바꿀 수 없습니다', new.id using errcode = 'check_violation';
    end if;
    select s.value into v_types from public.settings s where s.key = 'project_types';
    select s.value into v_lists from public.settings s where s.key = 'project_stage_lists';
    if jsonb_typeof(v_types) is distinct from 'object' or not (v_types ? new.project_type)
       or jsonb_typeof(v_lists -> new.project_type) is distinct from 'array' or jsonb_array_length(v_lists -> new.project_type) = 0 then
      raise exception '사업 유형 %의 단계 목록이 없습니다 — 사업 유형·단계 목록(project_types·project_stage_lists)을 먼저 넣으세요 (편집국 초안 + 감수)', new.project_type
        using errcode = 'check_violation';
    end if;
  end if;

  if v_publishing then
    if not exists (
      select 1 from public.project_events e
       where e.project_id = new.id and e.public and e.stage is not null and e.kind <> 'not_applicable'
         and not exists (select 1 from public.project_events c where c.correction_of = e.id)
    ) then
      raise exception '공개 단계 기록이 0건인 프로젝트는 공개할 수 없습니다 (PR-02)' using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.source_name, ''))) = 0 or new.last_verified_at is null then
      raise exception '데이터 출처(source_name)와 정보 확인일(last_verified_at)이 있어야 공개합니다 (PR-02 데이터 출처 줄)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.projects_guard() from public, anon, authenticated;
create trigger projects_guard
  before insert or update on public.projects
  for each row execute function public.projects_guard();

-- ─────────────────────────────────────────────────────────────
-- 단계 기록 검사 — 목록 밖 단계 · 같은 단계 · 앞 순서 · 정정 대상 · 메모 경고
-- ─────────────────────────────────────────────────────────────
create function public.project_events_check() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_lists jsonb;
  v_pos integer;
  v_max integer;
  v_target public.project_events;
begin
  -- 같은 프로젝트에 동시에 들어오는 두 기록이 서로를 못 보는 일을 막는다
  perform pg_advisory_xact_lock(hashtextextended('project_events:' || new.project_id::text, 0));

  select p.project_type into v_type from public.projects p where p.id = new.project_id;
  if v_type is null then
    raise exception '프로젝트 %가 없습니다', new.project_id using errcode = 'foreign_key_violation';
  end if;
  select s.value into v_lists from public.settings s where s.key = 'project_stage_lists';

  if new.stage is not null then
    v_pos := public.project_stage_position(v_lists, v_type, new.stage);
    if v_pos is null then
      raise exception '단계 %는 사업 유형 %의 단계 목록(project_stage_lists)에 없습니다', new.stage, v_type using errcode = 'check_violation';
    end if;
  end if;

  if public.project_note_has_amount(new.note) then
    raise warning '단계 메모에 숫자 + 원·%% 표현이 있습니다 — 가격 정보는 편집 승인을 거친 기사로만 씁니다 (PR-05 저장 경고)';
  end if;

  if new.kind = 'correction' then
    select * into v_target from public.project_events e where e.id = new.correction_of;
    if v_target.id is null or v_target.project_id <> new.project_id then
      raise exception '정정 대상(%)은 같은 프로젝트의 기록이어야 합니다', new.correction_of using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.project_events c where c.correction_of = new.correction_of) then
      raise exception '이미 정정된 기록(%)입니다 — 정정은 한 번만, 다시 고치려면 정정 기록을 정정하세요', new.correction_of using errcode = 'check_violation';
    end if;
    if new.stage is not null and exists (
      select 1 from public.project_events e
       where e.project_id = new.project_id and e.stage = new.stage and e.id <> new.correction_of
         and not exists (select 1 from public.project_events c where c.correction_of = e.id)
    ) then
      raise exception '이미 기록된 단계입니다 (%) — 그 기록을 정정하세요', new.stage using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- 같은 단계가 이미 유효하게(정정되지 않은 채) 기록되어 있으면 거부 (해당 없음 기록 포함)
  if exists (
    select 1 from public.project_events e
     where e.project_id = new.project_id and e.stage = new.stage
       and not exists (select 1 from public.project_events c where c.correction_of = e.id)
  ) then
    raise exception '이미 기록된 단계입니다 (%) — 고치려면 정정 기록(correction_of·reason)을 쓰세요', new.stage using errcode = 'check_violation';
  end if;

  -- 앞 순서로 돌아가는 단계 기록 거부 (해당 없음 기록은 현재 단계를 바꾸지 않으므로 순서 검사에서 뺀다)
  if new.kind = 'stage' then
    select max(public.project_stage_position(v_lists, v_type, e.stage)) into v_max
      from public.project_events e
     where e.project_id = new.project_id and e.stage is not null and e.kind <> 'not_applicable'
       and not exists (select 1 from public.project_events c where c.correction_of = e.id);
    if v_max is not null and v_pos < v_max then
      raise exception '앞 순서 단계로 돌아가는 기록은 거부합니다 (현재 % → 새 기록 %) — 잘못된 기록은 정정 기록으로 고치세요',
        (v_lists -> v_type -> (v_max - 1)) ->> 'key', new.stage using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.project_events_check() from public, anon, authenticated;

create trigger project_events_check
  before insert on public.project_events
  for each row execute function public.project_events_check();

create trigger project_events_no_update_delete
  before update or delete on public.project_events
  for each row execute function public.append_only_guard();

create trigger project_events_no_truncate
  before truncate on public.project_events
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS — 표는 service_role만 (프로젝트는 전권, 단계 기록은 읽기·추가만)
-- ─────────────────────────────────────────────────────────────
alter table public.projects enable row level security;
revoke all on table public.projects from anon, authenticated, service_role;
grant select, insert, update, delete on table public.projects to service_role;

alter table public.project_events enable row level security;
revoke all on table public.project_events from anon, authenticated, service_role;
grant select, insert on table public.project_events to service_role;

-- ─────────────────────────────────────────────────────────────
-- 현재 단계 — 정정되지 않은 공개 단계 기록 가운데 단계 목록 순서가 가장 늦은 것 (service_role만)
-- ─────────────────────────────────────────────────────────────
create view public.project_current_stages as
select distinct on (e.project_id)
  e.project_id,
  e.stage as current_stage,
  l.pos as current_stage_position,
  l.label as current_stage_label,
  e.notice_date as current_stage_notice_date,
  e.id as event_id
from public.project_events e
join public.projects p on p.id = e.project_id
join public.settings s on s.key = 'project_stage_lists'
cross join lateral (
  select x.ord::integer as pos, x.item ->> 'label' as label
    from jsonb_array_elements(case when jsonb_typeof(s.value -> p.project_type) = 'array' then s.value -> p.project_type else '[]'::jsonb end)
         with ordinality as x(item, ord)
   where x.item ->> 'key' = e.stage
) l
where e.public and e.stage is not null and e.kind <> 'not_applicable'
  and not exists (select 1 from public.project_events c where c.correction_of = e.id)
order by e.project_id, l.pos desc, e.recorded_at desc, e.id desc;

comment on view public.project_current_stages is '프로젝트별 현재 단계 (PR-02 — 정정되지 않은 공개 단계 기록 중 단계 목록 순서가 가장 늦은 것, 목록 순서를 바꾸면 다음 읽기부터). service_role만';
revoke all on table public.project_current_stages from public, anon, authenticated, service_role;
grant select on table public.project_current_stages to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 공개 프로젝트(공개 단계 기록 1건 이상)의 공개 칸 · 공개 단계 기록(링크만 — 스냅샷 글자 0)
-- ─────────────────────────────────────────────────────────────
create view public.public_projects as
select
  p.id,
  p.slug,
  p.name,
  p.region_code,
  p.project_type,
  t.value -> p.project_type ->> 'label' as project_type_label,
  p.landmark,
  p.summary,
  p.source_name,
  p.last_verified_at,
  c.current_stage,
  c.current_stage_label,
  c.current_stage_position,
  c.current_stage_notice_date
from public.projects p
join public.project_current_stages c on c.project_id = p.id
left join public.settings t on t.key = 'project_types'
where p.status = 'public';

comment on view public.public_projects is '공개 프로젝트 (PR-02) — status=public + 공개 단계 기록 1건 이상. 기록자·내부 칸 0';
revoke all on table public.public_projects from public, anon, authenticated, service_role;
grant select on table public.public_projects to anon, authenticated, service_role;

create view public.public_project_events as
select
  e.id,
  e.project_id,
  case when e.kind = 'not_applicable' then 'not_applicable' else 'stage' end as kind,
  e.stage,
  l.label as stage_label,
  l.pos as stage_position,
  e.notice_no,
  e.notice_date,
  e.issuer,
  e.source_url,
  e.license_type,
  r.fetched_at as verified_at,
  exists (
    select 1 from public.source_review_queue q
     where q.target_type = 'project_event' and q.target_id = e.id and q.status = 'open'
  ) as under_review,
  e.recorded_at
from public.project_events e
join public.public_projects pp on pp.id = e.project_id
join public.projects p on p.id = e.project_id
join public.settings s on s.key = 'project_stage_lists'
cross join lateral (
  select x.ord::integer as pos, x.item ->> 'label' as label
    from jsonb_array_elements(case when jsonb_typeof(s.value -> p.project_type) = 'array' then s.value -> p.project_type else '[]'::jsonb end)
         with ordinality as x(item, ord)
   where x.item ->> 'key' = e.stage
) l
left join public.raw_snapshots r on r.id = e.snapshot_id
where e.public and e.stage is not null
  and not exists (select 1 from public.project_events c where c.correction_of = e.id);

comment on view public.public_project_events is '공개 프로젝트의 단계 타임라인 (PR-02 · PR-03) — 정정되지 않은 공개 기록만. verified_at = 원본 스냅샷을 받은 시각(확인일), under_review = 원문 검수 중. 메모·사유·기록자·스냅샷 글자 0';
revoke all on table public.public_project_events from public, anon, authenticated, service_role;
grant select on table public.public_project_events to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 검수 큐(6단계 …42) — 대상 검사가 단계 기록을 받는다 (개발방법 사실 행은 18단계)
-- ─────────────────────────────────────────────────────────────
create or replace function public.source_review_target_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.article_sources;
  v_ev public.project_events;
begin
  if new.target_type = 'article_source' then
    select * into v_src from public.article_sources where id = new.target_id;
    if v_src.id is null then
      raise exception '검수 대상 출처 src:%가 없습니다', new.target_id using errcode = 'foreign_key_violation';
    end if;
    if v_src.kind not in ('official_doc', 'dataset') then
      raise exception '검수 큐에는 공식 자료(official_doc·dataset) 출처만 올립니다 (src:% 는 %)', new.target_id, v_src.kind using errcode = 'check_violation';
    end if;
    if new.article_id is distinct from v_src.article_id then
      raise exception '검수 항목의 기사 번호(%)가 출처 src:%의 기사(%)와 다릅니다', new.article_id, new.target_id, v_src.article_id using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'project_event' then
    select * into v_ev from public.project_events where id = new.target_id;
    if v_ev.id is null then
      raise exception '검수 대상 단계 기록 pe:%가 없습니다', new.target_id using errcode = 'foreign_key_violation';
    end if;
    if v_ev.snapshot_id is null then
      raise exception '검수 큐에는 원본 스냅샷이 있는 단계 기록만 올립니다 (pe:%)', new.target_id using errcode = 'check_violation';
    end if;
    if new.article_id is not null then
      raise exception '단계 기록 검수 항목(pe:%)에는 기사 번호를 넣지 않습니다', new.target_id using errcode = 'check_violation';
    end if;
  else
    raise exception '검수 대상 %는 아직 받지 않습니다 — 개발방법 사실 행(18단계)이 표를 만든 뒤 엽니다', new.target_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_review_target_guard() from public, anon, authenticated;

-- 원문 다시 받기 — 같은 주소를 쓴 공식 자료(기사)와 단계 기록(프로젝트)을 함께 비교한다. 결과 칸 targets·opened·unchanged·alreadyQueued·noSnapshot은 공식 자료(6단계 그대로),
-- projectTargets·projectOpened·projectUnchanged·projectAlreadyQueued는 단계 기록(정정되지 않은 단계 기록 — 공개·비공개, 초안 프로젝트 포함)
create or replace function public.source_snapshot_refetched(p_url text, p_hash text, p_payload text, p_source text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_hash text := lower(btrim(coalesce(p_hash, '')));
  v_snap bigint;
  v_row record;
  v_rc integer;
  v_targets integer := 0;
  v_opened integer := 0;
  v_same integer := 0;
  v_already integer := 0;
  v_nosnap integer := 0;
  v_p_targets integer := 0;
  v_p_opened integer := 0;
  v_p_same integer := 0;
  v_p_already integer := 0;
begin
  if v_url !~* '^https?://[^[:space:]]+$' then
    raise exception '원문 주소는 http(s) 주소입니다' using errcode = 'check_violation';
  end if;
  if v_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception '원문 해시는 sha256:<64자리>입니다' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '원문을 다시 받은 사람이 필요합니다' using errcode = 'check_violation';
  end if;

  select s.id into v_snap from public.raw_snapshots s where s.url = v_url and lower(s.content_hash) = v_hash order by s.fetched_at desc, s.id desc limit 1;
  if v_snap is null then
    insert into public.raw_snapshots (source, url, content_hash, payload)
    values (coalesce(nullif(btrim(p_source), ''), '공식 자료 다시 받기'), v_url, v_hash, coalesce(p_payload, ''))
    returning id into v_snap;
  end if;

  for v_row in
    select s.id, s.article_id, r.content_hash as old_hash
      from public.article_sources s
      join public.articles a on a.id = s.article_id
      left join public.raw_snapshots r on r.id = s.snapshot_id
     where s.kind in ('official_doc', 'dataset')
       and btrim(coalesce(s.source_url, '')) = v_url
       and a.status <> 'deleted'
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
     order by s.id
  loop
    v_targets := v_targets + 1;
    if v_row.old_hash is null then
      v_nosnap := v_nosnap + 1;
    elsif regexp_replace(lower(v_row.old_hash), '^sha256:', '') = regexp_replace(v_hash, '^sha256:', '') then
      v_same := v_same + 1;
    else
      insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by)
      values ('article_source', v_row.id, v_row.article_id, 'snapshot_changed', v_row.old_hash, v_hash, v_snap, btrim(p_actor))
      on conflict do nothing;
      get diagnostics v_rc = row_count;
      if v_rc > 0 then v_opened := v_opened + 1; else v_already := v_already + 1; end if;
    end if;
  end loop;

  -- 프로젝트 단계 기록 (W4 12단계 — PR-03 '원본을 다시 받아 스냅샷 해시가 다르면 검수 큐 1건과 해당 단계 검토 중')
  for v_row in
    select e.id, r.content_hash as old_hash
      from public.project_events e
      join public.raw_snapshots r on r.id = e.snapshot_id
     where e.stage is not null and e.kind <> 'not_applicable'
       and btrim(coalesce(e.source_url, '')) = v_url
       and not exists (select 1 from public.project_events c where c.correction_of = e.id)
     order by e.id
  loop
    v_p_targets := v_p_targets + 1;
    if regexp_replace(lower(v_row.old_hash), '^sha256:', '') = regexp_replace(v_hash, '^sha256:', '') then
      v_p_same := v_p_same + 1;
    else
      insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by)
      values ('project_event', v_row.id, null, 'snapshot_changed', v_row.old_hash, v_hash, v_snap, btrim(p_actor))
      on conflict do nothing;
      get diagnostics v_rc = row_count;
      if v_rc > 0 then v_p_opened := v_p_opened + 1; else v_p_already := v_p_already + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('snapshotId', v_snap, 'targets', v_targets, 'opened', v_opened, 'unchanged', v_same, 'alreadyQueued', v_already, 'noSnapshot', v_nosnap,
    'projectTargets', v_p_targets, 'projectOpened', v_p_opened, 'projectUnchanged', v_p_same, 'projectAlreadyQueued', v_p_already);
end;
$$;
revoke all on function public.source_snapshot_refetched(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.source_snapshot_refetched(text, text, text, text, text) to service_role;
