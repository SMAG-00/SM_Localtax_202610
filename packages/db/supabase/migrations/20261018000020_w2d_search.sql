-- W2-d 1단계 DB — 통합 검색 기반 (docs/dev/W2-d_설계.md 3~7장 · PRD-01A SRCH-01·SRCH-02, PRD-01B REG-08·REG1-11, PRD-01C CHAT-03)
-- · 검색 엔진: PGroonga (PRD-00 이식성 규칙 2 — Supabase 직접 설치판에도 있는 확장). extensions 스키마에 둔다(Supabase 확장 관례)
-- · 찾는 글 = 표마다 계산 칸 search_text (생성 칸 — 직접 쓸 수 없다). 칸마다 정규화(NFKC·소문자·띄어쓰기와 문장부호 지움)하고
--   칸 사이는 줄바꿈으로 나눈다 → 띄어쓰기 변형("취득 세"·"재 건축")이 같은 글이 된다. 색인 = 2글자 조각(부분 글자 찾기)
-- · 이름 칸 search_names (제목·별칭 등의 정규형 배열) — 순위 등급(이름 같음 · 이름에 있음 · 본문에만)에 쓴다
-- · 검색 함수는 하나(search_public) — security invoker: 부르는 역할의 칸 권한·RLS가 그대로 걸린다. 함수 안에서도 공개 조건을 다시 건다
--   (service_role이 불러도 공개 행만 — 심층 방어). anon이 실행할 수 있는 public 함수는 health_ping과 이 함수뿐
-- · 정규화 도우미 함수(생성 칸용)는 쓰는 역할(service_role)만 실행 — anon 실행 0. 검색 함수는 같은 정규화를 몸 안에 직접 쓴다
--   (설계 2.2 견본 표를 DB 시험과 TypeScript 시험이 함께 읽어 두 구현이 같은지 본다)
-- · 동의어 사전 search_synonyms — 편집국이 관리하는 검색 낱말(공개 검색 어휘). anon은 사용 중인 줄의 열쇠·동의어 칸만 읽는다
-- · 검색 색인에 넣지 않는 것: 취재 근거 3종(article_evidence·datasets·interviews)·승인 기록·운영 설정 사전·기사 핵심 주장(claims)·문의함

create extension if not exists pgroonga with schema extensions;

-- ─────────────────────────────────────────────────────────────
-- 정규화 도우미 (생성 칸·제약에서 부른다 — immutable). 규칙은 설계 4장
-- ─────────────────────────────────────────────────────────────

-- 한 칸의 정규형 — NFKC → 소문자 → 숫자·영문 소문자·한글 음절·한글 자모(NFKC가 호환 자모 ㄱ을 첫소리 글자 ᄀ로 바꾼다 — 둘 다 남긴다)·한자 밖의 글자(띄어쓰기·문장부호 포함)를 지운다
create function public.search_squash(t text) returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(normalize(coalesce(t, ''), NFKC)), '[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+', '', 'g')
$$;

-- 이름 목록의 정규형 — 차례 그대로, 빈 것·겹친 것은 뺀다
create function public.search_keys(items text[]) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(k order by first_n), '{}')
  from (
    select k, min(n) as first_n
    from (select public.search_squash(x) as k, n from unnest(coalesce(items, '{}')) with ordinality as u(x, n)) s
    where k <> ''
    group by k
  ) d
$$;

-- 찾는 글 — 칸마다 정규형, 빈 칸은 빼고 줄바꿈으로 잇는다 (줄을 넘는 글자는 이어지지 않는다)
create function public.search_doc(parts text[]) returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(k, E'\n' order by n), '')
  from (select public.search_squash(x) as k, n from unnest(coalesce(parts, '{}')) with ordinality as u(x, n)) s
  where k <> ''
$$;

