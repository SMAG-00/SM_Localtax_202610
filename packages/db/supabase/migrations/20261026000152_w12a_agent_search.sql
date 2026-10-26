-- W12-a a4 - 하이브리드 검색 함수 (docs/dev/W12-a_설계.md 3장 · PRD-04 RAG-04 · RAG-06 · ASK-14)
-- · agent_search - 전문 검색(PGroonga) + 벡터 검색(있을 때만)을 RRF로 합친다. 기준일·접근 등급·권리·범위 필터는 모두 함수 안 SQL에서 강제한다.
--   접근 등급은 인자가 아니라 auth.uid()의 has_entitlement('digital')로 정한다 (클라이언트 값 무시). 비구독자·비회원은 premium 청크 0.
--   범위 플래그(settings ask_scope_flags)가 꺼진 범위(신탁·정비/상속/증여)의 청크는 anon·일반 회원 키로도 0.
-- · 벡터 분기는 p_embedding이 있고 chunk_embeddings 표가 있을 때만 동적 SQL로 돈다 - pgvector가 없어도 이 함수는 만들어지고 전문 검색만 한다.
-- · 순위: 전문 검색은 질의 낱말이 들어 있는 개수(많을수록 앞), 같으면 id 큰 것. RRF 점수 = sum(1 / (60 + 순위)).
-- · agent_premium_hint - 비구독자에게 "프리미엄 해설 n건" 안내용 건수만 돌려준다 (본문 0).
-- anon·authenticated가 실행한다 (웹 서버는 공개 키 + 사용자 토큰으로 부른다) - verify-rls 허용 목록에 같은 커밋에서 더했다.

-- 질의 낱말 - 공백으로 나눠 W2-d 정규형으로 만들고, 2글자 미만은 버린다. 3글자 이상은 끝 한 글자를 뗀 낱말도 더한다(조사 붙은 낱말 대응). 최대 16개
create function public.chunk_query_terms(p_query text) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(t order by n), '{}')
  from (
    select t, min(n) as n
    from (
      select w.k as t, w.ord * 2 as n
        from (select public.search_squash(x) as k, ord from unnest(regexp_split_to_array(left(coalesce(p_query, ''), 500), '\s+')) with ordinality as u(x, ord)) w
       where char_length(w.k) >= 2
      union all
      select left(w.k, char_length(w.k) - 1), w.ord * 2 + 1
        from (select public.search_squash(x) as k, ord from unnest(regexp_split_to_array(left(coalesce(p_query, ''), 500), '\s+')) with ordinality as u(x, ord)) w
       where char_length(w.k) >= 3
    ) s
    group by t
    order by min(n)
    limit 16
  ) d
$$;
revoke all on function public.chunk_query_terms(text) from public, anon, authenticated;
grant execute on function public.chunk_query_terms(text) to service_role;

-- 한 청크를 이 호출자가 볼 수 있는가 - 두 분기(전문·벡터)와 안내 건수가 같은 식을 쓴다
create function public.chunk_allowed(c public.chunks, p_asof date, p_premium boolean, p_flags jsonb, p_tax_items text[], p_source_types text[], p_scopes text[]) returns boolean
language sql
stable
set search_path = ''
as $$
  select c.retired_at is null
     and c.rights_status = 'confirmed'
     and c.valid_from <= p_asof and (c.valid_to is null or p_asof < c.valid_to)
     and (c.access_tier = 'public' or p_premium)
     and (c.scope = 'base' or (p_flags ->> c.scope) = 'true')
     and (p_scopes is null or c.scope = any(p_scopes))
     and (p_tax_items is null or c.tax_items && p_tax_items)
     and (p_source_types is null or c.source_type = any(p_source_types))
$$;
revoke all on function public.chunk_allowed(public.chunks, date, boolean, jsonb, text[], text[], text[]) from public, anon, authenticated;
grant execute on function public.chunk_allowed(public.chunks, date, boolean, jsonb, text[], text[], text[]) to service_role;

