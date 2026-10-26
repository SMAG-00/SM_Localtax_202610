-- W12-a a1 - 검색 색인 청크 표 (docs/dev/W12-a_설계.md 2장 · PRD-04 RAG-01·RAG-03·RAG-06 · ASK-14, 4단계_설계.md 3장 a행)
-- · chunks - 근거형 AI가 읽는 검색 조각. 공개·감수를 거친 자료만 들어온다 (법령 조문 · 해석 · 결정례 · 서명 공개된 가이드 버전 · 공개된 쟁점 지도 버전 · 권리 확인된 출판물 · 기사 · 용어).
--   회원 작성 글·일반 웹문서 값은 source_type 허용 목록(DB 제약)에 없어 어떤 경로로도 들어올 수 없다.
-- · 메타 하나라도 비면 거부 (NOT NULL + 제약). 출판물은 접근 등급 premium + 권리 확인(confirmed)이 아니면 행 자체를 거부한다 - 권리 확인 전 출판물 청크 0.
-- · 개정·신규 수집은 새 행(법령 조문은 개정판마다 다른 source_id). 이전 버전 보존 - 바꿀 수 있는 칸은 valid_to(대체 시각)와 retired_at(색인에서 뺌)뿐이다.
-- · 전문 검색 칸 search_text는 W2-d와 같은 정규형(search_squash)이고 PGroonga 2글자 조각 색인을 쓴다.
-- · 벡터는 별도 표 chunk_embeddings (pgvector가 있을 때만 만든다 - 없으면 건너뛰고 전문 검색만으로 동작). 차원 1024는 임시 자리이며 공급자 결정(PO #5) 뒤 155에서 새 칸·새 색인으로 확정한다.
-- · 쓰기는 service_role의 chunk_index_put(153) 함수로만 한다. anon·authenticated는 표 접근 0, 읽기는 agent_search(152)로만.
-- 이 파일에 법령·세무 글은 없다 (표 구조뿐).

-- 벡터 확장 - 있으면 켠다. 없으면 알리고 지나간다 (벡터 검색은 꺼진 채 전문 검색만 쓴다).
do $$
begin
  begin
    create extension if not exists vector with schema extensions;
  exception when others then
    raise notice 'pgvector를 켜지 못했습니다 - 벡터 검색 없이 전문 검색만 씁니다: %', sqlerrm;
  end;
end;
$$;

create table public.chunks (
  id bigint generated always as identity primary key,
  source_type text not null check (source_type in (
    'law_article', 'interpretation', 'case_decision', 'guide_version', 'issue_graph_version', 'publication', 'article', 'glossary_term')),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 80),
  chunk_no int not null check (chunk_no >= 0),
  doc_type text not null check (doc_type in (
    'law', 'ruling', 'circular', 'interpretation', 'tribunal', 'case', 'guide', 'issue_graph', 'publication', 'article', 'glossary')),
  path text not null check (char_length(btrim(path)) between 1 and 500),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  token_est int not null check (token_est > 0),
  tax_items text[] not null check (cardinality(tax_items) between 1 and 20 and array_position(tax_items, null) is null and array_position(tax_items, '') is null),
  valid_from date not null,
  valid_to date,
  access_tier text not null check (access_tier in ('public', 'premium')),
  rights_status text not null check (rights_status in ('confirmed', 'unchecked', 'restricted')),
  scope text not null check (scope in ('base', 'trust_redevelopment', 'inheritance', 'gift')),
  snapshot_id bigint references public.raw_snapshots (id),
  source_hash text not null check (char_length(btrim(source_hash)) between 1 and 200),
  supersede_key text check (supersede_key is null or char_length(btrim(supersede_key)) between 1 and 120),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  index_version text not null check (char_length(btrim(index_version)) between 1 and 40),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  search_text text generated always as (public.search_doc(array[path, content])) stored,
  constraint chunks_valid_range check (valid_to is null or valid_to > valid_from),
  -- 원천 종류와 문서 종류가 맞아야 한다 (엉뚱한 조합 거부)
  constraint chunks_type_pair check (
    (source_type = 'law_article' and doc_type = 'law')
    or (source_type = 'interpretation' and doc_type in ('ruling', 'circular', 'interpretation'))
    or (source_type = 'case_decision' and doc_type in ('tribunal', 'case'))
    or (source_type = 'guide_version' and doc_type = 'guide')
    or (source_type = 'issue_graph_version' and doc_type = 'issue_graph')
    or (source_type = 'publication' and doc_type = 'publication')
    or (source_type = 'article' and doc_type = 'article')
    or (source_type = 'glossary_term' and doc_type = 'glossary')),
  -- RAG-06 / ASK-14: 출판물은 권리가 확인되고 프리미엄 등급인 것만 (권리 확인 전 0)
  constraint chunks_publication_gate check (source_type <> 'publication' or (access_tier = 'premium' and rights_status = 'confirmed')),
  -- 원문 스냅샷이 있는 원천(법령·해석·결정례)은 스냅샷 필수
  constraint chunks_snapshot_required check (source_type not in ('law_article', 'interpretation', 'case_decision') or snapshot_id is not null),
  constraint chunks_supersede_law_only check (supersede_key is null or source_type = 'law_article')
);

