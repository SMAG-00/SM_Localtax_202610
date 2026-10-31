-- 간편 발행 (2026-10-31 PO 결정 — "기사는 전문기자·회계사·세무사가 써서 올린다, 복잡한 절차는 모두 뺀다")
-- ① 작성자가 바로 발행합니다 — 발행 API가 이 버전의 편집 승인(desk_edit approve)을 발행자 이름으로 함께 남깁니다(checklist.publishApproval = true).
--    작성자 본인이 발행하면 checklist.authorPublish = true — editorial_reviews_guard가 작성자 본인의 편집 승인을 이 표시가 있을 때도 받습니다(칼럼 제외, BR-08 그대로).
-- ② 세무 감수는 작성자 본인 책임으로 대체합니다 — 세무 감수 승인(tax_review_status = approved)을 발행 조건으로 요구하던 두 검사를 풉니다.
--    · 해석 해설(interpretation_publish_guard) — 원문(subject) 연결 1건 이상은 그대로, 세무 감수 승인 조건만 뺍니다
--    · 고시·조례 자료를 쓴 해설(official_source_publish_problem · article_sources_official_guard) — 공식 자료 칸·공공누리 검사는 그대로, 세무 감수 조건만 뺍니다
--    세무 감수 상태 칸은 그대로 계산됩니다 — 감수 기록이 없으면 approved가 되지 않고, 공개 화면 '감수 ○○' 표시도 서명 기록에서만 그립니다(사실과 다른 표시 0).
-- 그대로 두는 것: 지역 기사 편집 승인 3항목(REG1-17)·금융 사례(DF-03·09) 편집 승인 검사, 칼럼 발행 검사(BR-08), 지역 기사 단계 순서(REG1-14).

create or replace function public.editorial_reviews_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.articles;
  v_author_publish boolean := (new.checklist -> 'authorPublish') is not distinct from 'true'::jsonb;
begin
  if new.kind = 'desk_edit' then
    select * into v_article from public.articles a where a.id = new.article_id;
    if v_article.author_id is not null and v_article.author_id = new.reviewer_id then
      if (new.checklist -> 'selfPublish') is distinct from 'true'::jsonb and not v_author_publish then
        raise exception '작성 기자 본인의 편집 승인(desk_edit)은 거부합니다 (NAV-12 — 기사 %, 인물 %)', new.article_id, new.reviewer_id
          using errcode = 'check_violation';
      end if;
      if new.decision is distinct from 'approve' then
        raise exception '본인 발행·작성자 발행 표시는 승인(approve)에만 씁니다 — 반려·보류는 다른 편집자가 합니다 (NAV-12, 기사 %)', new.article_id
          using errcode = 'check_violation';
      end if;
      if v_article.content_type is not distinct from 'opinion' then
        raise exception '칼럼(opinion)은 본인 발행할 수 없습니다 — 다른 편집 책임자가 승인·발행합니다 (BR-08, 기사 %)', new.article_id
          using errcode = 'check_violation';
      end if;
      if v_author_publish then
        -- 작성자 발행 (간편 발행) — 승인자 인물이 기자·편집 책임자 계정에 연결돼 있어야 합니다
        if not exists (
          select 1 from public.people p
            join public.staff_roles r on r.user_id = p.staff_user_id and r.role in ('reporter', 'editor')
           where p.id = new.reviewer_id) then
          raise exception '작성자 발행은 기자(reporter)·편집 책임자(editor) 역할이 있는 편집국 계정만 할 수 있습니다 (기사 %, 인물 %)', new.article_id, new.reviewer_id
            using errcode = 'check_violation';
        end if;
      else
        if v_article.tax_review_status is distinct from 'not_required' then
          raise exception '세금 내용이 있는 글은 본인 발행할 수 없습니다 — 세무 감수와 다른 편집자의 승인이 필요합니다 (NAV-12, 기사 %, 세무 감수 상태 %)', new.article_id, v_article.tax_review_status
            using errcode = 'check_violation';
        end if;
        if not exists (
          select 1 from public.people p
            join public.staff_roles r on r.user_id = p.staff_user_id and r.role = 'editor'
           where p.id = new.reviewer_id) then
          raise exception '본인 발행은 편집 책임자(editor) 역할이 있는 편집국 계정만 할 수 있습니다 — 다른 편집자가 승인해야 합니다 (NAV-12, 기사 %, 인물 %)', new.article_id, new.reviewer_id
            using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.editorial_reviews_guard() from public, anon, authenticated;

create or replace function public.interpretation_publish_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('published', 'scheduled')
     and exists (select 1 from public.interpretation_articles i where i.article_id = new.id) then
    if not exists (
      select 1 from public.article_legal_docs l join public.legal_docs d on d.id = l.legal_doc_id
       where l.article_id = new.id and l.role = 'subject' and public.legal_doc_public(d)
    ) then
      raise exception '해석 해설은 공개 가능한 원문(해설 대상)을 1건 이상 연결해야 발행할 수 있습니다 (기사 %)', new.id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.interpretation_publish_guard() from public, anon, authenticated;

