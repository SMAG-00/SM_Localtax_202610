-- W2-d 4단계 DB — 검색어 집계 query_terms (SRCH-03 · OPT-04 원본, docs/dev/W2-d_설계.md 2.7 · 2.8 · 8.3 · 10장, PRD-01A 6.1)
-- · query_terms — 질의 원본의 '가린 값'과 기간별 합계만 둔다. 칸은 PRD-01A 6.1 그대로 9개
--   (id · source · term_masked · normalized · period · count · cluster_id · first_seen · last_seen).
--   검색어 원문·방문자·세션·IP·User-Agent·회원 칸이 없다. 출처 site_search(이번 단계 — 사이트 검색)는 서버가 가린 값만 넣는다
--   (이메일 · 주민등록번호 · 전화번호 · 9자리 이상 숫자 줄 → 가림 글자, 설계 2.7·2.8). 같은 정규형은 (normalized, source, period) 한 행 —
--   더하기 함수(query_terms_add)가 횟수를 합친다. 정규형은 검색과 같은 낱말 규칙(설계 4장 3 — TypeScript queryTerms)
-- · DB도 막는다(심층 방어) — 9자리 이상 숫자 줄(숫자 사이에 띄어쓰기·기호만 낀 것)·'@' 앞뒤에 글자가 붙은 덩어리가 든 값은 check 위반.
--   정규형은 남기는 글자(검색 정규화 4장 1)로 된 낱말 1~8개를 띄어쓰기 하나로 이은 것만
-- · 기간 period = 한국 날짜 하루(설계 2.7 query_terms.period) — 화면이 고른 기간의 날 행을 더해 보인다
-- · cluster_id — 질의 묶음(OPT-04 query_clusters, W7)이 생기면 그 표에 외래 키를 단다. 지금은 비움
-- · RLS 기본 거부 — anon·authenticated 읽기·쓰기 0, service_role 전권. 함수 셋(더하기·보고·보존 기한 정리)은 service_role만 실행
-- · settings 씨앗 query_terms — 기간 행 보존 일수 · 편집국 화면에 보이는 최소 합계 횟수 (설계 2.7 — 결정 안건)

-- 남기는 글자 (검색 정규화 public.search_squash와 같은 범위): 0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿 — 가린 값은 대문자 영문도 남는다(소문자로 바꾸기 전)
create table public.query_terms (
  id bigint generated always as identity primary key,
  source text not null check (source in ('site_search', 'search_console', 'search_advisor', 'assistant_unresolved', 'inquiry')),
  term_masked text not null,                                  -- 가린 검색어 (보이는 꼴) — 같은 정규형의 첫 값
  normalized text not null,                                   -- 정규형 낱말 목록 (띄어쓰기 하나로 이음) — 합산 열쇠
  period date not null,                                       -- 한국 날짜 하루
  count integer not null check (count > 0),
  cluster_id bigint,                                          -- 질의 묶음 (OPT-04 — W7에 외래 키)
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  constraint query_terms_unique unique (normalized, source, period),
  constraint query_terms_seen_order check (first_seen <= last_seen),
  constraint query_terms_term_masked_shape check (char_length(term_masked) between 1 and 100 and term_masked = btrim(term_masked)),
  constraint query_terms_normalized_shape check (
    char_length(normalized) <= 200
    and normalized ~ '^[0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+( [0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+){0,7}$'),
  -- 9자리 이상 숫자 줄 — 전화번호·주민등록번호·카드·계좌 모양 (설계 2.7 query_terms.digit_run). 숫자 사이에 남기는 글자 밖(띄어쓰기·하이픈·점·괄호 등)만 끼면 한 줄.
  -- NFKC로 바꾼 뒤 본다 — 전각 숫자(０１０)·전각 기호(＠)도 같은 모양
  constraint query_terms_no_digit_run check (
    normalize(term_masked, NFKC) !~ '[0-9]([^0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]*[0-9]){8}'
    and normalized !~ '[0-9]([^0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]*[0-9]){8}'),
  -- 이메일 모양 — '@' 앞뒤(띄어쓰기 허용)에 글자·숫자가 붙어 있으면 거부
  constraint query_terms_no_email check (normalize(term_masked, NFKC) !~ '[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿_.%+-][[:space:]]*@[[:space:]]*[0-9A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]')
);

comment on table public.query_terms is
  '검색어 집계 (SRCH-03 · OPT-04 원본) — 가린 값·정규형·기간(한국 날짜)별 합계만. 검색어 원문·방문자·IP·User-Agent 칸 없음. anon·authenticated 0';
comment on column public.query_terms.term_masked is '가린 검색어 — 서버가 이메일·주민등록번호·전화번호·9자리 이상 숫자 줄을 가림 글자로 바꾼 값(설계 2.8 견본). 같은 정규형 행의 첫 값을 둔다';
comment on column public.query_terms.normalized is '정규형 — 가린 값에서 가림 글자를 뺀 뒤 검색 낱말 규칙(설계 4장 3)으로 만든 낱말 목록. 합산 열쇠 (normalized, source, period)';
comment on column public.query_terms.period is '기간 — 한국 날짜 하루 (설계 2.7 query_terms.period)';
comment on column public.query_terms.cluster_id is '질의 묶음 번호 (OPT-04 query_clusters — W7에 외래 키). 지금은 비움';

create index query_terms_source_period_idx on public.query_terms (source, period);

