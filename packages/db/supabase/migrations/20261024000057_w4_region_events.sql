-- W4 24단계 — 지역 측정 이벤트 (docs/dev/W4_설계.md 1장 24단계 · 2.5, W2-c 설계 2.1~2.3, PRD-01B REG1-15)
-- · analytics_events.name 제약에 이벤트 7개를 더한다: region_viewed · regional_news_opened · regional_source_opened · region_to_tax_clicked ·
--   region_to_realestate_clicked · project_viewed · dev_method_viewed (W2-c 2.1 표와 같다 — 시험 w2c-analytics가 표와 제약 값 집합을 대조)
-- · 속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다. 상세 주소·좌표·검색어 원문·계산값·외부 주소 칸은 없고,
--   이 이름들은 W2-c analytics_events_props_no_personal 제약이 DB에서도 막는다(이 마이그레이션은 그 제약을 바꾸지 않는다).
-- · calculator_card_clicked.screen 값(inheritance_gift · project · region_hub · dev_method)은 속성 값이라 제약이 아니라 수집 API가 검사한다(W2-c 2.3).
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다(이름 제약은 값 7개를 더한 같은 이름 제약으로 바꾼다).
alter table public.analytics_events drop constraint analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
  'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
  'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
  'redirect_hit', 'not_found_viewed',
  'calculator_card_clicked', 'amendment_viewed', 'interpretation_viewed',
  'region_viewed', 'regional_news_opened', 'regional_source_opened', 'region_to_tax_clicked', 'region_to_realestate_clicked',
  'project_viewed', 'dev_method_viewed'));
