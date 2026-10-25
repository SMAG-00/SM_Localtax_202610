-- W11 0차 - 3단계 공통 (docs/dev/3단계_설계.md 2.1 번호 110, docs/dev/W11-a_설계.md 1장)
-- · 측정 이벤트 이름 13개를 더한다 (PRD-03 12장 - 65종 -> 78종). 속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다 - 입력값·금액·기관명·이메일 칸 없음.
-- · 기능 키 10개를 꺼진 채로 미리 넣는다 (이미 있는 키는 건드리지 않는다). 공개 승인 전에는 모두 닫힘. 지자체 허브 자리 redevelopment_status·ordinance_texts는 W4가 이미 둔 키를 쓴다.
-- · 설정 키 씨앗 4개 - 값은 빈 객체. 실제 값(보유 연수 상한·미리보기 길이·보존 기간·경고 일수)은 감수·PO 결정 입력이라 AI가 쓰지 않는다. 비어 있으면 해당 기능은 열리지 않는다.
-- · review_items 종류 3개(guide_stale·issue_graph_stale·ordinance_change)와 종류별 필수 체크 키를 더한다. 키는 처리 과정의 라벨이고 법·세무 내용이 아니다.
-- · 직원 권한 이름(guide.sign 등 10개)은 DB가 아니라 apps/web/lib/access.ts ACTIONS에 있다 - 역할 표는 고치지 않는다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (이름·종류 제약은 값만 늘린 같은 이름 제약으로 바꾼다).

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
  'certificate_issued', 'training_quote_requested',
  'guide_viewed', 'determination_completed', 'total_cost_started', 'total_cost_completed',
  'family_next_check_opened', 'step_viewed', 'zone_viewed', 'issue_map_viewed',
  'issue_map_source_opened', 'ordinance_viewed', 'institution_inquiry_sent', 'premium_report_viewed',
  'org_seat_invited'));

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['tax_lifecycle', 'house_count', 'total_cost', 'trust_tax_guide', 'redevelopment_tax', 'finance_tax_guide', 'tax_determination', 'issue_graph', 'institution_plans', 'premium_reports']) as k where not (s.value ? k)),
       updated_by = 'migration:20261025000110'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['tax_lifecycle', 'house_count', 'total_cost', 'trust_tax_guide', 'redevelopment_tax', 'finance_tax_guide', 'tax_determination', 'issue_graph', 'institution_plans', 'premium_reports']) as k where not (s.value ? k));

insert into public.settings (key, value, description, updated_by) values
  ('total_cost_policy', '{}'::jsonb, '총비용 시뮬레이터 보유 연수 상한·금리 입력 상한·부대비용 항목 수·"모르겠어요" 기본 비교 값 (RE-05 - 씨앗은 비어 있고, 비어 있으면 기능은 열리지 않는다 - W11-b가 모양 검사를 더한다)', 'migration:20261025000110'),
  ('premium_report_policy', '{}'::jsonb, '프리미엄 리포트 미리보기 길이·발행 주기 (BIZ-07 - 씨앗은 비어 있고, 비어 있으면 리포트는 열리지 않는다 - W11-f)', 'migration:20261025000110'),
  ('institution_inquiry_policy', '{}'::jsonb, '기관 구독 견적 요청 보존 기간·파기 기준 (BIZ-07 - 법률 검토 입력이라 씨앗은 비어 있다. 비어 있으면 견적 접수 닫힘 - W11-f)', 'migration:20261025000110'),
  ('stale_check_policy', '{}'::jsonb, '정비 현황·조례 확인일 경고 일수 (RDV-06·07 - 씨앗은 비어 있다. 비어 있으면 경고 계산 0 - W11-e)', 'migration:20261025000110')
on conflict (key) do nothing;

-- 공통 검수 큐 종류 3개 (W10-c review_items) - 개정 감지가 가이드·쟁점 지도의 "개정 반영 검토 중"을, 자치법규 수집이 조례 변경을 올린다
alter table public.review_items drop constraint review_items_kind_check;
alter table public.review_items add constraint review_items_kind_check check (kind in (
  'law_change', 'legal_doc', 'link_error', 'link_candidates', 'amendment_stage', 'field_data', 'ai_draft', 'pipeline_failure',
  'guide_stale', 'issue_graph_stale', 'ordinance_change'));

create or replace function public.review_required_checks(p_kind text) returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'pipeline_failure' then array['cause_noted']
    when 'law_change' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'promulgation_effective_match']
    when 'legal_doc' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'rights_checked', 'anonymity_checked']
    when 'link_error' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'link_opened']
    when 'link_candidates' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'targets_exist']
    when 'amendment_stage' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'stage_matches_source']
    when 'field_data' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'terms_allowed']
    when 'ai_draft' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'no_unreviewed_claims']
    when 'guide_stale' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'guide_reflected']
    when 'issue_graph_stale' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'graph_reflected']
    when 'ordinance_change' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'summary_matches_source']
  end;
$$;
revoke all on function public.review_required_checks(text) from public, anon, authenticated;
grant execute on function public.review_required_checks(text) to service_role;
