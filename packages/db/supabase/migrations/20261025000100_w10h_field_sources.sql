-- W10-h 2단계 — 분야 데이터 연동: 원천 칸 · 후보 승인 검사 (PRD-02 PR-06 · LG-15 · DF-06, docs/dev/W10-h_설계.md)
-- 이 파일에 실제 이용 조건·공공누리 문구·법령·세무 문장, 세율·기한 값은 없다 — 표·칸·검사 규칙만 만든다. 원천 7행은 모두 이용 조건 미확인(unchecked)으로 시작한다.
-- · data_sources — 분야 데이터 원천 7행 씨앗 (모두 unchecked → 수집 불가, 후보 생성도 DB가 막는다)
-- · 원천 칸 — project_events · supply_notices · local_events · finance_indicators · finance_regulations 에 원천 키 · 원천 항목 번호 · 값 해시(세 칸은 함께 있거나 함께 없다).
--     (원천 키, 원천 항목 번호, 값 해시)는 유일 → 같은 원천 항목의 같은 값은 두 번 공개되지 않는다 (원천 ID 멱등).
-- · local_events — 공공누리 유형 · 이미지 URL · 이미지 권리(권리 확인이 없으면 이미지 URL 자체를 저장하지 않는다) + 공개 뷰에 유형·이미지 칸 추가
-- · project_source_links — 프로젝트와 원천 항목의 연결(편집자 입력). 어댑터가 프로젝트 번호를 지어내지 않는다
-- · field_candidate_checks(제4유형 유사도 통과 기록, 추가만) · field_publications(공개 반영 기록, 추가만)
-- · field_candidate_problem() — 후보 모양·필수 칸·허용 칸·개인정보 패턴 검사. 검수 항목이 approved 가 될 때 트리거가 부르고, 문제가 있으면 승인이 거부된다
-- · 후보 생성 검사 — 검수 항목 종류 field_data 는 data_source_runnable 인 원천에서만 만들어진다 (미확인 원천 실행 0)
-- 가격·분양가·분담금·수익률·시세 칸 0 (PR-05) — 새 칸 이름과 칸 설명에 가격 사전 낱말을 쓰지 않는다. 기존 표 칸·제약·값은 바꾸지 않는다 (뷰 public_local_events 는 칸 끝에 더하기만)

-- ─────────────────────────────────────────────────────────────
-- 원천 씨앗 (모두 unchecked)
-- ─────────────────────────────────────────────────────────────
insert into public.data_sources (key, name, kind, api_target, priority) values
  ('applyhome_supply', '청약홈 분양정보', 'field_data', null, 'p1'),
  ('buildinghub_permit', '건축HUB 인허가', 'field_data', null, 'p1'),
  ('seoul_cleanup', '서울시 정비사업 정보', 'field_data', null, 'p1'),
  ('festival_data', '축제·행사 표준데이터', 'field_data', null, 'p1'),
  ('fin_authority_release', '금융당국 발표(보도자료)', 'field_data', null, 'p1'),
  ('dart_disclosure', 'DART 공시', 'field_data', null, 'p1'),
  ('pf_integrated_info', 'PF 통합정보 공개분', 'field_data', null, 'p1')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 원천 칸 — 대상 표 5개
-- ─────────────────────────────────────────────────────────────
alter table public.project_events
  add column source_key text references public.data_sources (key),
  add column source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  add column source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  add constraint project_events_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null));
create unique index project_events_source_once on public.project_events (source_key, source_item_id, source_value_hash) where source_key is not null;
comment on column public.project_events.source_key is '연동 원천 키 — 수집 후보를 승인해 넣은 기록에만 있다 (PR-06)';
comment on column public.project_events.source_item_id is '원천의 항목 번호 — 같은 번호·같은 값 해시는 한 행 (원천 ID 멱등)';
comment on column public.project_events.source_value_hash is '후보 값의 해시(sha256 16진) — 값이 바뀌면 새 후보·정정 기록';

alter table public.supply_notices
  add column source_key text references public.data_sources (key),
  add column source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  add column source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  add constraint supply_notices_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null));
