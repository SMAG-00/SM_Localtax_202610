-- W3 10단계 — 검색·측정 연결 (docs/dev/W3_설계.md 1장 10단계 · 2.5 · 11장, W2-d 설계 2.1·3장, W2-c 설계 2.1~2.3)
-- · 검색 — 해석 원문(legal_docs)을 검색 결과 종류 `interpretation`(해석 원문)으로 더한다. 공개 가능한 원문(공개 읽기 정책·legal_doc_public과 같은 조건)이면서
--   발행된 해석 해설(interpretation_articles 지정 · subject 연결)이 1건 이상인 원문만 — /tax/interpretations 목록에 나오는 원문이다. 결과 주소는 그 원문을
--   다루는 가장 최근 해설 기사(서버가 기능 키 interpretations가 켜졌을 때만 링크). 찾는 글 = 유형 글자(예규·통칙·유권해석·심판·판례)·발행 기관·문서 번호·세목·조문.
--   트래커(tracker)는 W2-d 1단계부터 결과 종류다 — 바꾸지 않는다. 칼럼(opinion)도 기사 결과로 이미 찾힌다.
-- · AI 색인 `불허` 칼럼 0 (TX-17) — 기고 계약의 AI 색인 범위가 deny인 칼럼은 기사 결과에서 뺀다. AI 도우미 검색 도구(01C CHAT-03)가 이 함수를 그대로
--   부르므로 사이트 검색에서도 빠진다(12장 #40). 범위는 공개 뷰 public_column_disclosures(6단계)에서 읽는다 — 계약 위치는 보지 않는다.
-- · 그 밖의 종류(지역·상황·트래커·용어·분야·인물)와 기사 결과의 다른 조건·순위·결과 모양·인자·권한은 W2-d 3단계(20261019000021) 그대로
-- · 측정 — 이벤트 이름 3개(calculator_card_clicked · amendment_viewed · interpretation_viewed)를 analytics_events.name 제약에 더한다 (W2-c 2.1 표와 같다)
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다(이름 제약은 값 3개를 더한 같은 이름 제약으로 바꾼다).

-- ─────────────────────────────────────────────────────────────
-- legal_docs — 찾는 글·이름 칸 (생성 칸 — 원문을 고치면 같은 문장 안에서 다시 계산된다)
-- ─────────────────────────────────────────────────────────────
alter table public.legal_docs
  add column search_text text generated always as (public.search_doc(
    array[case doc_type when 'ruling' then '예규' when 'circular' then '통칙' when 'interpretation' then '유권해석'
                        when 'tribunal' then '심판' when 'case' then '판례' end,
          issuer, doc_no] || tax_kinds || provisions)) stored,
  add column search_names text[] generated always as (public.search_keys(array[doc_no, coalesce(issuer, '') || ' ' || coalesce(doc_no, '')])) stored;

comment on column public.legal_docs.search_text is '찾는 글 (W3 10단계) — 유형 글자·발행 기관·문서 번호·세목·조문의 정규형, 칸 사이 줄바꿈. 생성 칸';
comment on column public.legal_docs.search_names is '이름 정규형 (순위 등급) — 문서 번호 · 기관+번호. 생성 칸';

create index legal_docs_search_idx on public.legal_docs using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');

-- 검색 함수(security invoker)가 함수 안에서 공개 조건을 다시 걸도록 조건 칸 읽기를 anon에도 연다 — 공개 읽기 정책이 공개 원문 행만 보이므로
-- 권리 상태는 늘 confirmed, 스냅샷 번호는 원본 표(raw_snapshots — anon 0)를 가리키는 번호뿐이다 (용어 visible 칸과 같은 방식)
grant select (search_text, search_names, rights_status, anonymity_check, snapshot_id) on table public.legal_docs to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- search_public — W2-d 3단계 함수 + 종류 interpretation(해석 원문) + 기사 결과의 AI 색인 불허 칼럼 제외
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
  -- 설계 2.1 · 2.3 표 (DB 시험이 읽어 대조한다) — interpretation(해석 원문)은 W3 10단계, 같은 등급 안에서 맨 뒤
  c_kinds constant text[] := array['region', 'situation', 'tracker', 'glossary', 'category', 'article', 'person', 'interpretation'];
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
        when 'region' then r.slug when 'category' then c.slug when 'person' then pe.slug when 'interpretation' then ix.slug end,
      case p.kind
        when 'article' then a.title when 'situation' then s.title when 'tracker' then m.title when 'glossary' then g.term
        when 'region' then r.name when 'category' then c.name when 'person' then pe.name
        when 'interpretation' then ld.issuer || ' ' || ld.doc_no end,
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
        when 'interpretation' then ix.title end,
      case p.kind
        when 'article' then a.section when 'situation' then s.section when 'tracker' then 'tax'
        when 'region' then 'local' when 'category' then c.section when 'interpretation' then 'tax' end,
      case p.kind when 'article' then a.content_type end,
      case p.kind when 'article' then a.first_published_at when 'tracker' then p.sort_at when 'interpretation' then p.sort_at end,
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
               'provisions', to_jsonb(ld.provisions), 'source_url', ld.source_url) end,
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
          p_kinds, v_limit, v_offset, p_per_kind, v_terms;
end;
$fn$;

comment on function public.search_public(text, text[], text, text, text, date, date, integer, integer, integer) is
  '통합 검색 (W2-d 설계 7장 · SRCH-01·02 · W3 10단계) — 공개 행만(용어는 공개 상태 visible, 해석 원문은 공개 가능 + 발행된 해석 해설, AI 색인 불허 칼럼 0), security invoker. 결과 종류·분야·기사 유형·지역·기간 거르개, 쪽 나눔·종류별 묶음. anon 실행 허용';

-- ─────────────────────────────────────────────────────────────
-- analytics_events.name — 이벤트 3개 더하기 (W2-c 설계 2.1 표, 시험 tests/w2c-analytics.test.mjs가 표와 제약 값 집합을 대조한다)
-- ─────────────────────────────────────────────────────────────
alter table public.analytics_events drop constraint analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
  'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
  'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
  'redirect_hit', 'not_found_viewed',
  'calculator_card_clicked', 'amendment_viewed', 'interpretation_viewed'));
