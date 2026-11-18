-- 지역 기사 판정(REG1-17) 걷어내기 — 2026-11-18 PO 결정: "지자체뉴스는 지자체뉴스일 뿐, 복잡한 판정은 쓰지 않는다".
-- 20261022000043_w4_regional_gate.sql 이 만든 두 트리거를 지운다.
--  · articles_regional_gate          : 지자체뉴스 새 발행에 지역 태그·편집 분야·공익적 질문·판정 책임자 요구, 비보도 판정·관계·근거 요구
--  · editorial_reviews_regional_guard: 지역 기사 편집 승인에 근거·관계·광고 독립성 3항목·이해관계 표시 요구
-- 함수 regional_publish_problem 과 두 트리거 함수는 남긴다(되돌릴 때 트리거만 다시 걸면 된다). settings_regional_guard 는 설정값 모양 검사라 그대로 둔다.
-- 지역 태그·편집 분야 등 articles 칸은 그대로 있고 선택 입력이다.
drop trigger if exists articles_regional_gate on public.articles;
drop trigger if exists editorial_reviews_regional_guard on public.editorial_reviews;

-- 단계 순서 트리거(articles_stage_order, 20261022000044)의 ③ "지역 기사는 승인 단계를 거쳐야 공개" 도 지역 기사 판정에 기대고 있었다.
-- 지자체뉴스가 일반 기사와 같은 길을 가도록 지역 기사 판정 함수가 늘 false 를 돌려주게 바꾼다. (① 공개 중 비보도 판정 거부, ② 별도 상품 검토 큐 열린 항목은 그대로)
create or replace function public.is_regional_article(p_article public.articles) returns boolean
language sql
immutable
set search_path = ''
as $$
  select false;
$$;