create unique index supply_notices_source_once on public.supply_notices (source_key, source_item_id) where source_key is not null;
comment on column public.supply_notices.source_key is '연동 원천 키 — 수집 후보를 승인해 넣은 항목에만 있다 (PR-06)';
comment on column public.supply_notices.source_item_id is '원천의 항목 번호 — 한 항목은 한 행';
comment on column public.supply_notices.source_value_hash is '마지막으로 승인한 후보 값의 해시 — 같은 값을 다시 승인해도 바뀌지 않는다';

alter table public.local_events
  add column source_key text references public.data_sources (key),
  add column source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  add column source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  add column license_type text check (license_type is null or license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  add column image_url text check (image_url is null or image_url ~* '^https://[^[:space:]]+$'),
  add column image_rights text not null default 'unconfirmed' check (image_rights in ('confirmed', 'unconfirmed')),
  add constraint local_events_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null)),
  add constraint local_events_source_license check (source_key is null or license_type is not null),
  add constraint local_events_image_rights check (image_url is null or image_rights = 'confirmed');
create unique index local_events_source_once on public.local_events (source_key, source_item_id) where source_key is not null;
comment on column public.local_events.license_type is '원천 자료의 공공누리 유형 (LG-15) — 연동 항목은 필수';
comment on column public.local_events.image_url is '행사 이미지 주소 — 권리가 확인된 것만 저장한다 (LG-15, 미확인이면 비워 둔다)';
comment on column public.local_events.image_rights is '이미지 권리 확인 여부 — confirmed 가 아니면 이미지 주소를 저장하지 않는다';

alter table public.finance_indicators
  add column source_key text references public.data_sources (key),
  add column source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  add column source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  add column released_on date,
  add column license_type text check (license_type is null or license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  add constraint finance_indicators_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null)),
  add constraint finance_indicators_source_record check (source_key is null or (released_on is not null and license_type is not null));
create unique index finance_indicators_source_once on public.finance_indicators (source_key, source_item_id, source_value_hash) where source_key is not null;
comment on column public.finance_indicators.released_on is '발표·공시일 (DF-06) — 연동 항목은 필수';
comment on column public.finance_indicators.license_type is '원천 자료의 공공누리 유형 — 연동 항목은 필수';

alter table public.finance_regulations
  add column source_key text references public.data_sources (key),
  add column source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  add column source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  add column released_on date,
  add column as_of date,
  add column license_type text check (license_type is null or license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  add constraint finance_regulations_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null)),
  add constraint finance_regulations_source_record check (source_key is null or (released_on is not null and as_of is not null and license_type is not null));
create unique index finance_regulations_source_once on public.finance_regulations (source_key, source_item_id, source_value_hash) where source_key is not null;
comment on column public.finance_regulations.released_on is '발표·공시일 (DF-06) — 연동 항목은 필수';
comment on column public.finance_regulations.as_of is '기준일 (DF-06) — 연동 항목은 필수';
comment on column public.finance_regulations.license_type is '원천 자료의 공공누리 유형 — 연동 항목은 필수';

-- 원문 스냅샷 주소에 다른 이름의 인증키 모양이 있으면 새 행 거부 (W10-c 검사에 이름을 더함 — 기존 제약은 그대로)
alter table public.raw_snapshots add constraint raw_snapshots_url_no_field_credential
  check (url !~* '[?&;](crtfc_key|cert_?key|service_?key|secret|token)=') not valid;

-- ─────────────────────────────────────────────────────────────
-- 프로젝트 ↔ 원천 항목 연결 (편집자 입력)
-- ─────────────────────────────────────────────────────────────
create table public.project_source_links (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id),
  source_key text not null references public.data_sources (key),
  source_item_id text not null check (length(btrim(source_item_id)) between 1 and 200),
  linked_by text not null check (length(btrim(linked_by)) > 0),
  linked_at timestamptz not null default now(),
  constraint project_source_links_once unique (source_key, source_item_id)
);
comment on table public.project_source_links is '프로젝트와 원천 항목의 연결 (PR-06) — 편집자가 입력. 연결이 없는 원천 항목은 단계 후보를 만들지 않는다';
alter table public.project_source_links enable row level security;
revoke all on table public.project_source_links from anon, authenticated, service_role;
grant select, insert, delete on table public.project_source_links to service_role;

