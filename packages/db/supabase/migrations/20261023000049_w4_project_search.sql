-- W4 15단계 — 프로젝트 공개 화면·검색 (PRD-01B PR-01 · PR-02 · PR-03 · PR-05 · REG1-10, docs/dev/W4_설계.md 1장 15단계 · 2.1 search.kind · 2.4 · 3장 · 12장 #99 · #103 · #120~)
-- 이 파일에 실제 프로젝트·사업 유형·단계 이름·고시 번호는 없다 (12장 #10 — 목록은 편집국 초안 + 감수 뒤 설정에 넣는다).
-- · 기능 키 realestate_projects (2.4) — 꺼진 채로 더한다. 켜지면 /realestate/projects*·지역 허브 ③ 프로젝트 카드·검색 결과 프로젝트·확인된 연결의 프로젝트 링크.
--     꺼져 있으면 상세 404·목록은 하위 분야 목록·검색 결과 프로젝트 0(이 파일의 public_project_search가 키를 본다)·링크 0
-- · projects 찾는 글 칸(생성 칸 — 이름·요약의 정규형, 이름 정규형) + PGroonga 색인 projects_search_idx — W2-d와 같은 색인 설정.
--     표 권한은 그대로(anon·authenticated 0) — 검색은 공개 뷰 public_project_search로만 읽는다
-- · 공개 뷰 public_project_search (anon) — 공개 프로젝트(public_projects)이고 기능 키가 켜졌을 때만, 칸 = 번호·주소·이름·지역·대표 표시·현재 단계 고시일·찾는 글 2칸
-- · 공개 뷰 public_project_stage_lists (anon) — 공개 프로젝트가 쓰는 사업 유형의 전체 단계 목록(차례·키·글자) — 아직 기록이 없는 단계까지 보이는 타임라인(12장 #99)
-- · search_public — W4 10단계(…45) 함수 그대로 + 결과 종류 project(같은 등급 안에서 맨 뒤 — 2.1). 인자·결과 모양·권한은 그대로, 분류 갈래는 기사만(12장 #123)
-- 가격·분양가·분담금·수익률·시세 칸 0 (PR-05 — 시험 w4-price-fields가 새 뷰도 본다). 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 기능 키 realestate_projects — 없을 때만 false로 더한다 (이미 있는 값은 그대로)
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = s.value || jsonb_build_object('realestate_projects', false),
       updated_by = 'migration:20261023000049'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and not (s.value ? 'realestate_projects');

-- ─────────────────────────────────────────────────────────────
-- 찾는 글 칸 (생성 칸) + PGroonga 색인 — W2-d …20과 같은 함수·같은 색인 설정
-- ─────────────────────────────────────────────────────────────
alter table public.projects
  add column search_text text generated always as (public.search_doc(array[name, summary])) stored,
  add column search_names text[] generated always as (public.search_keys(array[name])) stored;

comment on column public.projects.search_text is '찾는 글 (W4 15단계) — 이름·요약의 정규형, 칸 사이 줄바꿈. 생성 칸';
comment on column public.projects.search_names is '이름 정규형 (W4 15단계 순위 등급) — 이름. 생성 칸';

create index projects_search_idx on public.projects using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 검색용 (공개 프로젝트 + 기능 키 realestate_projects 켜짐)
-- ─────────────────────────────────────────────────────────────
create view public.public_project_search as
select p.id, p.slug, p.name, p.region_code, p.landmark, pp.current_stage_notice_date, p.search_text, p.search_names
  from public.projects p
  join public.public_projects pp on pp.id = p.id
 where coalesce((select (f.value -> 'realestate_projects') = 'true'::jsonb from public.settings f where f.key = 'feature_flags'), false);

comment on view public.public_project_search is '검색용 공개 프로젝트 (W4 15단계) — 공개 프로젝트(public_projects)이고 기능 키 realestate_projects가 켜졌을 때만. 찾는 글은 공개 칸(이름·요약)에서만 만든다';
revoke all on table public.public_project_search from public, anon, authenticated, service_role;
grant select on table public.public_project_search to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 공개 프로젝트가 쓰는 사업 유형의 전체 단계 목록 (12장 #99 — 첫 단계 … 마지막 단계 타임라인)
-- ─────────────────────────────────────────────────────────────
create view public.public_project_stage_lists as
select t.project_type, x.ord::integer as stage_position, x.item ->> 'key' as stage, x.item ->> 'label' as stage_label
  from (select distinct pp.project_type from public.public_projects pp) t
  join public.settings s on s.key = 'project_stage_lists'
 cross join lateral jsonb_array_elements(case when jsonb_typeof(s.value -> t.project_type) = 'array' then s.value -> t.project_type else '[]'::jsonb end)
       with ordinality as x(item, ord);

comment on view public.public_project_stage_lists is '공개 프로젝트가 쓰는 사업 유형의 전체 단계 목록 (PR-02 · W4 15단계 — 차례·키·글자). 공개 프로젝트가 없는 유형은 0행. 목록 순서를 바꾸면 다음 읽기부터';
revoke all on table public.public_project_stage_lists from public, anon, authenticated, service_role;
grant select on table public.public_project_stage_lists to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- search_public — W4 10단계 함수 + 결과 종류 project (W4 15단계 — 트래커 탭)
-- ─────────────────────────────────────────────────────────────
create or replace function public.search_public(
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
  -- 설계 2.1 · 2.3 표 (DB 시험이 읽어 대조한다) — interpretation(해석 원문)은 W3 10단계, project(프로젝트)는 W4 15단계 — 같은 등급 안에서 맨 뒤
  c_kinds constant text[] := array['region', 'situation', 'tracker', 'glossary', 'category', 'article', 'person', 'interpretation', 'project'];
  c_sections constant text[] := array['tax', 'realestate', 'finance', 'local'];
  c_content_types constant text[] := array['reported_news', 'explainer', 'guide', 'opinion', 'sponsored'];
  c_query_chars constant integer := 100;
  c_max_terms constant integer := 8;
  c_max_limit constant integer := 50;
  c_max_offset constant integer := 1000;
  c_max_per_kind constant integer := 10;

  -- 기사 결과의 공개 조건·거르개 (기사 두 갈래 — 글에 모든 낱말 · 분류된 지역 태그 + 남은 낱말 — 가 같이 쓴다)
  c_article_where constant text := $aw$
      and a.status = 'published' and a.lead_media_cleared and not a.is_paid
      and a.content_type is distinct from 'digest'
      -- AI 색인 불허 칼럼 0 (TX-17 · W3 10단계) — 기고 계약의 AI 색인 범위가 deny인 칼럼 (계약이 없는 칼럼은 그대로 — 12장 #40)
      and (a.content_type is distinct from 'opinion'
           or not exists (select 1 from public.public_column_disclosures cd where cd.article_id = a.id and cd.ai_index_scope = 'deny'))
      and ($6::text is null or a.section = $6)
      and ($7::text is null or a.content_type = $7)
      and ($8::text is null or exists (
            select 1 from unnest(a.region_codes) rc
             where rc = $8 or (right($8, 8) = '00000000' and left(rc, 2) = left($8, 2))))
      and ($9::date is null or (a.first_published_at at time zone 'Asia/Seoul')::date >= $9)
      and ($10::date is null or (a.first_published_at at time zone 'Asia/Seoul')::date <= $10)
  $aw$;
  c_article_tier constant text := $at$
      (case when $5 = any(a.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(a.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint
  $at$;

  -- 종류마다 찾은 행: (종류, 번호, 등급, 종류 순서, 날짜, 정렬 숫자, 정렬 이름)
  -- $1 PGroonga 질의 · $2 낱말 선택지 · $3 선택지의 낱말 번호 · $4 낱말 수 · $5 검색어 전체 정규형
  -- $6 분야 · $7 기사 유형 · $8 지역 코드 · $9 시작일 · $10 종료일 · $11 오늘(한국 날짜)
  -- 분류 자리(주석) — 지역 후보가 있을 때만 채운다: $17 지역 후보 · $18 남은 낱말 PGroonga 질의 · $19 태그 코드(후보 + 시·도 후보의 하위)
  c_hits constant text := $h1$
    select 'article'::text as kind, a.id::text as ref, $h1$ || c_article_tier || $h2$ as tier,
      6 as kord, a.first_published_at as sort_at, 0 as sort_num, a.title as sort_name
    from public.articles a
    where a.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.articles_search_idx')
    $h2$ || c_article_where || $h3$
    /*classified_articles*/
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
      and gl.visible
      and $7::text is null and $8::text is null and $9::date is null and $10::date is null
      and ($6::text is null or $6 = any(gl.section))
    union all
    select 'region', r.code,
      (case /*classified_region_tier*/ when $5 = any(r.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(r.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      1, null::timestamptz, (case when r.level = 'sido' then 0 else 1 end), r.name
    from public.regions r
    where (r.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.regions_search_idx') /*classified_regions*/)
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
    union all
    -- 해석 원문 (W3 10단계) — 공개 가능한 원문(정책·legal_doc_public과 같은 식) + 발행된 해석 해설의 subject 원문. 날짜 = 결정·회신일, 분야 = 지방세
    select 'interpretation', d.id::text,
      (case when $5 = any(d.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(d.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      8, (d.decided_on::timestamp at time zone 'Asia/Seoul'), 0, d.issuer || ' ' || d.doc_no
    from public.legal_docs d
    where d.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.legal_docs_search_idx')
      and d.rights_status = 'confirmed'
      and coalesce(btrim(d.issuer), '') <> '' and coalesce(btrim(d.doc_no), '') <> ''
      and d.decided_on is not null and d.source_url is not null and d.snapshot_id is not null
      and coalesce(btrim(d.content_hash), '') <> '' and cardinality(d.tax_kinds) > 0
      and (d.doc_type in ('ruling', 'circular', 'interpretation') or d.anonymity_check = 'confirmed')
      and exists (
            select 1 from public.article_legal_docs l
              join public.interpretation_articles ia on ia.article_id = l.article_id
              join public.articles x on x.id = l.article_id
             where l.legal_doc_id = d.id and l.role = 'subject'
               and x.status = 'published' and x.lead_media_cleared and not x.is_paid)
      and $7::text is null and $8::text is null
      and ($6::text is null or $6 = 'tax')
      and ($9::date is null or d.decided_on >= $9)
      and ($10::date is null or d.decided_on <= $10)
    union all
    -- 프로젝트 (W4 15단계) — 공개 프로젝트(공개 단계 기록 1건 이상)이고 기능 키 realestate_projects가 켜졌을 때만(뷰 public_project_search).
    -- 찾는 글 = 이름·요약, 날짜 = 현재 단계 고시일, 분야 = 부동산, 지역 = 프로젝트 지역(시·도 거르개는 그 아래 시·군·구 포함). 기사 유형을 고르면 0
    select 'project', ps.id::text,
      (case when $5 = any(ps.search_names) then 0
            when (select count(distinct u.g) from unnest($2, $3) as u(o, g) where exists (select 1 from unnest(ps.search_names) nm where strpos(nm, u.o) > 0)) = $4 then 1
            else 2 end)::smallint,
      9, (ps.current_stage_notice_date::timestamp at time zone 'Asia/Seoul'), (case when ps.landmark then 0 else 1 end), ps.name
    from public.public_project_search ps
    where ps.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.projects_search_idx')
      and $7::text is null
      and ($6::text is null or $6 = 'realestate')
      and ($8::text is null or ps.region_code = $8 or (right($8, 8) = '00000000' and left(ps.region_code, 2) = left($8, 2)))
      and ($9::date is null or ps.current_stage_notice_date >= $9)
      and ($10::date is null or ps.current_stage_notice_date <= $10)
  $h3$;
  -- 분류된 지역 태그 기사 (두 번째 갈래) — 남은 낱말이 모두 들고 후보 지역 태그가 있는 기사. 공개 조건·거르개는 첫 갈래와 같다.
  -- 첫 갈래와 겹치는 기사는 union(같은 행 하나)으로 한 번만 — 두 갈래의 행은 칸이 모두 같다(같은 등급 식). union은 앞의 기사 갈래까지만 묶는다(왼쪽부터)
  c_region_articles constant text := $ra1$
    union
    select 'article'::text, a.id::text, $ra1$ || c_article_tier || $ra2$,
      6, a.first_published_at, 0, a.title
    from public.articles a
    where a.search_text operator(extensions.&@~) extensions.pgroonga_condition($18, index_name => 'public.articles_search_idx')
      and a.region_codes && $19::text[]
    $ra2$ || c_article_where;

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
  -- 분류 (W4 10단계)
  v_hits text;
  v_cls_regions text[] := '{}';
  v_cls_topics text[] := '{}';
  v_cls_rest text[] := '{}';
  v_tag_codes text[];
  v_tv jsonb;
  v_rq text;
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

    -- 붙인 낱말이 띄어 쓴 낱말과 다르면, 붙여서 0건일 때만 띄어 쓴 대로 다시 찾는다 (종류 거르개·쪽과 상관없이 같은 판단 — 분류 자리는 비운 채)
    exit when attempt = 2 or v_terms = v_split;
    execute 'select exists (' || c_hits || ')' into v_found
      using v_q, v_opts, v_grps, cardinality(v_terms), v_whole, p_section, p_content_type, p_region, p_from, p_to, v_today;
    exit when v_found;
    v_terms := v_split;
  end loop;

  -- 지역 + 주제 분류 (W4 10단계) — 쓴 낱말로. 지역 후보가 있으면 그 지역을 등급 0 결과로, 남은 낱말이 있으면 그 지역 태그 기사에서도 찾는다
  select c.region_codes, c.topics, c.rest into v_cls_regions, v_cls_topics, v_cls_rest from public.search_classify(v_terms) c;
  v_hits := c_hits;
  if cardinality(v_cls_regions) > 0 then
    v_hits := replace(replace(v_hits, '/*classified_regions*/', 'or r.code = any ($17::text[])'), '/*classified_region_tier*/', 'when r.code = any ($17::text[]) then 0');
    if cardinality(v_cls_topics) + cardinality(v_cls_rest) > 0 then
      -- 태그 코드 = 후보 + 시·도 후보 아래 시·군·구(폐지 포함 — 이미 단 태그는 남는다)
      v_tag_codes := array(select distinct z.x from (select unnest(v_cls_regions) as x union select r.code from public.regions r where r.parent_code = any (v_cls_regions)) z order by 1);
      select st.value into v_tv from public.settings st where st.key = 'search_topics';
      -- 남은 낱말 질의 — 주제는 그 주제의 글자·별칭 중 하나, 남은 낱말은 낱말 또는 동의어. 묶음끼리는 그리고
      select string_agg('(' || q.opts || ')', ' ' order by q.g) into v_rq
      from (
        select z.g, string_agg('"' || replace(replace(z.o, '\', '\\'), '"', '\"') || '"', ' OR ' order by z.o) as opts
        from (
          select t.n::integer as g, w.k as o
            from unnest(v_cls_topics) with ordinality as t(tk, n)
            cross join lateral (
              select regexp_replace(lower(normalize(w0.x, NFKC)), '[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+', '', 'g') as k
              from (select v_tv -> t.tk ->> 'label' as x
                    union all
                    select e from jsonb_array_elements_text(case when jsonb_typeof(v_tv -> t.tk -> 'aliases') = 'array' then v_tv -> t.tk -> 'aliases' else '[]'::jsonb end) as e) w0
              where w0.x is not null
            ) w
           where w.k <> ''
          union
          select 100 + t.n::integer, t.x from unnest(v_cls_rest) with ordinality as t(x, n)
          union
          select 100 + t.n::integer, sk.k
            from unnest(v_cls_rest) with ordinality as t(x, n)
            join public.search_synonyms y on y.term_key = t.x and y.enabled
            cross join lateral unnest(y.synonym_keys) as sk(k)
           where sk.k <> ''
        ) z
        group by z.g
      ) q;
      if v_rq is not null then
        v_hits := replace(v_hits, '/*classified_articles*/', c_region_articles);
      end if;
    end if;
  end if;

  if p_per_kind is null then
    v_limit := p_limit;
    v_offset := p_offset;
  else
    v_limit := p_per_kind * cardinality(c_kinds);
    v_offset := 0;
  end if;

  return query execute
    'with hits as (' || v_hits || $main$
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
        when 'region' then r.slug when 'category' then c.slug when 'person' then pe.slug when 'interpretation' then ix.slug
        when 'project' then pj.slug end,
      case p.kind
        when 'article' then a.title when 'situation' then s.title when 'tracker' then m.title when 'glossary' then g.term
        when 'region' then r.name when 'category' then c.name when 'person' then pe.name
        when 'interpretation' then ld.issuer || ' ' || ld.doc_no
        when 'project' then pj.name end,
      case p.kind
        when 'article' then coalesce(nullif(btrim(a.summary), ''), left(regexp_replace(
               coalesce(jsonb_path_query_first(a.body, 'lax $.blocks[*] ? (@.type == "paragraph").text') #>> '{}', ''),
               '\[([^]\n]+)\]\([^)[:space:]]+\)', '\1', 'g'), 160))
        when 'situation' then s.subtitle
        when 'tracker' then m.summary
        when 'glossary' then coalesce(nullif(btrim(g.plain), ''), g.definition)
        when 'region' then rp.name
        when 'category' then c.intro
        when 'person' then pe.affiliation
        when 'interpretation' then ix.title
        when 'project' then pj.summary end,
      case p.kind
        when 'article' then a.section when 'situation' then s.section when 'tracker' then 'tax'
        when 'region' then 'local' when 'category' then c.section when 'interpretation' then 'tax'
        when 'project' then 'realestate' end,
      case p.kind when 'article' then a.content_type end,
      case p.kind when 'article' then a.first_published_at when 'tracker' then p.sort_at when 'interpretation' then p.sort_at when 'project' then p.sort_at end,
      p.tier,
      case p.kind
        when 'article' then jsonb_build_object('format', a.format, 'label', a.label, 'partner_badge_name', a.partner_badge_name,
               'category_id', a.category_id, 'region_codes', to_jsonb(a.region_codes), 'subtype', a.subtype)
        when 'situation' then jsonb_build_object('pictogram', s.pictogram)
        when 'tracker' then jsonb_build_object('stage', cs.current_stage, 'stage_on', cs.current_stage_on, 'source_url', ev.source_url)
        when 'glossary' then jsonb_build_object('reading', g.reading, 'sections', to_jsonb(g.section))
        when 'region' then jsonb_build_object('level', r.level, 'parent_code', r.parent_code, 'parent_slug', rp.slug, 'parent_name', rp.name)
        when 'category' then '{}'::jsonb
        when 'person' then jsonb_build_object('roles', to_jsonb(pe.roles), 'beat', pe.beat)
        when 'interpretation' then jsonb_build_object('doc_type', ld.doc_type, 'decided_on', ld.decided_on, 'tax_kinds', to_jsonb(ld.tax_kinds),
               'provisions', to_jsonb(ld.provisions), 'source_url', ld.source_url)
        -- 프로젝트 — 현재 단계(키·글자·고시일)·사업 유형·지역 코드·대표 표시만 (가격 칸 0 — PR-05)
        when 'project' then jsonb_build_object('stage', pj.current_stage, 'stage_label', pj.current_stage_label, 'stage_on', pj.current_stage_notice_date,
               'project_type', pj.project_type, 'project_type_label', pj.project_type_label, 'region_code', pj.region_code, 'landmark', pj.landmark) end,
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
    left join public.legal_docs ld on p.kind = 'interpretation' and ld.id = (case when p.kind = 'interpretation' then p.ref::bigint end)
    left join public.public_projects pj on p.kind = 'project' and pj.id = (case when p.kind = 'project' then p.ref::bigint end)
    -- 해석 원문의 주소 = 그 원문을 subject로 다루는 가장 최근 발행 해설 (hits와 같은 공개 조건)
    left join lateral (
      select x.slug, x.title from public.article_legal_docs l
        join public.interpretation_articles ia on ia.article_id = l.article_id
        join public.articles x on x.id = l.article_id
       where l.legal_doc_id = ld.id and l.role = 'subject'
         and x.status = 'published' and x.lead_media_cleared and not x.is_paid
       order by x.first_published_at desc nulls last, x.id desc
       limit 1) ix on true
    order by (case when $15::integer is null then p.tier else 0 end), p.kord,
             (case when $15::integer is null then 0 else p.kind_rank end),
             p.sort_at desc nulls last, p.sort_num, p.sort_name, p.ref
    $main$
    using v_q, v_opts, v_grps, cardinality(v_terms), v_whole, p_section, p_content_type, p_region, p_from, p_to, v_today,
          p_kinds, v_limit, v_offset, p_per_kind, v_terms, v_cls_regions, v_rq, v_tag_codes;
end;
$fn$;

comment on function public.search_public(text, text[], text, text, text, date, date, integer, integer, integer) is
  '통합 검색 (W2-d 설계 7장 · SRCH-01·02 · W3 10단계 · W4 10·15단계) — 공개 행만(용어는 공개 상태 visible, 해석 원문은 공개 가능 + 발행된 해석 해설, AI 색인 불허 칼럼 0, 프로젝트는 공개 프로젝트 + 기능 키 realestate_projects), security invoker. 결과 종류·분야·기사 유형·지역·기간 거르개, 쪽 나눔·종류별 묶음. 지역 + 주제 분류(search_classify) — 지역 후보를 첫 결과로, 그 지역 태그 기사의 주제 검색을 더한다. anon 실행 허용';
