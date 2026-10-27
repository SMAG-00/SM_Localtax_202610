-- W13-c 5단계 - 관련 자료 패널 v2의 연결 표 확장 (PRD-05 LAW-10, docs/dev/W13-c_설계.md)
-- 이 파일에 법령·해석 문장, 기준 점수 값은 없다 - 칸과 규칙만. 시험 자료는 시험용 표시와 지어낸 값이다.
--
-- · links.reason - 카드마다 보이는 '추천 이유' 한 줄(편집자·배치가 쓴 짧은 글). 비어 있으면 화면이 관계 값(relation)에서 만든다.
-- · links.origin 에 'similarity'(유사도) 추가 + links.similarity(0~1 점수). 유사도 연결은 이유와 점수가 필수.
-- · links.src_kind 에 'pub_node'(지식창고 노드)·'issue_article'(월간지 기사) 추가 - 조문을 가리키는 쪽만. 본문은 이 표에 없다.
-- · 공개 뷰 public_links_v2 - v1(public_links)은 유사도·지식창고 연결을 보이지 않아 v1 화면은 그대로다.
--   유사도 연결은 설정 link_similarity_threshold({"min": n})가 숫자일 때, 점수가 n 이상인 것만 보인다. 비어 있으면 유사도 카드 0.
--   지식창고 연결은 공개 뷰(public_library_nodes·public_library_issue_articles)에 있는 것(승인 + 공개 권리 확인)만 보인다.

alter table public.links add column reason text check (reason is null or char_length(btrim(reason)) between 1 and 120);
alter table public.links add column similarity numeric(5, 4) check (similarity is null or (similarity >= 0 and similarity <= 1));

alter table public.links drop constraint if exists links_origin_check;
alter table public.links add constraint links_origin_check check (origin in ('auto', 'editor', 'similarity'));
alter table public.links add constraint links_similarity_cols check (
  (origin = 'similarity') = (similarity is not null)
  and (origin <> 'similarity' or reason is not null));

alter table public.links drop constraint if exists links_src_kind_check;
alter table public.links add constraint links_src_kind_check check (src_kind in ('legal_doc', 'article', 'pub_node', 'issue_article'));
alter table public.links drop constraint if exists links_pair;
alter table public.links add constraint links_pair check (
  (src_kind = 'legal_doc' and dst_kind = 'law_provision')
  or (src_kind = 'article' and dst_kind in ('law_provision', 'legal_doc'))
  or (src_kind in ('pub_node', 'issue_article') and dst_kind = 'law_provision'));

comment on column public.links.reason is '추천 이유 한 줄(120자 이하) - 비면 화면이 관계 값에서 만든다. 법령 문장을 넣지 않는다';
comment on column public.links.similarity is '유사도 점수(0~1) - origin=similarity일 때만. 공개는 설정 link_similarity_threshold 이상만';

-- 새 연결 보호 - W10-d 규칙에 새 시작 종류의 존재 확인만 더한다 (바꿀 수 없는 칸에 reason·similarity도 넣는다)
create or replace function public.links_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ok boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.src_kind, new.src_id, new.dst_kind, new.dst_id, new.dst_article_no, new.dst_branch_no, new.relation, new.origin, new.similarity)
         is distinct from (old.src_kind, old.src_id, old.dst_kind, old.dst_id, old.dst_article_no, old.dst_branch_no, old.relation, old.origin, old.similarity) then
      raise exception '연결의 양 끝·관계·출처·유사도 점수는 고칠 수 없습니다 - 새 연결로 넣으세요 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    if old.status = 'rejected' and new.status <> 'rejected' then
      raise exception '반려된 연결은 되살릴 수 없습니다 - 새 연결로 넣으세요 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    if old.status = 'confirmed' and new.status = 'candidate' then
      raise exception '확인된 연결을 후보로 되돌릴 수 없습니다 - 반려로만 거둡니다 (연결 %)', old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;
  ok := case new.src_kind
    when 'legal_doc' then exists (select 1 from public.legal_docs where id = new.src_id)
    when 'article' then exists (select 1 from public.articles where id = new.src_id)
    when 'pub_node' then exists (select 1 from public.pub_nodes where id = new.src_id)
    else exists (select 1 from public.magazine_articles where id = new.src_id) end;
  if not ok then
    raise exception '없는 대상을 가리키는 연결은 저장할 수 없습니다 (시작 %, 번호 %)', new.src_kind, new.src_id using errcode = 'check_violation';
  end if;
  ok := case new.dst_kind
    when 'legal_doc' then exists (select 1 from public.legal_docs where id = new.dst_id)
    else public.law_provision_exists(new.dst_id, new.dst_article_no, new.dst_branch_no) end;
  if not ok then
    raise exception '없는 대상을 가리키는 연결은 저장할 수 없습니다 (도착 %, 번호 %)', new.dst_kind, new.dst_id using errcode = 'check_violation';
  end if;
  if new.src_kind = new.dst_kind and new.src_id = new.dst_id then
    raise exception '자기 자신을 가리키는 연결은 저장할 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- v1 공개 뷰: 같은 칸, 유사도 연결만 뺀다 (지식창고 시작 종류는 조건에 없어 이미 빠진다)
