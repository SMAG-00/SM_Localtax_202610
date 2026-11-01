-- 관리자(PO) 본인 칼럼 발행 (PO 결정 2026-11-01 — "이것도 PO는 가능하게 하여야 해")
-- · 칼럼(opinion) 필자 본인 발행 금지(BR-08)는 그대로 두고, 관리자 본인만 예외로 둡니다.
-- · 관리자 여부는 DB가 아니라 서버(ADMIN_EMAILS — 이메일 확인된 계정)가 정합니다. 발행 API가 접근 판정(article.publish)을 통과한 관리자 본인 칼럼에만
--   편집 승인 checklist.adminColumnPublish = true 와 발행 기록 check_log.publish.adminColumnPublish = true 를 남깁니다.
--   두 표(articles·editorial_reviews)는 authenticated·anon 쓰기 정책이 없어 서버(service_role)만 이 표시를 쓸 수 있습니다.
-- · editorial_reviews_guard — 칼럼 작성자 본인의 편집 승인은 작성자 발행(authorPublish) + adminColumnPublish 둘 다 있을 때만 받습니다 (235번 본문 그대로, 칼럼 조건만)
-- · signature_article_guard — 칼럼 발행 기록의 계정이 필자 계정이어도 adminColumnPublish 표시가 있으면 받습니다 (036번 본문 그대로, 칼럼 조건만)
-- · 표·칸·트리거 연결·권한은 바꾸지 않습니다 (함수 두 개 교체만)

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
      if v_article.content_type is not distinct from 'opinion'
         and not (v_author_publish and (new.checklist -> 'adminColumnPublish') is not distinct from 'true'::jsonb) then
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

create or replace function public.signature_article_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_author_user uuid;
  v_publishing boolean;
begin
  if new.series_title is not null and (tg_op = 'INSERT' or new.series_title is distinct from old.series_title)
     and public.brand_claim_token(new.series_title) then
    raise exception '연재 이름에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 — 시그니처 연재 제목(설정)에서만, 승인 뒤에 씁니다 (BR-04)'
      using errcode = 'check_violation';
  end if;

  v_publishing := new.status in ('published', 'scheduled') and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled'));

  if v_publishing and new.content_type is not distinct from 'opinion' and new.author_id is not null
     and new.check_log ? 'publish' and length(btrim(coalesce(new.check_log -> 'publish' ->> 'by', ''))) > 0
     and (new.check_log -> 'publish' -> 'adminColumnPublish') is distinct from 'true'::jsonb then
    select p.staff_user_id into v_author_user from public.people p where p.id = new.author_id;
    if v_author_user is not null and btrim(new.check_log -> 'publish' ->> 'by') = 'user:' || v_author_user::text then
      raise exception '칼럼 필자 본인은 자기 칼럼을 발행할 수 없습니다 — 다른 편집 책임자가 발행합니다 (BR-08, 기사 %)', new.id using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;
  select e.series_key into v_key from public.signature_episodes e where e.article_id = new.id;
  if v_key is null then
    return new;
  end if;
  if new.content_type is distinct from 'opinion' then
    raise exception '시그니처 연재 회차는 칼럼(opinion)이어야 합니다 — 연재에서 먼저 빼세요 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if new.series_title is not null then
    raise exception '시그니처 연재 회차는 기사의 연재 이름·회차 칸을 비웁니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if (new.title, new.summary, new.slug, new.body) is distinct from (old.title, old.summary, old.slug, old.body)
     and (public.brand_claim_token(new.title) or public.brand_claim_token(new.summary) or public.brand_claim_token(new.slug) or public.brand_claim_token(new.body::text)) then
    raise exception '시그니처 연재 회차의 제목·요약·주소·본문에는 경력 연수 표기(''50년'' 등)를 쓸 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  if v_publishing and v_key = 'then_now' and not exists (select 1 from public.then_now_items i where i.article_id = new.id) then
    raise exception '「그때와 지금」 회차는 출처·기준연도가 있는 비교 항목이 1개 이상이어야 발행합니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
