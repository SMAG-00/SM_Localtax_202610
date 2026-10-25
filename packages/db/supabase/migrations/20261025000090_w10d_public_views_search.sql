-- W10-d 2단계 - 공개 뷰 · PGroonga 색인 · 해석 문서 검색 함수 (PRD-02 LAW-01~05 · CASE-01 · CASE-02 · TX-10 · TX-11, docs/dev/W10-d_설계.md)
-- · 공개 읽기는 칸을 지정한 뷰로만 한다(표 직접 권한 0). 뷰는 소유자 권한으로 돌므로 공개 조건(기능 키·권리 확인·스냅샷·이용 조건·공개 보류)을 뷰 안에서 모두 건다.
-- · 기능 키: law_viewer(법령 뷰어) · law_three(3단 보기) · case_db(해석 DB). 꺼져 있으면 뷰는 0행.
-- · 검색 함수 2개(search_legal_docs · legal_doc_type_counts)는 security invoker - 부르는 역할의 칸 권한이 그대로 걸리고, 공개 뷰만 읽는다. anon 실행 허용 목록에 더했다(verify-rls).
-- · 이 파일에 법령·해석 문장은 없다.

-- PGroonga 색인 - 2글자 조각, NFKC (W2-d와 같은 설정). 정규형 글자끼리의 부분 글자 찾기
create index legal_doc_texts_search_idx on public.legal_doc_texts using pgroonga (search_text)
  with (tokenizer = 'TokenBigramSplitSymbolAlphaDigit', normalizers = 'NormalizerNFKC150');

-- ─────────────────────────────────────────────────────────────
-- 표본 검사 관문 - 종류마다 가장 최근 표본
-- ─────────────────────────────────────────────────────────────
create view public.public_quality_gates as
select distinct on (q.kind) q.kind, q.passed, q.sample_size, q.matched, (q.sampled_at at time zone 'Asia/Seoul')::date as sampled_on
  from public.quality_samples q
 order by q.kind, q.id desc;

comment on view public.public_quality_gates is '표본 검사 관문(종류별 가장 최근 표본의 합격 여부와 숫자) - 위임 50건 중 48 합격, 조문 인용 100건 중 95 합격';

-- ─────────────────────────────────────────────────────────────
-- 법령 뷰어 (LAW-01~04)
-- ─────────────────────────────────────────────────────────────
create view public.public_laws as
select l.id, l.name, l.tier, l.scope
  from public.laws l
 where l.watch
   and exists (select 1 from public.law_versions v where v.law_id = l.id)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'law_viewer') = 'true'::jsonb);

create view public.public_law_versions as
select v.id, v.law_id, v.promulgation_no, v.promulgated_on, v.effective_on, v.revision_kind
  from public.law_versions v
  join public.public_laws l on l.id = v.law_id
 where v.snapshot_id is not null;

create view public.public_law_articles as
select a.id, a.version_id, v.law_id, a.article_no, a.branch_no, a.title, a.body, a.effective_on
  from public.law_articles a
  join public.public_law_versions v on v.id = a.version_id;

-- 법·시행령·시행규칙 묶음 - 이름 규칙(법 이름 + ' 시행령' / ' 시행규칙')
create view public.public_law_families as
select s.id as statute_id, d.id as decree_id, r.id as rule_id
  from public.public_laws s
  left join public.public_laws d on d.tier = 'decree' and d.name = s.name || ' 시행령'
  left join public.public_laws r on r.tier = 'rule' and r.name = s.name || ' 시행규칙'
 where s.tier = 'statute';

-- 위임 매핑 - 확인된 것만, 3단 보기 기능 키 + 표본 검사 관문(delegation_mapping) 통과 때만
create view public.public_law_delegations as
select x.id, x.parent_law_id, x.parent_article_no, x.parent_branch_no, x.child_law_id, x.child_article_no, x.child_branch_no, x.source
  from public.law_delegations x
  join public.public_laws p on p.id = x.parent_law_id
  join public.public_laws c on c.id = x.child_law_id
 where x.status = 'confirmed'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'law_three') = 'true'::jsonb)
   and exists (select 1 from public.public_quality_gates g where g.kind = 'delegation_mapping' and g.passed);