create or replace view public.public_links as
select k.id, k.src_kind, k.src_id, k.dst_kind, k.dst_id, k.dst_article_no, k.dst_branch_no, k.relation, k.origin, k.confirmed_at
  from public.links k
 where k.status = 'confirmed'
   and k.origin <> 'similarity'
   and ((k.src_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.src_id))
     or (k.src_kind = 'article' and exists (select 1 from public.public_articles a where a.id = k.src_id)))
   and ((k.dst_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.dst_id))
     or (k.dst_kind = 'law_provision' and exists (
           select 1 from public.public_law_articles a where a.law_id = k.dst_id and a.article_no = k.dst_article_no and a.branch_no = k.dst_branch_no)));

-- 기준 점수: 설정이 숫자 min을 가질 때만. 아니면 null(= 유사도 카드 0)
create view public.public_link_similarity_min as
select case when jsonb_typeof(s.value -> 'min') = 'number' then (s.value ->> 'min')::numeric end as min_score
  from public.settings s where s.key = 'link_similarity_threshold';

create view public.public_links_v2 as
select k.id, k.src_kind, k.src_id, k.dst_kind, k.dst_id, k.dst_article_no, k.dst_branch_no, k.relation, k.origin, k.reason, k.similarity, k.confirmed_at,
       case k.src_kind
         when 'pub_node' then (select n.access_tier from public.public_library_nodes n where n.id = k.src_id)
         when 'issue_article' then (select a.access_tier from public.public_library_issue_articles a where a.id = k.src_id)
       end as src_tier
  from public.links k
 where k.status = 'confirmed'
   and (k.origin <> 'similarity' or k.similarity >= (select m.min_score from public.public_link_similarity_min m))
   and ((k.src_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.src_id))
     or (k.src_kind = 'article' and exists (select 1 from public.public_articles a where a.id = k.src_id))
     or (k.src_kind = 'pub_node' and exists (select 1 from public.public_library_nodes n where n.id = k.src_id))
     or (k.src_kind = 'issue_article' and exists (select 1 from public.public_library_issue_articles a where a.id = k.src_id)))
   and ((k.dst_kind = 'legal_doc' and exists (select 1 from public.public_legal_docs d where d.id = k.dst_id))
     or (k.dst_kind = 'law_provision' and exists (
           select 1 from public.public_law_articles a where a.law_id = k.dst_id and a.article_no = k.dst_article_no and a.branch_no = k.dst_branch_no)));

comment on view public.public_links_v2 is '패널 v2용 확인된 연결 - 양 끝이 공개일 때만, 유사도 연결은 기준 점수(설정) 이상만(설정이 비면 0), 지식창고 시작은 승인+공개 권리 확인분만. 본문 칸 없음';

revoke all on table public.public_link_similarity_min, public.public_links_v2 from public, anon, authenticated, service_role;
grant select on table public.public_links_v2 to anon, authenticated, service_role;

-- 유사도 연결 넣기 (배치 전용) - 공개 상태 콘텐츠만, 이유·점수 필수, 새 문장을 만들지 않는다. 같은 연결이 있으면 새로 만들지 않고 그 번호를 돌려준다
create function public.link_add_similarity(
  p_src_kind text, p_src_id bigint, p_law_id bigint, p_article_no integer, p_branch_no integer, p_relation text, p_score numeric, p_reason text
) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id bigint;
  v_public boolean;
begin
  if p_score is null or p_score < 0 or p_score > 1 then
    raise exception '유사도 점수는 0 이상 1 이하여야 합니다' using errcode = 'check_violation';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception '유사도 연결에는 추천 이유가 필요합니다' using errcode = 'check_violation';
  end if;
  v_public := case p_src_kind
    when 'legal_doc' then exists (select 1 from public.public_legal_docs where id = p_src_id)
    when 'article' then exists (select 1 from public.public_articles where id = p_src_id)
    when 'pub_node' then exists (select 1 from public.public_library_nodes where id = p_src_id)
    when 'issue_article' then exists (select 1 from public.public_library_issue_articles where id = p_src_id)
    else false end;
  if not v_public then
    raise exception '공개 상태가 아닌 자료는 유사도 추천에 쓸 수 없습니다 (% %)', p_src_kind, p_src_id using errcode = 'check_violation';
  end if;
  insert into public.links (src_kind, src_id, dst_kind, dst_id, dst_article_no, dst_branch_no, relation, origin, status, similarity, reason, confirmed_by, confirmed_at, created_by)
  values (p_src_kind, p_src_id, 'law_provision', p_law_id, p_article_no, coalesce(p_branch_no, 0), p_relation, 'similarity', 'confirmed', p_score, btrim(p_reason), 'similarity-batch', now(), 'similarity-batch')
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.links
     where src_kind = p_src_kind and src_id = p_src_id and dst_kind = 'law_provision' and dst_id = p_law_id
       and dst_article_no = p_article_no and dst_branch_no = coalesce(p_branch_no, 0) and relation = p_relation;
  end if;
  return v_id;
end;
$$;

revoke all on function public.link_add_similarity(text, bigint, bigint, integer, integer, text, numeric, text) from public, anon, authenticated;
grant execute on function public.link_add_similarity(text, bigint, bigint, integer, integer, text, numeric, text) to service_role;
