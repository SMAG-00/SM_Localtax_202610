-- W2-d 3단계 DB — 용어사전 공개 상태·쉬운 풀이 한도·기능 키 (docs/dev/W2-d_설계.md 2.5 · 8.2, PRD-01A GLO-01 · GLO-02, W2-b 설계 9장 #12)
-- · glossary_terms.visible — 용어의 공개 상태. 새 용어는 숨김(false)으로 저장되고, 편집 책임자·관리자가 사전 화면에서 공개로 바꾼다
--   (용어 풀이는 편집국이 쓰고 세무 감수를 거친 뒤 공개한다 — GLO-01). 이 칸이 생기기 전부터 있던 용어는 W2-b 정책(모든 용어 공개)대로
--   공개 그대로 둔다 — 칸을 '공개'로 더한 뒤 기본값만 '숨김'으로 바꾼다(기존 행을 고치지 않아 고친 시각도 그대로)
-- · 공개 읽기 정책을 좁힌다 — anon·authenticated는 공개 용어만 읽는다. 용어사전 화면 · 허브·상황의 용어 칩 · 본문 툴팁 · 검색이 모두 이 경계를 쓴다.
--   검색 함수(security invoker)가 함수 안에서 같은 조건을 다시 걸도록 visible 칸 읽기 권한을 anon에도 연다(공개 행에서는 늘 true다)
-- · 쉬운 풀이 한도 — W2-a의 60자 check를 120자 check로 바꾼다. GLO-01 수용 기준 '쉬운 풀이는 60자 이하 (61자는 저장 경고)' — 61자는
--   저장되고 경고는 편집 화면·API가 낸다. 120자를 넘는 글(뜻을 통째로 붙인 글)은 DB가 막는다
-- · settings.feature_flags에 glossary(용어사전 화면 /glossary · /glossary/[번호]) — 꺼짐. 이미 값이 있으면 건드리지 않는다
-- · search_public — 용어 결과에 공개 조건(gl.visible) 한 줄을 더한다. 나머지 몸·인자·결과 모양·권한은 1단계(20261018000020) 그대로

alter table public.glossary_terms
  add column visible boolean not null default true;
alter table public.glossary_terms
  alter column visible set default false;

comment on column public.glossary_terms.visible is
  '공개 상태 (W2-d 3단계) — true인 용어만 공개 화면(용어사전·용어 칩·본문 툴팁·검색)에 나온다. 새 용어는 false, 편집 책임자·관리자가 바꾼다';

alter table public.glossary_terms
  drop constraint glossary_terms_plain_check,
  add constraint glossary_terms_plain_max check (plain is null or char_length(plain) <= 120);

comment on column public.glossary_terms.plain is
  '쉬운 풀이 한 줄 — 60자를 넘으면 저장 경고(GLO-01, 편집 화면·API), 120자를 넘으면 거부(glossary_terms_plain_max)';

drop policy glossary_terms_public_read on public.glossary_terms;
create policy glossary_terms_public_read on public.glossary_terms
  for select to anon, authenticated
  using (visible);

grant select (visible) on table public.glossary_terms to anon, authenticated;

update public.settings
   set value = value || jsonb_build_object('glossary', false),
       updated_by = 'migration:20261019000021'
 where key = 'feature_flags'
   and jsonb_typeof(value) = 'object'
   and not (value ? 'glossary');

-- ─────────────────────────────────────────────────────────────
-- search_public — 1단계 함수 그대로 + 용어 결과의 공개 조건 (and gl.visible)
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
  '통합 검색 (W2-d 설계 7장 · SRCH-01·02) — 공개 행만(용어는 공개 상태 visible — 3단계), security invoker. 결과 종류·분야·기사 유형·지역·기간 거르개, 쪽 나눔·종류별 묶음. anon 실행 허용';
