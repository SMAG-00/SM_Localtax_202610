-- 별도 상품 검토 큐 걷어내기 — 2026-11-18 PO 결정: "복잡한 내부절차는 삭제" (20261118000243 지역 기사 판정 제거의 연장).
-- 20261022000044_w4_regional_warnings.sql 이 만든 세 트리거를 지운다.
--  · articles_separate_product_sync_insert/update: 비보도 판정이 되면 큐에 열린 항목을 자동으로 만들던 것
--  · articles_stage_order: 열린 큐 항목이 있는 원고 공개 거부 · 공개 중 비보도 판정 거부 · 지역 기사 승인 단계 강제
-- 표 separate_product_queue 와 함수는 남긴다 — 기존 행(기록)을 지우지 않고, 되돌릴 때 트리거만 다시 걸면 된다. 어떤 화면에도 더는 쓰이지 않는다.
drop trigger if exists articles_separate_product_sync_insert on public.articles;
drop trigger if exists articles_separate_product_sync_update on public.articles;
drop trigger if exists articles_stage_order on public.articles;