create function public.agent_search(
  p_query text,
  p_as_of date default null,
  p_tax_items text[] default null,
  p_source_types text[] default null,
  p_scopes text[] default null,
  p_embedding double precision[] default null,
  p_embedding_model text default null,
  p_limit int default 40
) returns table (
  chunk_id bigint, source_type text, source_id text, doc_type text, path text, content text, tax_items text[],
  valid_from date, valid_to date, scope text, access_tier text, snapshot_id bigint, chunk_no int,
  fts_rank int, vec_rank int, rrf_score double precision)
language plpgsql
stable
security definer
set search_path = extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_premium boolean := false;
  v_asof date := coalesce(p_as_of, (now() at time zone 'Asia/Seoul')::date);
  v_flags jsonb := coalesce((select s.value from public.settings s where s.key = 'ask_scope_flags' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb);
  v_terms text[] := public.chunk_query_terms(p_query);
  v_pq text;
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_fetch int;
  v_tax text[] := case when p_tax_items is null then null else p_tax_items[1:20] end;
  v_vec_ids bigint[] := '{}';
  v_fts_ids bigint[] := '{}';
begin
  if v_uid is not null then
    v_premium := public.has_entitlement(v_uid, 'digital');
  end if;
  v_fetch := v_limit * 3;
  v_pq := array_to_string(v_terms, ' OR ');

  if v_pq <> '' then
    select coalesce(array_agg(f.id order by f.score desc, f.id desc), '{}') into v_fts_ids
      from (
        select c.id, (select count(*) from unnest(v_terms) t where strpos(c.search_text, t) > 0) as score
          from public.chunks c
         where c.search_text operator(extensions.&@~) extensions.pgroonga_condition(v_pq, index_name => 'public.chunks_search_idx')
           and public.chunk_allowed(c, v_asof, v_premium, v_flags, v_tax, p_source_types, p_scopes)
         order by 2 desc, c.id desc
         limit v_fetch
      ) f;
  end if;

  -- 벡터 분기 - 임베딩이 오고 벡터 표가 있을 때만. 차원이 맞지 않는 등 실패하면 전문 검색 결과만 쓴다.
  if p_embedding is not null and p_embedding_model is not null and to_regclass('public.chunk_embeddings') is not null then
    begin
      perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
      execute $q$
        select coalesce(array_agg(v.id order by v.d, v.id), '{}')
          from (
            select c.id, e.embedding operator(extensions.<=>) ($1::double precision[]::extensions.vector) as d
              from public.chunk_embeddings e
              join public.chunks c on c.id = e.chunk_id
             where e.model = $2
               and public.chunk_allowed(c, $3, $4, $5, $6, $7, $8)
             order by 2
             limit $9
          ) v$q$
        into v_vec_ids
        using p_embedding, p_embedding_model, v_asof, v_premium, v_flags, v_tax, p_source_types, p_scopes, v_fetch;
    exception when others then
      v_vec_ids := '{}';
    end;
  end if;

  return query
    with f as (select u.id, u.n::int as r from unnest(v_fts_ids) with ordinality as u(id, n)),
         v as (select u.id, u.n::int as r from unnest(v_vec_ids) with ordinality as u(id, n)),
         ids as (select id from f union select id from v)
    select c.id, c.source_type, c.source_id, c.doc_type, c.path, c.content, c.tax_items,
           c.valid_from, c.valid_to, c.scope, c.access_tier, c.snapshot_id, c.chunk_no,
           f.r, v.r,
           (coalesce(1.0 / (60 + f.r), 0) + coalesce(1.0 / (60 + v.r), 0))::double precision
      from ids
      join public.chunks c on c.id = ids.id
      left join f on f.id = ids.id
      left join v on v.id = ids.id
     order by 16 desc, c.id desc
     limit v_limit;
end;
$$;
comment on function public.agent_search(text, date, text[], text[], text[], double precision[], text, int) is
  '근거형 AI 하이브리드 검색 (RAG-04) - 필터는 함수 안 SQL, 등급은 auth.uid()+has_entitlement, 범위 플래그 꺼짐이면 그 범위 0';
revoke all on function public.agent_search(text, date, text[], text[], text[], double precision[], text, int) from public;
grant execute on function public.agent_search(text, date, text[], text[], text[], double precision[], text, int) to anon, authenticated, service_role;

create function public.agent_premium_hint(p_query text, p_as_of date default null, p_tax_items text[] default null, p_scopes text[] default null) returns int
language plpgsql
stable
security definer
set search_path = extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_asof date := coalesce(p_as_of, (now() at time zone 'Asia/Seoul')::date);
  v_flags jsonb := coalesce((select s.value from public.settings s where s.key = 'ask_scope_flags' and jsonb_typeof(s.value) = 'object'), '{}'::jsonb);
  v_terms text[] := public.chunk_query_terms(p_query);
  v_pq text := array_to_string(public.chunk_query_terms(p_query), ' OR ');
  v_n int;
begin
  -- 구독자는 본문을 직접 받으므로 안내 건수 0
  if v_uid is not null and public.has_entitlement(v_uid, 'digital') then return 0; end if;
  if v_pq = '' then return 0; end if;
  select count(distinct (c.source_type, c.source_id)) into v_n
    from public.chunks c
   where c.search_text operator(extensions.&@~) extensions.pgroonga_condition(v_pq, index_name => 'public.chunks_search_idx')
     and c.access_tier = 'premium'
     and public.chunk_allowed(c, v_asof, true, v_flags, case when p_tax_items is null then null else p_tax_items[1:20] end, null, p_scopes);
  return v_n;
end;
$$;
comment on function public.agent_premium_hint(text, date, text[], text[]) is '비구독자에게 "프리미엄 해설 n건" 안내용 건수 (ASK-14) - 본문·제목 0';
revoke all on function public.agent_premium_hint(text, date, text[], text[]) from public;
grant execute on function public.agent_premium_hint(text, date, text[], text[]) to anon, authenticated, service_role;

-- 임베딩 쓰기·백필 목록 (service_role 전용). pgvector가 없으면 { ok:false, code:'vector_unavailable' }
create function public.chunk_embedding_put(p_chunk_id bigint, p_model text, p_embedding double precision[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.chunk_embeddings') is null then
    return jsonb_build_object('ok', false, 'code', 'vector_unavailable');
  end if;
  if p_embedding is null or cardinality(p_embedding) = 0 or coalesce(btrim(p_model), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  begin
    execute 'insert into public.chunk_embeddings (chunk_id, model, embedding) values ($1, $2, $3::double precision[]::extensions.vector) on conflict (chunk_id, model) do nothing'
      using p_chunk_id, p_model, p_embedding;
  exception when data_exception or invalid_parameter_value then
    return jsonb_build_object('ok', false, 'code', 'bad_dimension');
  end;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.chunk_embedding_put(bigint, text, double precision[]) from public, anon, authenticated;
grant execute on function public.chunk_embedding_put(bigint, text, double precision[]) to service_role;

create function public.chunks_without_embedding(p_model text, p_limit int default 50) returns table (chunk_id bigint, path text, content text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.chunk_embeddings') is null then return; end if;
  return query execute
    'select c.id, c.path, c.content from public.chunks c where c.retired_at is null and c.rights_status = ''confirmed'' and not exists (select 1 from public.chunk_embeddings e where e.chunk_id = c.id and e.model = $1) order by c.id limit $2'
    using p_model, least(greatest(p_limit, 1), 500);
end;
$$;
revoke all on function public.chunks_without_embedding(text, int) from public, anon, authenticated;
grant execute on function public.chunks_without_embedding(text, int) to service_role;