-- ─────────────────────────────────────────────────────────────
-- 해석 DB (CASE-01 · CASE-02 · TX-10)
-- ─────────────────────────────────────────────────────────────
-- 공개 조건: 기존 공개 조건(권리 확인·필수 칸·비실명 확인·스냅샷) + 읽을 글자가 같은 스냅샷에서 나온 것 + 수집기 문서는 원천 이용 조건 allowed
--           + 풀지 않은 공개 보류(실명·주민등록번호) 0 + 기능 키 case_db
create view public.public_legal_docs as
select d.id, d.doc_type, d.issuer, d.doc_no, d.decided_on, d.tax_kinds, d.provisions, d.source_url, d.decision_kind,
       (s.fetched_at at time zone 'Asia/Seoul')::date as collected_on,
       (t.checked_at at time zone 'Asia/Seoul')::date as checked_on,
       t.search_text
  from public.legal_docs d
  join public.legal_doc_texts t on t.legal_doc_id = d.id and t.snapshot_id = d.snapshot_id
  join public.raw_snapshots s on s.id = d.snapshot_id
 -- 기존 공개 가능 판정(legal_doc_public, W3)과 같은 식 - 함수 실행 권한이 공개 역할에 없어(뷰 안의 함수는 호출자 권한으로 검사) 식을 그대로 적는다
 where d.rights_status = 'confirmed'
   and coalesce(btrim(d.issuer), '') <> ''
   and coalesce(btrim(d.doc_no), '') <> ''
   and d.decided_on is not null
   and d.source_url is not null
   and d.snapshot_id is not null
   and coalesce(btrim(d.content_hash), '') <> ''
   and cardinality(d.tax_kinds) > 0
   and (d.doc_type in ('ruling', 'circular', 'interpretation') or d.anonymity_check = 'confirmed')
   and (d.source_key is null or exists (select 1 from public.data_sources ds where ds.key = d.source_key and ds.terms_status = 'allowed'))
   and not exists (select 1 from public.legal_doc_holds h where h.legal_doc_id = d.id and h.released_at is null)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'case_db') = 'true'::jsonb);

comment on view public.public_legal_docs is '공개 해석 문서(예규·통칙·유권해석·심판·판례) 메타 + 검색 칸 - 스냅샷 없는 문서 0, 풀지 않은 공개 보류 0, 이용 조건 미확인 원천 0';

create view public.public_legal_doc_bodies as
select d.id, t.body
  from public.public_legal_docs d
  join public.legal_doc_texts t on t.legal_doc_id = d.id;

-- ─────────────────────────────────────────────────────────────
-- 확인된 연결 (CASE-03 · LAW-06 · TX-11 · ART-12) - 양 끝이 모두 공개일 때만
-- ─────────────────────────────────────────────────────────────
create view public.public_links as
select k.id, k.src_kind, k.src_id, k.dst_kind, k.dst_id, k.dst_article_no, k.dst_branch_no, k.relation, k.origin, k.confirmed_at
  from public.links k
 where k.status = 'confirmed'
   and ((k.src_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.src_id))
     or (k.src_kind = 'article' and exists (select 1 from public.public_articles a where a.id = k.src_id)))
   and ((k.dst_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.dst_id))
     or (k.dst_kind = 'law_provision' and exists (
           select 1 from public.public_law_articles a where a.law_id = k.dst_id and a.article_no = k.dst_article_no and a.branch_no = k.dst_branch_no)));

revoke all on table public.public_quality_gates, public.public_laws, public.public_law_versions, public.public_law_articles, public.public_law_families,
  public.public_law_delegations, public.public_legal_docs, public.public_legal_doc_bodies, public.public_links from public, anon, authenticated, service_role;
grant select on table public.public_quality_gates, public.public_laws, public.public_law_versions, public.public_law_articles, public.public_law_families,
  public.public_law_delegations, public.public_legal_docs, public.public_legal_doc_bodies, public.public_links to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 검색 함수 (CASE-01) - 키워드 + 세목 + 문서 유형 + 조문(연결 기준) + 결정 유형 + 기간
-- ─────────────────────────────────────────────────────────────
-- 정규화는 W2-d 검색 함수와 같은 식을 몸 안에 직접 쓴다(정규화 도우미는 anon 실행 0). 정규형에는 PGroonga 질의 기호가 남지 않는다.
-- 조문 필터 = 그 조문을 확인된 연결(public_links)로 가리키는 문서 - 필터로 거른 결과는 모두 그 조문을 links로 가리킨다 (TX-10)
create function public.search_legal_docs(
  p_q text default null, p_type text default null, p_tax text default null,
  p_law_id bigint default null, p_article_no integer default null, p_branch_no integer default 0,
  p_decision text default null, p_from date default null, p_to date default null,
  p_limit integer default 20, p_offset integer default 0
) returns table (id bigint, doc_type text, issuer text, doc_no text, decided_on date, tax_kinds text[], decision_kind text, total bigint)
language plpgsql
stable
-- PGroonga 조건 형식이 extensions 스키마에 있다 (W2-d 검색 함수와 같은 경로). 표·뷰는 모두 public.으로 적는다
set search_path = extensions, pg_temp
as $$
declare
  v_q text := regexp_replace(lower(normalize(coalesce(p_q, ''), NFKC)), '[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+', '', 'g');
  v_blank boolean := btrim(coalesce(p_q, '')) = '';