-- JSON 안의 모든 글자 값 (상황의 먼저 확인할 것 · 체크리스트 항목)
create function public.jsonb_strings(j jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(v #>> '{}'), '{}')
  from jsonb_path_query(coalesce(j, 'null'::jsonb), 'strict $.** ? (@.type() == "string")') as v
$$;

-- 기사 본문 블록의 글 — 블록마다 글 칸(문단·표·이미지 설명·인용·콜아웃·인포그래픽 같은 내용·동영상 요약·FAQ·핵심 요약·카드뉴스 장)만.
-- 블록 종류·media 번호·주소·근거 참조·템플릿 같은 값 칸은 뺀다. 핵심 주장(claims — 근거 번호)은 읽지 않는다.
-- 문단의 링크 표기 [글](주소)는 글만 남긴다 (주소가 검색 낱말이 되지 않게)
create function public.article_search_parts(body jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(regexp_replace(v #>> '{}', '\[([^]\n]+)\]\([^)[:space:]]+\)', '\1', 'g') order by b.n), '{}')
  from jsonb_array_elements(case when jsonb_typeof(body -> 'blocks') = 'array' then body -> 'blocks' else '[]'::jsonb end) with ordinality as b(blk, n)
  cross join lateral jsonb_path_query(
    case when jsonb_typeof(b.blk) = 'object'
      then (b.blk - array['type', 'kind', 'template', 'origin', 'refId', 'mediaId', 'embedUrl', 'thumbnailMediaId', 'thumbnail',
                          'rightsStatus', 'credit', 'license', 'mediaAlt', 'captions', 'durationSeconds', 'checklist']) #- '{data,kind}'
      else 'null'::jsonb end,
    'strict $.** ? (@.type() == "string")') as v
$$;

-- 글자 배열의 항목마다 max_len 글자 이하
create function public.text_items_short(items text[], max_len integer) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from unnest(coalesce(items, '{}')) x where char_length(x) > max_len)
$$;

revoke all on function public.search_squash(text) from public, anon, authenticated;
revoke all on function public.search_keys(text[]) from public, anon, authenticated;
revoke all on function public.search_doc(text[]) from public, anon, authenticated;
revoke all on function public.jsonb_strings(jsonb) from public, anon, authenticated;
revoke all on function public.article_search_parts(jsonb) from public, anon, authenticated;
revoke all on function public.text_items_short(text[], integer) from public, anon, authenticated;
grant execute on function public.search_squash(text) to service_role;
grant execute on function public.search_keys(text[]) to service_role;
grant execute on function public.search_doc(text[]) to service_role;
grant execute on function public.jsonb_strings(jsonb) to service_role;
grant execute on function public.article_search_parts(jsonb) to service_role;
grant execute on function public.text_items_short(text[], integer) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 상황 검색 별칭 (SRCH-01 — "차 팔았" → '차를 팔았어요·폐차했어요'). 편집국이 상황 카드 CMS에서 적는다(2단계 칸)
-- ─────────────────────────────────────────────────────────────
alter table public.situations
  add column aliases text[] not null default '{}',
  add constraint situations_aliases_shape check (
    cardinality(aliases) <= 20 and public.text_items_nonblank(aliases) and public.text_items_short(aliases, 50));

comment on column public.situations.aliases is '검색 별칭 (SRCH-01) — 독자가 이 상황을 부르는 말(“차 팔았어요”·“폐차”). 20개 · 50자까지, 공개';

-- ─────────────────────────────────────────────────────────────
-- 찾는 글·이름 칸 (생성 칸) + PGroonga 색인
-- ─────────────────────────────────────────────────────────────
alter table public.articles
  add column search_text text generated always as (public.search_doc(array[title, summary] || public.article_search_parts(body))) stored,
  add column search_names text[] generated always as (public.search_keys(array[title])) stored;

alter table public.situations
  add column search_text text generated always as (public.search_doc(
    array[title, subtitle] || aliases || mistakes || public.jsonb_strings(checks) || public.jsonb_strings(checklist -> 'items'))) stored,
  add column search_names text[] generated always as (public.search_keys(array[title] || aliases)) stored;

alter table public.amendments
  add column search_text text generated always as (public.search_doc(array[title, summary] || law_names)) stored,
  add column search_names text[] generated always as (public.search_keys(array[title])) stored;

alter table public.glossary_terms
  add column search_text text generated always as (public.search_doc(array[term, reading, definition, plain] || related)) stored,
  add column search_names text[] generated always as (public.search_keys(array[term, reading])) stored;

alter table public.regions
  add column search_text text generated always as (public.search_doc(array[name] || aliases)) stored,
  add column search_names text[] generated always as (public.search_keys(array[name] || aliases)) stored;

alter table public.categories
  add column search_text text generated always as (public.search_doc(array[name, intro])) stored,
  add column search_names text[] generated always as (public.search_keys(array[name])) stored;

alter table public.people
  add column search_text text generated always as (public.search_doc(array[name, affiliation, beat])) stored,
  add column search_names text[] generated always as (public.search_keys(array[name])) stored;

comment on column public.articles.search_text is '찾는 글 (W2-d) — 제목·요약·본문 블록 글의 정규형, 칸 사이 줄바꿈. 생성 칸';
comment on column public.articles.search_names is '이름 정규형 (W2-d 순위 등급) — 제목. 생성 칸';

-- 2글자 조각(문자·숫자·기호 모두) + NFKC 정규화 — 정규형끼리의 부분 글자 찾기. 함수는 pgroonga_condition(…, index_name)으로
-- 색인 설정을 넘겨 순차 읽기(작은 표)에서도 같은 규칙으로 맞춘다
create index articles_search_idx on public.articles using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index situations_search_idx on public.situations using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index amendments_search_idx on public.amendments using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index glossary_terms_search_idx on public.glossary_terms using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index regions_search_idx on public.regions using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index categories_search_idx on public.categories using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');
create index people_search_idx on public.people using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');

-- 공개 칸 더함 — 찾는 글은 이미 공개된 칸(제목·요약·본문·용어 풀이·이름)에서만 만든다. 행은 그대로 각 표의 RLS 정책이 거른다
grant select (search_text, search_names) on table public.articles to anon, authenticated;
grant select (aliases, search_text, search_names) on table public.situations to anon, authenticated;
grant select (search_text, search_names) on table public.amendments to anon, authenticated;
grant select (search_text, search_names) on table public.glossary_terms to anon, authenticated;
grant select (search_text, search_names) on table public.people to anon, authenticated;
-- regions·categories는 표 단위 공개 읽기(W2-b·W2-a)라 새 칸도 따라 열린다

-- ─────────────────────────────────────────────────────────────
-- search_synonyms — 동의어 사전 (설계 5장). 낱말 하나(정규형 열쇠)를 찾으면 동의어도 함께 찾는다(한쪽 방향)
-- ─────────────────────────────────────────────────────────────
create table public.search_synonyms (
  id bigint generated always as identity primary key,
  term text not null check (char_length(btrim(term)) between 1 and 50),
  term_key text generated always as (public.search_squash(term)) stored,
  synonyms text[] not null,
  synonym_keys text[] generated always as (public.search_keys(synonyms)) stored,
  enabled boolean not null default true,
  note text,
  updated_by text not null check (length(btrim(updated_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint search_synonyms_term_key check (term_key <> ''),
  constraint search_synonyms_term_key_unique unique (term_key),
  constraint search_synonyms_shape check (
    cardinality(synonyms) between 1 and 10
    and public.text_items_short(synonyms, 50)
    -- 동의어마다 정규형이 비지 않고 서로 겹치지 않는다 (겹치거나 빈 것이 있으면 정규형 수가 줄어든다)
    and cardinality(public.search_keys(synonyms)) = cardinality(synonyms))
);

comment on table public.search_synonyms is '검색 동의어 사전 (W2-d 설계 5장) — term_key(정규형 낱말)를 찾으면 synonym_keys도 함께 찾는다. 공개 검색 어휘 — anon은 사용 중 줄의 열쇠 칸만';

create trigger search_synonyms_touch before update on public.search_synonyms
  for each row execute function public.touch_updated_at();

alter table public.search_synonyms enable row level security;
revoke all on table public.search_synonyms from anon, authenticated, service_role;
grant select, insert, update, delete on table public.search_synonyms to service_role;
grant select (term_key, synonym_keys, enabled) on table public.search_synonyms to anon, authenticated;
create policy search_synonyms_public_read on public.search_synonyms
  for select to anon, authenticated
  using (enabled);

-- ─────────────────────────────────────────────────────────────
-- search_public — 통합 검색 함수 하나 (설계 7장). 공개 화면(/search)·AI 도우미 검색 도구(01C CHAT-03)가 같이 부른다
-- ─────────────────────────────────────────────────────────────
create function public.search_public(
  p_query text,
  p_kinds text[] default null,
  p_section text default null,
  p_content_type text default null,
  p_region text default null,
  p_from date default null,
  p_to date default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_per_kind integer default null
) returns table (
  kind text,
  ref text,
  slug text,
  title text,
  snippet text,
  section text,
  content_type text,
  published_at timestamptz,
  tier smallint,
  meta jsonb,
  total_count bigint,
  kind_counts jsonb,
  query_terms text[]
)
language plpgsql
stable
security invoker
-- PGroonga 연산자·조건 형식이 extensions 스키마에 있다. 표·뷰는 모두 public.으로 적는다 (임시 스키마는 맨 뒤)
set search_path = extensions, pg_temp
as $fn$
declare
  -- 설계 2.1 · 2.3 표 (DB 시험이 읽어 대조한다)
  c_kinds constant text[] := array['region', 'situation', 'tracker', 'glossary', 'category', 'article', 'person'];
  c_sections constant text[] := array['tax', 'realestate', 'finance', 'local'];
  c_content_types constant text[] := array['reported_news', 'explainer', 'guide', 'opinion', 'sponsored'];
  c_query_chars constant integer := 100;
  c_max_terms constant integer := 8;
  c_max_limit constant integer := 50;
  c_max_offset constant integer := 1000;
  c_max_per_kind constant integer := 10;

  v_parts text[];
  v_work text[];
  v_terms text[] := '{}';
  v_split text[] := '{}';
  v_whole text;
  v_cur text;
  v_last integer;
  v_i integer;
  v_n integer;
  v_q text;
  v_opts text[];
  v_grps integer[];
  v_found boolean;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_limit integer;
  v_offset integer;

  -- 종류마다 찾은 행: (종류, 번호, 등급, 종류 순서, 날짜, 정렬 숫자, 정렬 이름)
  -- $1 PGroonga 질의 · $2 낱말 선택지 · $3 선택지의 낱말 번호 · $4 낱말 수 · $5 검색어 전체 정규형
  -- $6 분야 · $7 기사 유형 · $8 지역 코드 · $9 시작일 · $10 종료일 · $11 오늘(한국 날짜)
  c_hits constant text := $hits$
    select 'article'::text as kind, a.id::text as ref,
      (case when $5 = any(a.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(a.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint as tier,
      6 as kord, a.first_published_at as sort_at, 0 as sort_num, a.title as sort_name
    from public.articles a
    where a.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.articles_search_idx')
      and a.status = 'published' and a.lead_media_cleared and not a.is_paid
      and a.content_type is distinct from 'digest'
      and ($6::text is null or a.section = $6)
      and ($7::text is null or a.content_type = $7)
      and ($8::text is null or exists (
            select 1 from unnest(a.region_codes) rc
             where rc = $8 or (right($8, 8) = '00000000' and left(rc, 2) = left($8, 2))))
      and ($9::date is null or (a.first_published_at at time zone 'Asia/Seoul')::date >= $9)
      and ($10::date is null or (a.first_published_at at time zone 'Asia/Seoul')::date <= $10)
    union all
    select 'situation', s.id::text,
      (case when $5 = any(s.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(s.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      2, null::timestamptz, s.sort, s.title
    from public.situations s
    where s.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.situations_search_idx')
      and s.visible
      and $7::text is null and $8::text is null and $9::date is null and $10::date is null
      and ($6::text is null or s.section = $6)
    union all
    select 'tracker', m.id::text,
      (case when $5 = any(m.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(m.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      3, (cs.current_stage_on::timestamp at time zone 'Asia/Seoul'), 0, m.title
    from public.amendments m
    left join public.amendment_current_stages cs on cs.amendment_id = m.id
    where m.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.amendments_search_idx')
      and m.status = 'public'
      and $7::text is null and $8::text is null
      and ($6::text is null or $6 = 'tax')
      and ($9::date is null or cs.current_stage_on >= $9)
      and ($10::date is null or cs.current_stage_on <= $10)
    union all
    select 'glossary', gl.id::text,
      (case when $5 = any(gl.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(gl.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      4, null::timestamptz, 0, gl.term
    from public.glossary_terms gl
    where gl.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.glossary_terms_search_idx')
      and $7::text is null and $8::text is null and $9::date is null and $10::date is null
      and ($6::text is null or $6 = any(gl.section))
    union all
    select 'region', r.code,
      (case when $5 = any(r.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(r.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      1, null::timestamptz, (case when r.level = 'sido' then 0 else 1 end), r.name
    from public.regions r
    where r.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.regions_search_idx')
      and (r.valid_from is null or r.valid_from <= $11) and (r.valid_to is null or r.valid_to >= $11)
      and $7::text is null and $9::date is null and $10::date is null
      and ($6::text is null or $6 = 'local')
      and ($8::text is null or r.code = $8 or (right($8, 8) = '00000000' and r.parent_code = $8))
    union all
    select 'category', c.id::text,
      (case when $5 = any(c.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(c.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      5, null::timestamptz, c.sort, c.name
    from public.categories c
    where c.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.categories_search_idx')
      and c.visible and c.section <> 'local'
      and exists (select 1 from public.public_articles pa
                   where pa.category_id = c.id and pa.content_type is not null and pa.content_type <> 'digest')
      and $7::text is null and $8::text is null and $9::date is null and $10::date is null
      and ($6::text is null or c.section = $6)
    union all
    select 'person', p.id::text,
      (case when $5 = any(p.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(p.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      7, null::timestamptz, 0, p.name
    from public.people p
    where p.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.people_search_idx')
      and p.visibility = 'public'
      and p.roles && array['reporter', 'editor', 'writer', 'reviewer']::text[]
      and $6::text is null and $7::text is null and $8::text is null and $9::date is null and $10::date is null
  $hits$;
begin
  -- 입력 검사 (설계 2.1·2.3) — 틀리면 22023 (PostgREST 400)
  if p_kinds is not null and (cardinality(p_kinds) = 0 or not (p_kinds <@ c_kinds) or array_position(p_kinds, null) is not null) then
    raise exception '결과 종류는 %에서 고릅니다', array_to_string(c_kinds, '·') using errcode = '22023';
  end if;
  if p_section is not null and not (p_section = any (c_sections)) then
    raise exception '분야는 %에서 고릅니다', array_to_string(c_sections, '·') using errcode = '22023';
  end if;
  if p_content_type is not null and not (p_content_type = any (c_content_types)) then
    raise exception '기사 유형은 %에서 고릅니다', array_to_string(c_content_types, '·') using errcode = '22023';
  end if;
  if p_region is not null and p_region !~ '^[0-9]{10}$' then
    raise exception '지역은 법정동코드 10자리입니다' using errcode = '22023';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception '기간의 끝이 시작보다 앞입니다' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > c_max_limit then
    raise exception '한 쪽 결과 수는 1~%입니다', c_max_limit using errcode = '22023';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > c_max_offset then
    raise exception '건너뛰기는 0~%입니다', c_max_offset using errcode = '22023';
  end if;
  if p_per_kind is not null and (p_per_kind < 1 or p_per_kind > c_max_per_kind) then
    raise exception '종류별 결과 수는 1~%입니다', c_max_per_kind using errcode = '22023';
  end if;

  -- 검색어 정규화 (설계 4장 — public.search_squash와 같은 규칙: 앞 100글자 · NFKC · 소문자 · 남기는 글자 밖은 띄어쓰기로)
  select coalesce(array_agg(x order by n), '{}') into v_parts
  from regexp_split_to_table(
         regexp_replace(lower(normalize(left(coalesce(p_query, ''), c_query_chars), NFKC)), '[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+', ' ', 'g'),
         ' ') with ordinality as t(x, n)
  where x <> '';
  v_n := cardinality(v_parts);
  if v_n = 0 then
    return;
  end if;
  v_whole := array_to_string(v_parts, '');

  -- 띄어 쓴 그대로의 낱말 (겹친 것 뺌, 앞 8개)
  select coalesce(array_agg(x order by first_n), '{}') into v_split
  from (select x, min(n) as first_n from unnest(v_parts) with ordinality as t(x, n) group by x order by min(n) limit c_max_terms) d;

  -- 한 글자 한글 조각은 옆 낱말에 붙인다 — 앞 낱말이 숫자로 끝나면 앞에("2026 년"), 아니면 뒤 낱말이 한글·숫자로 시작하면 뒤에("재 건축"),
  -- 아니면 앞 낱말이 한글로 끝날 때 앞에("취득 세")
  v_work := v_parts;
  v_i := 1;
  while v_i <= v_n loop
    v_cur := v_work[v_i];
    if v_n > 1 and v_cur ~ '^[가-힣]$' then
      v_last := cardinality(v_terms);
      if v_last > 0 and v_terms[v_last] ~ '[0-9]$' then
        v_terms[v_last] := v_terms[v_last] || v_cur;
        v_i := v_i + 1;
        continue;
      end if;
      if v_i < v_n and v_work[v_i + 1] ~ '^[가-힣0-9]' then
        v_work[v_i + 1] := v_cur || v_work[v_i + 1];
        v_i := v_i + 1;
        continue;
      end if;
      if v_last > 0 and v_terms[v_last] ~ '[가-힣]$' then
        v_terms[v_last] := v_terms[v_last] || v_cur;
        v_i := v_i + 1;
        continue;
      end if;
    end if;
    v_terms := v_terms || v_cur;
    v_i := v_i + 1;
  end loop;
  select coalesce(array_agg(x order by first_n), '{}') into v_terms
  from (select x, min(n) as first_n from unnest(v_terms) with ordinality as t(x, n) group by x order by min(n) limit c_max_terms) d;

  for attempt in 1..2 loop
    -- 낱말마다 선택지 = 낱말 자신 + 동의어 사전(사용 중인 줄 — RLS)의 동의어. 질의 = 낱말마다 (선택지 OR …), 낱말끼리는 그리고
    select array_agg(o order by g, o), array_agg(g order by g, o) into v_opts, v_grps
    from (
      select distinct t.n::integer as g, t.x as o from unnest(v_terms) with ordinality as t(x, n)
      union
      select t.n::integer, sk.k
        from unnest(v_terms) with ordinality as t(x, n)
        join public.search_synonyms y on y.term_key = t.x and y.enabled
        cross join lateral unnest(y.synonym_keys) as sk(k)
       where sk.k <> ''
    ) z;
    select string_agg('(' || opts || ')', ' ' order by g) into v_q
    from (
      select u.g, string_agg('"' || replace(replace(u.o, '\', '\\'), '"', '\"') || '"', ' OR ' order by u.o) as opts
      from unnest(v_opts, v_grps) as u(o, g) group by u.g
    ) q;

    -- 붙인 낱말이 띄어 쓴 낱말과 다르면, 붙여서 0건일 때만 띄어 쓴 대로 다시 찾는다 (종류 거르개·쪽과 상관없이 같은 판단)
    exit when attempt = 2 or v_terms = v_split;
    execute 'select exists (' || c_hits || ')' into v_found
      using v_q, v_opts, v_grps, cardinality(v_terms), v_whole, p_section, p_content_type, p_region, p_from, p_to, v_today;
    exit when v_found;
    v_terms := v_split;
  end loop;

  if p_per_kind is null then
    v_limit := p_limit;
    v_offset := p_offset;
  else
    v_limit := p_per_kind * cardinality(c_kinds);
    v_offset := 0;
  end if;

  return query execute
    'with hits as (' || c_hits || $main$
    ),
    facet as (
      select coalesce(jsonb_object_agg(f.kind, f.n), '{}'::jsonb) as counts
      from (select h.kind, count(*) as n from hits h group by h.kind) f
    ),
    picked as (
      select h.*, count(*) over () as total,
        row_number() over (partition by h.kind order by h.tier, h.sort_at desc nulls last, h.sort_num, h.sort_name, h.ref) as kind_rank
      from hits h
      where $12::text[] is null or h.kind = any ($12)
    ),
    page as (
      select p.* from picked p
      where $15::integer is null or p.kind_rank <= $15
      order by (case when $15::integer is null then p.tier else 0 end), p.kord,
               (case when $15::integer is null then 0 else p.kind_rank end),
               p.sort_at desc nulls last, p.sort_num, p.sort_name, p.ref
      limit $13 offset $14
    )
    select p.kind, p.ref,
      case p.kind
        when 'article' then a.slug when 'situation' then s.slug when 'tracker' then m.slug when 'glossary' then g.id::text
        when 'region' then r.slug when 'category' then c.slug when 'person' then pe.slug end,
      case p.kind
        when 'article' then a.title when 'situation' then s.title when 'tracker' then m.title when 'glossary' then g.term
        when 'region' then r.name when 'category' then c.name when 'person' then pe.name end,
      case p.kind
        when 'article' then coalesce(nullif(btrim(a.summary), ''), left(regexp_replace(
               coalesce(jsonb_path_query_first(a.body, 'lax $.blocks[*] ? (@.type == "paragraph").text') #>> '{}', ''),
               '\[([^]\n]+)\]\([^)[:space:]]+\)', '\1', 'g'), 160))
        when 'situation' then s.subtitle
        when 'tracker' then m.summary
        when 'glossary' then coalesce(nullif(btrim(g.plain), ''), g.definition)
        when 'region' then rp.name
        when 'category' then c.intro
        when 'person' then pe.affiliation end,
      case p.kind
        when 'article' then a.section when 'situation' then s.section when 'tracker' then 'tax'
        when 'region' then 'local' when 'category' then c.section end,
      case p.kind when 'article' then a.content_type end,
      case p.kind when 'article' then a.first_published_at when 'tracker' then p.sort_at end,
      p.tier,
      case p.kind
        when 'article' then jsonb_build_object('format', a.format, 'label', a.label, 'partner_badge_name', a.partner_badge_name,
               'category_id', a.category_id, 'region_codes', to_jsonb(a.region_codes), 'subtype', a.subtype)
        when 'situation' then jsonb_build_object('pictogram', s.pictogram)
        when 'tracker' then jsonb_build_object('stage', cs.current_stage, 'stage_on', cs.current_stage_on, 'source_url', ev.source_url)
        when 'glossary' then jsonb_build_object('reading', g.reading, 'sections', to_jsonb(g.section))
        when 'region' then jsonb_build_object('level', r.level, 'parent_code', r.parent_code, 'parent_slug', rp.slug, 'parent_name', rp.name)
        when 'category' then '{}'::jsonb
        when 'person' then jsonb_build_object('roles', to_jsonb(pe.roles), 'beat', pe.beat) end,
      p.total,
      (select f.counts from facet f),
      $16::text[]
    from page p
    left join public.articles a on p.kind = 'article' and a.id = (case when p.kind = 'article' then p.ref::bigint end)
    left join public.situations s on p.kind = 'situation' and s.id = (case when p.kind = 'situation' then p.ref::bigint end)
    left join public.amendments m on p.kind = 'tracker' and m.id = (case when p.kind = 'tracker' then p.ref::bigint end)
    left join public.amendment_current_stages cs on cs.amendment_id = m.id
    left join public.amendment_events ev on ev.id = cs.event_id
    left join public.glossary_terms g on p.kind = 'glossary' and g.id = (case when p.kind = 'glossary' then p.ref::bigint end)
    left join public.regions r on p.kind = 'region' and r.code = p.ref
    left join public.regions rp on rp.code = r.parent_code
    left join public.categories c on p.kind = 'category' and c.id = (case when p.kind = 'category' then p.ref::bigint end)
    left join public.people pe on p.kind = 'person' and pe.id = (case when p.kind = 'person' then p.ref::bigint end)
    order by (case when $15::integer is null then p.tier else 0 end), p.kord,
             (case when $15::integer is null then 0 else p.kind_rank end),
             p.sort_at desc nulls last, p.sort_num, p.sort_name, p.ref
    $main$
    using v_q, v_opts, v_grps, cardinality(v_terms), v_whole, p_section, p_content_type, p_region, p_from, p_to, v_today,
          p_kinds, v_limit, v_offset, p_per_kind, v_terms;
end;
$fn$;

comment on function public.search_public(text, text[], text, text, text, date, date, integer, integer, integer) is
  '통합 검색 (W2-d 설계 7장 · SRCH-01·02) — 공개 행만, security invoker. 결과 종류·분야·기사 유형·지역·기간 거르개, 쪽 나눔·종류별 묶음. anon 실행 허용';

revoke all on function public.search_public(text, text[], text, text, text, date, date, integer, integer, integer) from public;
grant execute on function public.search_public(text, text[], text, text, text, date, date, integer, integer, integer) to anon, authenticated, service_role;
