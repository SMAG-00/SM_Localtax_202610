-- W10 0차 - 2단계 공통 (docs/dev/2단계_설계.md 2.2 번호 80, docs/dev/W10-a_설계.md 11장)
-- · 측정 이벤트 이름 34개를 더한다 (PRD-02 11장 - 31종 -> 65종). 속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다 - 입력값·금액·이메일·카드 칸 없음.
-- · 기능 키 24개를 꺼진 채로 미리 넣는다 (이미 있는 키는 건드리지 않는다). 공개 승인 전에는 모두 닫힘.
-- · 설정 키 씨앗 6개 - 값은 빈 객체. 실제 값(일수·횟수·시각·한도)은 감수·결정 입력이라 AI가 쓰지 않는다.
-- · 직원 권한 이름(ruleset.sign 등 9개)은 DB가 아니라 apps/web/lib/access.ts ACTIONS에 있다 - 역할 표는 고치지 않는다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (이름 제약은 값만 늘린 같은 이름 제약으로 바꾼다).

alter table public.analytics_events drop constraint analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
  'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
  'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
  'redirect_hit', 'not_found_viewed',
  'calculator_card_clicked', 'amendment_viewed', 'interpretation_viewed',
  'region_viewed', 'regional_news_opened', 'regional_source_opened', 'region_to_tax_clicked', 'region_to_realestate_clicked',
  'project_viewed', 'dev_method_viewed',
  'product_clicked', 'order_link_clicked',
  'calc_started', 'calc_completed', 'calc_step_viewed', 'calc_step_left',
  'calc_compared', 'calc_compare_gated', 'reduction_shown', 'reduction_expanded',
  'refund_diagnosed', 'wetax_handoff', 'external_calculator_opened', 'calc_offline_used',
  'calendar_exported', 'accuracy_viewed', 'content_to_tool', 'law_viewed',
  'related_panel_opened', 'case_viewed', 'brief_subscribe_viewed', 'brief_subscribed',
  'brief_confirmed', 'brief_opened', 'brief_unsubscribed', 'brief_link_visited',
  'review_decided', 'sm_calculator_opened', 'amendment_alert_subscribed', 'amendment_alert_sent',
  'paywall_viewed', 'subscription_started', 'subscription_cancelled', 'order_paid',
  'certificate_issued', 'training_quote_requested'));

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['calc_acquisition', 'calc_holding', 'calc_refund', 'calc_compare', 'calc_reduction', 'calc_accuracy', 'calc_offline', 'wetax_links', 'tax_calendar', 'law_viewer', 'law_three', 'case_db', 'review_queue', 'pipelines', 'amendment_auto', 'brief_regular', 'amendment_alerts', 'ai_ops', 'billing', 'digital_subscription', 'paywall', 'education_billing', 'seminars', 'field_data']) as k where not (s.value ? k)),
       updated_by = 'migration:20261025000080'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['calc_acquisition', 'calc_holding', 'calc_refund', 'calc_compare', 'calc_reduction', 'calc_accuracy', 'calc_offline', 'wetax_links', 'tax_calendar', 'law_viewer', 'law_three', 'case_db', 'review_queue', 'pipelines', 'amendment_auto', 'brief_regular', 'amendment_alerts', 'ai_ops', 'billing', 'digital_subscription', 'paywall', 'education_billing', 'seminars', 'field_data']) as k where not (s.value ? k));

insert into public.settings (key, value, description, updated_by) values
  ('billing_retry_policy', '{}'::jsonb, '결제 실패 재시도 횟수·유예 일수 (BIZ-05 - 씨앗은 비어 있고, 값이 없으면 정기결제는 열리지 않는다 - W10-f가 검사 트리거를 더한다)', 'migration:20261025000080'),
  ('renewal_notice_policy', '{}'::jsonb, '자동갱신·가격 변경 사전 고지 기한 (BIZ-04 - 기한 값은 감수 입력이라 씨앗은 비어 있다. 비어 있으면 갱신 거부 - W10-f)', 'migration:20261025000080'),
  ('brief_publish_policy', '{}'::jsonb, '브리핑 정기 발행 요일·시각 (BRIEF-01 - 씨앗은 비어 있다. 발행 시각 기준은 Asia/Seoul - W10-e)', 'migration:20261025000080'),
  ('brief_reconfirm_policy', '{}'::jsonb, '브리핑 수신 재확인 주기·무응답 처리 (BRIEF-02 - 씨앗은 비어 있다. 법률 검토 뒤 확정 - W10-e)', 'migration:20261025000080'),
  ('ops_ai_budget', '{}'::jsonb, '운영 배치 AI 월 한도·경보 비율 (AIOPS-04 - 씨앗은 비어 있다. 비어 있으면 운영 AI 호출 0 - W10-e)', 'migration:20261025000080'),
  ('amendment_alert_policy', '{}'::jsonb, '개정 알림 발송 기준 (TX-12 - 씨앗은 비어 있다 - W10-e)', 'migration:20261025000080')
on conflict (key) do nothing;