begin
  if not v_blank and v_q = '' then
    return;
  end if;
  -- 질의마다 계획을 새로 세운다(실행 때 값을 상수로 넣는 방식) - 정적 문장은 5번 불린 뒤 값을 모르는 공통 계획으로 굳어,
  -- 표가 커진 뒤에도 PGroonga 색인을 타지 못하는 계획이 남을 수 있다 (W2-d 검색 함수도 같은 이유로 동적 실행)
  return query execute $q$
  select v.id, v.doc_type, v.issuer, v.doc_no, v.decided_on, v.tax_kinds, v.decision_kind, count(*) over () as total
    from public.public_legal_docs v
   where ($1 = '' or v.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.legal_doc_texts_search_idx'))
     and ($2::text is null or v.doc_type = $2)
     and ($3::text is null or $3 = any (v.tax_kinds))
     and ($4::text is null or v.decision_kind = $4)
     and ($5::date is null or v.decided_on >= $5)
     and ($6::date is null or v.decided_on <= $6)
     and ($7::bigint is null or exists (
           select 1 from public.public_links k
            where k.src_kind = 'legal_doc' and k.src_id = v.id and k.dst_kind = 'law_provision'
              and k.dst_id = $7 and k.dst_article_no = $8 and k.dst_branch_no = coalesce($9, 0)))
   order by v.decided_on desc, v.id desc
   limit least(greatest(coalesce($10, 20), 1), 100) offset greatest(coalesce($11, 0), 0)
  $q$ using v_q, p_type, p_tax, p_decision, p_from, p_to, p_law_id, p_article_no, p_branch_no, p_limit, p_offset;
end;
$$;

-- 유형별 개수 - 5종 모두(0건 유형도 한 행). 유형 필터를 뺀 같은 조건
create function public.legal_doc_type_counts(
  p_q text default null, p_tax text default null,
  p_law_id bigint default null, p_article_no integer default null, p_branch_no integer default 0,
  p_decision text default null, p_from date default null, p_to date default null
) returns table (doc_type text, n bigint)
language plpgsql
stable
set search_path = extensions, pg_temp
as $$
declare
  v_q text := regexp_replace(lower(normalize(coalesce(p_q, ''), NFKC)), '[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+', '', 'g');
  v_blank boolean := btrim(coalesce(p_q, '')) = '';
begin
  return query execute $q$
  select t.k, case when $2 then 0::bigint else count(v.id) end
    from unnest(array['ruling', 'circular', 'interpretation', 'tribunal', 'case']) with ordinality as t(k, o)
    left join public.public_legal_docs v
      on v.doc_type = t.k
     and ($1 = '' or v.search_text operator(extensions.&@~) extensions.pgroonga_condition($1, index_name => 'public.legal_doc_texts_search_idx'))
     and ($3::text is null or $3 = any (v.tax_kinds))
     and ($4::text is null or v.decision_kind = $4)
     and ($5::date is null or v.decided_on >= $5)
     and ($6::date is null or v.decided_on <= $6)
     and ($7::bigint is null or exists (
           select 1 from public.public_links k
            where k.src_kind = 'legal_doc' and k.src_id = v.id and k.dst_kind = 'law_provision'
              and k.dst_id = $7 and k.dst_article_no = $8 and k.dst_branch_no = coalesce($9, 0)))
   group by t.k, t.o
   order by t.o
  $q$ using v_q, (not v_blank and v_q = ''), p_tax, p_decision, p_from, p_to, p_law_id, p_article_no, p_branch_no;
end;
$$;

revoke all on function public.search_legal_docs(text, text, text, bigint, integer, integer, text, date, date, integer, integer) from public, anon, authenticated;
revoke all on function public.legal_doc_type_counts(text, text, bigint, integer, integer, text, date, date) from public, anon, authenticated;
grant execute on function public.search_legal_docs(text, text, text, bigint, integer, integer, text, date, date, integer, integer) to anon, authenticated, service_role;
grant execute on function public.legal_doc_type_counts(text, text, bigint, integer, integer, text, date, date) to anon, authenticated, service_role;

-- FAM-06 상속·증여 근거 칩이 열 조문 목록 - 감수 입력(씨앗은 비어 있다. 비어 있으면 칩은 글자로만 보인다)
insert into public.settings (key, value, description, updated_by) values
  ('law_chip_provisions', '{}'::jsonb, '근거 칩이 법령 뷰어로 여는 조문 목록 (FAM-06 - 감수 입력 [감수 필요: 조문 목록]. 씨앗은 비어 있고 AI가 채우지 않는다)', 'migration:20261025000090')
on conflict (key) do nothing;
