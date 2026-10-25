-- W10-h 4단계 — 금융 사례 DB (PRD-02 DF-07 · DF-06, docs/dev/W10-h_설계.md 3장 결정 8·9)
-- 이 파일에 실제 사례·기업 이름·판결 내용은 없다. 표 틀과 공개 규칙만 정한다. 씨앗 행 0.
-- · finance_case_entries — 구조 유형 · 쟁점 · 결과 · 공개 자료 출처(1건 이상) · 기준일 · 실명 기업 반론 기록을 가진 사례 DB 항목.
--     1단계 finance_cases(기사 번호가 기본 키)는 그대로 두고, 기사와 이어지는 번호는 article_ids 배열로만 둔다 (자체 취재 기사 집계에 들어가지 않는다).
--     공개(status public)는 쟁점 1개 이상 · 결과 · 출처 1건 이상 · 기준일이 있어야 하고, 실명 기업(companies)이 있으면 반론 요청일과 답변 상태가 있어야 한다.
--     답변 상태 '회신 없음'(no_response)은 요청일부터 설정 finance_rebuttal_wait_days가 지난 뒤에만. 판결문 인용은 비실명 확인이 있어야 한다.
--     미공개 조건(금리·수수료·내부 약정)·수익률 칸 없음. 글자는 finance_text_problem(투자 권유·수익 암시·세액 표현 거부)을 거친다.
--     수집 후보(W10-h 승인)로 들어온 항목은 draft 로 시작해 사람이 반론 기록 등을 채운 뒤 공개한다.
-- · 공개 뷰 public_finance_case_entries — 기능 키 finance 와 field_data 가 모두 켜졌고 status public 인 항목만. 원천 이름 · 확인일 · 공공누리 유형 줄 포함. 내부 칸(반론 메모·번호·작성자) 0.

