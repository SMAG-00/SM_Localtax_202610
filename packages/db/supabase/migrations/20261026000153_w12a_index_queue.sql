-- W12-a a5 - 증분 색인: 원천 표시 · 색인 대기열 · 색인 쓰기 (docs/dev/W12-a_설계.md 3장 · PRD-04 RAG-03)
-- · raw_snapshots.origin - 스냅샷이 어디서 왔는가 (pipeline = 2단계 수집 · live_fetch = 지방세봇 실시간 조회 · web_search = 공식 도메인 검색 · stats = 통계 수집).
--   색인은 origin = pipeline 스냅샷만 읽는다 - 실시간 조회 원문은 수집 대기열 검수를 마치기 전에는 색인에 넣지 않는다 (4단계_설계 4.6).
--   기존 행은 모두 2단계 이전 수집·수기 입력이라 pipeline 으로 둔다.
-- · chunk_sources - 색인할 수 있는 원천의 단일 목록 (내부 뷰, service_role 전용). 법령 조문(지방세·연관 국세 법령만) · 공개 가능한 해석/결정례 · 공개된 가이드 버전 · 공개된 쟁점 지도 버전.
--   법령 권리 상태는 'confirmed' 로 둔다 [확인 필요: 법령 원문 이용 권리 - 법률 확인]. tax_items 는 거친 분류(법령 scope · 가이드 허브 · 문서의 tax_kinds)이며 세목별 정밀 분류는 감수 입력 [감수 필요].
--   범위 태그: 상속·증여가 한쪽만 나오는 해석은 inheritance/gift, 둘 다 나오면 이 단위에서는 색인하지 않는다(W12-c 몫). 신탁·정비 허브 가이드·지도는 trust_redevelopment (플래그가 꺼지면 검색 0).
--   상속·증여 허브 지도·'related'·'national_igt' 법령은 W12-c(c4)가 범위를 정해 더한다.
-- · index_queue - 색인할 원천 대기열. index_queue_scan(수집 뒤 1시간 안에 작업이 부른다)이 새로 생겼거나 해시·범위·색인 버전이 달라진 원천을 쌓고, 더는 색인할 수 없는 원천(권리 철회·공개 내림)의 청크는 즉시 뺀다.
-- · chunk_index_put - 한 원천의 청크 묶음을 한 번에 넣는다. 메타가 비면 { ok:false, code } 로 거부, 권리 미확인 거부, 같은 입력은 멱등, 바뀐 조각은 이전 행을 빼고 새 행.
--   법령 조문은 supersede_key 로 더 새 개정판이 색인되면 옛 행의 valid_to 를 채운다 (양방향 - 옛 개정판을 나중에 색인해도 valid_to 가 붙는다).

alter table public.raw_snapshots
  add column origin text not null default 'pipeline' check (origin in ('pipeline', 'live_fetch', 'web_search', 'stats'));
comment on column public.raw_snapshots.origin is '스냅샷 출처 (W12-a) - 색인은 pipeline 만 읽는다. 실시간 조회(live_fetch)는 수집 대기열 검수 전 색인 0';