-- ─────────────────────────────────────────────────────────────
-- 제4유형 유사도 통과 기록 · 공개 반영 기록 (추가만)
-- ─────────────────────────────────────────────────────────────
create table public.field_candidate_checks (
  id bigint generated always as identity primary key,
  review_item_id bigint not null references public.review_items (id),
  kind text not null check (kind in ('similarity')),
  status text not null check (status in ('pass', 'blocked', 'no_sources', 'no_body')),
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  max_similarity numeric check (max_similarity is null or max_similarity between 0 and 1),
  similar_ratio numeric check (similar_ratio is null or similar_ratio between 0 and 1),
  rules_version text not null check (length(btrim(rules_version)) > 0),
  checked_by text not null check (length(btrim(checked_by)) > 0),
  checked_at timestamptz not null default now()
);
comment on table public.field_candidate_checks is '제4유형 후보의 공개 본문 유사도 검사 기록 (PR-06) — 추가만. 본문 해시가 공개 때 계산한 해시와 같고 상태가 pass 여야 공개 반영';
create index field_candidate_checks_item_idx on public.field_candidate_checks (review_item_id, id desc);
create trigger field_candidate_checks_append_only before update or delete on public.field_candidate_checks
  for each row execute function public.append_only_guard();
create trigger field_candidate_checks_no_truncate before truncate on public.field_candidate_checks
  for each statement execute function public.append_only_guard();

create table public.field_publications (
  id bigint generated always as identity primary key,
  review_item_id bigint not null references public.review_items (id),
  target text not null check (target in ('project_stage', 'supply_notice', 'local_event', 'finance_indicator', 'finance_regulation', 'finance_case_entry')),
  target_id bigint,
  source_key text not null references public.data_sources (key),
  source_item_id text not null,
  value_hash text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('created', 'updated', 'corrected', 'unchanged')),
  published_by text not null check (length(btrim(published_by)) > 0),
  published_at timestamptz not null default now(),
  constraint field_publications_once unique (review_item_id)
);
comment on table public.field_publications is '분야 데이터 공개 반영 기록 (W10-h) — 추가만. 검수 항목 하나는 한 번만 반영된다';
create trigger field_publications_append_only before update or delete on public.field_publications
  for each row execute function public.append_only_guard();
create trigger field_publications_no_truncate before truncate on public.field_publications
  for each statement execute function public.append_only_guard();

alter table public.field_candidate_checks enable row level security;
alter table public.field_publications enable row level security;
revoke all on table public.field_candidate_checks, public.field_publications from anon, authenticated, service_role;
grant select, insert on table public.field_candidate_checks, public.field_publications to service_role;

-- ─────────────────────────────────────────────────────────────
-- 후보 모양 — 대상별 필수·허용 칸 (허용 칸 밖의 키는 승인 거부 → 가격류 칸이 실려 올 수 없다)
-- ─────────────────────────────────────────────────────────────
create function public.field_target_spec(p_target text) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_target
    when 'project_stage' then '{"required": ["project_slug", "stage", "notice_no", "notice_date", "issuer", "source_url"], "optional": []}'::jsonb
    when 'supply_notice' then '{"required": ["name", "region_code", "supply_scale", "apply_start", "apply_end", "notice_date", "notice_issuer", "official_notice_url"], "optional": ["project_slug"]}'::jsonb
    when 'local_event' then '{"required": ["slug", "series_key", "title", "category", "organizer", "organizer_type", "venue", "region_code", "starts_at", "ends_at", "official_url", "sponsored"], "optional": ["status", "status_source_url", "image_url", "image_rights"]}'::jsonb
    when 'finance_indicator' then '{"required": ["indicator_key", "label", "definition", "value", "unit", "as_of", "released_on", "provider", "source_url"], "optional": []}'::jsonb
    when 'finance_regulation' then '{"required": ["reg_key", "title", "stage", "effective_on", "as_of", "released_on", "provider", "source_url"], "optional": []}'::jsonb
    when 'finance_case_entry' then '{"required": ["slug", "title", "structure_type", "issues", "outcome", "as_of", "released_on", "sources"], "optional": ["companies", "judgment_quoted", "anonymized_checked"]}'::jsonb
  end;
