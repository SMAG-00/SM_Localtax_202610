-- 하위 분야 '최신법령·유권해석' 더하기 (PO 결정 2026-11-01 — 주간 브리핑 호 대신, PO가 일반 기사처럼 써서 이 하위 분야를 골라 올린다)
-- · tax/law-updates — 목록 /tax/law-updates (하위 분야 목록 CAT-02 그대로). 헤더 바로 메뉴 '최신법령·유권해석'이 이 목록으로 간다
-- · 지방세 분야라 면책·세무 감수 대상(needs_disclaimer)으로, 「지방세로 읽기」는 필수 아님 — 같은 분야 '해석'·'개정 트래커'와 같다
-- · 맨 앞(sort 5)에 둔다. 이미 있으면 건드리지 않는다. 표·칸·트리거·정책은 바꾸지 않는다

insert into public.categories (section, slug, name, intro, sort, visible, needs_disclaimer, needs_tax_lens) values
  ('tax', 'law-updates', '최신법령·유권해석', '지방세·부동산 세금 법령 개정과 유권해석 소식을 모았습니다.', 5, true, true, false)
on conflict (section, slug) do nothing;