-- ── 색인 가능 원천 목록 ───────────────────────────────────────
create view public.chunk_sources as
  select 'law_article'::text as source_type, a.id::text as source_id, 'law'::text as doc_type,
         array[l.scope]::text[] as tax_items,
         coalesce(a.effective_on, v.effective_on) as valid_from,
         'public'::text as access_tier, 'confirmed'::text as rights_status, 'base'::text as scope,
         v.snapshot_id, encode(sha256(convert_to(a.body, 'UTF8')), 'hex') as source_hash,
         ('law:' || l.id || ':' || a.article_no || ':' || a.branch_no) as supersede_key
    from public.law_articles a
    join public.law_versions v on v.id = a.version_id
    join public.laws l on l.id = v.law_id
    join public.raw_snapshots s on s.id = v.snapshot_id and s.origin = 'pipeline'
   where l.scope in ('local', 'linked_national')
  union all
  select case when d.doc_type in ('ruling', 'circular', 'interpretation') then 'interpretation' else 'case_decision' end,
         d.id::text, d.doc_type, d.tax_kinds, d.decided_on, 'public', 'confirmed', x.scope, d.snapshot_id, d.content_hash, null
    from public.legal_docs d
    join public.legal_doc_texts t on t.legal_doc_id = d.id and t.snapshot_id = d.snapshot_id
    join public.raw_snapshots s on s.id = d.snapshot_id and s.origin = 'pipeline'
    cross join lateral (
      select case
        when exists (select 1 from unnest(d.tax_kinds) k where k like '%증여%') and exists (select 1 from unnest(d.tax_kinds) k where k like '%상속%') then null
        when exists (select 1 from unnest(d.tax_kinds) k where k like '%증여%') then 'gift'
        when exists (select 1 from unnest(d.tax_kinds) k where k like '%상속%') then 'inheritance'
        else 'base' end as scope) x
   where x.scope is not null
     and d.rights_status = 'confirmed'
     and coalesce(btrim(d.issuer), '') <> '' and coalesce(btrim(d.doc_no), '') <> ''
     and d.decided_on is not null and d.source_url is not null and d.snapshot_id is not null
     and coalesce(btrim(d.content_hash), '') <> '' and cardinality(d.tax_kinds) > 0
     and (d.doc_type in ('ruling', 'circular', 'interpretation') or d.anonymity_check = 'confirmed')
     and (d.source_key is null or exists (select 1 from public.data_sources ds where ds.key = d.source_key and ds.terms_status = 'allowed'))
     and not exists (select 1 from public.legal_doc_holds h where h.legal_doc_id = d.id and h.released_at is null)
  union all
  select 'guide_version', v.id::text, 'guide', array[g.hub, v.tax_scope]::text[],
         coalesce(v.as_of, (v.published_at at time zone 'Asia/Seoul')::date),
         'public', 'confirmed', case when g.hub in ('trust', 'redevelopment') then 'trust_redevelopment' else 'base' end,
         null::bigint, v.body_sha256, null
    from public.guide_versions v
    join public.guides g on g.id = v.guide_id
   where v.status = 'published' and v.published_at is not null
  union all
  select 'issue_graph_version', ig.id::text, 'issue_graph', array[ig.hub]::text[],
         coalesce(ig.as_of, (ig.published_at at time zone 'Asia/Seoul')::date),
         'public', 'confirmed', 'trust_redevelopment', null::bigint, ig.body_sha256, null
    from public.issue_graphs ig
   where ig.status = 'published' and ig.published_at is not null and ig.hub in ('trust', 'redevelopment');
comment on view public.chunk_sources is '색인할 수 있는 원천의 단일 목록 (W12-a) - 내부용. 출판물·기사·용어 원천은 아직 없다(출판물은 권리 확인 뒤, T1)';
revoke all on table public.chunk_sources from public, anon, authenticated, service_role;
grant select on table public.chunk_sources to service_role;

-- ── 대기열 ────────────────────────────────────────────────────
create table public.index_queue (
  id bigint generated always as identity primary key,
  source_type text not null check (source_type in ('law_article', 'interpretation', 'case_decision', 'guide_version', 'issue_graph_version', 'publication', 'article', 'glossary_term')),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 80),
  reason text not null check (reason in ('new', 'changed')),
  source_hash text not null check (char_length(btrim(source_hash)) > 0),
  index_version text not null check (char_length(btrim(index_version)) between 1 and 40),
  enqueued_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz,
  attempts int not null default 0 check (attempts >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 300),
  chunk_count int check (chunk_count is null or chunk_count >= 0)
);
comment on table public.index_queue is '색인 대기열 (RAG-03) - 완료 행(done_at)은 같은 해시·색인 버전을 다시 쌓지 않는 장부이기도 하다';
create unique index index_queue_pending_once on public.index_queue (source_type, source_id) where done_at is null;
create index index_queue_done_idx on public.index_queue (source_type, source_id, source_hash, index_version) where done_at is not null;
alter table public.index_queue enable row level security;
revoke all on table public.index_queue from anon, authenticated, service_role;
grant select on table public.index_queue to service_role;