create table public.finance_case_entries (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  structure_type text not null check (structure_type in ('trust', 'completion_guarantee', 'pf_stage', 'reit')),
  issues text[] not null default '{}' check (cardinality(issues) <= 8),
  outcome text check (outcome is null or char_length(btrim(outcome)) between 1 and 300),
  as_of date not null,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 10),
  companies text[] not null default '{}' check (cardinality(companies) <= 10),
  rebuttal_requested_on date,
  rebuttal_status text check (rebuttal_status in ('answered', 'no_response', 'declined')),
  rebuttal_note text check (rebuttal_note is null or char_length(rebuttal_note) <= 500),
  judgment_quoted boolean not null default false,
  anonymized_checked boolean not null default false,
  article_ids bigint[] not null default '{}' check (cardinality(article_ids) <= 20),
  status text not null default 'draft' check (status in ('draft', 'public', 'hidden')),
  source_key text references public.data_sources (key),
  source_item_id text check (source_item_id is null or length(btrim(source_item_id)) between 1 and 200),
  source_value_hash text check (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$'),
  snapshot_id bigint references public.raw_snapshots (id),
  license_type text check (license_type is null or license_type in ('kogl_1', 'kogl_2', 'kogl_3', 'kogl_4', 'unmarked', 'not_applicable')),
  released_on date,
  created_by text not null check (length(btrim(created_by)) > 0),
  updated_by text not null check (length(btrim(updated_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_case_entries_source_trio check ((source_key is null) = (source_item_id is null) and (source_key is null) = (source_value_hash is null)),
  constraint finance_case_entries_source_record check (source_key is null or (snapshot_id is not null and license_type is not null and released_on is not null)),
  constraint finance_case_entries_rebuttal_pair check (rebuttal_status is null or rebuttal_requested_on is not null)
);

comment on table public.finance_case_entries is '금융 사례 DB 항목 (DF-07) — 공개 자료 범위만. 미공개 조건·수익률 칸 없음. 공개는 쟁점·결과·출처 1건 이상·기준일, 실명 기업이 있으면 반론 기록 필수. 기사 표와 분리(자체 취재 기사 집계 0)';
comment on column public.finance_case_entries.sources is '공개 자료 출처 목록 [{ label, url }] — 공개 전 1건 이상';
comment on column public.finance_case_entries.companies is '실명 기업 목록 — 비어 있지 않으면 반론 요청일·답변 상태가 있어야 공개';
comment on column public.finance_case_entries.rebuttal_note is '반론 요청·답변 내부 메모 — 공개 뷰에 없다';
comment on column public.finance_case_entries.article_ids is '이 사례를 다룬 기사 번호 — 번호만 담고 기사 표를 읽지 않는다';
comment on column public.finance_case_entries.source_key is '수집 후보로 들어온 항목의 원천 키 (DF-06)';
comment on column public.finance_case_entries.source_item_id is '원천의 항목 번호 — 한 항목은 한 행';
comment on column public.finance_case_entries.source_value_hash is '마지막으로 승인한 후보 값의 해시';

create unique index finance_case_entries_source_once on public.finance_case_entries (source_key, source_item_id) where source_key is not null;
create index finance_case_entries_public_idx on public.finance_case_entries (structure_type, as_of desc) where status = 'public';

create function public.finance_case_entries_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_wait integer;
  v_problem text;
  v_issue text;
  v_company text;
  v_src jsonb;
  v_id bigint;
begin
  foreach v_issue in array new.issues loop
    if char_length(btrim(v_issue)) not between 1 and 80 then
      raise exception '사례 쟁점은 항목마다 1~80자입니다 (%)', new.slug using errcode = 'check_violation';
    end if;
  end loop;
  foreach v_company in array new.companies loop
    if char_length(btrim(v_company)) not between 1 and 60 then
      raise exception '실명 기업 이름은 항목마다 1~60자입니다 (%)', new.slug using errcode = 'check_violation';
    end if;
  end loop;
  foreach v_id in array new.article_ids loop
    if not exists (select 1 from public.articles a where a.id = v_id) then
      raise exception '사례 %의 기사 번호 %가 없습니다', new.slug, v_id using errcode = 'foreign_key_violation';
    end if;
  end loop;
  for v_src in select x from jsonb_array_elements(new.sources) x loop
    if jsonb_typeof(v_src) <> 'object' or char_length(btrim(coalesce(v_src ->> 'label', ''))) not between 1 and 80 then
      raise exception '공개 자료 출처마다 이름(label)이 필요합니다 (%)', new.slug using errcode = 'check_violation';
    end if;
    v_problem := public.finance_url_problem(v_src ->> 'url');
    if v_problem is not null then
      raise exception '사례 % 출처 주소 — %', new.slug, v_problem using errcode = 'check_violation';
    end if;
  end loop;
  v_problem := public.finance_text_problem(array_remove(array[new.title, new.outcome] || new.issues, null));
  if v_problem is not null then
    raise exception '금융 사례 % — %', new.slug, v_problem using errcode = 'check_violation';
  end if;
  if new.as_of > v_today then
    raise exception '사례 %의 기준일이 오늘보다 뒤입니다', new.slug using errcode = 'check_violation';
  end if;
  if new.rebuttal_requested_on is not null and new.rebuttal_requested_on > v_today then
    raise exception '사례 %의 반론 요청일이 오늘보다 뒤입니다', new.slug using errcode = 'check_violation';
  end if;
  if new.judgment_quoted and not new.anonymized_checked and new.status = 'public' then
    raise exception '판결문을 인용한 사례는 비실명 확인이 있어야 공개합니다 (DF-06, %)', new.slug using errcode = 'check_violation';
  end if;

  if new.status = 'public' then
    if cardinality(new.issues) < 1 or new.outcome is null or jsonb_array_length(new.sources) < 1 then
      raise exception '공개 사례는 쟁점 1개 이상·결과·공개 자료 출처 1건 이상이 있어야 합니다 (DF-07, %)', new.slug using errcode = 'check_violation';
    end if;
    if cardinality(new.companies) > 0 then
      if new.rebuttal_requested_on is null or new.rebuttal_status is null then
        raise exception '실명 기업이 있는 사례는 반론 요청일과 답변 상태(답변·회신 없음·거절)가 있어야 공개합니다 (DF-07, %)', new.slug using errcode = 'check_violation';
      end if;
      if new.rebuttal_status = 'no_response' then
        select (s.value #>> '{}')::integer into v_wait from public.settings s where s.key = 'finance_rebuttal_wait_days';
        if new.rebuttal_requested_on + coalesce(v_wait, 7) > v_today then
          raise exception '회신 없음은 요청일부터 %일이 지나야 인정됩니다 (DF-07, %)', coalesce(v_wait, 7), new.slug using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.finance_case_entries_guard() from public, anon, authenticated;
create trigger finance_case_entries_guard before insert or update on public.finance_case_entries
  for each row execute function public.finance_case_entries_guard();

alter table public.finance_case_entries enable row level security;
revoke all on table public.finance_case_entries from anon, authenticated, service_role;
grant select, insert, update on table public.finance_case_entries to service_role;   -- 지우기는 열지 않는다 (숨김으로 내린다)

create view public.public_finance_case_entries as
select e.id, e.slug, e.title, e.structure_type, e.issues, e.outcome, e.as_of, e.sources, e.companies,
       e.rebuttal_requested_on, e.rebuttal_status, e.article_ids, e.license_type,
       d.name as source_name,
       (r.fetched_at at time zone 'Asia/Seoul')::date as checked_on
  from public.finance_case_entries e
  left join public.data_sources d on d.key = e.source_key
  left join public.raw_snapshots r on r.id = e.snapshot_id
 where e.status = 'public'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'finance') = 'true'::jsonb and (f.value -> 'field_data') = 'true'::jsonb);

comment on view public.public_finance_case_entries is '공개 금융 사례 DB (DF-07) — 기능 키 finance·field_data 가 켜졌고 status public 인 항목. 원천 이름·확인일·공공누리 유형 줄 포함, 내부 칸 0';
revoke all on table public.public_finance_case_entries from public, anon, authenticated, service_role;
grant select on table public.public_finance_case_entries to anon, authenticated, service_role;
