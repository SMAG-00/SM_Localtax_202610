-- 본인 발행 (2026-10-31 PO 결정) — 편집 책임자는 세무 감수가 필요 없는 자기 글을 본인 발행할 수 있습니다 (칼럼 제외, '본인 발행' 기록)
-- 20261018000007_reviews_corrections.sql의 editorial_reviews_guard()를 바꿉니다. 작성 기자 본인의 desk_edit는 여전히 거부하고,
-- 아래 조건을 모두 채운 경우 하나만 저장합니다 — 관리자(PO)도 같은 조건입니다 (NAV-12의 좁은 예외).
--   ① checklist.selfPublish = true (JSON 참값 — '본인 발행' 기록으로 남습니다)  ② 결정이 승인(approve)
--   ③ 기사 유형이 칼럼(opinion)이 아님 (BR-08 그대로)  ④ 세무 감수 상태가 not_required (감수가 끝난 approved 글도 제외)
--   ⑤ 승인자 인물(people)이 편집국 계정(staff_user_id)에 연결돼 있고 그 계정에 staff_roles editor가 있음
-- 같은 검사가 UPDATE에도 돕니다 — 저장된 본인 승인 기록에서 selfPublish를 지우거나 결정을 바꾸면 거부합니다.
-- 다른 편집 승인 검사(지역 기사 REG1-17 · 개발금융 DF-03·09)와 칼럼 발행 검사(BR-08 — articles 발행 기록)는 그대로 함께 돕니다.

create or replace function public.editorial_reviews_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.articles;
begin
  if new.kind = 'desk_edit' then
    select * into v_article from public.articles a where a.id = new.article_id;
    if v_article.author_id is not null and v_article.author_id = new.reviewer_id then
      if (new.checklist -> 'selfPublish') is distinct from 'true'::jsonb then
        raise exception '작성 기자 본인의 편집 승인(desk_edit)은 거부합니다 (NAV-12 — 기사 %, 인물 %)', new.article_id, new.reviewer_id
          using errcode = 'check_violation';
      end if;
      if new.decision is distinct from 'approve' then
        raise exception '본인 발행 표시(selfPublish)는 승인(approve)에만 씁니다 — 반려·보류는 다른 편집자가 합니다 (NAV-12, 기사 %)', new.article_id
          using errcode = 'check_violation';
      end if;
      if v_article.content_type is not distinct from 'opinion' then
        raise exception '칼럼(opinion)은 본인 발행할 수 없습니다 — 다른 편집 책임자가 승인·발행합니다 (BR-08, 기사 %)', new.article_id
          using errcode = 'check_violation';
      end if;
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
  return new;
end;
$$;

revoke all on function public.editorial_reviews_guard() from public, anon, authenticated;

comment on table public.editorial_reviews is '편집 승인(desk_edit)·세무 감수(tax_review)·광고 표기 확인 기록 — 서로 다른 행. 작성 기자 본인의 desk_edit 거부 (NAV-12) — 예외: 편집 책임자의 본인 발행(checklist.selfPublish, 세무 감수 not_required·칼럼 아님, 2026-10-31 PO 결정). anon 0행';