$$;
revoke all on function public.field_target_spec(text) from public, anon, authenticated;
grant execute on function public.field_target_spec(text) to service_role;

-- 공개 본문(글자) — 제4유형 유사도 검사 대상. 구조화 칸만 공개하는 대상은 null
create function public.field_body_text(p_payload jsonb) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_payload ->> 'target'
    when 'finance_indicator' then nullif(btrim(coalesce(p_payload #>> '{fields,definition}', '')), '')
    when 'finance_case_entry' then nullif(btrim(concat_ws(E'\n',
      nullif(btrim(coalesce(p_payload #>> '{fields,outcome}', '')), ''),
      (select string_agg(x, E'\n') from jsonb_array_elements_text(case when jsonb_typeof(p_payload #> '{fields,issues}') = 'array' then p_payload #> '{fields,issues}' else '[]'::jsonb end) as t(x)))), '')
    else null
  end;
$$;
revoke all on function public.field_body_text(jsonb) from public, anon, authenticated;
grant execute on function public.field_body_text(jsonb) to service_role;

create function public.field_body_hash(p_text text) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_text, ''), 'UTF8')), 'hex');
$$;
revoke all on function public.field_body_hash(text) from public, anon, authenticated;
grant execute on function public.field_body_hash(text) to service_role;

-- 검사기용 — 검수 항목의 공개 본문과 해시 (본문이 없으면 text = null)
create function public.field_candidate_body(p_item_id bigint) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.review_items;
  v_body text;
begin
  select * into r from public.review_items where id = p_item_id;
  if r.id is null or r.kind <> 'field_data' then
    raise exception '분야 데이터 후보 %가 없습니다', p_item_id using errcode = 'no_data_found';
  end if;
  v_body := public.field_body_text(r.payload);
  return jsonb_build_object('text', v_body, 'hash', public.field_body_hash(v_body), 'kogl_type', r.payload ->> 'kogl_type', 'snapshot_id', r.snapshot_id);
end;
$$;
revoke all on function public.field_candidate_body(bigint) from public, anon, authenticated;
grant execute on function public.field_candidate_body(bigint) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 후보 검사 — 문제 문장 또는 null. 승인 때(트리거)와 공개 반영 때(field_publish)가 부른다
-- ─────────────────────────────────────────────────────────────
create function public.field_candidate_problem(p_payload jsonb, p_snapshot_id bigint, p_source_key text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_top constant text[] := array['target', 'source_item_id', 'value_hash', 'kogl_type', 'changed_fields', 'fields'];
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_target text := p_payload ->> 'target';
  v_spec jsonb;
  v_f jsonb;
  v_k text;
  v_v jsonb;
  v_problem text;
  v_date date;
  v_item jsonb;
  v_start timestamptz;
  v_end timestamptz;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    return '후보 내용이 객체가 아닙니다';
  end if;
  v_spec := public.field_target_spec(v_target);
  if v_spec is null then
    return format('알 수 없는 후보 대상입니다 (%s)', coalesce(v_target, '없음'));
  end if;
  select k into v_k from jsonb_object_keys(p_payload) k where k <> all (c_top) limit 1;
  if v_k is not null then
    return format('허용되지 않은 칸 ''%s''이 후보에 있습니다 — 가격·분담금·수익률 같은 칸은 담을 수 없습니다', v_k);
  end if;
  if length(btrim(coalesce(p_payload ->> 'source_item_id', ''))) not between 1 and 200 then
    return '원천 항목 번호(source_item_id)가 없습니다';
  end if;
  if coalesce(p_payload ->> 'value_hash', '') !~ '^[0-9a-f]{64}$' then
    return '값 해시(value_hash)가 없거나 모양이 맞지 않습니다';
  end if;
  if p_snapshot_id is null then
    return '원본 스냅샷이 없습니다';
  end if;
  if not exists (select 1 from public.data_sources s where s.key = p_source_key and s.kind = 'field_data') then
    return '분야 데이터 원천(data_sources, 종류 field_data)이 아닙니다';
  end if;
  if coalesce(p_payload ->> 'kogl_type', '') not in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked') then
    return '공공누리 유형이 없습니다 — 유형(제1~4유형·표시 없음)이 기록되어야 승인할 수 있습니다';
  end if;
  if jsonb_typeof(p_payload -> 'changed_fields') is not null and jsonb_typeof(p_payload -> 'changed_fields') <> 'array' then
    return '바뀐 필드 표시(changed_fields)는 배열입니다';
  end if;
  v_f := p_payload -> 'fields';
  if jsonb_typeof(v_f) is distinct from 'object' then
    return '후보 칸(fields)이 없습니다';
  end if;
  -- 허용 칸 밖의 키
  select k into v_k from jsonb_object_keys(v_f) k
   where not (v_spec -> 'required' ? k) and not (v_spec -> 'optional' ? k) limit 1;
  if v_k is not null then
    return format('허용되지 않은 칸 ''%s''이 후보에 있습니다 — 가격·분담금·수익률 같은 칸은 담을 수 없습니다', v_k);
  end if;
  -- 필수 칸
  for v_k in select jsonb_array_elements_text(v_spec -> 'required') loop
    v_v := v_f -> v_k;
    if v_v is null or jsonb_typeof(v_v) = 'null'
       or (jsonb_typeof(v_v) = 'string' and length(btrim(v_v #>> '{}')) = 0)
       or (jsonb_typeof(v_v) = 'array' and jsonb_array_length(v_v) = 0) then
      return format('필수 칸 ''%s''이 비었습니다', v_k);
    end if;
  end loop;
  -- 개인정보 패턴 (주민등록번호 모양) — 값 해시(16진수 64자)·원천 항목 번호는 수집기가 만든 식별 글자라 검사에서 뺀다 (숫자 13자가 우연히 이어질 수 있다)
  if (p_payload - 'value_hash' - 'source_item_id')::text ~ '(^|[^0-9])[0-9]{6}-?[1-4][0-9]{6}([^0-9]|$)' then
    return '주민등록번호 모양의 글자가 있습니다 — 승인할 수 없습니다';
  end if;

  begin
    if v_target = 'project_stage' then
      if not exists (select 1 from public.projects p where p.slug = v_f ->> 'project_slug') then
        return format('프로젝트 ''%s''가 없습니다', v_f ->> 'project_slug');
      end if;
      if (v_f ->> 'source_url') !~* '^https?://[^[:space:]]+$' then
        return '고시 원문 링크가 http(s) 주소가 아닙니다';
      end if;
      v_date := (v_f ->> 'notice_date')::date;
      if public.project_stage_position((select s.value from public.settings s where s.key = 'project_stage_lists'),
           (select p.project_type from public.projects p where p.slug = v_f ->> 'project_slug'), v_f ->> 'stage') is null then
        return format('단계 ''%s''가 이 프로젝트 사업 유형의 단계 목록에 없습니다', v_f ->> 'stage');
      end if;
    elsif v_target = 'supply_notice' then
      if (v_f ->> 'official_notice_url') !~* '^https?://[^[:space:]]+$' then
        return '공식 공고 주소가 http(s) 주소가 아닙니다';
      end if;
      if (v_f ->> 'apply_end')::date < (v_f ->> 'apply_start')::date then
        return '청약 마감일이 시작일보다 앞입니다';
      end if;
      v_date := (v_f ->> 'notice_date')::date;
      if public.supply_text_has_price(v_f ->> 'name') or public.supply_text_has_price(v_f ->> 'supply_scale') or public.supply_text_has_price(v_f ->> 'notice_issuer') then
        return '사업명·공급 규모·공고 기관에 금액·가격 표현이 있습니다';
      end if;
      if v_f ? 'project_slug' and not exists (select 1 from public.projects p where p.slug = v_f ->> 'project_slug') then
        return format('프로젝트 ''%s''가 없습니다', v_f ->> 'project_slug');
      end if;
    elsif v_target = 'local_event' then
      v_problem := public.event_url_problem(v_f ->> 'official_url');
      if v_problem is not null then
        return '행사 공식 주소: ' || v_problem;
      end if;
      v_start := (v_f ->> 'starts_at')::timestamptz;
      v_end := (v_f ->> 'ends_at')::timestamptz;
      if v_end < v_start then
        return '행사 종료가 시작보다 앞입니다';
      end if;
      if (v_f ->> 'slug') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or (v_f ->> 'series_key') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        return '행사 slug·series_key 모양이 맞지 않습니다';
      end if;
      if jsonb_typeof(v_f -> 'sponsored') is distinct from 'boolean' then
        return '행사 sponsored 는 참/거짓입니다';
      end if;
      if (v_f ->> 'category') not in ('tax_finance', 'development', 'festival', 'commercial', 'other')
         or (v_f ->> 'organizer_type') not in ('government', 'public_body', 'nonprofit', 'commercial') then
        return '행사 분류 또는 주최 유형 값이 맞지 않습니다';
      end if;
      if ((v_f ->> 'organizer_type') = 'commercial' or (v_f ->> 'category') = 'commercial') and (v_f -> 'sponsored') is distinct from 'true'::jsonb then
        return '영리 주최·상업 분류 행사는 sponsored 여야 합니다 (LG-13)';
      end if;
      if coalesce(v_f ->> 'status', 'normal') not in ('normal', 'cancelled', 'changing') then
        return '행사 상태 값이 맞지 않습니다';
      end if;
      if v_f ->> 'status_source_url' is not null then
        v_problem := public.event_url_problem(v_f ->> 'status_source_url');
        if v_problem is not null then
          return '행사 상태 출처 주소: ' || v_problem;
        end if;
      end if;
      if v_f ->> 'image_rights' is not null and (v_f ->> 'image_rights') not in ('confirmed', 'unconfirmed') then
        return '이미지 권리 값이 맞지 않습니다';
      end if;
    else
      -- 금융 대상 공통: 발표일·기준일 날짜, 기준일은 오늘 이후 불가, 금지 표현, 원문 주소
      v_date := (v_f ->> 'released_on')::date;
      if v_date > v_today or (v_f ->> 'as_of')::date > v_today then
        return '발표·공시일 또는 기준일이 오늘보다 뒤입니다';
      end if;
      if v_target in ('finance_indicator', 'finance_regulation') then
        v_problem := public.finance_url_problem(v_f ->> 'source_url');
        if v_problem is not null then
          return v_problem;
        end if;
      end if;
      if v_target = 'finance_indicator' then
        perform (v_f ->> 'value')::numeric;
        if jsonb_typeof(v_f -> 'value') not in ('number', 'string') then
          return '지표 값은 숫자입니다';
        end if;
        v_problem := public.finance_text_problem(array[v_f ->> 'label', v_f ->> 'definition', v_f ->> 'provider']);
      elsif v_target = 'finance_regulation' then
        perform (v_f ->> 'effective_on')::date;
        v_problem := public.finance_text_problem(array[v_f ->> 'title', v_f ->> 'stage', v_f ->> 'provider']);
      else
        if v_f ->> 'structure_type' not in ('trust', 'completion_guarantee', 'pf_stage', 'reit') then
          return '구조 유형 값이 맞지 않습니다';
        end if;
        if jsonb_typeof(v_f -> 'issues') <> 'array' or jsonb_array_length(v_f -> 'issues') > 8 then
          return '쟁점은 1~8개 배열입니다';
        end if;
        if jsonb_typeof(v_f -> 'sources') <> 'array' or jsonb_array_length(v_f -> 'sources') > 10 then
          return '공개 자료 출처는 1~10개 배열입니다';
        end if;
        for v_item in select x from jsonb_array_elements(v_f -> 'sources') x loop
          if jsonb_typeof(v_item) <> 'object' or length(btrim(coalesce(v_item ->> 'label', ''))) not between 1 and 80 then
            return '공개 자료 출처마다 이름(label)이 필요합니다';
          end if;
          v_problem := public.finance_url_problem(v_item ->> 'url');
          if v_problem is not null then
            return v_problem;
          end if;
        end loop;
        if coalesce((v_f ->> 'judgment_quoted')::boolean, false) and not coalesce((v_f ->> 'anonymized_checked')::boolean, false) then
          return '판결문을 인용한 후보는 비실명 확인(anonymized_checked)이 있어야 합니다 (DF-06)';
        end if;
        v_problem := public.finance_text_problem(array[v_f ->> 'title', v_f ->> 'outcome'] || array(select jsonb_array_elements_text(v_f -> 'issues')));
      end if;
      if v_problem is not null then
        return v_problem;
      end if;
    end if;
  exception when others then
    return format('칸 모양이 맞지 않습니다 (%s)', sqlerrm);
  end;
  return null;
end;
$$;
revoke all on function public.field_candidate_problem(jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.field_candidate_problem(jsonb, bigint, text) to service_role;

-- 후보 만들기 검사 — 분야 데이터 후보는 수집 가능한 원천(이용 조건 허용 + 견본 계약 확인)에서만 (미확인 원천 실행 0)
create function public.review_items_field_data_insert_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.data_source_key is null or not public.data_source_runnable(new.data_source_key) then
    raise exception '분야 데이터 후보는 이용 조건이 허용되고 견본 계약이 확인된 원천에서만 만들 수 있습니다 (원천 %)', coalesce(new.data_source_key, '없음')
      using errcode = 'check_violation';
  end if;
  if new.snapshot_id is null then
    raise exception '분야 데이터 후보에는 원본 스냅샷이 있어야 합니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.review_items_field_data_insert_guard() from public, anon, authenticated;
create trigger review_items_field_data_insert_guard before insert on public.review_items
  for each row when (new.kind = 'field_data') execute function public.review_items_field_data_insert_guard();

-- 승인 검사 — 후보 검사에서 문제가 나오면 approved 로 가지 못한다
create function public.review_items_field_data_approve_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    v_problem := public.field_candidate_problem(new.payload, new.snapshot_id, new.data_source_key);
    if v_problem is not null then
      raise exception '분야 데이터 후보를 승인할 수 없습니다 — %', v_problem using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.review_items_field_data_approve_guard() from public, anon, authenticated;
create trigger review_items_field_data_approve_guard before update on public.review_items
  for each row when (new.kind = 'field_data') execute function public.review_items_field_data_approve_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 public_local_events — 칸 끝에 공공누리 유형·이미지(권리 확인분만)를 더한다 (기존 칸 순서·값은 그대로)
-- ─────────────────────────────────────────────────────────────
create or replace view public.public_local_events as
select e.id, e.slug, e.series_key, e.title, e.category, e.organizer, e.organizer_type, e.venue, e.region_code,
       e.starts_at, e.ends_at, e.official_url, e.source_name, e.confirmed_on, e.sponsored,
       e.status_source_url, e.status_confirmed_at,
       case e.status_override
         when 'cancelled' then 'cancelled'
         when 'changing' then 'changing'
         else case when now() < e.starts_at then 'upcoming' when now() <= e.ends_at then 'ongoing' else 'ended' end
       end as status,
       (e.confirmed_on + coalesce((select (s.value ->> 'days')::int from public.settings s where s.key = 'event_recheck' and jsonb_typeof(s.value) = 'object'), 7)
          < (now() at time zone 'Asia/Seoul')::date) as recheck_due,
       coalesce((select (s.value ->> 'hide_stale')::boolean from public.settings s where s.key = 'event_recheck' and jsonb_typeof(s.value) = 'object'), false) as hide_stale,
       e.license_type,
       case when e.image_rights = 'confirmed' then e.image_url end as image_url
  from public.local_events e
 where e.published
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'local_events') = 'true'::jsonb);