create function public.index_queue_scan(p_index_version text, p_now timestamptz default now(), p_limit int default 2000) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enq int := 0;
  v_ret int := 0;
begin
  if coalesce(btrim(p_index_version), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  -- 더는 색인할 수 없는 원천(권리 철회·공개 내림·보류) - 즉시 뺀다
  update public.chunks c set retired_at = p_now
   where c.retired_at is null
     and c.source_type in ('law_article', 'interpretation', 'case_decision', 'guide_version', 'issue_graph_version')
     and not exists (select 1 from public.chunk_sources s where s.source_type = c.source_type and s.source_id = c.source_id);
  get diagnostics v_ret = row_count;

  with cand as (
    select s.source_type, s.source_id, s.source_hash,
           case when exists (select 1 from public.chunks c where c.source_type = s.source_type and c.source_id = s.source_id) then 'changed' else 'new' end as reason
      from public.chunk_sources s
     where not exists (select 1 from public.chunks c
                        where c.source_type = s.source_type and c.source_id = s.source_id and c.retired_at is null
                          and c.source_hash = s.source_hash and c.scope = s.scope and c.index_version = p_index_version)
       and not exists (select 1 from public.index_queue q
                        where q.source_type = s.source_type and q.source_id = s.source_id
                          and ((q.done_at is not null and q.source_hash = s.source_hash and q.index_version = p_index_version) or q.done_at is null))
     order by s.valid_from desc, s.source_id
     limit least(greatest(p_limit, 1), 20000)
  ), ins as (
    insert into public.index_queue (source_type, source_id, reason, source_hash, index_version, enqueued_at)
    select source_type, source_id, reason, source_hash, p_index_version, p_now from cand
    returning 1
  )
  select count(*) into v_enq from ins;
  return jsonb_build_object('ok', true, 'enqueued', v_enq, 'retired', v_ret);
end;
$$;
revoke all on function public.index_queue_scan(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.index_queue_scan(text, timestamptz, int) to service_role;

create function public.index_queue_claim(p_limit int default 50, p_now timestamptz default now(), p_stale interval default '15 minutes', p_max_attempts int default 5)
returns table (id bigint, source_type text, source_id text, reason text, attempts int)
language sql
security definer
set search_path = ''
as $$
  with c as (
    select q.id from public.index_queue q
     where q.done_at is null and q.attempts < p_max_attempts and (q.claimed_at is null or q.claimed_at < p_now - p_stale)
     order by q.id
     limit least(greatest(p_limit, 1), 500)
     for update skip locked)
  update public.index_queue q set claimed_at = p_now from c where q.id = c.id
  returning q.id, q.source_type, q.source_id, q.reason, q.attempts
$$;
revoke all on function public.index_queue_claim(int, timestamptz, interval, int) from public, anon, authenticated;
grant execute on function public.index_queue_claim(int, timestamptz, interval, int) to service_role;

create function public.index_queue_finish(p_id bigint, p_ok boolean, p_error text default null, p_chunks int default null, p_now timestamptz default now()) returns void
language sql
security definer
set search_path = ''
as $$
  update public.index_queue
     set done_at = case when p_ok then p_now else null end,
         claimed_at = case when p_ok then claimed_at else null end,
         attempts = case when p_ok then attempts else attempts + 1 end,
         last_error = case when p_ok then null else left(p_error, 300) end,
         chunk_count = case when p_ok then p_chunks else chunk_count end
   where id = p_id
$$;
revoke all on function public.index_queue_finish(bigint, boolean, text, int, timestamptz) from public, anon, authenticated;
grant execute on function public.index_queue_finish(bigint, boolean, text, int, timestamptz) to service_role;

-- 대기 현황 (경보용) - 가장 오래된 대기 시각과 건수
create function public.index_queue_status(p_now timestamptz default now()) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('pending', count(*), 'oldest_minutes', coalesce(floor(extract(epoch from (p_now - min(enqueued_at))) / 60), 0)::int)
    from public.index_queue where done_at is null
$$;
revoke all on function public.index_queue_status(timestamptz) from public, anon, authenticated;
grant execute on function public.index_queue_status(timestamptz) to service_role;

-- ── 원천 읽기 (청킹 입력) ─────────────────────────────────────
create function public.chunk_source_load(p_source_type text, p_source_id text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s record;
  v jsonb;
begin
  select * into s from public.chunk_sources cs where cs.source_type = p_source_type and cs.source_id = p_source_id;
  if not found then return null; end if;
  v := jsonb_build_object('sourceType', s.source_type, 'sourceId', s.source_id, 'docType', s.doc_type, 'taxItems', to_jsonb(s.tax_items),
         'validFrom', s.valid_from, 'accessTier', s.access_tier, 'rightsStatus', s.rights_status, 'scope', s.scope,
         'snapshotId', s.snapshot_id, 'sourceHash', s.source_hash, 'supersedeKey', s.supersede_key);
  if p_source_type = 'law_article' then
    return v || (select jsonb_build_object('lawName', l.name, 'articleNo', a.article_no, 'branchNo', a.branch_no, 'title', a.title, 'body', a.body)
                   from public.law_articles a join public.law_versions lv on lv.id = a.version_id join public.laws l on l.id = lv.law_id
                  where a.id = p_source_id::bigint);
  elsif p_source_type in ('interpretation', 'case_decision') then
    return v || (select jsonb_build_object('issuer', d.issuer, 'docNo', d.doc_no, 'body', t.body)
                   from public.legal_docs d join public.legal_doc_texts t on t.legal_doc_id = d.id where d.id = p_source_id::bigint);
  elsif p_source_type = 'guide_version' then
    return v || (select jsonb_build_object('title', gv.title, 'sections', gv.sections, 'slug', g.slug)
                   from public.guide_versions gv join public.guides g on g.id = gv.guide_id where gv.id = p_source_id::bigint);
  elsif p_source_type = 'issue_graph_version' then
    return v || (select jsonb_build_object('title', ig.title, 'summary', ig.summary, 'version', ig.version,
        'nodeRows', coalesce((select jsonb_agg(jsonb_build_object('nodeId', n ->> 'node_id', 'kind', n ->> 'kind',
              'label', case n ->> 'kind'
                when 'law_article' then (select l.name || ' 제' || a.article_no || '조' || case when a.branch_no > 0 then '의' || a.branch_no else '' end
                                           from public.law_articles a join public.law_versions lv on lv.id = a.version_id join public.laws l on l.id = lv.law_id
                                          where a.id = (n ->> 'ref_id')::bigint)
                else (select d.doc_no from public.legal_docs d where d.id = (n ->> 'ref_id')::bigint) end)
              order by o) from jsonb_array_elements(ig.nodes) with ordinality as e(n, o)), '[]'::jsonb),
        'edgeRows', coalesce(ig.edges, '[]'::jsonb))
                   from public.issue_graphs ig where ig.id = p_source_id::bigint);
  end if;
  return null;
end;
$$;
revoke all on function public.chunk_source_load(text, text) from public, anon, authenticated;
grant execute on function public.chunk_source_load(text, text) to service_role;

-- ── 색인 쓰기 ─────────────────────────────────────────────────
-- p_meta 필수 키: docType taxItems validFrom accessTier rightsStatus scope sourceHash (snapshotId·supersedeKey 선택)
-- p_chunks 각 원소: chunkNo path content tokenEst contentHash
create function public.chunk_index_put(p_source_type text, p_source_id text, p_index_version text, p_meta jsonb, p_chunks jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
  k text;
  v_from date;
  v_to date;
  v_key text := nullif(btrim(p_meta ->> 'supersedeKey'), '');
  v_ins int := 0;
  v_ret int := 0;
  v_ids bigint[];
begin
  if p_source_type is null or coalesce(btrim(p_source_id), '') = '' or coalesce(btrim(p_index_version), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'meta_missing', 'fields', jsonb_build_array('source'));
  end if;
  if jsonb_typeof(p_meta) is distinct from 'object' or jsonb_typeof(p_chunks) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  foreach k in array array['docType', 'taxItems', 'validFrom', 'accessTier', 'rightsStatus', 'scope', 'sourceHash'] loop
    if coalesce(btrim(p_meta ->> k), '') = '' or (k = 'taxItems' and (jsonb_typeof(p_meta -> k) <> 'array' or jsonb_array_length(p_meta -> k) = 0)) then
      v_missing := v_missing || k;
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ok', false, 'code', 'meta_missing', 'fields', to_jsonb(v_missing));
  end if;
  if p_meta ->> 'rightsStatus' <> 'confirmed' then
    return jsonb_build_object('ok', false, 'code', 'rights_not_confirmed');
  end if;
  if jsonb_array_length(p_chunks) = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_chunks');
  end if;
  if exists (select 1 from jsonb_array_elements(p_chunks) c
              where coalesce(btrim(c ->> 'path'), '') = '' or coalesce(btrim(c ->> 'content'), '') = '' or coalesce(c ->> 'chunkNo', '') !~ '^[0-9]+$'
                 or coalesce(c ->> 'tokenEst', '') !~ '^[0-9]+$' or coalesce(c ->> 'contentHash', '') !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'code', 'meta_missing', 'fields', jsonb_build_array('chunk'));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('chunk_put:' || p_source_type || ':' || p_source_id, 0));
  v_from := (p_meta ->> 'validFrom')::date;
  v_to := nullif(p_meta ->> 'validTo', '')::date;

  -- 법령 조문: 더 새로운 개정판이 이미 색인되어 있으면 그 시행일부터 효력이 끝난다
  if v_key is not null then
    select least(v_to, min(c.valid_from)) into v_to from public.chunks c
     where c.supersede_key = v_key and c.retired_at is null and c.source_id <> p_source_id and c.valid_from > v_from;
    if v_to is null then v_to := nullif(p_meta ->> 'validTo', '')::date; end if;
  end if;

  -- 이전 행 빼기: 이번 묶음과 같지 않은 현행 행
  update public.chunks c set retired_at = now()
   where c.source_type = p_source_type and c.source_id = p_source_id and c.retired_at is null
     and not exists (select 1 from jsonb_array_elements(p_chunks) n
                      where (n ->> 'chunkNo')::int = c.chunk_no and n ->> 'contentHash' = c.content_hash and c.index_version = p_index_version
                        and c.source_hash = p_meta ->> 'sourceHash' and c.scope = p_meta ->> 'scope'
                        and c.access_tier = p_meta ->> 'accessTier' and c.valid_from = v_from);
  get diagnostics v_ret = row_count;

  with ins as (
    insert into public.chunks (source_type, source_id, chunk_no, doc_type, path, content, token_est, tax_items, valid_from, valid_to,
                               access_tier, rights_status, scope, snapshot_id, source_hash, supersede_key, content_hash, index_version)
    select p_source_type, p_source_id, (n ->> 'chunkNo')::int, p_meta ->> 'docType', n ->> 'path', n ->> 'content', greatest((n ->> 'tokenEst')::int, 1),
           array(select jsonb_array_elements_text(p_meta -> 'taxItems')), v_from, v_to,
           p_meta ->> 'accessTier', p_meta ->> 'rightsStatus', p_meta ->> 'scope', nullif(p_meta ->> 'snapshotId', '')::bigint,
           p_meta ->> 'sourceHash', v_key, n ->> 'contentHash', p_index_version
      from jsonb_array_elements(p_chunks) n
     where not exists (select 1 from public.chunks c where c.source_type = p_source_type and c.source_id = p_source_id
                          and c.chunk_no = (n ->> 'chunkNo')::int and c.retired_at is null)
    returning id)
  select count(*), array_agg(id) into v_ins, v_ids from ins;

  -- 옛 개정판 행의 효력 끝 채우기
  if v_key is not null then
    update public.chunks c set valid_to = v_from
     where c.supersede_key = v_key and c.retired_at is null and c.source_id <> p_source_id and c.valid_from < v_from and c.valid_to is null;
  end if;
  return jsonb_build_object('ok', true, 'inserted', v_ins, 'retired', v_ret, 'ids', coalesce(to_jsonb(v_ids), '[]'::jsonb));
end;
$$;
revoke all on function public.chunk_index_put(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.chunk_index_put(text, text, text, jsonb, jsonb) to service_role;
