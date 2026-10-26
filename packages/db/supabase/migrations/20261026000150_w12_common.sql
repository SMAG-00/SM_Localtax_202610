-- W12 0차 - 4단계 공통 (docs/dev/4단계_설계.md 2.1 번호 150, 3장 0차 행)
-- · 측정 이벤트 이름 20개를 더한다 (PRD-04 15장 - 85종 -> 105종). 속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다 - 질문 원문·입력값·개인정보 칸 없음.
-- · 기능 키 9개를 꺼진 채로 미리 넣는다 (이미 있는 키는 건드리지 않는다). 공개 승인 전에는 모두 닫힘. `taxbot`은 W1 이후 이미 있는 키를 모드 전환의 마지막 스위치로 쓴다.
-- · 설정 키 씨앗 10개 - 범위 플래그·공개 단계는 꺼짐(none), 예산·단가·보존 기간·정책 값은 PO·감수 입력이라 비어 있다. 비어 있으면 해당 기능은 열리지 않는다(예산 비면 지방세봇 호출 0, 보존 기간 비면 회원 저장 0).
--   한도(ask_limits)·실시간 조회 상한(ask_live_fetch_policy)은 PRD-04 6.8의 운영 초기값이며 세무 값이 아니다.
-- · review_items 종류 4개(case_summary·article_ai_box·channel_draft·consistency_alert)와 종류별 필수 체크 키를 더한다. 키는 처리 과정의 라벨이고 법·세무 내용이 아니다.
-- · 직원 권한 이름(eval.author 등 11개)은 DB가 아니라 apps/web/lib/access.ts ACTIONS에 있다 - 역할 표는 고치지 않는다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (이름·종류 제약은 값만 늘린 같은 이름 제약으로 바꾼다).

-- 측정 이벤트 이름 20종 더하기 - 지금 있는 제약의 이름 목록을 읽어 W12 몫만 덧붙인다(131과 같은 방식). 결과는 in (...) 목록 제약이다.
do $$
declare v_def text; v_names text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'analytics_events_name_check' and c.conrelid = 'public.analytics_events'::regclass;
  select array_agg(t.m[1] order by t.ord) into v_names from regexp_matches(v_def, '''([a-z_]+)''', 'g') with ordinality as t(m, ord);
  v_names := v_names || array(select n from unnest(array[
    'ask_started', 'ask_entry_clicked', 'assistant_mode_switched', 'ask_clarify_answered', 'ask_answer_rendered',
    'ask_fallback_shown', 'ask_investment_blocked', 'ask_scope_redirected', 'ask_live_fetched', 'ask_benefits_shown',
    'ask_determination_shown', 'benefits_block_opened', 'citation_opened', 'ask_feedback', 'ask_quota_reached',
    'keyword_map_viewed', 'keyword_map_node_clicked', 'data_story_viewed', 'channel_landing_viewed', 'security_page_viewed']) as n
    where n <> all (v_names));
  alter table public.analytics_events drop constraint analytics_events_name_check;
  execute format('alter table public.analytics_events add constraint analytics_events_name_check check (name in (%s))', (select string_agg(quote_literal(n), ', ' order by o) from unnest(v_names) with ordinality as u(n, o)));
end;
$$;

update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['ask_history', 'case_summaries', 'keyword_map', 'data_stories', 'security_page', 'channel_kit', 'kakao_login', 'article_ai_box', 'impact_banner']) as k where not (s.value ? k)),
       updated_by = 'migration:20261026000150'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['ask_history', 'case_summaries', 'keyword_map', 'data_stories', 'security_page', 'channel_kit', 'kakao_login', 'article_ai_box', 'impact_banner']) as k where not (s.value ? k));

insert into public.settings (key, value, description, updated_by) values
  ('ask_limits', '{"guest_daily": 3, "member_daily": 10, "premium_daily": 100, "session_turns": 20, "clarify_rounds": 2, "clarify_per_round": 3, "context_chunks": 12, "context_tokens": 20000}'::jsonb,
    '지방세봇 한도 초기값 (PRD-04 6.8 - 운영 값이며 세무 값 아님. 하루 한도는 보내기를 눌렀을 때만 차감)', 'migration:20261026000150'),
  ('ask_live_fetch_policy', '{"max_calls": 3, "timeout_ms": 5000, "excerpt_tokens": 4000, "official_search_max": 2}'::jsonb,
    '질문당 공식 원문 실시간 조회 상한 (PRD-04 6.8 - 운영 값. 호출 서버 등록 요건 확인 전에는 실시간 조회를 쓰지 않는다)', 'migration:20261026000150'),
  ('ask_scope_flags', '{"trust_redevelopment": false, "inheritance": false, "gift": false}'::jsonb,
    '지방세봇 답변 범위 플래그 (신탁·정비 / 상속 취득세 / 증여 취득세) - 모두 꺼짐. 범위 게이트 리포트와 관리자 승인 RPC(W12-e)로만 켠다. 일반 설정 쓰기로 바꾸지 않는다', 'migration:20261026000150'),
  ('ask_rollout', '{"stage": "none"}'::jsonb,
    '지방세봇 공개 단계 none·4a·4b·4c - 평가 게이트 리포트와 관리자 승인 RPC(W12-e)로만 바꾼다', 'migration:20261026000150'),
  ('ask_budget', '{}'::jsonb, '지방세봇 월 예산 (PO 입력 - 비어 있으면 지방세봇 호출 0)', 'migration:20261026000150'),
  ('ask_pricing', '{}'::jsonb, '모델 단가 (PO 입력 - 비어 있으면 지방세봇 호출 0, 단가는 코드에 두지 않는다)', 'migration:20261026000150'),
  ('ask_retention', '{}'::jsonb, '지방세봇 대화 보존 기간 (PO·법률 결정 - 비어 있으면 회원 대화 저장 0)', 'migration:20261026000150'),
  ('keyword_map_policy', '{}'::jsonb, '키워드 맵 노드 상한·최소 건수 (W12-g - 비어 있으면 키워드 맵 닫힘)', 'migration:20261026000150'),
  ('channel_copy_limits', '{}'::jsonb, '채널별 원고 글자 수 상한 (W12-f - 비어 있으면 채널 원고 생성 0)', 'migration:20261026000150'),
  ('ask_official_search', '{"enabled": false}'::jsonb, '공식 도메인 한정 웹 검색 (ASK-17, P2) - 기본 꺼짐. 켜지 않는 동안 요청에 도구 정의 0', 'migration:20261026000150')
on conflict (key) do nothing;

-- 공통 검수 큐 종류 4개 (W10-c review_items) - 편집국 AI 산출물(요지·요약 상자·채널 원고)과 개정 정합성 경보는 review_items에만 쓰고 사람이 승인한 것만 공개한다
alter table public.review_items drop constraint review_items_kind_check;
alter table public.review_items add constraint review_items_kind_check check (kind in (
  'law_change', 'legal_doc', 'link_error', 'link_candidates', 'amendment_stage', 'field_data', 'ai_draft', 'pipeline_failure',
  'guide_stale', 'issue_graph_stale', 'ordinance_change',
  'case_summary', 'article_ai_box', 'channel_draft', 'consistency_alert'));

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
    when 'case_summary' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'case_facts_from_source']
    when 'article_ai_box' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'box_matches_article']
    when 'channel_draft' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'channel_limits_checked']
    when 'consistency_alert' then array['original_compared', 'numbers_dates_links', 'no_personal_info', 'consistency_reflected']
  end;
$$;
revoke all on function public.review_required_checks(text) from public, anon, authenticated;
grant execute on function public.review_required_checks(text) to service_role;
