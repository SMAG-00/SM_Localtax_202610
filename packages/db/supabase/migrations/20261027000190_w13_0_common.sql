-- W13 0차 - 5단계 공통 (docs/dev/5단계_설계.md 2.1 번호 190, 3장 0차 행, 1.1 W13-0)
-- · 권한 키 허용 목록에 library·workspace·copilot을 더한다 (entitlements.key · product_plans.entitlement_key). has_entitlement는 바꾸지 않는다 - 판정은 이 함수 하나.
-- · 측정 이벤트 이름 19개를 더한다 (PRD-05 11장 중 없는 것만 - 105종 -> 124종). 속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다 - 질문 원문·입력값·개인정보 칸 없음.
-- · 기능 키 16개를 꺼진 채로 미리 넣는다 (이미 있는 키는 건드리지 않는다). 공개 승인 전에는 모두 닫힘.
-- · 설정 키 씨앗 11개 - 가격·한도·고지 값은 비어 있다(PO 입력). PRD에 값이 있는 qna_answer_sla_hours(72시간)·digitization_sample_error_max(0.5%)만 값이 있다.
-- · 직원 권한 이름(library.edit 등 10개)은 DB가 아니라 apps/web/lib/access.ts ACTIONS에 있다 - 역할 표는 고치지 않는다.
-- · 5단계 상품 행(products)은 만들지 않는다 - 가격 없는 상품 행은 판매 중 검사와 부딪히므로 W13-a(요금제 가격 입력 시점)에서 더한다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (제약은 값만 늘린 같은 이름 제약으로 바꾼다).

alter table public.entitlements drop constraint entitlements_key_check;
alter table public.entitlements add constraint entitlements_key_check check (key in ('digital', 'premium_report', 'library', 'workspace', 'copilot'));
alter table public.product_plans drop constraint product_plans_entitlement_key_check;
alter table public.product_plans add constraint product_plans_entitlement_key_check check (entitlement_key in ('digital', 'library', 'workspace', 'copilot'));

do $$
declare v_def text; v_names text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'analytics_events_name_check' and c.conrelid = 'public.analytics_events'::regclass;
  select array_agg(t.m[1] order by t.ord) into v_names from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as t(m, ord);
  v_names := v_names || array(select n from unnest(array[
    'pricing_viewed', 'subscription_renewed', 'library_opened', 'workspace_opened', 'note_saved', 'split_view_opened', 'timeline_opened',
    'export_downloaded', 'briefing_opened', 'copilot_used', 'qna_posted', 'qna_answered', 'qna_accepted', 'expert_strip_clicked',
    'solved_case_clicked', 'expert_verified', 'notification_setting_changed', 'notification_opened', 'partner_feed_requested']) as n
    where n <> all (v_names));
  alter table public.analytics_events drop constraint analytics_events_name_check;
  execute format('alter table public.analytics_events add constraint analytics_events_name_check check (name in (%s))', (select string_agg(quote_literal(n), ', ' order by o) from unnest(v_names) with ordinality as u(n, o)));
end;
$$;

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['library', 'library_premium', 'workspace', 'law_split', 'law_timeline', 'research_copilot', 'expert_calc', 'qna', 'solved_cases', 'my_notifications', 'my_briefings', 'partner_feeds', 'licenses', 'naver_series', 'account_links', 'security_cert_plan']) as k where not (s.value ? k)),
       updated_by = 'migration:20261027000190'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['library', 'library_premium', 'workspace', 'law_split', 'law_timeline', 'research_copilot', 'expert_calc', 'qna', 'solved_cases', 'my_notifications', 'my_briefings', 'partner_feeds', 'licenses', 'naver_series', 'account_links', 'security_cert_plan']) as k where not (s.value ? k));

insert into public.settings (key, value, description, updated_by) values
  ('library_preview', '{}'::jsonb, '지식창고 비구독자 미리보기 길이 (PO 입력 - 글자 수 기준. 비어 있으면 미리보기 0, 서버 절단 함수가 읽는다)', 'migration:20261027000190'),
  ('library_rate_limit', '{}'::jsonb, '지식창고 열람 속도 제한·대량 복사 탐지 한도 (W13-a - 비어 있으면 열람 닫힘)', 'migration:20261027000190'),
  ('export_excerpt_limit', '{}'::jsonb, '내보내기(.docx·.csv) 발췌 한도 (W13-b - 비어 있으면 내보내기 0)', 'migration:20261027000190'),
  ('saved_search_limit', '{}'::jsonb, '저장 검색 개수 한도 (W13-b - 비어 있으면 저장 0)', 'migration:20261027000190'),
  ('copilot_monthly_limit', '{}'::jsonb, '리서치 코파일럿 월 한도 (PO 입력 - 비어 있으면 실행 0)', 'migration:20261027000190'),
  ('link_similarity_threshold', '{}'::jsonb, '유사도 추천 임계값 (W13-c - 비어 있으면 유사도 추천 0)', 'migration:20261027000190'),
  ('qna_criteria', '{}'::jsonb, '활동 전문가 노출 기준 값 (W13-g - 최근 90일 채택 수·채택률 등, PO 입력. 기준 페이지가 같은 값을 읽는다)', 'migration:20261027000190'),
  ('qna_detect_dictionary', '{}'::jsonb, '라운지 개인정보·상담 유도 표현 검출 사전 (W13-g - 법률 검토 전 비어 있음)', 'migration:20261027000190'),
  ('qna_answer_sla_hours', '{"hours": 72}'::jsonb, '라운지 질문 답변 목표 시간 (PRD-05 11장 초기안 72시간 - 라운지 답변율 지표의 기준)', 'migration:20261027000190'),
  ('expert_badge_notice_days', '{}'::jsonb, '전문가 배지 재검증 만료 사전 알림 일수 (W13-g - 비어 있으면 알림 0)', 'migration:20261027000190'),
  ('digitization_sample_error_max', '{"percent": 0.5}'::jsonb, '출판물 이관 표본 오류율 상한 (PRD-05 LIB-06 값 0.5% - 초과하면 승인 닫힘)', 'migration:20261027000190')
on conflict (key) do nothing;