create or replace function public.official_source_publish_problem(p_article public.articles) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_src public.article_sources;
  v_missing text[];
begin
  for v_src in
    select s.* from public.article_sources s
     where s.article_id = p_article.id
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
     order by s.id
  loop
    v_missing := public.official_source_missing(v_src);
    if cardinality(v_missing) > 0 then
      return format('출처 src:%s「%s」의 %s이(가) 비어 발행할 수 없습니다 — 공식 자료는 발표일·기준일·지역 단위·수집일·확인일·공공누리 유형, 보도자료·사진은 공공누리 유형이 필요합니다 (REG1-09 · PR-07, 기사 %s)',
        v_src.id, coalesce(v_src.title, ''), array_to_string(v_missing, '·'), p_article.id);
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.official_source_publish_problem(public.articles) from public, anon, authenticated;

create or replace function public.article_sources_official_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_types jsonb;
  v_changed text;
  v_target public.article_sources;
  v_article public.articles;
  v_missing text[];
begin
  -- 자료 종류 (REG1-07) — 공식 자료 행에만, 허용 목록 값만, 차단 4종은 늘 거부
  if new.source_type is not null and (tg_op = 'INSERT' or new.source_type is distinct from old.source_type) then
    if new.kind not in ('official_doc', 'dataset') then
      raise exception '자료 종류(sourceType)는 공식 자료(official_doc·dataset) 출처에만 씁니다 (REG1-07)' using errcode = 'check_violation';
    end if;
    if new.source_type in ('transport', 'tourism', 'restaurant', 'living_guide') then
      raise exception '자료 종류 %는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 (REG1-07 코드 고정)', new.source_type using errcode = 'check_violation';
    end if;
    select s.value into v_types from public.settings s where s.key = 'official_source_types';
    if not coalesce(jsonb_typeof(v_types) = 'array' and v_types ? new.source_type, false) then
      raise exception '자료 종류 %는 허용 목록(official_source_types)에 없습니다 (REG1-07)', new.source_type using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- 원자료 덮어쓰기 0 (REG1-09) — 값이 있던 칸은 새 버전 행으로만. 빈 칸(null·공백 글자) 채우기·확인일 갱신은 된다
    if old.kind in ('official_doc', 'dataset') then
      select string_agg(o.key, '·' order by o.key) into v_changed
        from jsonb_each(to_jsonb(old)) o
       where o.key <> 'last_verified_at'
         and o.value <> 'null'::jsonb
         and not (jsonb_typeof(o.value) = 'string' and btrim(o.value #>> '{}') = '')
         and (to_jsonb(new) -> o.key) is distinct from o.value;
      if v_changed is not null then
        raise exception '원자료(공식 자료 src:%)의 %은(는) 고칠 수 없습니다 — 새 버전 행(supersedes_id + 수정 사유)으로 기록하세요 (REG1-09)', old.id, v_changed
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- 새 버전은 같은 기사의 출처만 대체한다
  if new.supersedes_id is not null and (tg_op = 'INSERT' or new.supersedes_id is distinct from old.supersedes_id) then
    select * into v_target from public.article_sources where id = new.supersedes_id;
    if v_target.id is not null and v_target.article_id <> new.article_id then
      raise exception '다른 기사의 출처(src:%)를 대체할 수 없습니다 (REG1-09)', new.supersedes_id using errcode = 'check_violation';
    end if;
  end if;

  -- 이미 발행된(예약된) 기사에 넣거나 고치는 출처도 발행 검사와 같은 규칙 (한쪽만 우회한 삽입도 실패 — REG1-13)
  select * into v_article from public.articles where id = new.article_id;
  if v_article.status in ('published', 'scheduled') then
    v_missing := public.official_source_missing(new);
    if cardinality(v_missing) > 0 then
      raise exception '발행된 기사(%)의 출처「%」에 %이(가) 비었습니다 (REG1-09 · PR-07)', v_article.id, coalesce(new.title, ''), array_to_string(v_missing, '·')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.article_sources_official_guard() from public, anon, authenticated;

comment on table public.editorial_reviews is '편집 승인(desk_edit)·세무 감수(tax_review)·광고 표기 확인 기록 — 서로 다른 행. 작성 기자 본인의 desk_edit 거부 (NAV-12) — 예외: 편집 책임자의 본인 발행(checklist.selfPublish), 간편 발행의 작성자 발행(checklist.authorPublish — 기자·편집 책임자, 칼럼 제외, 2026-10-31 PO 결정). anon 0행';