comment on table public.chunks is '검색 색인 조각 (RAG-01·03) - 공개·감수 자료만. 직접 읽기 0, agent_search로만 읽는다. 쓰기는 chunk_index_put(service_role)';
comment on column public.chunks.valid_from is '법령 조문은 시행일, 해석·결정례는 결정일, 가이드·쟁점 지도는 기준일 또는 공개일';
comment on column public.chunks.valid_to is '이 시각(날짜)부터 효력이 끝남(배타적) - 더 새로운 개정판이 색인되면 채워진다. 비어 있으면 현행';
comment on column public.chunks.source_hash is '색인 때 원천의 해시 - 달라지면 다시 색인(index_queue_scan)';
comment on column public.chunks.retired_at is '색인에서 뺀 시각 - 권리 철회·공개 내림·다시 색인. 검색에서 제외, 행은 보존';

-- 같은 원천의 같은 조각 번호는 현행(빼지 않은) 행이 하나
create unique index chunks_active_once on public.chunks (source_type, source_id, chunk_no) where retired_at is null;
create index chunks_source_idx on public.chunks (source_type, source_id);
create index chunks_active_filter_idx on public.chunks (scope, access_tier, valid_from) where retired_at is null and rights_status = 'confirmed';
create index chunks_supersede_idx on public.chunks (supersede_key, valid_from) where supersede_key is not null and retired_at is null;
create index chunks_tax_items_idx on public.chunks using gin (tax_items);
create index chunks_search_idx on public.chunks using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');

-- 바꿀 수 있는 것은 valid_to(비어 있던 것을 채움)·retired_at(비어 있던 것을 채움)뿐. 지우기 거부.
create function public.chunks_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '색인 조각은 지울 수 없습니다 (빼려면 retired_at)' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'valid_to' - 'retired_at' - 'search_text') is distinct from (to_jsonb(old) - 'valid_to' - 'retired_at' - 'search_text') then
    raise exception '색인 조각의 내용은 고칠 수 없습니다 (새 행으로 색인)' using errcode = '42501';
  end if;
  if old.valid_to is not null and new.valid_to is distinct from old.valid_to then
    raise exception '대체 시각은 한 번 정하면 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then
    raise exception '뺀 시각은 바꿀 수 없습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger chunks_guard_trg before update or delete on public.chunks for each row execute function public.chunks_guard();
revoke all on function public.chunks_guard() from public, anon, authenticated;

alter table public.chunks enable row level security;
revoke all on table public.chunks from anon, authenticated, service_role;
grant select on table public.chunks to service_role;

-- 벡터 표 - pgvector가 있을 때만. 한 번에 한 모델(차원 고정) - 모델을 바꾸면 155에서 새 칸·새 색인.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $t$
      create table public.chunk_embeddings (
        chunk_id bigint not null references public.chunks (id),
        model text not null check (char_length(btrim(model)) between 1 and 80),
        embedding extensions.vector(1024) not null,
        created_at timestamptz not null default now(),
        primary key (chunk_id, model)
      )$t$;
    execute 'comment on table public.chunk_embeddings is ''청크 임베딩 (RAG-02 - 공급자 결정 전 차원 1024는 임시 자리). 벡터 검색은 설정으로 꺼져 있고 이 표가 비어도 전문 검색은 동작''';
    execute 'create index chunk_embeddings_hnsw on public.chunk_embeddings using hnsw (embedding extensions.vector_cosine_ops)';
    execute 'alter table public.chunk_embeddings enable row level security';
    execute 'revoke all on table public.chunk_embeddings from anon, authenticated, service_role';
    execute 'grant select on table public.chunk_embeddings to service_role';
  end if;
end;
$$;