alter table public.query_terms enable row level security;
revoke all on table public.query_terms from anon, authenticated, service_role;
grant select, insert, update, delete on table public.query_terms to service_role;

-- ─────────────────────────────────────────────────────────────
-- 더하기 — 같은 (정규형, 출처, 기간)이면 횟수를 합치고 처음·마지막 시각을 넓힌다. 가린 값은 첫 값 그대로. 합친 뒤 횟수를 돌려준다
-- ─────────────────────────────────────────────────────────────
create function public.query_terms_add(p_source text, p_term_masked text, p_normalized text, p_period date, p_at timestamptz, p_count integer default 1)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  total integer;
begin
  if p_count is null or p_count < 1 then
    raise exception using errcode = '22023', message = '더할 횟수는 1 이상이어야 합니다';
  end if;
  if p_period is null or p_at is null then
    raise exception using errcode = '22023', message = '기간과 시각이 필요합니다';
  end if;
  insert into public.query_terms as q (source, term_masked, normalized, period, count, first_seen, last_seen)
  values (p_source, p_term_masked, p_normalized, p_period, p_count, p_at, p_at)
  on conflict on constraint query_terms_unique do update
    set count = q.count + excluded.count,
        first_seen = least(q.first_seen, excluded.first_seen),
        last_seen = greatest(q.last_seen, excluded.last_seen)
  returning q.count into total;
  return total;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 보고 — 출처 하나의 [p_from, p_to] 날 행을 정규형마다 더한다(편집국 화면 — 설계 8.3).
-- 합계가 p_min_count 이상인 정규형만 rows에(많이 찾은 차례 → 마지막으로 찾은 차례 → 정규형), 앞 p_limit개.
-- terms = 기간 안 정규형 수 · shown = 최소 횟수 이상인 정규형 수 · searches = 기간 안 검색 합계. 가린 값은 기간 안에서 가장 많이 찾은 날 행의 값
-- ─────────────────────────────────────────────────────────────
create function public.query_terms_report(p_source text, p_from date, p_to date, p_min_count integer, p_limit integer)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_source is null or p_source not in ('site_search', 'search_console', 'search_advisor', 'assistant_unresolved', 'inquiry') then
    raise exception using errcode = '22023', message = '출처 값이 목록 밖입니다';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception using errcode = '22023', message = '기간의 시작일이 끝날보다 늦거나 비어 있습니다';
  end if;
  if p_min_count is null or p_min_count < 1 then
    raise exception using errcode = '22023', message = '최소 횟수는 1 이상이어야 합니다';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = '보일 건수는 1~500이어야 합니다';
  end if;
  with g as (
    select q.normalized,
           sum(q.count)::bigint as total,
           count(*)::integer as days,
           min(q.first_seen) as first_seen,
           max(q.last_seen) as last_seen,
           (array_agg(q.term_masked order by q.count desc, q.period desc, q.id))[1] as term_masked
    from public.query_terms q
    where q.source = p_source and q.period between p_from and p_to
    group by q.normalized),
  shown as (
    select g.* from g
    where g.total >= p_min_count
    order by g.total desc, g.last_seen desc, g.normalized
    limit p_limit)
  select jsonb_build_object(
    'terms', (select count(*) from g),
    'shown', (select count(*) from g where g.total >= p_min_count),
    'searches', coalesce((select sum(g.total) from g), 0),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'normalized', s.normalized, 'term_masked', s.term_masked, 'count', s.total, 'days', s.days,
               'first_seen', s.first_seen, 'last_seen', s.last_seen)
             order by s.total desc, s.last_seen desc, s.normalized)
      from shown s), '[]'::jsonb))
  into result;
  return result;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 보존 기한 정리 — p_before보다 앞선 날 행을 최대 p_limit건 지운다(측정 보존 기한 정리 배치 analytics-retention이 부른다)
-- ─────────────────────────────────────────────────────────────
create function public.query_terms_purge(p_before date, p_limit integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer;
begin
  if p_before is null then
    raise exception using errcode = '22023', message = '기준 날짜가 필요합니다';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = '한 번에 지울 건수는 1 이상이어야 합니다';
  end if;
  with doomed as (
    select q.id from public.query_terms q
    where q.period < p_before
    order by q.period, q.id
    limit p_limit)
  delete from public.query_terms q using doomed d where q.id = d.id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.query_terms_add(text, text, text, date, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.query_terms_report(text, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.query_terms_purge(date, integer) from public, anon, authenticated;
grant execute on function public.query_terms_add(text, text, text, date, timestamptz, integer) to service_role;
grant execute on function public.query_terms_report(text, date, date, integer, integer) to service_role;
grant execute on function public.query_terms_purge(date, integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 (설계 2.7 — 시험 tests/w2d-query-terms.test.mjs가 설계 문서의 값과 대조한다)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('query_terms',
   '{"version":"2026-10-19.1","retention_days":395,"display_min_count":2}'::jsonb,
   '검색어 집계 (SRCH-03 · OPT-04) — retention_days 기간 행 보존(일, 매일 정리) · display_min_count 편집국 화면에 보이는 최소 합계 횟수(그보다 적게 찾은 검색어는 숨김 — 형식으로 가리지 못하는 이름 같은 말이 한 번 찾은 그대로 보이지 않게) [결정 안건]',
   'migration:20261019000022');
