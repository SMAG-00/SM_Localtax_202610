# W2-c 측정·많이 본 기사·형식 콘텐츠·기사 생산 대시보드 — 설계 약속 (개발 문서)

PRD-01A 9장 W2-c(분석 이벤트·첫 방문·지표 대시보드, 많이 본 기사·HOT 집계, 인포그래픽·동영상·포토·제휴 콘텐츠, 기사 생산 대시보드)를 구현할 때 DB(packages/db)·수집 API(apps/web/app/api/events)·브라우저 도우미(apps/web/lib/analytics)·집계 배치·대시보드가 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항 원문은 PRD-01A 4장(FND-06 · GROW-01 · ART-07 · ART-08 · ART-09 · ART-10 · ART-11 · HOME-05 · NAV-13 · NAV-14)·6장 데이터·8.2 시험·12장 측정·13장 결정 안건, PRD-00 13장 측정 공통·6장 회원 등급, PRD_최종 §3.3·§10이다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다. W2-a·W2-b에서 정한 것(값 목록·권한·공개 읽기)은 `docs/dev/W2-a_설계.md`·`docs/dev/W2-b_설계.md`를 그대로 따른다.

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 측정 기반 | `analytics_events`·`article_stats` 마이그레이션·RLS·수집 설정 씨앗, 익명 방문자 ID·세션·측정 거부(GPC), 수집 API `POST /api/events`(검사·크기·같은 사이트·속도 제한·봇 표시·첫 방문), 측정 거부 화면·API, 브라우저 도우미와 시범 연결(기사 상세·허브·홈 분야 카드) | DB 시험(칸 검사 — 개인정보 칸 0·`events` 표 0)·RLS 검증·단위 시험(29분·30분·31분 세션 경계, 29초·30초 열람)·E2E `analytics-api`(거부·GPC 전송 0, 봇 표시, 4xx 저장 0, 429) |
| 2 집계·많이 본 기사·HOT | 1시간 배치 `/api/jobs/popular-hourly`(→ `article_stats`, 멱등), 많이 본 기사(사이드바 5·`/news/popular` 20), 상담 사례 HOT(지방세 허브·상담 사례 목록 — 카드 3 + HOT 5), 원본 이벤트 보존 기한 정리 | 봇 100회 + 사람 3회 < 사람 5회, 168시간·169시간 경계, 30분 안 반복 1회, 비공개 전환 제외, 고정 최대 2건·동점 최신 앞, 가중치 설정 변경 → 다음 집계 순위 변화 |
| 3 지표 대시보드 | `/admin/metrics` — GROW-01 분야별 유효 방문·재방문율·첫 방문 깔때기, 다른 문서 지표 자리(`수집 전`), 시험 기간 분리(전환일 설정) | 지방세 허브 → 기사 29초 0·30초 1, 재방문 30일 포함·31일 제외, 새 브라우저 시나리오 깔때기 세 칸 +1, 편집자·봇 제외 |
| 4 형식·제휴 콘텐츠 | 인포그래픽 블록(ART-07)·동영상 기사와 `/news/video`(ART-08)·포토 기사와 `/news/photo`(ART-09)·제휴사 프로필 `/partners/[id]`(ART-10) | 저장 불가 조건, 재생 전 유튜브 요청 0, `video_played`·`partner_content_viewed` 1건 |
| 5 기사 생산·제휴 준비 대시보드 | 규정 버전 `news_partner_requirements`·점검 기록 `news_partner_checks`·읽기 함수, 3·6·12개월 대시보드 `/admin/news-readiness`와 규정 화면(NAV-13·14), 공동 기획 배지 이름(ART-10 표기 고침). 월 행 `partner_readiness_monthly`는 W7 NAV-17 월 마감 배치(9장 #59) | 확정 버전 없으면 `요건 미확정`, 시작일 하루 전 제외·시작일 포함, '인정'·'예상 점수' 0, 코드·설정 기본값에 기준 상수 0 |
| 6 수용 E2E | PRD-01A 9장 W2-c 증거 전부 | 봇 제외·168시간 경계, 유효 방문 29초·30초, 규정 미확정 시 `요건 미확정` — `e2e/w2c-acceptance.test.mjs` (8.6 수용 결과 표) |

단계마다 시험 통과 → 커밋 → push → CI 확인 → 보고 (작업 단위 규칙). 이 문서의 1단계 밖 내용(2~6단계)은 순서와 약속만 적었고, 그 단계에서 고친다.

## 2. 값 목록

### 2.1 DB check 제약 값 (TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| analytics_events.name (이벤트 이름 — PRD-01A 12장 19종 + W3 10단계 3종 + W4 24단계 7종 + W8 2종 + W10 0차 34종 + W10-i 4종 + W11 0차 13종 + W11-f 3종 + W12 0차 20종 + W13 0차 19종) | `home_entry_clicked` · `hub_viewed` · `article_viewed` · `article_engaged` · `article_shared` · `search_submitted` · `glossary_opened` · `situation_card_clicked` · `next_action_clicked` · `hot_article_clicked` · `popular_article_clicked` · `video_played` · `partner_content_viewed` · `signup_completed` · `brief_preregistered` · `inquiry_submitted` · `policy_page_viewed` · `redirect_hit` · `not_found_viewed` · `calculator_card_clicked` · `amendment_viewed` · `interpretation_viewed` · `region_viewed` · `regional_news_opened` · `regional_source_opened` · `region_to_tax_clicked` · `region_to_realestate_clicked` · `project_viewed` · `dev_method_viewed` · `product_clicked` · `order_link_clicked` · `calc_started` · `calc_completed` · `calc_step_viewed` · `calc_step_left` · `calc_compared` · `calc_compare_gated` · `reduction_shown` · `reduction_expanded` · `refund_diagnosed` · `wetax_handoff` · `external_calculator_opened` · `calc_offline_used` · `calendar_exported` · `accuracy_viewed` · `content_to_tool` · `law_viewed` · `related_panel_opened` · `case_viewed` · `brief_subscribe_viewed` · `brief_subscribed` · `brief_confirmed` · `brief_opened` · `brief_unsubscribed` · `brief_link_visited` · `review_decided` · `sm_calculator_opened` · `amendment_alert_subscribed` · `amendment_alert_sent` · `paywall_viewed` · `subscription_started` · `subscription_cancelled` · `order_paid` · `certificate_issued` · `training_quote_requested` · `shortcut_clicked` · `realestate_weekly_viewed` · `campaign_landing_viewed` · `campaign_cta_clicked` · `guide_viewed` · `determination_completed` · `total_cost_started` · `total_cost_completed` · `family_next_check_opened` · `step_viewed` · `zone_viewed` · `issue_map_viewed` · `issue_map_source_opened` · `ordinance_viewed` · `institution_inquiry_sent` · `premium_report_viewed` · `org_seat_invited` · `institution_inquiry_submitted` · `org_seat_accepted` · `report_previewed` · `ask_started` · `ask_entry_clicked` · `assistant_mode_switched` · `ask_clarify_answered` · `ask_answer_rendered` · `ask_fallback_shown` · `ask_investment_blocked` · `ask_scope_redirected` · `ask_live_fetched` · `ask_benefits_shown` · `ask_determination_shown` · `benefits_block_opened` · `citation_opened` · `ask_feedback` · `ask_quota_reached` · `keyword_map_viewed` · `keyword_map_node_clicked` · `data_story_viewed` · `channel_landing_viewed` · `security_page_viewed` · `pricing_viewed` · `subscription_renewed` · `library_opened` · `workspace_opened` · `note_saved` · `split_view_opened` · `timeline_opened` · `export_downloaded` · `briefing_opened` · `copilot_used` · `qna_posted` · `qna_answered` · `qna_accepted` · `expert_strip_clicked` · `solved_case_clicked` · `expert_verified` · `notification_setting_changed` · `notification_opened` · `partner_feed_requested` |
| analytics_events.mode (모드 — PRD-00 13장 일반·전문가) | `general` · `expert` |
| analytics_events.tier (회원 등급 — PRD-00 6장 비회원·일반·프리미엄·기관 좌석) | `guest` · `basic` · `premium` · `institution` |
| analytics_events.entry (진입 경로 — PRD-00 13장) | `search` · `ai_answer_engine` · `naver` · `brief` · `assistant` · `experts` · `tax_lens` · `campaign` · `direct` · `referral` |
| analytics_events.section (분야 — W2-a 4대 분야) | `tax` · `realestate` · `finance` · `local` |

- 이름은 PRD-01A 12장 표가 정한다(PRD-00 13장 공통 초안 `section_hub_viewed`·`article_read_30s`는 정의 문서 이름 `hub_viewed`·`article_engaged`로 확정 — PRD-00 "다르면 이 문서를 고친다"). 01B·01C 이벤트(`tax_lens_clicked`·`assistant_*`·`expert_*` 등)는 그 작업 단위가 마이그레이션으로 이 제약과 이 표에 더한다.
- 진입 경로 글자: `search` 검색 · `ai_answer_engine` AI 검색(AI 답변 엔진 — OPT-09) · `naver` 네이버 · `brief` 브리핑·주간 메일 · `assistant` AI 도우미 · `experts` 전문가 소개 · `tax_lens` 「지방세로 읽기」 · `direct` 직접 · `referral` 그 밖의 사이트 [확인 필요 — 9장 #6].
- 숫자 칸 `stage`(단계)는 1~5 정수(서비스 단계 — PRD 단계 표의 숫자). 지금은 설정 `analytics.stage` = 1 [확인 필요 — 9장 #5].

### 2.2 이벤트 속성 (props — 수집 API가 이벤트 이름마다 이 칸만 받는다)

분야 칸: 필수 = `section` 없으면 400 · 선택 = 있어도 없어도 된다 · 없음 = 보내면 400. 속성은 모두 필수이고 `(선택)`만 빠져도 된다. 적히지 않은 속성 이름은 400.

| 이벤트 | 분야 칸 | 속성 |
|---|---|---|
| `home_entry_clicked` | 필수 | 없음 |
| `hub_viewed` | 필수 | `topic`(선택) · `category`(선택) |
| `article_viewed` | 필수 | `article_id` · `format` · `content_type` |
| `article_engaged` | 필수 | `article_id` · `format` · `content_type` |
| `article_shared` | 필수 | `article_id` · `channel` |
| `search_submitted` | 선택 | `query_length` · `result_count` · `result_type_count` · `region_classified` |
| `glossary_opened` | 선택 | `term_id` |
| `situation_card_clicked` | 필수 | `situation` · `position` |
| `next_action_clicked` | 선택 | `action` · `screen` |
| `hot_article_clicked` | 선택 | `article_id` · `rank` · `pinned` |
| `popular_article_clicked` | 선택 | `article_id` · `rank` · `position` |
| `video_played` | 필수 | `article_id` |
| `partner_content_viewed` | 선택 | `partner_id` · `article_id` |
| `signup_completed` | 없음 | `interest_count` · `region_count` |
| `brief_preregistered` | 선택 | `from_path` |
| `inquiry_submitted` | 없음 | `kind` |
| `policy_page_viewed` | 없음 | `policy` |
| `redirect_hit` | 없음 | `from_path` · `to_path` |
| `not_found_viewed` | 없음 | `path` |
| `calculator_card_clicked` | 선택 | `card` · `screen` · `rank` |
| `amendment_viewed` | 필수 | `amendment_id` · `stage`(선택) |
| `interpretation_viewed` | 필수 | `article_id` · `doc_type` |
| `region_viewed` | 필수 | `region_code` · `level` |
| `regional_news_opened` | 필수 | `region_code` · `field` |
| `regional_source_opened` | 필수 | `region_code` · `source_type` |
| `region_to_tax_clicked` | 필수 | `region_code` · `target` |
| `region_to_realestate_clicked` | 필수 | `region_code` · `target` |
| `project_viewed` | 필수 | `region_code` · `project_type` · `stage` |
| `dev_method_viewed` | 필수 | `method` |
| `product_clicked` | 선택 | `product_id` · `placement` · `article_id`(선택) |
| `order_link_clicked` | 선택 | `product_id` · `placement` · `mode` · `article_id`(선택) |
| `calc_started` | 선택 | `tool` · `input_mode` · `entry_path` |
| `calc_completed` | 선택 | `tool` · `input_mode` · `entry_path` · `elapsed_sec` |
| `calc_step_viewed` | 선택 | `tool` · `step` · `unsure` |
| `calc_step_left` | 선택 | `tool` · `step` · `unsure` |
| `calc_compared` | 선택 | `condition_count` |
| `calc_compare_gated` | 선택 | 없음 |
| `reduction_shown` | 선택 | `reduction_id` · `table_version` |
| `reduction_expanded` | 선택 | `reduction_id` · `table_version` |
| `refund_diagnosed` | 선택 | `high_count` · `check_count` · `low_count` |
| `wetax_handoff` | 선택 | `from_screen` · `tax_kind` · `wetax_menu` |
| `external_calculator_opened` | 선택 | `from_screen` · `link_state` |
| `calc_offline_used` | 선택 | `tool` · `ruleset_version` |
| `calendar_exported` | 선택 | `year` · `item_count` |
| `accuracy_viewed` | 선택 | `via` |
| `content_to_tool` | 선택 | `content_kind` · `tool` · `region_code`(선택) |
| `law_viewed` | 선택 | `law_id` · `as_of_used` · `view` · `duration_band` |
| `related_panel_opened` | 선택 | `tab` · `place` |
| `case_viewed` | 선택 | `doc_type` · `origin` · `duration_band` |
| `brief_subscribe_viewed` | 없음 | `route` |
| `brief_subscribed` | 없음 | `route` |
| `brief_confirmed` | 없음 | `route` |
| `brief_opened` | 없음 | 없음 |
| `brief_unsubscribed` | 없음 | `route` · `tenure_band` |
| `brief_link_visited` | 없음 | `issue_id` · `corner` |
| `review_decided` | 없음 | `job` · `duration_band` · `result` |
| `sm_calculator_opened` | 선택 | `from_screen` · `tax_kind` · `link_state` |
| `amendment_alert_subscribed` | 선택 | `tax_count` · `item_count` |
| `amendment_alert_sent` | 선택 | `stage` |
| `paywall_viewed` | 선택 | `content_type` · `via` |
| `subscription_started` | 없음 | `product_id` · `period` · `via` |
| `subscription_cancelled` | 없음 | `product_id` · `tenure_band` |
| `order_paid` | 없음 | `product_kind` · `via` |
| `certificate_issued` | 없음 | `course_id` |
| `training_quote_requested` | 없음 | `org_type` |
| `shortcut_clicked` | 없음 | `placement` · `shortcut` |
| `realestate_weekly_viewed` | 없음 | `issue_id` |
| `campaign_landing_viewed` | 없음 | `campaign` · `source` · `medium` |
| `campaign_cta_clicked` | 없음 | `campaign` · `cta` · `destination` |
| `guide_viewed` | 선택 | `hub` · `topic` · `tax_scope` |
| `determination_completed` | 선택 | `kind` |
| `total_cost_started` | 선택 | `entry_path` |
| `total_cost_completed` | 선택 | `entry_path` · `compare_used` |
| `family_next_check_opened` | 선택 | `from_screen` · `target` |
| `step_viewed` | 선택 | `stage` |
| `zone_viewed` | 선택 | `region_code` · `project_type` · `entry` |
| `issue_map_viewed` | 선택 | `issue` · `entry` |
| `issue_map_source_opened` | 선택 | `issue` · `law_id` · `relation` |
| `ordinance_viewed` | 선택 | `region_code` · `kind` · `entry` |
| `institution_inquiry_sent` | 없음 | `product_id` · `org_type` |
| `premium_report_viewed` | 없음 | `report_id` · `seated` |
| `org_seat_invited` | 없음 | `org_type` |
| `institution_inquiry_submitted` | 없음 | 없음 |
| `org_seat_accepted` | 없음 | 없음 |
| `report_previewed` | 없음 | 없음 |
| `ask_started` | 없음 | `entry` · `ask_mode` · `member_tier` |
| `ask_entry_clicked` | 선택 | `entry` |
| `assistant_mode_switched` | 없음 | `direction` · `rollout_stage` |
| `ask_clarify_answered` | 없음 | `round` · `unsure` |
| `ask_answer_rendered` | 없음 | `citation_count` · `live_citation_count` · `validation` · `latency_ms` · `cost_won` · `scope` |
| `ask_fallback_shown` | 없음 | `reason` |
| `ask_investment_blocked` | 없음 | `topic` |
| `ask_scope_redirected` | 없음 | `reason` · `scope`(선택) |
| `ask_live_fetched` | 없음 | `target_type` · `succeeded` · `latency_ms` |
| `ask_benefits_shown` | 없음 | `tax_kind` · `reduction_count` |
| `ask_determination_shown` | 없음 | `kind` |
| `benefits_block_opened` | 선택 | `tax_kind` · `via` |
| `citation_opened` | 없음 | `source_kind` · `live` |
| `ask_feedback` | 없음 | `rating` · `reason`(선택) |
| `ask_quota_reached` | 없음 | `member_tier` |
| `keyword_map_viewed` | 선택 | `tax_item` |
| `keyword_map_node_clicked` | 선택 | `tax_item` · `node_count` |
| `data_story_viewed` | 선택 | `series_key` · `via` |
| `channel_landing_viewed` | 없음 | `utm_source` · `utm_campaign` |
| `security_page_viewed` | 없음 | `entry` |
| `pricing_viewed` | 없음 | `via` |
| `subscription_renewed` | 없음 | `product_id` · `period` |
| `library_opened` | 없음 | `kind` |
| `workspace_opened` | 없음 | 없음 |
| `note_saved` | 없음 | 없음 |
| `split_view_opened` | 없음 | `panel_count` |
| `timeline_opened` | 없음 | `entry` |
| `export_downloaded` | 없음 | `format` · `target` |
| `briefing_opened` | 없음 | `channel` |
| `copilot_used` | 없음 | `feature` |
| `qna_posted` | 없음 | `tax_item`(선택) |
| `qna_answered` | 없음 | `tax_item`(선택) · `by_expert` |
| `qna_accepted` | 없음 | `tax_item`(선택) · `by_expert` |
| `expert_strip_clicked` | 없음 | `rank` |
| `solved_case_clicked` | 없음 | `placement` |
| `expert_verified` | 없음 | `qualification` |
| `notification_setting_changed` | 없음 | `kind` · `enabled` · `entry` |
| `notification_opened` | 없음 | `kind` |
| `partner_feed_requested` | 없음 | `partner_id` · `scope` |

속성 값의 모양 — 번호(`article_id`·`term_id`·`partner_id`·`amendment_id`)는 1 이상 정수, 개수(`query_length` 0~200 · `result_count` 0~10000 · `result_type_count` 0~20 · `interest_count`·`region_count` 0~20), 순위(`rank`) 1~100, 참·거짓(`region_classified`·`pinned`), `situation`·`category`는 slug(영문 소문자·숫자·`-`, 100자 이하), 주소(`from_path`·`to_path`·`path`)는 `/`로 시작하는 경로만(쿼리·조각 없음, 200자 이하, 풀어 읽은 글자에 이메일·전화·주민등록번호 모양 0), 나머지는 아래 2.3 목록 값이다. `format`·`content_type`은 W2-a 값 목록(`general` … · `reported_news` …), `action`은 W2-b 2.3 `next_action` 키다. 검색어 원문·질문 원문·계산 입력값·이메일·주소를 담을 칸은 어느 이벤트에도 없다. W3 10단계 3종(W3 설계 2.5): `calculator_card_clicked` — 바깥 연결 카드(`/calc`·상황 페이지 공용 카드)의 이동 링크를 누를 때 1건, `rank`는 그 화면 안 카드 차례(1부터 — `/calc`는 SM 카드 다음 바깥 계산기 카드), 분야는 상황 페이지만 · `amendment_viewed` — 트래커 상세를 열 때 1건(분야 `tax`) · `interpretation_viewed` — 원문 블록이 있는 해석 해설 기사를 열 때 1건(기사 분야). 카드 주소·이용자 입력·표식 값은 어느 칸에도 없다. W4 24단계 7종(W4 설계 2.5): 지역 코드(`region_code`)는 `regions.code` 숫자 10자리, 분야는 모두 필수 · `region_viewed` — 지역 허브(`/local/[시·도]`·`/[시·군·구]`)를 열 때 1건(분야 `local`, `level` = 시·도/시·군·구) · `regional_news_opened` — 허브 블록 ②③⑤의 지역 기사 카드 링크를 누를 때 1건(`field` = 기사 편집 분야) · `regional_source_opened` — 허브 ⑤ 공식 자료 원문 카드의 [원문 보기]를 누를 때 1건(`source_type` = 자료 종류, 원문 주소 0) · `region_to_tax_clicked` — 지역 세금 연결 블록의 상황 카드·감수 해설·공식 원문 링크를 누를 때 1건(`target`: `situation`·`explainer`·`official_source`) · `region_to_realestate_clicked` — 허브 ③ 부동산·개발의 프로젝트 카드·분양 카드·더 보기 링크를 누를 때 1건(`target`: `project`·`project_list`·`supply`·`supply_list`) · `project_viewed` — 프로젝트 상세를 열 때 1건(분야 `realestate`, 지역 코드·사업 유형 키·현재 단계 키) · `dev_method_viewed` — 개발방법 상세를 열 때 1건(분야 `realestate`, `method` = 방법 slug). SM 취득세 카드(별도 사이트)의 누름은 이 7종이 아니라 `calculator_card_clicked`(`region_hub`·`project`·`inheritance_gift`·`dev_method` 화면) 하나로 센다 — 링크 한 번에 이벤트 한 건.

### 2.3 속성 값 목록 (TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| article_shared.channel (공유 채널) | `native_share` · `copy_link` |
| situation_card_clicked.position (상황 카드 위치) | `hub` · `search_empty` · `inheritance_gift` |
| next_action_clicked.screen (화면) | `article` · `situation` |
| popular_article_clicked.position (위치) | `sidebar` · `list` |
| policy_page_viewed.policy (정책 종류) | `editorial_policy` · `ethics` · `corrections` · `ad_policy` · `privacy` |
| inquiry_submitted.kind (문의 종류 — W2-a inquiries.kind) | `tip` · `subscription` · `advertising` · `reader_submission` · `correction` · `product` · `assistant_report` |
| hub_viewed.topic (지자체뉴스 편집 분야 — W2-a editorial_field) | `local_tax` · `realestate` · `local_finance` · `urban_policy` |
| calculator_card_clicked.card (바깥 연결 카드 키 — official_links.key 시드, W3 1단계 마이그레이션 …32. 키 이름은 임시 — W3 12장 #41) | `acquisition` · `property_tax` · `transfer` · `registration` · `comprehensive` · `inheritance_gift` · `wetax` · `nts` · `nts_guide` · `law_info_center` · `edu` |
| calculator_card_clicked.screen (카드가 있는 화면 — W3 1·9단계 공용 카드 + W4 24단계) | `calc` · `situation` · `inheritance_gift` · `project` · `region_hub` · `dev_method` |
| amendment_viewed.stage (현재 단계 — W2-a amendment_event.stage, 단계 기록이 없으면 칸 없음) | `announced` · `pre_notice` · `submitted` · `passed` · `promulgated` · `effective` |
| interpretation_viewed.doc_type (해설 대상 원문 유형 — W3 설계 2.1 legal_doc.doc_type, 첫 subject 원문) | `ruling` · `circular` · `interpretation` · `tribunal` · `case` |
| region_viewed.level (행정구역 단계 — W4 region.level) | `sido` · `sigungu` |
| regional_news_opened.field (지역 기사 편집 분야 — W2-a editorial_field) | `local_tax` · `realestate` · `local_finance` · `urban_policy` |
| regional_source_opened.source_type (공식 자료 종류 — W4 official_source_type 허용 6종) | `ordinance` · `notice` · `budget_settlement` · `local_tax_revenue` · `realestate_transaction` · `redevelopment` |
| region_to_tax_clicked.target (도착 종류 — 지역 세금 연결 블록의 링크 줄) | `situation` · `explainer` · `official_source` |
| region_to_realestate_clicked.target (도착 종류 — 허브 ③ 부동산·개발의 링크) | `project` · `project_list` · `supply` · `supply_list` |
| dev_method_viewed.method (개발방법 slug — W4 dev_method.slug) | `redevelopment` · `reconstruction` · `small-scale` · `public` · `trust` · `renewal` · `rapid-planning` |
| product_clicked.placement (자사 상품 카드 위치 — W8 product_links.placement + 스토어 목록) | `article` · `home` · `store` |
| order_link_clicked.placement (주문 링크를 누른 출발 위치) | `article` · `home` · `store` |
| order_link_clicked.mode (주문 방식 — W8 products.order_mode) | `existing_channel` · `request_form` |
| calc.tool (계산기 종류 - W10 0차, PRD-02 11장) | `acquisition` · `holding` · `refund` · `compare` |
| calc.input_mode (입력 방식 - 질문형·전체 폼 - W10 0차, PRD-02 11장) | `wizard` · `form` |
| calc.entry_path (계산기 진입 경로 - W10 0차, PRD-02 11장) | `home_card` · `hub` · `article` · `tax_lens` · `search` · `region_hub` · `assistant` · `direct` · `shortcut` · `campaign` |
| calc.screen (바깥 이동 출발 화면 - W10 0차, PRD-02 11장) | `calc_index` · `acquisition_result` · `holding_result` · `refund_result` · `situation` · `region_hub` · `ask` |
| calc.tax_kind (세목 - 위택스·SM 계산기 이동 - W10 0차, PRD-02 11장) | `acquisition` · `property` · `comprehensive` · `vehicle` · `refund` |
| link.state (바깥 연결 상태 - 정상·대체 - W10 0차, PRD-02 11장) | `ok` · `fallback` |
| accuracy.via (정확도 페이지 진입 - 배지·허브 - W10 0차, PRD-02 11장) | `badge` · `hub` |
| view.duration_band (열람 시간 구간 - W10 0차, PRD-02 11장) | `under_10` · `10_to_30` · `over_30` |
| content.kind (도구로 넘어간 콘텐츠 유형 - W10 0차, PRD-02 11장) | `article` · `tax_lens` · `solution_case` · `glossary` · `situation` · `search` · `region_hub` |
| law.view (법령 보기 - 1단·3단 - W10 0차, PRD-02 11장) | `single` · `three` |
| panel.tab (관련 자료 패널 탭 - W10 0차, PRD-02 11장) | `law` · `ruling` · `circular` · `interpretation` · `tribunal` · `case` |
| panel.place (관련 자료 패널 위치 - W10 0차, PRD-02 11장) | `law_view` · `three_view` |
| case.doc_type (해석 DB 문서 유형 - W10 0차, PRD-02 11장) | `ruling` · `circular` · `interpretation` · `tribunal` · `case` |
| case.origin (해석 DB 유입 경로 - W10 0차, PRD-02 11장) | `search` · `panel` · `article` |
| brief.route (브리핑 구독 경로 - W10 0차, PRD-02 11장) | `page` · `article` · `home` · `footer` · `assistant` |
| brief.unsubscribe_route (브리핑 해지 경로 - W10 0차, PRD-02 11장) | `mail_link` · `manage` |
| tenure.band (구독 기간 구간 - W10 0차, PRD-02 11장) | `under_30` · `30_to_90` · `over_90` |
| review.result (검수 결과 - W10 0차, PRD-02 11장) | `approved` · `rejected` · `held` |
| shortcut.placement (바로가기 위치 - W10-i, GROW·HOME-13. 헤더 줄은 PO 2026-10-26에 없앴습니다) | `home` |
| shortcut.key (바로가기 도착 키 - W10-i, HEADER_SHORTCUTS) | `calc` · `expert_request` · `brief_weekly` · `realestate_weekly` |
| campaign.cta (캠페인 버튼 종류 - W10-i, GROW-05) | `primary` · `secondary` |
| review.duration_band (검수 소요 구간 - W10 0차, PRD-02 11장) | `under_15` · `15_to_60` · `over_60` |
| amendment_alert_sent.stage (알림에 담은 변경 단계 - amendment_event.stage - W10 0차, PRD-02 11장) | `announced` · `pre_notice` · `submitted` · `passed` · `promulgated` · `effective` |
| paywall.content_type (페이월 콘텐츠 유형 - W10 0차, PRD-02 11장) | `digital_edition` · `archive` · `deep_commentary` · `premium_brief` |
| paywall.via (유료 구독 유입 경로 - BIZ-09 - W10 0차, PRD-02 11장) | `article` · `column` · `brief` · `search` · `ai_search` · `naver` · `assistant` · `expert_profile` |
| billing.period (결제 주기 - W10 0차, PRD-02 11장) | `monthly` · `yearly` |
| order.product_kind (주문 상품 유형 - W10 0차, PRD-02 11장) | `digital` · `print` · `course` · `seminar` |
| training.org_type (위탁교육 기관 유형 - W10 0차, PRD-02 11장) | `public` · `corporate` · `association` · `other` |
| guide.hub (가이드 허브 - W11 0차, PRD-03 7장 guides.hub) | `realestate_tax` · `trust` · `redevelopment` · `finance_tax` |
| guide.tax_scope (세목 범위 - W11 0차, PRD-03 7장 guides.tax_scope) | `local` · `national` · `both` |
| determination.kind (판정표 종류 - W11 0차, 마이그레이션 112 determination_tables.kind) | `house_count` · `trust_taxpayer` · `redevelopment_right` · `house_count_inheritance` · `house_count_gift` · `redevelopment_tax` · `trust_acquisition` |
| total_cost.entry_path (총비용 진입 경로 - W11 0차, PRD-03 12장) | `realestate_tax` · `calc_index` · `article` · `situation` · `direct` |
| family_next.from (다음 확인 출발 화면 - W11 0차, FAM-05) | `guide_page` · `situation_page` · `acquisition_result` |
| family_next.target (다음 확인 대상 도구 - W11 0차, FAM-05) | `house_count` · `holding_tax` · `transfer_guide` |
| zone.entry (정비 현황 진입 - W11 0차, RDV-07) | `dev_method_compare` · `local_hub_block` |
| issue_map.entry (쟁점 지도 진입 - W11 0차, LINK-01) | `hub` · `guide` · `case_list` · `direct` |
| issue_map.relation (쟁점 지도 관계 라벨 - W11 0차, issue_graphs relation) | `delegation` · `mutatis` · `requirement` · `precedent` |
| ordinance.kind (조례 종류 - W11 0차, ordinance_links.kind) | `urban_redevelopment` · `tax_reduction` · `tax_rate` |
| ordinance.entry (조례 진입 - W11 0차, TX-13) | `local_hub` · `tax_hub` · `realestate_hub` |
| institution.org_type (기관 유형 - W11 0차, BIZ-07 지자체·세무법인·금융기관) | `local_government` · `tax_firm` · `financial_institution` |
| ask.entry (지방세봇 진입점 - W12 0차, PRD-04 15장) | `mode_switch` · `search_results` · `law` · `case` · `calc` · `article` · `step` · `issue_map` |
| ask.mode (답변 말투 - W12 0차) | `general` · `expert` |
| ask.tier (회원 등급 - W12 0차) | `guest` · `basic` · `premium` · `institution` |
| ask.direction (모드 전환 방향 - W12 0차) | `to_agent` · `to_guide` |
| ask.rollout (공개 단계 - W12 0차, 4a·4b·4c) | `stage_4a` · `stage_4b` · `stage_4c` |
| ask.validation (검증 결과 - W12 0차) | `passed` · `regenerated` · `fallback` |
| ask.scope (답변 범위 - W12 0차) | `base` · `trust_redevelopment` · `inheritance` · `gift` |
| ask.fallback_reason (대체 응답 사유 - W12 0차) | `insufficient_evidence` · `outage` · `budget` · `scope_pending` |
| ask.invest_topic (투자 차단 주제 - W12 0차) | `recommendation` · `prediction` |
| ask.redirect_reason (범위 안내 사유 - W12 0차) | `tourism` · `scope_pending` · `national_tax_calculator` |
| ask.live_target (실시간 조회 대상 - W12 0차) | `law` · `case` · `interpretation` |
| ask.benefit_via (감면 블록 진입 - W12 0차) | `agent` · `calculator` |
| ask.source_kind (근거 유형 - W12 0차) | `law` · `case` · `interpretation` · `guide` · `issue_map` · `publication` · `article` · `glossary` |
| ask.rating (피드백 - W12 0차) | `up` · `down` |
| ask.feedback_reason (피드백 사유 - W12 0차) | `wrong` · `outdated` · `unclear` · `other` |
| data_story.via (데이터 스토리 진입 - W12 0차) | `article` · `data_page` |
| security.entry (보안 정책 진입 - W12 0차) | `footer` · `agent` · `direct` · `search` |
| pricing.via (요금 안내 진입 경로 - W13 0차) | `paywall` · `menu` · `brief` · `local_hub` · `library` · `workspace` · `direct` |
| library.kind (지식창고 유형 - W13 0차) | `ebook` · `wiki` · `column` · `premium_column` |
| timeline.entry (쟁점 타임라인 진입 - W13 0차) | `law` · `keyword` |
| export.format (내보내기 형식 - W13 0차) | `docx` · `csv` |
| export.target (내보내기 대상 - W13 0차) | `notes` · `scraps` · `saved_searches` · `copilot_result` |
| briefing.channel (맞춤 브리핑 채널 - W13 0차) | `web` · `email` |
| copilot.feature (코파일럿 기능 - W13 0차) | `compare` · `history_summary` · `publication_summary` · `issue_memo` |
| solved_case.placement (해결 사례 위치 - W13 0차) | `home` |
| notification.kind (알림 종류 - W13 0차) | `law` · `saved_search` · `region` · `calendar` |
| notification.entry (알림 설정 진입 - W13 0차) | `local_hub` · `settings` |
| partner_feed.scope (제휴 피드 범위 - W13 0차) | `summary` · `full` |
| client.entry (브라우저가 정해 보내도 되는 진입 경로 — 사이트 안 출발점) | `assistant` · `experts` · `tax_lens` · `campaign` |
| settings.analytics_keys (수집·집계 설정 키) | `analytics` · `bot_user_agents` · `analytics_referrers` · `hot_weights` · `popular_rules` |

### 2.4 쿠키 (자체 도메인 1st-party — 모두 `Path=/` · `SameSite=Lax` · https면 `Secure`)

| 쿠키 | 값 | 수명 | 스크립트가 읽나 | 언제 생기나 |
|---|---|---|---|---|
| `ltr_vid` 방문자 ID | 무작위 UUID(v4) 하나 — 개인정보·회원 ID·시각 없음 | 만들 때 한 번 `analytics.visitor_id_days`(씨앗 365일 — 13장 초안 12개월). 다시 쓰지 않아 늘어나지 않는다 | 아니오 (HttpOnly) | 측정이 허용된 첫 이벤트를 서버가 받았을 때만 |
| `ltr_sid` 세션 | `<세션 UUID>.<마지막 활동 밀리초>.<첫 방문 1·0>.<세션 진입 경로>` | `analytics.session_idle_minutes`(씨앗 30분) — 이벤트마다 다시 씀 | 아니오 (HttpOnly) | 이벤트마다 |
| `ltr_optout` 측정 거부 | `1` | 400일(브라우저 상한 — 거부는 설정값으로 약해지지 않게 코드 고정) | 예 — 브라우저 도우미가 보고 보내지 않는다 | 측정 거부 화면·API에서 [측정 거부]를 눌렀을 때. [측정 허용]은 지운다 |

### 2.5 수집·집계 설정 씨앗 (`settings` — 관리자 설정 화면이 같은 규칙으로 검사한다, 시험이 이 블록을 읽어 DB 씨앗과 대조한다)

값마다 `version`이 있고, 내용을 바꾸면 버전도 바꿔야 한다(W2-a 사전·유사도 기준과 같은 규칙). 수집 API는 `analytics`·`bot_user_agents`·`analytics_referrers`를 60초까지 서버 메모리에 두고 읽는다(바꾸면 늦어도 1분 뒤 적용). `hot_weights`·`popular_rules`는 2단계 집계 배치가 읽는다 — 가중치·기간·중복 제거 창은 코드 상수 0 (HOME-05·ART-11). `popular_rules`는 공개 화면이 사이드바·목록 건수와 창 길이를 읽도록 anon 공개 키이기도 하다(2단계 마이그레이션 15 — 숫자·기사 유형 목록뿐, W2-b 설계 2.3 `settings.public_keys`).

#### `analytics`

```json
{"version":"2026-10-18.1","stage":1,"session_idle_minutes":30,"visitor_id_days":365,"respect_dnt":false,"retention_days":395,"rate_limits":{"visitor_per_minute":120,"ip_per_minute":600}}
```

#### `bot_user_agents`

```json
{"version":"2026-10-18.1","patterns":["bot","crawl","spider","slurp","headlesschrome","phantomjs","lighthouse","pagespeed","yeti","daumoa","bingpreview","facebookexternalhit","kakaotalk-scrap","whatsapp","gptbot","chatgpt-user","oai-searchbot","claude-user","claude-searchbot","perplexity-user","bytespider","semrush","ahrefs","petalbot","curl/","wget/","python-requests","python-urllib","aiohttp","httpx","go-http-client","java/","okhttp","node","axios/","undici","libwww-perl","scrapy","postmanruntime","insomnia","uptime","pingdom","statuscake","vercel-screenshot","vercel-cron"]}
```

#### `analytics_referrers`

```json
{"version":"2026-10-18.1","ai_answer_engine":["chatgpt.com","chat.openai.com","perplexity.ai","gemini.google.com","copilot.microsoft.com","claude.ai","wrtn.ai","you.com","poe.com"],"naver":["naver.com"],"search":["google.com","google.co.kr","bing.com","search.daum.net","search.yahoo.com","duckduckgo.com","ecosia.org","search.zum.com","baidu.com","yandex.ru"]}
```

#### `hot_weights`

```json
{"version":"2026-10-18.1","window_days":7,"view":1,"share":5,"engaged":2,"max_pins":2}
```

#### `popular_rules`

```json
{"version":"2026-10-18.1","window_hours":168,"dedupe_minutes":30,"exclude_content_types":["digest","sponsored"],"sidebar_size":5,"list_size":20}
```

- `analytics` — `stage` 단계 · `session_idle_minutes` 세션 경계(무활동 분 — GROW-01 30분) · `visitor_id_days` 방문자 ID 쿠키 수명 · `respect_dnt` 브라우저 DNT 신호를 측정 거부로 볼지(9장 #3) · `retention_days` 원본 이벤트 보존(13개월 초안 — 지우는 배치는 2단계, 9장 #4) · `rate_limits` 방문자·IP별 1분 상한(서버 메모리 — 5장).
- `bot_user_agents.patterns` — 소문자 글자 조각. User-Agent에 하나라도 들어 있으면(대소문자 무시) 봇. User-Agent가 비어 있어도 봇. 정규식이 아니다(느린 패턴 0). 사람 앱 브라우저와 겹치는 낱말(`kakaotalk`·`naver`·`daum` 단독)은 넣지 않는다 — 카카오톡·네이버·다음 앱 인앱 브라우저는 사람이다.
- `analytics_referrers` — 리퍼러 호스트가 목록의 이름과 같거나 `.이름`으로 끝나면 그 진입 경로. AI 답변 엔진 → 네이버 → 검색 순서로 본다(`gemini.google.com`은 검색이 아니라 AI). 목록에 없는 바깥 사이트는 `referral`, 리퍼러가 없으면 `direct`. 목록은 편집국이 고친다 [확인 필요 — 9장 #6].
- `hot_weights` — 상담 사례 HOT 점수 = 조회 × `view` + 공유 × `share` + 30초 이상 열람 × `engaged`, 최근 `window_days`일, 편집자 고정 최대 `max_pins`건 (HOME-05 초안 — [결정 안건: HOT 선정 기준]).
- `popular_rules` — 많이 본 기사 = 최근 `window_hours`시간 사람 조회, 같은 방문자의 `dedupe_minutes`분 안 반복은 1회, `exclude_content_types` 유형 제외([결정 안건 — ART-11]), 사이드바 `sidebar_size`건·목록 `list_size`건 (ART-11).

### 2.6 지표 대시보드 설정 (3단계 — 마이그레이션 16이 씨앗을 넣는다, 시험이 이 블록을 읽어 DB 씨앗과 대조한다)

#### `domain_cutover`

```json
{"version":"2026-10-18.1","date":null}
```

- `date` — 운영 도메인 전환일(한국 날짜 `YYYY-MM-DD`). `null`이면 아직 전환 전이라 모든 수치가 '시험 기간'이다. 그날 0시(한국 시각)부터 '운영', 그 앞날까지 '시험 기간'(GROW-01 '전환일(`settings`) 이전 수치는 시험 기간으로 따로'). 전환 당일 관리자가 설정 화면에서 적는다(PRD-01A 11장 '당일 … `settings`에 전환일 기록'). 바꾸면 버전도 바꾼다(2.5와 같은 규칙). 공개 키가 아니다(anon 0).
- 대시보드 기간 '전환 후 첫 4주(기준선)'는 이 날부터 28일이다(GROW-01 '첫 4주 기준선' — 정의 값이라 코드에 둔다).

### 2.7 형식 콘텐츠 값 (4단계 — `@ltr/editorial` 상수가 같은 값을 쓴다)

| 이름 | 값 |
|---|---|
| 인포그래픽 템플릿 (ART-07 템플릿 3종 — 블록 JSON 칸, DB 제약 아님) | `flow`(절차 흐름) · `compare`(비교) · `numbers`(핵심 숫자) |
| 인포그래픽 같은 내용 (블록 `data`) | 표 `{ kind: "table", columns, rows }` · 목록 `{ kind: "list", items }` |
| 동영상 주소 (ART-08 — 이 모양만 저장) | `https://www.youtube-nocookie.com/embed/<영상번호 11자>` + 칸 `start` · `end` · `cc_load_policy`만 |
| 썸네일 비율 (ART-08 — `VIDEO_THUMBNAIL_RATIO`) | 16:9, 가로÷세로가 16÷9에서 1% 안 (`media.width`·`height`로 판정) |
| 기능 키 (W2-b 설계 2.3 `feature_flags`에 더함) | `video_list` — 동영상 목록 `/news/video`, 씨앗 false (PRD-01A 1.3 '동영상 채널 — 없으면 동영상 목록은 숨긴다') |

### 2.8 기사 생산·제휴 준비 값 (5단계 — 마이그레이션 18이 제약·씨앗을 넣는다, 시험이 이 표와 블록을 읽어 DB·코드와 대조한다)

| 이름 | 값 |
|---|---|
| news_partner_requirements.platform (플랫폼 — PRD-01A 6.1) | `naver` · `kakao` |
| news_partner_requirements.status (규정 버전 상태 — 작성 중·확정) | `unconfirmed` · `confirmed` |
| review_period.basis (기간 잡는 법 — 규정 버전의 심사 대상 기간·설정 `news_readiness_windows`가 같은 값) | `closed_months` · `including_current` |
| requirement.metric (요건 계산 종류 — 기사 수·비율·기자 1인당) | `count` · `ratio` · `per_reporter` |
| requirement.comparator (기준 비교 — 이상·초과) | `gte` · `gt` |
| requirement.per (기준 단위 — 심사 기간 전체·월평균) | `period` · `month` |
| news_partner_checks.kind (실사·점검 종류 — PRD-01A 6.1) | `registration` · `existing_partnership` · `transmission_contract` · `document` · `tech` · `security` · `mock_review` · `penalty_risk` |
| news_partner_checks.status (확인·미확인·해당 없음) | `confirmed` · `unconfirmed` · `not_applicable` |

#### `news_readiness_windows`

```json
{"version":"2026-10-18.1","months":[3,6,12],"basis":"closed_months"}
```

- `months` — 대시보드 기간 길이(개월) 목록, 1~24 정수 1~4개, 작은 것부터(NAV-14 '3·6·12개월'). `basis` — `closed_months` 지난달까지 완결된 달(이번 달 제외 — 3개월 = 석 달 전 1일 0시 ~ 이번 달 1일 0시, 한국 시각) · `including_current` 이번 달 오늘까지 포함(3개월 = 두 달 전 1일 0시 ~ 내일 0시). 값을 바꾸면 버전도 바꾼다(2.5와 같은 규칙). 기준 숫자(기사 수·비율·합격선)는 이 설정에 없다 — 규정 버전의 요건에만 있다(NAV-13 '코드와 설정 기본값에 기준 상수 0').
- 요건 항목(`requirements` 배열의 한 칸 — JSON, 칸 이름은 camelCase): `key`(영문 소문자·숫자·`_`, 버전 안에서 하나) · `label`(60자) · `metric` · `numerator`(세는 기사 거르개) · `denominator`(비율만 — 거르개) · `numeratorText`·`denominatorText`·`exclusionsText`(규정 원문의 정의를 쉬운 말로 — 대시보드가 숫자 아래에 그대로 보인다) · `criterion`(`{ comparator, value, per }` 또는 null — 기준이 없으면 숫자만) · `sourceRef`(원문 조항). 거르개 = `{ contentTypes?, reportingMethods?, assignmentKinds?, includeLegacy? }` — 값은 W2-a 값 목록(`content_type` 6종 · `reporting_method` 3종 · `story_assignments.kind` 3종), 비우면 모두. 모든 기사는 '지금 공개 중(published)이고 그 기간에 처음 발행된 기사'에서 고른다.

## 3. DB가 직접 막는 것 (직접 SQL로도 깨지지 않아야 하는 규칙)

마이그레이션 `20261018000014_w2c_analytics.sql`, 시험 `packages/db/tests/w2c-analytics.test.mjs`.

- `analytics_events` — 칸은 PRD-01A 6.1 그대로 14개다: `id` · `name` · `occurred_at` · `session_id` · `visitor_id` · `first_visit` · `stage` · `mode` · `tier` · `entry` · `section` · `props` · `is_bot` · `is_staff`.
  - 개인정보·질문 원문·IP·User-Agent 원문·좌표·상세 주소·계산 입력값·검색어 원문·회원 ID 칸이 없다 (FND-06 · GROW-01 스키마 검사 — 시험이 `information_schema`를 읽어 칸 이름 목록이 위와 정확히 같은지, 금지 모양 이름(`ip`·`user_agent`·`email`·`address`·`lat`·`query`·`user_id` 등)이 없는지 본다).
  - `visitor_id`·`session_id`는 `uuid` 형식만 들어간다 — 무작위 값 말고 다른 글자를 넣을 칸이 아니다. `visitor_id`는 비울 수 있다(PRD "측정 거부 시 비움" — 9장 #1), `session_id`는 필수.
  - 이름·모드·회원 등급·진입 경로·분야는 2.1 목록 밖 거부. 단계 1~5 밖 거부.
  - `props`는 JSON 객체, 값은 글자·숫자·참거짓만(객체·배열 0), 글자로 2,048바이트 이하, 금지 이름(`ip`·`user_agent`·`email`·`phone`·`address`·`lat`·`lng`·`query`·`question`·`input`·`user_id` 등) 칸 거부 — 수집 API가 막지 못해도 DB가 막는다.
  - 서버 시각(`occurred_at` 기본값 `now()`·수집 API가 서버 시계로 적는다). 브라우저가 보낸 시각은 받지 않는다.
- `article_stats` (2단계 배치가 채운다) — `(article_id, hour)` 기본 키 · `hour`는 UTC 정시(분·초 0)만 · `views_all`(모든 조회)·`views_human`(봇·편집자·측정 거부 제외, 30분 중복 제거)·`shares`·`engaged_views`(사람만, 30초 이상) 0 이상 · `views_human ≤ views_all` · 기사를 지우면 함께 지워진다.
- `article_rankings` (2단계 — 마이그레이션 `20261018000015_w2c_popular.sql`, 시험 `packages/db/tests/w2c-popular.test.mjs`) — 배치가 매 실행 통째로 바꾸는 순위 목록 두 개(`popular` 많이 본 기사 · `hot` 상담 사례 HOT). `(list, rank)` 기본 키 · `(list, article_id)` 하나 · 순위 1~100 · 고정(`pinned`)은 `hot`만 · 집계 창 `[window_start, window_end)`는 UTC 정시 · 점수(`score`)·창·설정 버전 칸 · 기사를 지우면 함께 지워진다.
  - **최소 권한**: anon·authenticated는 `list`·`rank`·`article_id`·`pinned`·`computed_at` 칸만(칸 권한), 행은 RLS 정책 — 정책 안의 기사 하위 질의가 읽는 역할의 RLS로 돌아 **지금 공개된 기사의 행만** 보인다(보류·삭제로 바뀌면 다음 집계 전에도 0행). 점수·창 칸·쓰기는 권한 거부. 원본 `analytics_events`·`article_stats`는 1단계 그대로 0 — 공개 화면은 순위 목록만 읽는다(service_role을 공개 경로에 쓰지 않는다 — W2-b 공개 데이터 함수 원칙). `verify-rls.mjs` 허용 목록에 이 표만 더했다.
  - 집계 함수 6개(`analytics_article_changes`·`article_stats_replace`·`article_stats_totals`·`article_rankings_replace`·`analytics_events_purge`·`article_stats_purge`) — security invoker·search_path 빈칸, service_role만 실행(anon·authenticated 실행 0 — anon 실행 허용은 `health_ping`뿐, DB 시험이 public 함수 전체를 본다). 바꾸기 함수는 한 트랜잭션에 지우고 넣고(advisory lock으로 겹친 실행을 한 줄로 세움), 지금 없는 기사의 행은 넣지 않는다. 합계·변경 함수는 JSON 한 값을 돌려 API 행 상한(1,000)과 상관없다.
- 지표 읽기 함수 `analytics_metric_sessions(p_from, p_to, p_until, p_names, p_limit)` (3단계 — 마이그레이션 `20261018000016_w2c_metrics.sql`, 시험 `packages/db/tests/w2c-metrics.test.mjs`) — 세는 규칙 없이 이벤트를 세션별로 묶어 JSON 한 값으로 돌려준다(규칙은 8.3 순수 함수 한 곳). 고르는 세션 = 첫 이벤트가 `[p_from, p_to)`에 든 세션(`p_from` 앞 하루 안에 이벤트가 있으면 앞 기간에서 시작한 세션이라 뺀다) + 그 세션들의 방문자가 `[p_to, p_until)`에 새로 시작한 세션(재방문 30일). 세션 줄 = `[방문자 번호, 첫 방문, 봇, 편집국, 시작, [[이름 번호, 분야, 시각]…]]` — 방문자 번호는 이 응답 안에서만 쓰는 1부터 번호(**방문자 UUID는 응답에 0**), 시각은 `p_from`에서 지난 밀리초, 봇·편집국은 세션 안에 하나라도 있으면 참. 세션이 `p_limit`개를 넘으면 목록 없이 `{over: true, count}`. 범위·상한·이름 목록이 틀리면 오류. security invoker·search_path 빈칸, service_role만 실행(anon·authenticated 42501). 표는 더하지 않았다 — 방문자 ID 칸이 있는 표는 여전히 `analytics_events` 하나.
- 기사 생산·제휴 준비 (5단계 — 마이그레이션 `20261018000018_w2c_news_readiness.sql`, 시험 `packages/db/tests/w2c-readiness.test.mjs`)
  - `news_partner_requirements` — 공식 규정 버전(NAV-13). 플랫폼·상태·심사 대상 기간 잡는 법은 2.8 목록 밖 거부. 버전 번호는 플랫폼마다 1부터 트리거가 매긴다(넣은 값 무시, 겹친 추가는 advisory lock으로 한 줄). 적용 끝날 ≥ 시작일. 심사 대상 기간은 `{months 1~12 정수, basis}` 모양. 원문 주소는 http(s)만. 요건 칸은 배열.
  - 확정(`confirmed`)은 원문 주소·확인일·등록 유형·적용 시작일·심사 대상 기간·요건 1개 이상·승인자(빈칸 아님)·승인 시각이 모두 있을 때만(`news_partner_requirements_confirm_ready`), 확정과 승인 칸은 함께(`_approval`). 확정된 버전은 고치기·지우기 거부(service_role도 — 트리거, 확정을 되돌리는 우회 0). 번호·플랫폼은 바꿀 수 없다. 이어받는 버전은 같은 플랫폼만.
  - `news_partner_checks` — 실사·점검 기록(NAV-01·07·20). PRD 6.1 칸(종류 8 · 항목 · 상태 확인·미확인·해당 없음 · 근거 위치 · 점수 · 일어난 날 · 확인한 사람·시각 · 적용 규정 버전) + 이어받기. 추가만(service_role도 고치기·지우기 거부 — `admin-rights` 추가만 목록), 확인은 근거 위치 필수, 부정평가 위험은 점수·일어난 날 필수. 화면은 그 요구사항 단계가 단다.
  - 읽기 함수 `news_production_facts(p_from, p_to)` — 세는 규칙 없이 `[p_from, p_to)`에 처음 발행된 기사마다 사실(유형·취재 방식·이관 여부·지금 상태·작성자·기획 종류·편집 승인·세무 감수·취재 근거 수·확인된 근거 수·권리 미확인 근거 수·권리 미확인 이미지 수·사람 조회·30초 열람·공유·최근 유사도 점검 상태)과 기간 안 정정·유사도 점검, 작성자·진행 중 기획 기자의 이름·역할·고용 형태, 기자별 진행 중 기획 수를 JSON 한 값으로. 800일까지. security invoker·search_path 빈칸, service_role만 실행(anon·authenticated 42501).
  - 두 표 모두 RLS 기본 거부(anon·authenticated 읽기 0·쓰기 0). 마이그레이션은 규정 버전을 씨앗으로 넣지 않는다(시험이 모든 마이그레이션을 읽는다). 설정 씨앗 `news_readiness_windows`(2.8 — 기간 정의만).
- 공동 기획 배지 이름 (5단계 — 마이그레이션 `20261018000019_w2c_partner_badge.sql`, 시험 `packages/db/tests/w2c-partner-badge.test.mjs`) — `articles.partner_badge_name`: 표기 공동 기획 + 제휴사 지정이면 그 제휴사 이름, 아니면 비움. 트리거가 넣은 값과 상관없이 다시 계산하고, 제휴사 이름을 고치면 그 제휴사의 공동 기획 기사도 같이 바뀐다. anon은 공개 기사의 이 칸만 더 읽는다(`public_articles` 뷰 끝에 더함) — 비공개 제휴사 행은 그대로 0행.
- 표 이름 `events` 0 — 마이그레이션 검사(`lint-migrations.mjs`, FND-06 이름 충돌)와 DB 시험(public 스키마에 `events` 관계 0) 둘 다.
- RLS 기본 거부 — 두 표 모두 anon·authenticated 읽기 0·쓰기 0(정책 없음·권한 없음, PRD-01A 8.2 RLS). 수집은 서버 API가 service_role로만 쓴다. service_role은 읽기·추가·고치기·지우기 전권(관리자 전권 시험 `admin-rights.test.mjs` — 보존 기한 정리·잘못 들어온 행 지우기). `scripts/verify-rls.mjs` 허용 목록에 넣지 않는다.

## 4. 개인정보 규칙 (저장하지 않는 것)

| 받지만 저장하지 않는다 | 어떻게 쓰고 버리나 |
|---|---|
| IP 주소 | 속도 제한 열쇠로만 — 서버 메모리에 프로세스마다 다른 무작위 소금으로 해시한 값만, 1분 창이 지나면 사라진다. DB·로그 0 |
| User-Agent 원문 | 봇 판정(`is_bot`)에만 — 판정 결과 참·거짓만 남는다. DB·로그 0 |
| 리퍼러 | 브라우저 도우미가 호스트 이름만 보낸다(경로·쿼리 0). 서버는 진입 경로 값으로 바꾸고 호스트는 버린다 |
| 로그인 쿠키 | 편집국·관리자인지(`is_staff`)만 본다 — 회원 ID·이메일 0 |

- 검색어·질문 원문·계산 입력값·이메일·전화·주소·좌표는 받지 않는다 — 2.2에 그런 칸이 없고, 모르는 칸은 400, 주소 칸은 경로만이며 이메일·전화·주민등록번호 모양이면 400.
- 방문자 ID는 회원 ID·IP·User-Agent 원문과 같은 행에 있지 않다(같은 표에 그런 칸이 없다 — 시험). 방문자 ID 칸이 있는 표는 이 표 하나다.
- 측정 거부·GPC (GROW-01 · PRD-00 13장)
  - 브라우저: `ltr_optout=1` 쿠키가 있거나 `navigator.globalPrivacyControl === true`면 브라우저 도우미가 아무것도 보내지 않는다 — 이벤트 전송 0 (E2E 네트워크 기록).
  - 서버(이중 방어): 거부 쿠키 또는 `Sec-GPC: 1` 머리글이 붙은 요청은 본문을 읽지 않고 **204** — 저장 0, 방문자 ID를 만들지 않고, 남아 있던 `ltr_vid`·`ltr_sid`를 지운다.
  - DNT(`DNT: 1`)는 지금 측정 거부로 보지 않는다 — PRD가 정한 신호는 측정 거부·GPC이고 DNT는 표준이 폐기됐다. 설정 `analytics.respect_dnt`를 켜면 서버가 GPC와 같이 204로 버린다(브라우저 도우미는 DNT를 보지 않는다) [결정 안건 — 9장 #3].
  - 거부 전 이벤트는 남는다(방문자 ID 쿠키를 지워 더는 이어지지 않는다). [측정 허용]을 다시 누르면 새 방문자 ID로 다시 시작한다(첫 방문으로 센다) [확인 필요 — 9장 #2].
- 편집국·관리자: 로그인 쿠키가 있으면 서버가 인증 서버로 확인해 역할이 하나라도 있거나 관리자면 `is_staff = true`로 저장한다(집계에서 뺀다 — 이벤트를 버리지 않는다). 확인이 실패하면 503(분류할 수 없는 이벤트는 저장 0).
- 봇: `is_bot = true`로 저장한다(버리지 않는다 — `article_stats.views_all`과 봇 비율 점검에 쓴다). 집계·대시보드는 뺀다.
- 보존: 원본 이벤트는 `analytics.retention_days`(초안 395일 = 13개월 — 방문자 ID 12개월 + 재방문 30일 여유) 뒤 지운다. 지우는 일은 2단계 집계 배치가 한다 [결정 안건 — 9장 #4, 처리방침과 함께 정한다]. `article_stats`는 기사 단위 숫자라 방문자를 담지 않는다.
- 처리방침(HELP-02, W2-e)에 적을 것: 무작위 방문자 ID와 세션 쿠키(이름·수명·목적), 저장하지 않는 것(위 표), 거부 방법(측정 거부 화면·GPC), 보존 기한.

## 5. 수집 API (`POST /api/events` — apps/web/app/api/events/route.ts)

판정 순서(앞에서 걸리면 뒤는 하지 않는다) — 규칙은 순수 함수(`lib/analytics/*.ts`, 시험 `*.test.ts`), 경로 처리기는 설정 읽기·로그인 확인·DB 쓰기만 한다.

| 순서 | 검사 | 응답 |
|---|---|---|
| 1 | 같은 사이트 — `Sec-Fetch-Site`가 있으면 `same-origin`만, `Origin`이 있으면 요청 주소·`Host`·사이트 주소(`NEXT_PUBLIC_SITE_URL`)의 호스트와 같아야 | 403 |
| 2 | 본문 형식 `application/json` | 415 |
| 3 | 측정 거부 쿠키 · `Sec-GPC: 1` | 204 (저장 0 · 쿠키 지움) |
| 4 | 수집 설정 읽기(60초 메모리) — 없거나 모양이 틀리면 | 503 |
| 5 | DNT (설정이 켜졌을 때만) | 204 |
| 6 | IP별 속도 제한 (`rate_limits.ip_per_minute`) | 429 + `retry-after` |
| 7 | 본문 크기 4,096바이트 이하(`content-length`와 실제 읽은 양 둘 다) | 413 |
| 8 | JSON 객체 · 맨 위 칸은 `name`·`section`·`entry`·`mode`·`props`·`referrer`만 · 2.1·2.2·2.3 규칙 | 400 `{ error, errors: ["칸: 문장"] }` |
| 9 | 방문자·세션 정하기(아래) · 방문자별 속도 제한 (`rate_limits.visitor_per_minute`) | 429 |
| 10 | 봇 판정(User-Agent 조각) · 편집국 판정(로그인 쿠키가 있을 때만) | 503(로그인 확인 실패) |
| 11 | 저장(service_role) | 202 (본문 없음) · 실패는 503 |

- 잘못된 입력은 언제나 4xx다 — 500 0. 응답은 모두 `cache-control: no-store`. 오류 문장은 한국어이고 받은 값을 되풀이하지 않는다.
- 방문자·세션 (GROW-01 — 순수 함수 `lib/analytics/visit.ts`)
  - `ltr_vid`가 없거나 UUID 모양이 아니면: 새 방문자 ID + 새 세션, `first_visit = true` (새 브라우저로 처음 들어온 세션).
  - 방문자 ID가 있고 세션 쿠키가 없거나 모양이 틀리거나 마지막 활동에서 `session_idle_minutes`분 이상 지났으면: 새 세션, `first_visit = false`.
  - 마지막 활동에서 `session_idle_minutes`분 미만이면 같은 세션, 그 세션의 `first_visit` 그대로. 경계 시험: 29분 → 같은 세션 · 정확히 30분 → 새 세션 · 31분 → 새 세션(`first_visit = false`).
  - 시계는 서버 시각만 쓴다. 쿠키의 마지막 활동이 서버 시각보다 앞날이면(시계 조작) 새 세션.
- 진입 경로 (`entry`) — 세션의 진입 경로를 세션 쿠키에 둔다.
  - 새 세션: 브라우저가 보낸 리퍼러 호스트를 `analytics_referrers`로 분류(2.5), 없거나 이 사이트면 `direct`.
  - 이어지는 세션에 바깥 리퍼러가 오면(다른 사이트에서 다시 들어옴) 세션 진입 경로를 그 값으로 바꾼다. 사이트 안 이동·리퍼러 없음은 그대로.
  - 브라우저가 `entry`를 보내면 2.3 `client.entry`(사이트 안 출발점 — 「지방세로 읽기」·AI 도우미·전문가 소개) 값만 받고 그 이벤트에만 쓴다. 바깥 진입 경로를 브라우저가 정할 수는 없다(400).
- 회원 등급은 지금 모두 `guest`(회원은 W2-e — 그때 로그인 회원의 등급을 서버가 정한다). 모드는 브라우저가 보낸 `general`·`expert`, 없으면 `general`. 단계는 `analytics.stage`.
- 속도 제한 — 서버 메모리의 토큰 통(1분 상한만큼 담기고 초마다 상한/60씩 찬다). 서버마다 따로다(Vercel 함수 인스턴스·사내 컨테이너마다) — 남용을 늦추는 장치이지 정확한 상한이 아니다. 열쇠가 너무 많아지면 오래된 것부터 버린다. IP는 `x-real-ip` → `x-forwarded-for` 첫 값(Vercel·사내 Caddy가 붙인다) → 없으면 한 통.
- 쿠키 쓰기: 첫 이벤트에 `ltr_vid`(HttpOnly)를 만들고, 이벤트마다 `ltr_sid`를 다시 쓴다. 측정 거부(204)는 둘을 `Max-Age=0`으로 지운다.

### 5.1 측정 거부 화면·API (GROW-01 '바닥글 설정' — 바닥글 링크는 W2-e)

- 화면 `/about/measurement` — 지금 상태(측정 중 · 측정 거부 · 브라우저 GPC 신호로 측정하지 않음)와 [측정 거부]·[측정 허용] 버튼 하나(지금 상태의 반대). 스크립트가 꺼져도 동작하는 폼이다. 바닥글 [측정 거부] 링크는 HELP-05 정책 링크와 함께 W2-e가 단다(공개 승인 기능 키) — 거부 기능 자체는 기능 키로 숨기지 않는다(거부할 권리는 늘 열려 있다) [결정 안건 — 9장 #7 위치·문구 법률 검토].
- API `POST /api/measurement` — 본문 `choice=refuse|allow`(폼) 또는 `{ "choice": "refuse" }`(JSON). 같은 사이트 검사(5장 1번, 다른 사이트가 남의 거부를 풀지 못하게) 403 · 형식 밖 415 · 값 밖 400. 폼은 303으로 화면에 돌아가고(`?done=refuse|allow`), JSON은 200 `{ choice }`. 거부는 `ltr_optout=1`(400일)을 쓰고 `ltr_vid`·`ltr_sid`를 지운다. 허용은 `ltr_optout`을 지운다. DB를 읽지 않는다 — DB가 꺼져도 거부할 수 있다.

## 6. 브라우저 도우미와 시범 연결 (apps/web/lib/analytics/client.ts · components/site/Measure.tsx)

- `track(name, { section, props, entry, mode, keepalive })` — 측정이 허용될 때만(거부 쿠키·GPC 없음) 같은 출처 `fetch`(`credentials: same-origin`·JSON)로 보낸다. 실패는 조용히 버린다(화면 오류 0).
  - `keepalive`(문서를 떠나도 끝까지 보냄)는 새 문서로 넘어가는 순간 보내는 이벤트만 켠다(뒤 단계의 바깥 링크 등). 1단계 이벤트는 모두 문서를 떠나지 않을 때 보내므로 끈다 — keepalive 요청은 브라우저 전체 64KB 상한을 함께 쓴다.
  - 응답 본문은 끝까지 읽고, 받음(202)은 본문이 없다 — 읽지 않은 본문이 남으면 브라우저가 요청을 끝나지 않은 것으로 두어 '네트워크 조용함'을 기다리는 화면 E2E(W2-b)가 멈춘다.
  - 보내기는 한 줄로 차례차례 한다 — 앞 요청의 응답(방문자·세션 쿠키)을 받은 뒤 다음을 보낸다. 새 브라우저에서 분야 카드 클릭과 허브 열람이 겹쳐 방문자 ID가 둘 생기지 않게 (첫 방문 깔때기).
  - 리퍼러 호스트는 문서를 처음 연 뒤 첫 이벤트에만 붙인다(사이트 안 화면 전환은 문서 리퍼러가 바뀌지 않으므로).
- 30초 열람(`article_engaged`) — 화면이 보이는 동안의 시간만 더한다(탭이 숨으면 멈춤). 30,000ms에 1건 — 29초는 0, 30초는 1 (PRD-01A 12장 정의 "30초 이상 화면에 머문 조회" — 정의 값이라 코드에 둔다). 다른 화면으로 가면 타이머를 버린다.
- 1단계 시범 연결 (나머지 화면·이벤트는 해당 단계가 같은 도우미로 붙인다)

| 화면 | 이벤트 | 속성 |
|---|---|---|
| 기사 상세 `/news/[slug]` | `article_viewed`(열 때 1건) · `article_engaged`(30초) · `article_shared`(공유 성공) | 분야 · `article_id` · `format` · `content_type` · `channel` |
| 분야 허브 `/tax`·`/realestate`·`/finance`·`/local` | `hub_viewed`(열 때·지자체뉴스 분야 탭을 바꿀 때 1건) | 분야 · `topic`(지자체뉴스 분야 탭) |
| 홈 `/` | `home_entry_clicked`(4대 분야 카드를 누를 때) | 분야 |
| 기사 상세 · 상황 페이지 `/situations/[slug]` (3단계) | `next_action_clicked`(다음 행동 띠 버튼을 누를 때 — 첫 방문 깔때기 3단계) | 분야 · `action`(띠의 `data-next-action` = ART-06 버튼 키) · `screen`(`article`·`situation`) |
| 분야 허브 상황 카드 (3단계) | `situation_card_clicked`(허브 상황 카드를 누를 때 — 깔때기 2단계) | 분야 · `situation`(slug) · `position`(`hub`) |

- 공개 데이터를 읽지 못한 닫힌 허브·`UNAVAILABLE` 기사는 보내지 않는다.

## 7. 공개 경로 (이 작업이 만든다)

| 경로 | 화면·응답 | 단계 |
|---|---|---|
| `POST /api/events` | 수집 API (5장) | 1 |
| `POST /api/measurement` | 측정 거부·허용 (5.1) | 1 |
| `/about/measurement` | 측정 거부 화면 (5.1) — 링크는 W2-e 바닥글 | 1 |
| `/news/popular` | 많이 본 기사 목록(설정 `list_size` — 씨앗 20) · "최근 7일 기준 · 집계 시각(한국 시간, 고정폭)" (8.2) | 2 |
| `/api/jobs/popular-hourly` · `/api/jobs/analytics-retention` | 1시간 집계 · 보존 기한 정리 (CRON_SECRET — 8.2) | 2 |
| `/news/video` | 동영상 목록 — 형식 동영상 기사의 동영상 카드 그리드(1열 → 2열 → 3열, 썸네일만 — 재생은 기사 상세). 기능 키 `video_list`가 꺼지면 404 (8.4) | 4 |
| `/news/photo` | 포토 목록 — 형식 포토 기사의 기사 카드('포토' 형식 배지) 그리드 (8.4) | 4 |
| `/partners/[id]` | 제휴사 프로필 — 공개 제휴사의 소개·제휴 배지·그 제휴사 기사 카드. 비공개·없는 제휴사 404, 읽지 못하면 503(proxy) (8.4) | 4 |
| `/admin/metrics` | 측정 지표 대시보드 (8.3) — 관리자만 | 3 |
| `/admin/news-readiness` · `/admin/news-readiness/requirements` | 기사 생산·제휴 준비 대시보드 · 제휴 규정 버전 (8.5) — 편집 책임자·관리자. 경로는 PRD-01A 3장 백오피스 표(9장 #56) | 5 |
| `/api/admin/news-readiness/requirements` · `…/[id]` · `…/[id]/confirm` | 규정 버전 목록·새 버전 · 작성 중 고치기 · 확정 (8.5) | 5 |

## 8. 산출물

### 8.1 1단계 — 측정 기반 (2026-10-18)

- 마이그레이션 `packages/db/supabase/migrations/20261018000014_w2c_analytics.sql` — `analytics_events`·`article_stats`·RLS·설정 씨앗 5개.
- DB 시험 `packages/db/tests/w2c-analytics.test.mjs` — 이 문서 2.1 값 목록·2.3 설정 키·2.5 씨앗을 읽어 DB와 대조, 칸 검사(정확히 14칸·금지 모양 이름 0·방문자 ID와 회원 ID·IP·UA 원문 같은 표 0), `events` 관계 0, props 제약, `article_stats` 정시·크기 제약, anon·authenticated 읽기·쓰기 0, service_role 전권.
- 순수 규칙 `apps/web/lib/analytics/` — `events.ts`(이름·속성 검사) · `visit.ts`(방문자·세션·첫 방문·쿠키) · `consent.ts`(측정 거부·GPC·DNT) · `entry.ts`(진입 경로 분류) · `bots.ts`(봇 판정) · `rate-limit.ts`(토큰 통) · `request.ts`(같은 사이트·IP·본문 크기) · `settings.ts`(설정 모양 — 수집 API와 관리자 설정 화면이 같이 쓴다) · `ingest.ts`(판정 순서 한 곳) · `engagement.ts`(30초 열람) · `client.ts`(브라우저 도우미). 시험 `*.test.ts`.
- 서버 `apps/web/lib/server/analytics/collect.ts` — 설정 읽기(60초 메모리)·편집국 판정(`getViewer`)·저장(service_role). 경로 `app/api/events/route.ts`·`app/api/measurement/route.ts`·`app/(site)/about/measurement/page.tsx`(글자 `lib/site/measurement-view.ts`). 화면 연결 `components/site/Measure.tsx`(`MeasureView` 허브 · `MeasureArticle` 기사 · `MeasureHomeEntry` 홈 분야 카드) · `ShareButton.tsx`(공유 성공 → `article_shared`).
- 관리자 설정 화면이 고치는 키에 2.3 `settings.analytics_keys` 5개를 더했다(`lib/admin/settings-rules.ts` — 수집 API와 같은 검사).
- 통합 시험 `apps/web/lib/analytics/settings.itest.mjs` — 로컬 DB 씨앗 값이 수집 설정 읽기를 통과한다.
- E2E `e2e/analytics-api.test.mjs`(CI 2단계) — 정상 이벤트 저장(UA·IP 0)·세션 29·31분·봇 표시·거부 204·GPC 204·측정 거부 화면·4xx 저장 0·429·편집국 `is_staff`·칸 검사·브라우저(GPC·거부 쿠키 → `/api/events` 요청 0, 기사·허브·홈 카드 이벤트 저장).
- 시험 데이터 정리: E2E 공용 `e2e/lib/staff.mjs` 정리 단계가 시험 동안 생긴 측정 행(로컬 DB, 시험 시작 뒤 `occurred_at`)과 시험 기사의 `article_stats`를 지운다 — 공개 화면을 브라우저로 여는 E2E가 이벤트를 남기지 않게.

### 8.2 2단계 — 1시간 집계·많이 본 기사·상담 사례 HOT·보존 기한 정리 (2026-10-18)

**세는 규칙** (순수 함수 `apps/web/lib/analytics/aggregate.ts` — 시험 `aggregate.test.ts`)

- 시간대 = UTC 정시 `[h, h+1시간)`(`article_stats.hour`). 원본은 기사 이벤트 3종(`article_viewed`·`article_engaged`·`article_shared`)의 `props.article_id`.
- `views_all` = 모든 조회(봇·편집국 포함, 중복 제거 없음). 사람 값(`views_human`·`shares`·`engaged_views`) = `is_bot`·`is_staff`가 아닌 이벤트.
- 중복 제거(`popular_rules.dedupe_minutes`, 씨앗 30분): 같은 방문자·같은 기사·같은 이벤트가 **마지막 이벤트**(세지 않은 반복 포함)에서 30분 안에 다시 오면 세지 않는다 — 계속 새로고침하면 1회. 정확히 30분 뒤면 다시 1회(세션 경계 '정확히 30분 → 새 세션'과 같은 쪽). 경계 시험: 29분 59.999초 → 1회 · 30분 → 2회. 시간대를 넘는 반복(9:50 → 10:10)도 앞 시간대를 이력으로 본다. 방문자 ID가 없는 이벤트는 중복 제거 없이 센다(ART-11 '측정 거부 조회' — 지금은 거부 이벤트를 저장하지 않으므로 0, 9장 #1). 공유·30초 열람도 같은 규칙(9장 #21).

**다시 집계할 시간대·늦은 이벤트** (`planAggregation` — 실행 기록 `agent_runs.detail.watermark`)

- 지난 성공 실행이 본 마지막 이벤트 번호(watermark) 뒤에 들어온 기사 이벤트의 시간대 + 중복 제거가 넘어가는 뒤 시간대(30분 → 다음 1개) + **늘 바로 앞 시간대**(시간대 끝에 막 저장된 이벤트)를 다시 센다. 지금(끝나지 않은) 시간대는 끝난 뒤 다음 실행이 센다 — 그 시간대에 든 이벤트의 가장 작은 번호 − 1을 다음 watermark로 남긴다.
- 늦게 들어온 이벤트(시각이 지난 시간대 — 수집 지연·되살린 자료)도 번호가 새것이라 그 시간대를 다시 센다. 실행이 빠지거나(Vercel Cron은 최선 노력) 두 번 와도 결과가 같다(멱등 — `article_stats_replace`가 범위 안 행을 지우고 다시 넣는다).
- 순위가 보는 가장 긴 창(`window_hours`·`window_days` × 24 중 큰 값)보다 오래된 시간대는 다시 세지 않는다. 처음 실행(기록 없음)은 창 안 이벤트가 있는 시간대를 모두 센다(하루씩 나눠 쓴다).
- 손으로 이벤트 행을 지운 경우(잘못 들어온 행)는 그 시간대를 다시 세지 않는다 — 지운 뒤 `agent_runs`의 마지막 `popular-hourly` 기록을 지우면 다음 실행이 창 전체를 다시 센다(운영 메모).

**순위** (순수 함수 `apps/web/lib/analytics/ranking.ts` — 시험 `ranking.test.ts`)

- 창 = 집계 시각이 든 시간대의 시작(끝)에서 `window_hours`(168)시간 앞까지의 **끝난 시간대** `[끝 − 168시간, 끝)` — 168시간 전 시간대 포함, 169시간 전 시간대 제외, 지금 시간대 제외(ART-11 '집계 시각 기준 168시간').
- 많이 본 기사 = 창 안 사람 조회 합계 순. 0회·지금 공개되지 않은 기사·유형 없음·금주 핫뉴스·`exclude_content_types`(씨앗 `digest`·`sponsored`)는 빠진다. 같으면 최신 발행이 앞, 발행 시각도 같으면 나중 기사.
- 상담 사례 HOT = 상담 사례 분야(9장 #17) 공개 기사 중 — 편집자 고정(`articles.hot_pin_until` > 지금, 최대 `hot_weights.max_pins`건)이 점수와 관계없이 맨 앞(고정끼리는 점수·최신 순) → 점수(조회×`view` + 공유×`share` + 30초 열람×`engaged`, 최근 `window_days`일) 순, 0점은 HOT 아님, 동점은 최신 발행 앞.
- 배치가 계산한 순위를 `article_rankings`에 100건까지 둔다(화면 건수보다 넉넉히 — 비공개로 빠진 기사가 있어도 목록이 찬다). **가중치·창·건수를 바꾸면 다음 집계부터** 순위가 바뀐다(그 전까지는 지난 순위 — 화면은 순위 표를 그대로 읽는다, 코드 상수 0). 실행 기록에 쓴 설정 버전이 남는다.
- HOT 고정 판정(편집국 API `POST /api/admin/articles/[id]/placement`): 상담 사례 분야 기사만(아니면 422), 지금 고정 중인 다른 기사가 `max_pins`건이면 409(HOME-05 '3번째 고정은 막힌다'), 고정 풀기·지난 시각은 늘 된다.

**화면** (공개 데이터 함수 `lib/server/public/rankings.ts` — anon 키로 순위 표만)

| 화면 | 무엇 | 측정 |
|---|---|---|
| `/news/popular` | 머리('많이 본 기사' · 창 글자) · "최근 7일 기준 · 집계 YYYY-MM-DD HH:MM (한국 시간)"(고정폭) · 많이 본 기사 목록 `list_size`건(`@ltr/ui` PopularArticles). 집계 전이면 안내 한 줄 | `popular_article_clicked`(기사 번호·화면 순위·`list`) |
| 기사 상세 사이드바 | 많이 본 기사 `sidebar_size`건(지금 기사 제외) + '더 보기'. 1024px 이상은 본문 오른쪽 열(따라 내려옴 — 목록이 있으면 모든 부분이 같은 두 칸 틀이라 왼쪽 선이 맞는다), 그 아래는 본문 뒤. 목록 0건이면 자리 0 | `popular_article_clicked`(… `sidebar`) |
| 지방세 허브 `/tax` | 최신 목록 뒤 '상담 사례 HOT'(`data-hub-part="hot"`) — 해결 사례 카드 3장(SolvedCaseCard) + HOT 목록 5건(HotBadge) + '상담 사례 전체 보기' | `hot_article_clicked`(기사 번호·목록 순위·고정 여부) |
| 상담 사례 분야 목록 `/tax/interpretations` 첫 쪽 | 머리 다음에 같은 HOT 블록, 그 아래 전체 목록 | 같음 |

- HOT 블록: 카드 = 순위의 고정이 아닌 해결 사례(카드로 그릴 수 있는 것 — 4칸·결론·근거) 위에서부터 3장, 모자라면 최신 해결 사례로 채운다(9장 #20). 목록 = 카드에 나온 기사를 뺀 순위 앞 5건(HOT 배지), 5건 미만이면 배지 없이 최신 상담 사례로 채운다(HOME-05). 카드와 목록에 같은 기사 0. 상담 사례 기사가 하나도 없으면 블록 0. 홈에는 두지 않는다(홈 HTML에 HOT 0 — E2E).
- 많이 본 기사 목록 컴포넌트는 사이트 안 링크(UiLink)로 새로고침 없이 이동한다(FND-09 — `@ltr/ui` PopularArticles를 고쳤다, `link.test.tsx`).
- 순위가 바뀌면 배치가 공개 데이터 캐시를 바로 비운다(작업 결과 `revalidatePublic` → 작업 경로가 `revalidatePublicData()`).

**일정** (`apps/web/vercel.json` 한 곳 — 사내 스케줄러 `deploy/scheduler`도 같은 파일을 읽는다)

- Vercel Hobby 요금제는 일정 한 줄이 하루 한 번 넘게 돌면 **배포가 실패**한다(Vercel 문서 'Hobby scheduling limits' — `0 * * * *` 거부). 지금 팀은 Hobby이고(계정점검표), main push가 Production 배포를 부르므로 시간마다 도는 한 줄을 넣으면 배포가 깨진다.
- 그래서 `popular-hourly`를 **하루 한 번짜리 줄 24개**(`5 0 * * *` … `5 23 * * *` — 같은 경로의 여러 줄은 Vercel이 허용한다)로 적었다. Hobby는 그 시간 안 아무 때(±59분)에 부르고, Pro·사내 스케줄러는 매시 5분에 부른다. 늦거나 빠진 실행은 위 '다시 집계할 시간대'가 메운다. Pro로 바꾸면 `5 * * * *` 한 줄로 줄여도 된다(같은 동작).
- 보존 기한 정리 `analytics-retention`은 하루 한 번 `40 18 * * *`(한국 03:40). 시험(`scripts/__tests__/scheduler-cron.test.mjs`)이 vercel.json을 읽어 줄마다 하루 1번·popular-hourly 매시 1번·일정의 작업이 모두 작업 목록에 있는지 본다.
- 요청 때 집계하는 방식(화면을 열 때 낡았으면 집계)은 쓰지 않는다 — 방문자 요청이 service_role 배치를 부르게 되고, '다음 집계부터 순위가 바뀐다'를 지키기 어렵다.

**보존 기한 정리** (`analytics-retention`)

- `analytics.retention_days`(씨앗 395일)보다 앞선 원본 이벤트를 오래된 것부터 5,000건씩, 한 실행 20번까지 지운다(남으면 다음 날 이어서 — 결과 `done`). `article_stats`도 같은 기한(그 시간대 시작 기준)으로 지운다(9장 #22). 기한과 같은 시각의 이벤트는 남는다.

**산출물**

- 마이그레이션 `20261018000015_w2c_popular.sql` — `article_rankings`·RLS·칸 권한, 집계 함수 6개, 공개 설정 키 `popular_rules`.
- 작업 목록 `workflows/src/index.ts`(`popular-hourly`·`analytics-retention` — 작업은 웹 앱이 넘기는 서버 기능 `JobServices`를 부른다) · 서버 `apps/web/lib/server/analytics/aggregate.ts`·`lib/server/jobs.ts` · 작업 경로 `app/api/jobs/[job]/route.ts`(서버 기능 넘김·캐시 비움) · 설정 읽기 `lib/analytics/settings.ts` `parseCheckedSettings`.
- 공개 `lib/server/public/rankings.ts`(`getPopularList`·`readPopularSidebar`·`getHotBlock`) · 화면 `app/(site)/news/popular/page.tsx`·`components/site/PopularView.tsx`·`HotBlock.tsx`·`Measure.tsx` `MeasureClicks` · `ArticleView.tsx`(사이드바) · `HubView.tsx`·`CategoryView.tsx`(HOT) · 화면 값 `lib/site/popular-view.ts`·`hub-view.ts`(`hot` 부분).
- 시험 — 단위 `aggregate.test.ts`·`ranking.test.ts`·`popular-view.test.ts`·`settings.test.ts`(집계 설정)·`hub-view.test.ts`·공개 `settings.test.ts`·`constants.test.ts` · DB `w2c-popular.test.mjs` · 통합 `lib/server/public/rankings.itest.mjs` · E2E `e2e/analytics-popular.test.mjs`(CI 2단계) · 스크립트 `scheduler-cron.test.mjs`.
- 고친 기존 시험 — `site-hubs`·`a11y`(지방세 허브 골격에 `hot`), `site-article`·`w2b-acceptance`(`/news/popular`가 이제 열린 화면), `compose`(떠 있는 스케줄러가 매시 5분 집계를 부를 수 있어 자기 작업 기록만 세고 시험 동안의 스케줄러 기록을 지운다), `e2e/lib/staff.mjs` 정리(순위 행·지난 시각으로 넣은 시험 기사 이벤트). W2-b 설계 2.3 `settings.public_keys`에 `popular_rules`, '만들지 않는 경로'에서 `/news/popular`를 뺐다.

### 8.3 3단계 — 지표 대시보드 `/admin/metrics` (2026-10-18)

**세는 규칙** (순수 함수 `apps/web/lib/analytics/metrics.ts` — 시험 `metrics.test.ts`. 기대값은 PRD 수용 기준을 옮긴 견본)

- 기간은 한국 날짜다. 최근 7·30·90일(**오늘 포함** — 기본 30일) · 직접 고른 기간(시작일 ≤ 끝날 ≤ 오늘, 400일까지) · 전환 후 첫 4주(전환일부터 28일, 아직 28일이 안 지났으면 오늘까지). 범위는 `[첫날 0시, 끝날 다음 날 0시)`(한국 시각 — UTC 15시가 하루 경계). 틀린 주소는 이유를 보이고 최근 30일.
- **세션 단위로 센다.** 세션은 첫 이벤트 시각이 든 구간에 속하고, 그 세션의 이벤트는 기간 끝을 넘어도 그 세션 것이다(끝날 23:59에 시작한 세션의 0:01 이벤트도 센다). 기간 앞 하루 안에 이벤트가 있는 세션은 앞 기간의 세션이라 뺀다.
- **제외**: 세션 안에 봇 표시(`is_bot`)나 편집국 표시(`is_staff`)가 붙은 이벤트가 하나라도 있으면 그 세션은 어느 지표에도 넣지 않는다(GROW-01 '편집자·관리자 세션과 봇은 대시보드에서 빠진다'). 구간마다 '시작한 세션 n · 봇 a · 편집국 b'를 보인다.
- **분야별 유효 방문** — 분모: 그 분야 허브를 본 세션(`hub_viewed`) · 분자: 그 세션 가운데 **같은 분야** 기사의 30초 열람(`article_engaged`)이 있는 세션. 30초는 브라우저가 정한다(6장 — 29초는 이벤트 0, 30초는 1). 허브와 기사의 순서는 보지 않는다(같은 세션이면 된다). 전체 줄 = 허브를 하나라도 본 세션 · 그중 본 허브와 같은 분야 기사를 30초 이상 읽은 세션(분야 합보다 작을 수 있다). 방문자 ID가 없는 세션도 세션이라 넣는다.
- **재방문율** — 분모: 기간 안에 그 분야를 본(`hub_viewed`·`article_viewed`) **측정 동의 방문자**(방문자 ID 있음). 기준은 그 방문자가 기간 안에서 그 분야를 처음 본 이벤트이고, 그 한국 날짜를 D0으로 둔다. 분자: 같은 방문자가 **다른 세션**에서 같은 분야를 기준 뒤에 다시 본 한국 날짜가 **D0 + 30일 이하**인 방문자 — 30일째 날짜는 포함, 31일째는 제외(시각이 아니라 날짜로 센다 — 23:59에 처음 본 방문자도 30일째 날짜 끝까지). 같은 날 다른 세션도 재방문이다. 기간 끝 뒤 30일까지 읽는다. '30일 안 지남' = 아직 다시 오지 않았고 D0 + 30일이 오늘 이후인 방문자(분모에 들어 있고 숫자가 늘 수 있다). 방문자 ID가 없는 세션은 분모에서 빼고 따로 센다(지금은 측정 거부를 저장하지 않으므로 0 — 9장 #1). 전체 줄 = 분야를 하나라도 본 방문자 · 그중 어느 분야든 같은 분야를 다시 본 방문자.
- **첫 방문 깔때기** (보조) — ① 첫 방문 세션(`first_visit` — 이벤트가 하나라도 남은 세션, 9장 #9) → ② 그중 4대 분야 카드(`home_entry_clicked`)·상황 카드(`situation_card_clicked`)·검색(`search_submitted`)이 있는 세션 → ③ 그중 ②의 첫 이벤트 뒤에 기사 30초 열람이 있고, 그 열람 뒤에 다음 행동 클릭(`next_action_clicked`)이 있는 세션. 칸마다 앞 칸 대비·첫 방문 대비 비율.
- **첫 방문 문제해결률** (보조, BM-L2 1단계 대리 정의) — 첫 방문 세션 가운데 기사 30초 열람 뒤 다음 행동을 누른 세션(②를 거치지 않아도 된다 — 검색에서 기사로 바로 온 첫 방문).
- **시험 기간 · 운영** — 전환일(`settings.domain_cutover`, 2.6) 그날 0시부터 '운영', 앞날까지 '시험 기간'. 기간이 전환일을 걸치면 두 구간을 따로 센다(세션은 시작 구간에). 전환일이 없거나 설정이 틀리면 모두 시험 기간이고 화면이 알린다.
- 비율은 분모 0이면 '—'(0%로 보이지 않는다), 소수 한 자리.

**읽기** (`apps/web/lib/server/analytics/metrics.ts` `loadMetricsDashboard`) — 전환일 설정 → 기간 → DB 함수 한 번(3장, 기간 + 끝날 뒤 31일, service_role) → 세션 묶음을 규칙으로 센다. 세션이 100,000개(서버 보호 값 — 응답 약 10MB)를 넘으면 숫자를 만들지 않고 '기간을 줄이세요'. **화면을 열 때마다 원본 이벤트에서 다시 센다** — 일 단위 미리 계산(롤업) 표는 두지 않았다(9장 #34): 지금은 시험 주소라 이벤트가 적고, 재방문율은 방문자 단위라 날마다 더할 수 없어 롤업에 방문자 ID를 다시 두게 된다(방문자 ID 칸이 있는 표는 하나 — 4장).

**화면** (`app/admin/(desk)/metrics/page.tsx` · `components/admin/MetricsView.tsx` · 화면 값 `lib/admin/metrics-view.ts`)

- 기간 고르기(최근 7·30·90일 링크 · 전환일이 있으면 '전환 후 첫 4주 (기준선)' · 시작일·끝날 날짜 칸 — 스크립트 없이 도는 GET 폼) · 기간·계산 시각(한국 시간) · 전환일 줄(설정 화면 링크).
- 구간(시험 기간·운영)마다: 빼는 세션 줄 → 분야별 유효 방문 표(분야 4 + 전체: 허브 방문 세션·유효 방문 세션·비율) → 재방문율 표(방문자·재방문자·비율·30일 안 지남, 방문자 ID 없는 세션 수) → 첫 방문 깔때기 표(세 칸·앞 칸 대비·첫 방문 대비) + 첫 방문 문제해결률. 숫자마다 아래에 분모·분자·제외·소유 요구사항 ID·참고를 쉬운 말로(GROW-01 '지표마다 정의·분모·분자·소유 요구사항 ID').
- 다른 문서가 정하는 지표 — 지방세 연결률(01B CORE-03) · AI 도우미 해결률·사람 연결률·대화당 비용(01C CHAT-13) · 전문가 연결(01C EXPL-09) · 구독·도서·교육·상담 전환과 유입 경로(01C BIZ-09) · 상품별 공헌이익(01C BIZ-09, '2단계부터') · AI 검색 노출(OPT-09) · 제휴 준비도(NAV-17)를 정의·소유 ID와 '수집 전'으로만(숫자 칸 0 — 추정값 0). 소유 작업이 데이터를 만들면 그 작업이 이 목록에서 빼고 계산을 붙인다.
- 차트 컴포넌트가 `packages/ui`에 없어 표로 보인다(표 머리·줄 머리 `scope`, 화면 읽기용 caption). 360px — 칸이 적은 좁은 표, 넘치면 표만 가로로(페이지 가로 스크롤 0). AI 도우미 런처 0. CSV 내려받기는 두지 않았다(9장 #39).
- 데이터 표시(E2E가 읽는다): 구간 `[data-segment="trial|live"]` · 표 `[data-metric="valid-visits|revisits|funnel|solved|other"]` · 줄 `[data-row]` · 칸 `[data-cell]`.

**권한** — 작업 `metrics.read`(`lib/access.ts`) — **관리자만**. PRD-00 6장 표에 이 화면의 행이 없어 관리자 전권만 열었다(같은 표의 수익 대시보드 `/admin/business`도 관리자만, 9장 #29). 편집 책임자·기자·세무 감수위원·편집국 외 역할은 403 화면, 거부는 감사 대상이 아니다(읽기 — `AUDITED_DENIALS`에 넣지 않았다). 메뉴 '측정 지표'(`lib/admin/menu.ts` — 관리자 전용 메뉴 `ADMIN_MENU_IDS`). 전환일은 운영 설정 화면이 고친다(`lib/admin/settings-rules.ts` `domain_cutover` — 대시보드와 같은 검사 `checkDomainCutover`, 날짜를 바꾸면 버전도).

**측정 연결 더함** (6장 표) — 깔때기 ②·③의 원본이 화면에서 오지 않으면 칸이 늘 0이라(가짜 0), 기사 상세·상황 페이지의 다음 행동 띠 누름(`MeasureNextActions`)과 분야 허브의 상황 카드 누름(`MeasureSituationCards`)을 붙였다(`components/site/Measure.tsx` — 그리는 것 0, 띠·카드 컴포넌트를 바꾸지 않고 문서에서 누름을 듣는다). 검색(`search_submitted`)은 검색 화면(W2-d)이 붙인다.

**산출물**

- 마이그레이션 `20261018000016_w2c_metrics.sql` — 지표 읽기 함수 · 설정 씨앗 `domain_cutover`(2.6).
- 규칙 `lib/analytics/metrics.ts`(한국 날짜·기간·전환일 나누기·전환일 설정 검사·응답 읽기·유효 방문·재방문·깔때기·빼는 세션) · 서버 `lib/server/analytics/metrics.ts` · 화면 `app/admin/(desk)/metrics/page.tsx`·`components/admin/MetricsView.tsx` · 화면 값 `lib/admin/metrics-view.ts` · 권한 `lib/access.ts`(`metrics.read`)·`lib/admin/menu.ts` · 설정 `lib/admin/settings-rules.ts` · 측정 연결 `components/site/Measure.tsx`·`ArticleView.tsx`·`SituationView.tsx`·`HubView.tsx`.
- 시험 — 단위 `metrics.test.ts`(29초 0·30초 1을 30초 열람 시계와 이어서 · 허브만 0 · 다른 분야 0 · 30일째 포함·31일째 제외 · 한국 날짜 경계 · 같은 세션 0 · 방문자 ID 없는 세션 분모 0 · 봇·편집국 0 · 깔때기 순서 · 기간·전환일) · `metrics-view.test.ts` · `access.test.ts`·`menu.test.ts`·`settings-rules.test.ts` · DB `w2c-metrics.test.mjs` · 통합 `lib/server/analytics/metrics.itest.mjs`(로컬 DB 자료 → 대시보드 읽기 손 계산) · E2E `e2e/admin-metrics.test.mjs`(CI 2단계 — 화면 숫자 = 손 계산 · 전환일 → 두 구간 · 새 브라우저 시나리오 깔때기 세 칸 +1 · 수집 전 · 관리자만·403 · 360px).
- 함께 고친 것 — W2-b 기사 상세 머리 첫 화면(R1)·제목 40자·요약 60자 상한(W2-b 설계 9장 #52·#55). 그 상한에 걸린 E2E 원고 제목 2개를 줄였다(`admin-ui`·`w2b-acceptance`).

### 8.4 4단계 — 인포그래픽·동영상·포토·제휴사 프로필 (2026-10-18)

**블록 모양** (`@ltr/editorial` `model.ts` — 저장은 `apps/web/lib/server/articles/content.ts`, 값 목록 2.7)

- 인포그래픽(ART-07): 그림(media 번호)·대체 텍스트·캡션·축/단위/출처·템플릿·같은 내용(`data` — 표 또는 목록).
- 동영상(ART-08): 주소·캡션·요약 텍스트(`summary` — 영상 내용을 글로)·편집자 '자막 있음' 확인(`captions`)·썸네일(`thumbnailMediaId` — media 번호)·재생 시간(`durationSeconds`, 모르면 비움).
- 포토(ART-09): 형식이 포토인 기사의 이미지 블록이 사진 묶음이다(블록 종류를 더하지 않았다 — ART-01 블록 목록 그대로).
- media 표에서만 읽는 칸 — 그림의 권리 · 출처(`credit`) · 이용 조건(`license`) · media 대체 텍스트 · 크기(`width`·`height`). 본문에 적어 넣어도 저장하지 않는다(`StoredBlock`), 판정 입력은 `mapping.ts withMediaFacts`가 media 행에서 채운다.

**저장 불가** — 기사 저장 API(`POST`·`PATCH /api/admin/articles`) 422 `{ errors: ["body.blocks[n].칸: 문장"] }`, 편집 화면은 같은 함수·같은 문장으로 저장 요청 전에 막는다(`validateEditor`)

| 블록 | 저장 불가 | 함수 |
|---|---|---|
| 인포그래픽 | 대체 텍스트 빔 · 같은 내용 없음 · 표 머리 칸 빔·내용 행 0·행 칸 수가 머리 칸 수와 다름·빈 행 · 목록 항목 0·빈 항목 | `infographicSaveProblems` |
| 동영상 | 주소가 `https://www.youtube-nocookie.com/embed/<11자>`가 아님 — http · youtube.com · youtu.be · 다른·하위 호스트 · 끝 점 · 포트 · 사용자 정보(@) · 역슬래시 · `..` 경로 · 영상번호 없음·길이 틀림 · 덧붙인 경로 · 모르는·겹친 칸 · `#` · 빈칸·줄바꿈 · 300자 초과. 통과하면 정리한 주소(호스트 소문자·칸 순서)로 저장 | `parseYoutubeEmbed` |

읽을 때는 모양만 본다(`readStoredBody`) — 저장 규칙을 어긴 행(DB에 직접 넣은 행·이관 자료)도 읽어 발행 판정이 막고, 공개 화면은 그 블록을 그리지 않는다(`publicBlocks`).

**발행 판정** (`packages/editorial checks/media-formats.ts` — 모두 차단, README 규칙 표)

| 항목 | 막는 것 |
|---|---|
| `art07.infographic-required` · `art08.video-required` · `art09.photos-required` | 형식이 인포그래픽·동영상·포토인데 그 블록(포토는 이미지 블록)이 0 — 카드의 형식 배지가 빈 기사에 붙지 않게 |
| `art07.infographic-alt` · `art07.infographic-data` | 저장 규칙과 같은 조건(직접 넣은 행) |
| `art08.embed-url` | youtube-nocookie 임베드 주소가 아님 |
| `art08.summary-required` · `art08.captions-unconfirmed` | 요약 텍스트 빔 · '자막 있음' 체크 안 함 (ART-08) |
| `art08.thumbnail-required` · `art08.thumbnail-ratio` | 썸네일 안 고름 · 16:9가 아님(1% 밖)이거나 크기를 모름. 썸네일 권리는 `nav04.image-rights` |
| `art09.photo-credit` · `art09.photo-license` · `art09.photo-alt` | 포토 기사 사진마다 media 출처·이용 조건·대체 텍스트(블록 또는 media) |

동영상 조건(요약·자막·썸네일)은 형식과 상관없이 모든 동영상 블록에 같다 — 어느 기사에서나 같은 '누르면 재생' 카드로 그린다. 요약 텍스트·같은 내용의 표 글자도 금지·공포 표현 검사와 '할 일을 함께 썼다'(UX-03) 대상이다(`blockSentences`).

**DB** — 마이그레이션 `20261018000017_w2c_media_formats.sql`: `media.width`·`height`(둘 다 있거나 없음, 1~20000, anon 칸 권한 — 행 범위는 그대로) · `articles.body_media_ids` 계산식에 동영상 썸네일 번호(→ 공개 기사의 권리 확인 썸네일만 anon이 읽는다) · `feature_flags.video_list` false. 시험 `packages/db/tests/w2c-media.test.mjs`.

**공개 화면** (공개 데이터 함수 `lib/server/public/media-lists.ts`·`media-logic.ts`·`article.ts` — anon 키)

- 기사 상세 본문(`components/site/ArticleBlocks.tsx`): 인포그래픽 = `@ltr/ui InfographicBlock`(그림 + 같은 내용 `details` 기본 접힘·키보드로 펼침 · 절차 흐름은 번호 목록 · 단위·출처·그림 출처 줄) · 동영상 = `VideoPlayer`(`@ltr/ui VideoCard` — 누르기 전에는 사이트의 썸네일과 재생 단추뿐, 누르면 그 자리에 nocookie 플레이어(autoplay)를 열고 초점을 옮긴다) · 포토 기사 사진 = 그림 + '촬영 ○ · 출처 ○ · 이용 조건 ○' 줄. 그림은 모두 원본 비율 그대로 줄이고 자르지 않는다(`h-auto w-full`, 크기를 알면 `width`·`height`로 자리 확보). W2-b의 동영상 새 창 링크(`videoHref`)는 없앴다.
- 동영상 기사의 공유 이미지는 첫 동영상 썸네일(SEO-03 '동영상 기사는 저장한 썸네일이 공유 이미지'), 없으면 대표 이미지.
- `/news/video` — 동영상 카드(`@ltr/ui VideoCard` 링크형 — 썸네일·재생 시간·'자막 있음' 칩·요약·기사 유형/제휴 배지) 그리드, 그릴 수 있는 동영상이 없는 기사는 기사 카드. 기능 키 `video_list`가 꺼지면 404(`getVideoList` null). 한 쪽 20건·`?page=`.
- `/news/photo` — 기사 카드 그리드(형식 배지 '포토'). 형식이 인포그래픽인 기사 카드의 '인포그래픽' 배지는 W2-b 기사 카드 그대로.
- `/partners/[id]` — 공개 제휴사(RLS `visible`)의 이름·종류·소개·누리집(새 창, http(s)만)·제휴 배지 '공동 기획 ○○'·"제휴사는 기사 승인·순서·취재 결론에 관여하지 않습니다"·그 제휴사가 지정된 공개 기사 카드(공동 기획 = 제휴 배지, 광고 = 유형 배지 '광고' — 목록 카드·상세와 같은 함수 `cardTypeBadge`). 번호 모양이 아니거나 없는·비공개 제휴사는 404, 공개 데이터를 읽지 못하면 503(`lib/site/public-gate.ts` 상세 경로에 `partner`).
- 기사 상세 머리의 제휴 배지는 공개 제휴사이면 프로필 링크(화면 전환 — 링크 이름 '공동 기획 ○○ 제휴사 소개').
- 사이트 안 링크는 모두 `UiLink`(VideoCard 링크형을 a 요소에서 바꿨다). 세 목록 모두 메뉴 링크는 아직 없다(9장 #54).

**측정** (`components/site/Measure.tsx` · `VideoPlayer.tsx` — 1단계 브라우저 도우미 `track()`, 측정 거부·GPC면 전송 0)

| 이벤트 | 언제 | 속성 |
|---|---|---|
| `video_played` | 재생 단추를 누른 때 1건(카드마다 한 번) | 분야 · `article_id` |
| `partner_content_viewed` | 공개 제휴사가 지정된 기사를 열 때 1건 | 분야 · `partner_id` · `article_id` |

**편집 화면** (`components/admin/editor/BlockEditor.tsx` · 규칙 `lib/admin/media-blocks.ts`·`editor-state.ts`)

- 인포그래픽: 템플릿 고르기(절차 흐름·비교·핵심 숫자 — 같은 내용 칸이 비어 있으면 그 틀: 절차 흐름 = 목록, 비교 = '구분 | 비교 1 | 비교 2', 핵심 숫자 = '항목 | 숫자' 머리 칸) · 같은 내용의 모양(표·목록)과 칸 · 대체 텍스트(필수) · '인포그래픽 확인' 줄(대체 텍스트·같은 내용·그림 권리).
- 동영상: 주소(안내 — 개인정보 보호 주소만) · 썸네일 고르기(이미지 글자에 크기) · 요약 텍스트 · 재생 시간(초) · '자막 있음' 체크 · '동영상 확인' 줄(주소·요약·자막·썸네일·16:9·권리).
- 포토 기사: 사진 묶음 요약('사진 n장 · 표기가 빠진 사진 m장') · 사진마다 '사진 표기' 줄(출처·이용 조건·대체 텍스트·권리 — media 기록에서).
- 확인 줄은 글자('됨'·'빠짐')로 보이고, 최종 판정은 점검 패널(발행 판정 항목 이름·문장·블록 위치)이 한다. 편집기의 이미지 목록은 권리·출처·이용 조건·크기 칸까지 읽는다(`queries.ts listMedia`).

**시험**

- 단위 — editorial `media-formats.test.ts`(82 — 주소 거부 32종·16:9 경계 ±1%·저장 조건·발행 판정) · 웹 `content.test.ts`(저장 422 칸 경로·주소 정리·읽기는 모양만) · `media-blocks.test.ts` · `editor-state.test.ts`(왕복·API와 같은 문장·확인 대상) · `media-logic.test.ts`(그릴 수 있는 동영상·썸네일 번호·제휴사 공개 칸) · `media-view.test.ts`(화면 값·측정 속성이 수집 API 검사를 지남·화면 문구 검사) · `gate.test.ts`(media 기록으로 판정 — 본문에 적은 권리·크기는 무시) · `article-logic`·`public-gate`·`constants` 테스트 넓힘 · ui `VideoCard`(플레이어 주소 거부 10종·초점·배지·UiLink)·`InfographicBlock`(번호 목록·줄·크기 없음·표 가로 밀림)·`FieldHubHead`(긴 이름 줄바꿈).
- DB `w2c-media.test.mjs`(7) · 통합 `lib/server/public/media-lists.itest.mjs`(5 — anon: 기능 키 꺼짐 null·형식만·미확인 썸네일 0·비공개 제휴사 null·계약 칸 0).
- E2E `e2e/site-media.test.mjs`(CI 2단계 — 11개, 아래 표).

| 4단계 증거 | 시험 | 결과 |
|---|---|---|
| 저장 불가 조건 (ART-07·08) | `a)` · `c)` · `h)` | 통과 — 대체 텍스트·표 없음 422(`body.blocks[7].alt`·`.data`)·새 기사도 422·행 0·버전 그대로 / youtube.com·http·하위 도메인 속임·youtu.be·autoplay 칸 422 / 편집 화면은 저장 요청 0 |
| 발행 불가 조건 (ART-07·08·09) | `a)` · `c)` · `e)` | 통과 — 블록 없는 인포그래픽 기사 · 요약 없음·자막 미확인 → 자막만 → 4:3 썸네일 → 통과 / 사진 0장 · 출처·이용 조건·대체 텍스트 하나씩(그 사진 위치·media 번호) |
| 재생 전 유튜브 요청 0 (ART-08) | `d)` · `f)` | 통과 — 기사·목록 모두 재생 전 유튜브·구글 도메인 요청 0(네트워크 기록), 누른 뒤 nocookie 요청만·autoplay·초점 이동 |
| `video_played`·`partner_content_viewed` 1건 | `d)` · `g)` | 통과 — 누르기 전 0 → 1 → 1초 뒤에도 1(속성 기사 번호·분야) / 제휴 기사 한 번 열면 1건(제휴사·기사 번호), 제휴 기사가 아니면 0 |
| 표 접힘·키보드 펼침·대체 텍스트 · 원본 비율 | `b)` · `d)` · `e)` · `f)` | 통과 — 기본 접힘·Enter 펼침·Enter 접힘 / 그림·16:9 썸네일·4:3·세로 사진의 원본 비율 = 화면 비율(1% 안), object-fit cover 0 |
| 목록 (`/news/video`·`/news/photo`) | `f)` | 통과 — 기능 키 꺼짐 404 → 켬 → 형식 동영상만(썸네일 없는 기사는 기사 카드) → 끔 404 / 형식 포토만 / 'video' 주소 기사 0 |
| 제휴사 (ART-10) | `g)` | 통과 — 그 제휴사 공개 기사만·카드와 상세 배지 글자 같음·광고는 '광고'·배지 → 프로필 화면 전환·비공개·없는·0번 404·계약 끝난 제휴사 기존 배지 그대로 |
| R1~R3 · 360px · 접근성 | `i)` · `j)` | 통과 — 동영상·포토 기사 × 360·640·1024, 가로 스크롤 0(기사·목록·제휴사)·누르는 자리 44px / 동영상·포토·인포그래픽 기사 접근성 100점 |

- 시험 자료는 정리 단계가 지운다(계정·기사·이미지·제휴사·측정 행·감사 로그, 기능 키 되돌림) — 실행 뒤 남은 행 0을 확인했다.

**함께 고친 것** — W2-b 설계 2.3 기능 키에 `video_list` · 7장 '만들지 않는 경로'에서 동영상·포토 목록을 빼고 따로 적음 · 9장 #51. 열린 화면 판정(`constants.ts isOpenPath`)에서 포토 목록은 열린 화면, 동영상 목록은 기능 키로. `w2b-acceptance`의 닫힌 경로 목록에 동영상 목록을 기능 키 화면으로 더함. `@ltr/ui FieldHubHead` 제목이 띄어쓰기 없는 긴 이름도 줄을 바꾼다(제휴사 이름 — 360px 가로 스크롤). 표 칸 글자 도우미를 `lib/admin/table-text.ts`로 옮김(인포그래픽 표와 같이 쓴다).

**W7로 넘김** — 구조화 데이터: 동영상 기사의 `VideoObject`(OPT-02 — 생성기 `packages/structured-data videoObject`는 있다. 화면 값 연결과 견본 검사는 W7 '구조화 데이터 7유형'에서). 포토 기사용 `ImageGallery`는 PRD 목록에 없어 만들지 않는다.

### 8.5 5단계 — 기사 생산·제휴 준비 대시보드 · 공동 기획 배지 (2026-10-18)

**경로** — PRD-01A 3장 백오피스 표·화면 그림의 `/admin/news-readiness`(제휴 준비 대시보드 — NAV-13·14가 먼저 쓰고 NAV-16·17·24가 같은 화면에 더한다)와 규정 버전 화면 `/admin/news-readiness/requirements`. 작업 지시의 `/admin/news-partner`가 아니라 PRD 경로를 따랐다(이 문서 머리 '다르면 PRD가 맞다' — 9장 #56). E2E 파일 이름은 지시대로 `e2e/admin-news-partner.test.mjs`.

**규정 버전** (NAV-13 — DB 3장, 규칙 `lib/readiness/requirements.ts`)

- 칸: 플랫폼 · 버전 번호(플랫폼마다 1부터) · 이름 · 매체 등록 유형 · 원문 주소 · 원문 사본 보관 위치·조항 · 확인일 · 적용 시작일·끝날 · 심사 대상 기간 `{ months, basis, text }` · 요건 항목(2.8) · 상태 · 이어받은 버전 · 메모 · 작성·고친·승인한 사람(`user:<uuid>` — 감사 로그와 같은 모양)과 시각. PRD-01A 6.1의 나머지 칸(접수 주기·다음 접수 목표·합격선·평가 대상 기간 정의·유사도·기고자·부정평가 규칙)은 그 요구사항(NAV-16·18·19·20·24 — W7)이 칸을 더한다(9장 #58).
- 요건 항목 하나 = 계산 종류(기사 수 · 비율 · 기자 1인당) + 분자 거르개(유형 · 취재 방식 · 기획 종류 · 이관 포함) + 비율이면 분모 거르개 + 분자·분모·제외 정의 글자(규정 원문을 쉬운 말로 — 대시보드가 그대로 보인다) + 기준 `{ comparator 이상·초과, value, per 심사 기간 전체·월평균 }` 또는 없음 + 원문 조항. 비율 기준은 0~100(%)이고 심사 기간 전체만. 20개까지, key는 버전 안에서 하나.
- 확정 = 담당자 승인: 원문 주소(http(s))·확인일(오늘 이전)·등록 유형·적용 시작일·심사 대상 기간·요건 1개 이상 + '공식 규정 원문과 우리 매체의 실제 등록 유형을 확인했습니다' 표시. 하나라도 없으면 422(칸 경로가 붙은 문장 — 화면이 확정 전에 같은 목록을 보인다), DB 제약도 같은 칸을 막는다. 승인자는 작성자와 같아도 된다(9장 #57).
- 확정된 버전은 고치기·지우기 거부(API 409 · DB 트리거). 바뀐 규정은 '이 버전을 바탕으로 새 버전 적기' → 새 번호 작성 중 → 확정. 앞 버전은 그대로 남는다(NAV-13 '새 버전을 확정해도 이전 버전이 남는다').
- 대시보드가 쓰는 버전 = 그 플랫폼의 확정 버전 가운데 오늘이 적용 기간 안인 것, 여럿이면 가장 늦게 확정된 것. 없으면 `요건 미확정`과 이유(등록 0 · 작성 중만 · 적용 기간 밖 · 확정 버전의 요건 모양 틀림). 카카오는 버전이 하나도 없으면 `검토 전`도 함께(NAV-22).

**기간** (`lib/readiness/windows.ts` · 설정 `news_readiness_windows` 2.8) — 한국 달력 달. 씨앗은 완결된 달(3개월 = 석 달 전 1일 0시 ~ 이번 달 1일 0시, 한국 시각). 시작일 하루 전 제외 · 시작일 0시 포함 · 끝 제외(NAV-14 수용 기준 — 단위·통합·E2E). 공식 정의의 비교 칸은 그 버전의 심사 대상 기간(달 수·잡는 법)으로 따로 잡는다. 설정이 없거나 틀리면 NAV-14 정의(3·6·12개월, 완결된 달)로 세고 화면이 알린다. 관리자 설정 화면이 같은 검사로 고친다(기준 숫자 칸을 넣으면 거부).

**세는 규칙** (`lib/readiness/production.ts` — 시험 `production.test.ts`, 기대값은 견본 기사 손 계산)

- 고르는 기사(두 정의 공통): 지금 공개 중(published)이고 그 기간에 처음 발행된 기사. 내부 정의는 이관(옛 사이트) 기사를 빼고, 공식 정의는 거르개가 넣을 때만 넣는다. 보류·삭제로 내린 기사·이관 기사 수는 기간마다 따로 보인다.
- 내부 정의: 총 발행 · 자체 취재 후보(보도 `reported_news` — 금주 핫뉴스·칼럼·광고·공동 기획·해설·가이드·유형 없음 제외. 1건씩 더해도 분자 그대로 — 시험) · 정량형·정성형·혼합형·취재 방식 없음(분모 자체 취재 후보) · 기획·심층(기획 종류가 기획·탐사인 기획에서 나온 기사) · 근거 누락(자체 취재 후보 가운데 확인된 취재 근거 0) · 권리 누락(권리 미확인 이미지·취재 근거) · 편집 승인 누락 · 세무 감수 누락(분모 감수 대상) · 정정·반론·추후보도(그 기간에 결정된 기록 — 어느 기사든) · 유사도 사전 경고(그 기간 점검에서 기준을 넘은 원고 수 — 발행 안 된 원고 포함 · 유사도를 확인하지 못한 발행 기사 수) · 독자 반응(그 기간 발행 기사가 지금까지 받은 사람 조회·30초 이상 열람·공유 — `article_stats` 사람 값).
- 공식 정의: 요건마다 거르개로 분자·분모. 기자 1인당 = 그 기사를 쓴 기자 수로 나눔(작성자 없는 기사 제외 — 외부 기고자 합산은 NAV-19 W7). 기준 비교는 심사 기간 칸 하나에서만 — 월평균은 달 수로 나누고, 값이 없으면(분모 0) 미달, 이상·초과 경계는 규정 버전 값(시험: 정확히 50%는 이상이면 충족·초과면 미달).
- 기준에 못 미치는 요건이 하나라도 있으면 NAV-13 안내 — "지금 생산량으로는 이 규정 요건을 채우지 못합니다. 취재 인력·역량을 먼저 보강하거나 신청을 미루세요. 비슷한 기사를 한꺼번에 많이 내서 숫자를 맞추지 않습니다".

**읽기** (`lib/server/readiness/dashboard.ts`) — 설정 → 규정 버전 → DB 함수 `news_production_facts` 한 번(가장 이른 기간 시작 ~ 가장 늦은 끝). 화면을 열 때마다 원본 표에서 다시 센다. 월 마감 행(`partner_readiness_monthly`)은 만들지 않았다 — 이 대시보드는 지금 숫자를 보고, 지난 달을 고정하는 일은 NAV-17(W7 월 마감 배치·임의 3개월 조합)이 그 표·마감 규칙과 함께 한다(9장 #59).

**화면** (`app/admin/(desk)/news-readiness/page.tsx` · `components/admin/ReadinessView.tsx` · 화면 값 `lib/admin/readiness-view.ts`)

- 머리 '기사 생산·제휴 준비' + '제휴 규정 버전' 링크 · 강조 문단 "내부 준비 지표입니다 — 네이버 심사 점수가 아닙니다. 제휴 선정은 네이버가 정합니다." · 오늘·계산 시각·기간 설정 버전.
- 공식 정의 — 플랫폼마다. 확정 버전이 없으면 `요건 미확정`·이유·규정 화면 링크뿐(공식 숫자·충족·미달 0). 있으면 버전 정보(번호·이름·승인자·원문 링크·보관 위치·확인일·등록 유형·적용 기간·심사 대상 기간) + 표(요건 × 3·6·12개월 · 심사 기간 · 규정 기준 · 기준 대비) + 요건마다 분자·분모·제외(규정 버전 글자 그대로)·세는 기사·원문 조항 + 미달이면 인력 보강·신청 연기 안내.
- 내부 정의 — 표 5개(기사 생산 · 근거·권리·감수 누락 · 정정·반론 · 기사 유사도 사전 경고(중복·표절 검토용 경고) · 독자 반응) × 기간, 표마다 분자·분모·제외·소유 ID. 유사도 표 위에 "중복·표절 검토용 경고 … 네이버 심사와 관계없는 내부 점검이며 점수가 아닙니다".
- 기자별 취재 부담(기간별 발행·자체 취재 후보·진행 중 기획) · 기사별 추적(근거 확인/전체 → 편집 승인 → 세무 감수 → 정정·반론 기록 → 유사도 점검, 기사 이름은 편집국 기사 기록 화면 링크, `?window=` 기간, 100건까지).
- 글자 규칙: '인정'·'예상 점수'·'예측'·'판정'·'선정 예정'·'제휴 확정'·'네이버 제휴 언론사' 0(화면 값 모듈 글자 전부를 읽는 시험 + E2E 화면 글자). 360px — 표만 표 안에서 넘친다. AI 도우미 런처 0.
- 데이터 표시(E2E가 읽는다): `[data-platform][data-state="none|unconfirmed|confirmed"]` · `[data-part="undetermined|official|capacity-guidance|definition"]` · `[data-metric="official|production|gaps|corrections|similarity|reader|reporters|trace"]` · `[data-row]` · `[data-cell="w3|w6|w12|review|criterion|result"]`.

**규정 화면** (`app/admin/(desk)/news-readiness/requirements/page.tsx` · `components/admin/RequirementForm.tsx`·`RequirementConfirm.tsx` · 폼 값 `lib/admin/requirement-form.ts`) — 플랫폼별 버전 기록(새 번호가 앞, 작성 중·확정 표시, 작성·확정한 사람 — 편집국 인물 이름, 없으면 계정 앞 8자리) · 새 버전 적기(작성 중으로 저장) · 작성 중 버전의 고치기·확정하기(빠진 칸 목록 + 담당자 확인 표시) · 확정 버전은 '이 버전을 바탕으로 새 버전 적기'만. 저장 전 검사는 API와 같은 함수(같은 문장). 기준 숫자 칸은 비어서 시작한다.

**기사 할당량** (NAV-09 · NAV-13 '확정 버전이 없으면 대시보드·기사 할당량이 `요건 미확정`') — 기사 기획 캘린더(`/admin/stories`) 머리에 '기사 할당량' 줄(플랫폼마다): 확정 버전이 없으면 `요건 미확정 — 이유`, 있으면 그 버전의 기사 수·기자 1인당 기준(`규정 n번 — 월 발행량: 월평균 ○건 이상`), 그런 기준이 없으면 '기사 수 기준이 없습니다'. 할당량을 따로 적는 칸은 없다(NAV-09 '임의 할당량 입력 0'). 기자도 같은 줄을 본다(화면 값 `quotaLines`).

**API** — `GET·POST /api/admin/news-readiness/requirements` · `PATCH …/[id]`(작성 중만 — 확정 409) · `POST …/[id]/confirm`(`{ "attested": true }`, 빠진 칸 422, 이미 확정 409). 감사 로그 `news_requirement.create|update|confirm`(전후 값), 등록·확정 거부는 `readiness.requirements.denied`.

**권한** — `readiness.read`·`readiness.requirements` = 편집 책임자·관리자(PRD-01A 3장 '편집 책임자·관리자만' — `lib/access.ts`). 기자·세무 감수위원·편집국 외 역할은 화면 403·API 403, 메뉴 '제휴 준비'는 편집 책임자·관리자에게만.

**저장소 검사** (`lib/readiness/no-criteria.test.ts` — NAV-13 '코드와 설정 기본값에 심사 점수·기사 수 기준 상수 0') — 화면·서버·패키지·마이그레이션·작업 코드(시험 파일 제외)에 심사 점수 글자(예: 80점)·합격선·배점 칸의 숫자·요건 기준 숫자를 미리 채운 코드·규정 버전 씨앗이 0.

**공동 기획 배지 고침** (ART-10 · W2-a 4-2 '이미 붙은 배지는 남는다' — 9장 #52 해소)

- 원인: 공개 화면(anon)은 공개 제휴사 행만 읽어서(RLS), 공동 기획 기사의 제휴사를 비공개로 내리면 이름을 읽지 못해 카드·상세의 표기가 유형 배지 '광고'로 바뀌었고, JSON-LD 제목·공유 제목은 이름 없는 '[공동 기획]'이 됐다.
- 고침: 기사가 배지 이름을 들고 있다 — `articles.partner_badge_name`(DB 3장). 목록 카드(`lib/server/public/cards.ts`)와 기사 상세(`article.ts` — 배지·표기·JSON-LD·공유 제목·메타 설명)가 이 칸을 읽는다. 목록은 이제 제휴사 표를 읽지 않는다(요청마다 질의 1개 줄어듦). 제휴사 프로필 링크와 `partner_content_viewed`는 그대로 공개 제휴사만, 광고 기사는 그대로 '광고'. 계약이 끝나도 공개로 둔 제휴사는 전처럼 링크까지 보인다.

**산출물**

- 마이그레이션 `20261018000018_w2c_news_readiness.sql`(규정 버전·점검 기록·읽기 함수·설정 씨앗) · `20261018000019_w2c_partner_badge.sql`(배지 이름 칸·트리거·공개 뷰).
- 규칙 `apps/web/lib/readiness/windows.ts`·`requirements.ts`·`production.ts` · 서버 `lib/server/readiness/dashboard.ts`·`requirements.ts` · API `app/api/admin/news-readiness/requirements/route.ts`·`[id]/route.ts`·`[id]/confirm/route.ts` · 화면 `app/admin/(desk)/news-readiness/page.tsx`·`requirements/page.tsx`·`components/admin/ReadinessView.tsx`·`RequirementForm.tsx`·`RequirementConfirm.tsx` · 화면 값 `lib/admin/readiness-view.ts`·`requirement-form.ts` · 권한·메뉴 `lib/access.ts`·`lib/admin/menu.ts` · 설정 `lib/admin/settings-rules.ts` · 감사 대상 `lib/server/audit.ts`(`targetOf.requirement`) · 기사 할당량 `app/admin/(desk)/stories/page.tsx` · 표기 `lib/server/public/rows.ts`·`cards.ts`·`reads.ts`·`article.ts`.
- 시험 — DB `w2c-readiness.test.mjs`(9)·`w2c-partner-badge.test.mjs`(3)·`admin-rights`(추가만 목록) · 단위 `windows.test.ts`·`requirements.test.ts`·`production.test.ts`·`no-criteria.test.ts`·`readiness-view.test.ts`·`requirement-form.test.ts`·`access.test.ts`·`menu.test.ts`·`settings-rules.test.ts`·`cards.test.ts` · 통합 `lib/server/readiness/dashboard.itest.mjs`(2 — '오늘'을 2003-01-15로 두고 2002년 기사·규정 버전으로 손 계산) · E2E `e2e/admin-news-partner.test.mjs`(CI 2단계 — 8개, 아래 표) · `site-article` d-2)·c) · `site-media` g-2).
- 함께 고친 것 — 편집 책임자 메뉴 기대값(`admin-ui`·`admin-settings-ui` E2E에 '제휴 준비'), E2E 정리 단계(`e2e/lib/staff.mjs` — 시험 계정이 만든 규정 버전을 지운다), W2-a·W2-b 설계의 표기 문장.

| 5단계 증거 | 시험 | 결과 |
|---|---|---|
| 확정 버전 없으면 `요건 미확정` (NAV-13 · NAV-14) | 단위 `platformState`·`quotaLines` · 통합 · E2E `a)`·`c)` | 통과 — 두 플랫폼 `요건 미확정`(카카오 `검토 전`)·공식 숫자·충족·미달 0, 작성 중 버전만 있어도 요건 미확정, 기사 기획 캘린더의 기사 할당량도 요건 미확정(입력 칸 0) → 확정 뒤 '규정 1번' |
| 시작일 하루 전 제외·시작일 포함 (NAV-14) | 단위 `windows`·`windowArticles` · DB 함수 · 통합 · E2E `a)` | 통과 — 3개월: 시작일 0시 포함·하루 전 제외(6개월에는 포함), 끝(이번 달 1일 0시) 제외 |
| 확정 조건·담당자 승인 (NAV-13) | DB · 단위 `confirmProblems` · E2E `b)` | 통과 — 원문 URL·확인일·등록 유형·적용 시작일·심사 기간·요건 하나씩 없으면 거부, 확인 표시 없이 422, 화면에서 확정·감사 로그 |
| 확정 버전 그대로·새 버전 (NAV-13) | DB · E2E `d)` | 통과 — 고치기 409·DB 그대로·지우기 거부, 새 버전 확정 뒤 두 버전 모두 확정으로 남고 대시보드는 새 버전 |
| 공식·내부 정의 따로, 분모·제외 글자 (NAV-14) | 단위 · E2E `a)`·`c)` | 통과 — 공식 1/4·25%(규정 글자·거르개) · 내부 1/4·25%(내부 정의 글자), 정의마다 분자·분모·제외 |
| 인력 보강·신청 연기 안내 (NAV-13) | 단위 · 통합 · E2E `c)`·`d)` | 통과 — 미달이면 안내, 모두 충족이면 0 |
| '인정'·'예상 점수' 0, 유사도는 검토용 경고 (NAV-14) | 단위(모듈 글자 전부) · E2E `f)` | 통과 |
| 코드·설정 기본값에 기준 상수 0 (NAV-13) | `no-criteria.test.ts` · DB(씨앗 칸·규정 씨앗 0) | 통과 |
| 역할 (PRD-01A 3장) | 단위 `access`·`menu` · E2E `e)` | 통과 — 기자·광고 담당 403·메뉴 0·거부 감사 로그, 편집 책임자·관리자 200 |
| 360px | E2E `g)` | 통과 — 대시보드·규정 화면(폼 펼침) 가로 스크롤 0 |
| 공동 기획 배지 (ART-10) | DB · 단위 `cards` · E2E `site-article d-2)·c)`·`site-media g-2)` | 통과 — 제휴사를 비공개·계약 종료로 바꿔도 카드·상세·JSON-LD·공유 제목 '공동 기획 ○○', '광고' 0, 숨은 프로필 링크 0, 측정 0 |

- 시험 자료는 정리 단계가 지운다(계정·기사·규정 버전·감사 로그·집계·점검 행) — 실행 뒤 남은 행 0을 확인했다.

### 8.6 6단계 — 수용 E2E (2026-10-18)

`e2e/w2c-acceptance.test.mjs` — PRD-01A 9장 W2-c 증거와 4장 수용 기준(FND-06 · GROW-01 · ART-07~11 · HOME-05 · NAV-13·14)을 한 시험 자료·한 서버(standalone 빌드 + 로컬 Supabase)·한 브라우저로 다시 증명한다. CI 2단계(`scripts/ci/db-e2e.sh` — W2-b 수용 E2E 다음). 시험 22개, 로컬 실행 2분 30초~4분(standalone 빌드 포함).

**자료를 만드는 길** (실제 경로를 쓸 수 있으면 실제 경로)

- 편집국 API — 인포그래픽·동영상·포토 기사(작성 → 출처 → 저장 → 편집 승인 → 세무 감수 → 발행, 저장 422·발행 422 조건을 하나씩 지난다) · 공동 기획 기사(광고·협찬 담당이 쓰고 편집 책임자가 발행) · 삭제 정정 · HOT 고정(배치 API) · 제휴사 등록·비공개(운영 API) · 가중치·전환일·기능 키(설정 API) · 규정 버전 등록·확정(규정 API).
- 수집 API `POST /api/events` — 봇 User-Agent(Googlebot) 100번 + 사람 3번(기사 A), 사람 5번(B), 같은 방문자 3번. 배치는 끝난 시간대만 센다(8.2) — 받은 행의 시각만 2시간 앞으로 옮긴다(번호는 새것이라 다음 집계가 그 시간대를 센다). 봇 표시는 서버가 User-Agent로 붙인 그대로다.
- 시각을 정한 자료(DB) — 168·169시간 경계, 같은 방문자 0·10·29분, 편집국 조회 50, 광고 기사 사람 조회 30, 상담 사례 점수 자료(2단계 E2E와 같은 손 계산), 지난 주 지표 자료(3단계 E2E와 같은 손 계산 — 재방문 30·31일째). 자료를 넣는 사이 정시를 넘으면 그 자료와 이 시험의 집계를 지우고 새 기준 시간대로 한 번 더 한다(경계 시험이 흔들리지 않게).
- DB에 직접 넣은 것 — 순위를 채우는 기사·상담 사례·기사 생산 경계 기사(완결된 3개월 첫날 0시·그 하루 전)와 이미지 기록(이미지 등록 API가 아직 없다). 첫 공개 화면 요청 전에 넣는다(공개 데이터 캐시).
- 실제 브라우저 — 새 브라우저(사람 User-Agent) · 측정 거부 화면 · GPC · 편집자 로그인 · 자동화 브라우저(HeadlessChrome = 봇 — 공개 화면을 여는 나머지 시험 브라우저도 모두 이것이라 사람 조회를 만들지 않는다). 30초 열람은 Playwright 가짜 시계: 열람 이벤트를 받은 바로 뒤 시계를 멈추고 29,000ms → 이벤트 0, 1,000ms 더 → 1건(진짜 30초를 기다리지 않는다).
- 접근성 — 관리자 화면은 관리자 로그인 쿠키를 Lighthouse가 여는 브라우저 기본 창에 넣고 잰다. Lighthouse가 실제로 잰 주소가 그 화면인지(로그인 화면으로 넘어가지 않았는지) 시험이 본다(`e2e/lib/a11y.mjs`가 잰 주소를 돌려준다).
- 정리 — 표마다 시험 전 행 수·운영 설정 값 그대로(마지막 시험이 확인한다).

**W2-c 수용 결과**

| PRD 증거 · 수용 기준 | 시험 | 결과 |
|---|---|---|
| **봇 제외** — 봇 100 + 사람 3인 A < 사람 5인 B (ART-11 · 9장) | `7)` | 통과 — 수집 API가 103건 중 100건에 봇 표시, 집계 A 전체 103·사람 3 / B 사람 5, 순위 B 5점 > A 3점, `/news/popular`도 B가 위 |
| **168시간 경계** — 168시간 전 시간대 포함·169시간 전 제외 (ART-11 · 9장) | `7)` | 통과 — 168시간 전 2회 순위에 듦, 169시간 전 9회는 그 시간대 집계 행이 있어도 순위 0 |
| 30분 안 반복 1회 · 편집국·광고 제외 (ART-11) | `7)` | 통과 — 같은 방문자 3번(수집 API)·0·10·29분(지난 시각) 각 1회, 편집국 50회 → 사람 0, 광고 기사 사람 30회 → 순위 0, 원본·집계 anon 읽기 거부 |
| 사이드바 5·목록 20·비공개 전환 (ART-11) | `7b)` | 통과 — 목록 20 + 집계 시각 줄, 사이드바 5(지금 기사 제외 · 1280px 오른쪽 · 360px 본문 뒤), 누르면 `popular_article_clicked` 1건(순위 2·list), 삭제하면 다음 집계 전에도 목록에서 빠지고 20건 유지, 다음 집계는 순위 표에서도 0 |
| HOT — 가중치 settings · 다음 집계부터 · 카드 3 + HOT 5 · 고정 (HOME-05) | `6)` · `8)` | 통과 — 집계 전 최신 상담 사례·배지 0·홈 HOT 0, 고정 2건·3번째 409·다른 분야 422, 카드 3 + HOT 5(고정 맨 앞·배지·겹침 0 — 지방세 허브·상담 사례 목록), 점수 = 설정 가중치(22·20·12), 설정 API로 공유 5 → 1: 바꾼 직후 그대로 → 다음 집계에 순서 변화(점수 6) |
| **유효 방문 29초·30초** (GROW-01 · 9장) | `9)` | 통과 — 실제 브라우저 지방세 허브 → 기사: 29초는 30초 열람 이벤트 0·대시보드 유효 방문 +0(허브 방문 세션 +1), 30초는 1건·유효 방문 +1 |
| 첫 방문 깔때기 — 새 브라우저 (GROW-01) | `9)` | 통과 — 홈 → 4대 분야 카드 → 허브 → 기사 30초 → 다음 행동: 방문자 ID 쿠키(HttpOnly)·한 세션·모두 첫 방문·사람, 깔때기 세 칸 +1·첫 방문 문제해결 +1 |
| 편집자·관리자 세션과 봇 제외 (GROW-01) | `9)` · `9c)` | 통과 — 편집자 로그인 브라우저는 `is_staff`, 자동화 브라우저는 `is_bot`으로 저장되고 같은 길을 30초 넘게 걸어도 대시보드 숫자 그대로 / 지난 주 자료의 봇·편집국 세션 0 |
| 측정 거부·GPC — 방문자 ID 0·전송 0 (GROW-01) | `9b)` | 통과 — 측정 거부 화면에서 거부한 뒤·GPC 브라우저: 홈 → 카드 → 허브 → 기사 `/api/events` 요청 0·저장 0·방문자 ID 0, 서버도 거부 쿠키·`Sec-GPC` 204·저장 0 |
| 재방문 30일째 포함·31일째 제외 · 시험 기간 · 수집 전 (GROW-01) | `9c)` | 통과 — 대시보드 숫자 = 손 계산(유효 방문 29초 0·31초 1·다른 분야 0 · 재방문 30일째 포함·31일째 제외 · 방문자 ID 없는 세션 분모 밖 · 깔때기 · 지표마다 정의·분모·분자·소유 ID), 전환일 설정 → 시험 기간·운영 따로, 다른 문서 지표 '수집 전'(숫자 칸 0) |
| **규정 미확정 시 `요건 미확정`** (NAV-13·14 · 9장) | `10)` | 통과 — 두 플랫폼 `요건 미확정`(카카오 '검토 전')·공식 숫자·충족·미달 0, 기사 기획 캘린더의 기사 할당량도 `요건 미확정`·입력 칸 0(편집 책임자·기자), 내부 정의 숫자 = 손 계산, 3개월은 시작일 0시 포함·하루 전 제외(6개월에는 포함) |
| 확정 조건·공식/내부 정의 따로·확정 버전 그대로 (NAV-13·14) | `10b)` | 통과 — 원문·확인일·등록 유형 등 없는 버전 확정 422·DB도 거부(check 제약), 담당자 확인 표시 없이 422, 확정 → 공식 정의(규정 글자·심사 기간)와 내부 정의 따로, 60% 기준 미달 → 인력 보강·신청 연기 안내, 확정 버전 API 409·직접 SQL 고치기·지우기 거부, 2번(50%) 확정 → 1·2번 모두 남고 대시보드는 2번 '충족 (50%)'(이상 = 경계 포함), 할당량 '네이버 규정 1번 — 기사 수 기준이 없습니다', '인정'·'예상 점수' 0 |
| 코드·설정 기본값에 기준 상수 0 (NAV-13) | `10c)` | 통과 — 저장소 검사 `lib/readiness/no-criteria.test.ts`(5개)를 그대로 돌린다 |
| 인포그래픽 저장 불가·접힘·원본 비율·배지 (ART-07) | `2)` | 통과 — 대체 텍스트·표 없음 422(`body.blocks[7].alt`·`.data`, 새 버전 0), 블록 없는 형식 인포그래픽 발행 422 → 발행, 기본 접힘·Enter 펼침·번호 목록·원본 비율, 카드 '인포그래픽' |
| 동영상 nocookie·재생 전 요청 0·발행 조건·`video_played` (ART-08) | `3)` · `3b)` | 통과 — youtube.com·http·하위 도메인 속임·youtu.be·autoplay 저장 422, 요약·자막 미확인 → 자막만 → 4:3 → 발행(정리한 주소), 재생 전 유튜브·구글 요청 0 → 누르면 nocookie만, `video_played` 정확히 1건, `/news/video` 꺼짐 404 → 켬(형식 동영상만·요청 0) → 끔 404 |
| 포토 발행 조건·표기 줄·원본 비율 (ART-09) | `4)` | 통과 — 사진 0장·출처·이용 조건·대체 텍스트 하나씩 발행 422(그 사진 위치), 표기 줄 '촬영·출처·이용 조건', 가로·세로 사진 원본 비율, `/news/photo` 형식 포토만 |
| 제휴 프로필·같은 배지·`partner_content_viewed` · 비공개 뒤 배지 그대로 (ART-10) | `5)` · `5b)` | 통과 — 광고·협찬 담당이 쓴 공동 기획을 편집 책임자가 발행, 프로필에 그 제휴사 공개 기사만(광고는 '광고'), 상세 배지 = 카드 배지 → 프로필 화면 전환, 1건, 비공개 제휴사 404 / 운영 API로 비공개·계약 종료 → 허브 카드·상세·JSON-LD 제목·공유 제목 '공동 기획 ○○' 그대로, '광고' 0, 프로필 링크 0, 측정 0 |
| 칸 검사·`events` 0·`/api/health` 503 (FND-06) | `1)` | 통과 — 칸 = 설계 3장 14칸, 개인정보 모양 칸 0, 방문자 ID 칸이 있는 표 하나, 금지 속성 이름은 DB가 거부, `events` 관계 0·마이그레이션 검사(역검사로 잡는 것도 확인), DB에 닿지 않는 서버 `/api/health` 503 `failed: ["db"]` (`api-health-jobs`와 같은 판정) |
| 새 관리자 화면·API 권한 (PRD-01A 3장 · 9장 #29) | `11)` | 통과 — 편집국 역할 7종 + 관리자 × 화면 3: 측정 지표는 관리자만, 제휴 준비·규정 화면·규정 API는 편집 책임자·관리자만, 나머지 403(숫자 0)·메뉴 0·규정 API 403·새 버전 거부 감사 로그, 로그인 안 하면 로그인 화면·401 |
| 360px 가로 스크롤 0 | `12)` | 통과 — 관리자 화면 5(지표 2기간·대시보드 3·12개월·규정 폼 펼침) · 공개 화면 9(많이 본 기사·동영상·포토·제휴사·측정 거부·동영상·포토·인포그래픽 기사·사이드바 기사) |
| 접근성 95점 이상 | `13)` | 통과 — `/admin/metrics` 100 · `/admin/news-readiness` 100 · `/partners/[id]` 100 · 동영상·포토·인포그래픽 기사 100 · `/news/video`·`/news/photo` 100(아래 고침 전 98) |

**이 단계가 찾아 고친 제품 흠**

1. **편집국 쓰기 직후 공개 화면이 옛 값을 한 번 보일 때가 있었다** (W2-b 7.1 '쓰기는 바로 만료' 약속 위반 — 기능 키·기사·제휴사 등 공개 데이터 전부). 회귀 실행에서 `site-media f)`가 한 번 실패한 것(동영상 목록 기능 키를 끈 바로 뒤 `/news/video` 200)을 따라가 원인을 찾았다. Next.js 16.3은 태그 만료 시각을 벽시계(`Date.now()`)로 적고 읽을 때 단조 시계(`performance.timeOrigin + performance.now()`)와 비교하는데, 두 시계는 서버 프로세스마다 다르게 어긋난다 — 새 Node 프로세스 8개 중 4개에서 벽시계가 1~8ms 앞섰고(3분 띄운 프로세스는 10~13ms), 그런 서버에서 `{ expire: 0 }`이면 쓰기 직후 그 몇 ms 동안의 요청이 '만료'가 아니라 '낡음'으로 읽혀 옛 값을 그린다(Next.js의 실제 판정 모듈로 확인). 고침: 만료 시각을 어긋난 만큼 + 10ms 앞당겨 적는다(`lib/server/public/cache-policy.ts` `immediateExpiryProfile` · `cache.ts`). 시험 `cache-policy.test.ts`(어긋남 −14~+13ms × 흔들림 ±3ms 21경우 + Next.js 실제 태그 판정). 앞당긴 폭(수십 ms) 안에 막 저장된 응답만 '낡음'으로 남고 그것도 다음 요청이 뒤에서 새로 읽는다. Next.js를 올리면 이 시험이 판정 모듈이 바뀌었는지 알린다.
2. `/news/video`·`/news/photo`가 머리 제목(h1)에서 카드 제목(h3)으로 건너뛰어 Lighthouse 'heading-order'에 걸렸다(98점 — 95 기준은 넘었지만 화면 읽기 순서 흠). 목록 부분에 화면 읽기용 제목(h2 — '동영상 기사 목록'·'포토 기사 목록', `lib/site/media-view.ts` 글자 · `components/site/MediaListViews.tsx`)을 두었다. 보이는 화면은 그대로다(기사 상세 '본문' h2와 같은 방식). 시험 `13)`이 두 목록의 heading-order를 따로 본다.

**함께 고친 것** — `e2e/lib/a11y.mjs` `accessibility()`가 Lighthouse가 잰 주소(`finalUrl`)도 돌려준다. CI 2단계에 이 시험을 더했다.

**로컬에서 증명하지 못한 것**

- 배포 주소(E2E_BASE_URL)·Docker 이미지(E2E_TARGET=docker)로 같은 수용 E2E — standalone 빌드로만 돌렸다.
- Vercel Cron의 실제 1시간 일정(Hobby는 그 시간 안 아무 때 — 8.2) — 시험은 인증된 작업 경로를 직접 부른다.
- 진짜 30초 흐름과 탭 숨김 — 가짜 시계로 증명했다(숨기면 멈추는 것은 단위 시험 `engagement.test.ts`).
- 실제 검색 로봇·AI 수집기의 방문(User-Agent 판정만) · 실제 유튜브 플레이어(nocookie 응답을 빈 쪽으로 가로챘다 — 요청이 생기는지만 본다).
- 운영 트래픽에서 대시보드 계산 시간(세션 100,000개 상한 — 9장 #34).
- FND-06 '오류 발생 시 알림 1건' — 오류 추적 서비스 연결은 W2-c 범위 밖이다.
- 카카오톡 인앱 브라우저·실기기.

## 9. 결정·확인 필요

| # | 내용 | 지금 기본값 | 표시 |
|---|---|---|---|
| 1 | 측정 거부 방문의 이벤트 — GROW-01·PRD-00 13장·8.2 '첫 방문'은 "방문자 ID를 만들지 않고 이벤트 전송 0", 6.1 `visitor_id`는 "측정 거부 시 비움", ART-11은 "측정 거부 조회는 중복 제거 없이 센다" | 전송 0 · 서버도 저장 0(204) — 수용 기준(GROW-01·PRD-00 13장 E2E)을 따른다. 그래서 많이 본 기사에 거부 조회는 0이다. `visitor_id`는 비울 수 있는 칸으로 두어 PRD가 '방문자 ID 없이 센다'로 정하면 마이그레이션 없이 바꾼다 | [확인 필요 — PRD 문구 충돌] |
| 2 | 측정 허용으로 되돌린 방문자 | 새 방문자 ID·첫 방문으로 다시 센다. 거부 전 이벤트는 남는다(지우기 요청 경로는 처리방침과 함께) | [확인 필요] |
| 3 | DNT 신호 | 측정 거부로 보지 않는다(`respect_dnt=false`) — PRD는 측정 거부·GPC만 정했고 DNT는 폐기된 표준. 켜면 서버가 버린다 | [결정 안건 — 법률 검토] |
| 4 | 원본 이벤트 보존 기한 (13장 '이벤트 보존 기한') | 395일(13개월) 초안 — 지우는 배치는 2단계 | [결정 안건 — 처리방침과 함께] |
| 5 | 공통 속성 '단계'의 뜻 — PRD에 정의가 없다 | 서비스 단계(1~5, PRD 단계 표의 숫자). 지금 1 | [확인 필요] |
| 6 | 진입 경로 — PRD-00 13장 8종에 '그 밖의 사이트'가 없다(article_viewed "직접 등") · 리퍼러 목록 | `referral`을 더했다. AI 답변 엔진·네이버·검색 리퍼러 목록은 씨앗 값(2.5) — 편집국 확정 전. 다음 검색은 `search.daum.net`만(카페·블로그는 `referral`) | [확인 필요] |
| 7 | 측정 거부 화면 위치·문구 (13장 '첫 방문 측정 고지 문구') | `/about/measurement` · 쉬운 말 안내와 버튼. 바닥글 링크는 W2-e | [결정 안건 — 법률 검토] |
| 8 | 방문자 ID 유효 기간 (13장 초안 12개월) | 만들 때 365일 한 번 — 방문할 때마다 늘리지 않는다(12개월 뒤 새 ID) | [결정 안건] |
| 9 | 첫 방문 깔때기 '첫 방문' 칸의 분모 — PRD-01A 12장에 화면 열람 이벤트가 기사·허브뿐이라 홈에 들어와 아무것도 누르지 않은 첫 방문은 이벤트가 0이다 | 이벤트를 더하지 않는다(PRD 목록만). 3단계 대시보드가 '첫 방문 세션 = first_visit 이벤트가 있는 세션'으로 세고 이 한계를 정의 글자에 적는다 | [확인 필요 — 홈 열람 이벤트] |
| 10 | 하위 분야 목록(`/tax/interpretations` 등)의 `hub_viewed` — PRD-00 초안은 '하위 분야 열람' 포함, PRD-01A는 '분야 허브' | 허브 4곳만 보낸다. 속성 `category`는 자리만 | [확인 필요] |
| 11 | `brief_preregistered`의 '경로' | 신청한 화면 주소(`from_path`) | [확인 필요 — W2-e] |
| 12 | 회원 등급 값 이름 (PRD-00 6장 비회원·일반·프리미엄·기관 좌석) | `guest`·`basic`·`premium`·`institution` — 1단계는 모두 `guest` | [확인 필요 — W2-e] |
| 13 | 속도 제한 값 | 방문자 1분 120 · IP 1분 600(사무실 공유 IP 고려) — 설정값 | [확인 필요 — 운영 뒤 조정] |
| 14 | 30초 열람의 '화면에 머문' 시간 | 탭이 보이는 시간만 더한다(숨은 탭 0). 스크롤 위치는 보지 않는다 | [확인 필요] |
| 15 | 봇 판정 | User-Agent 조각 목록(설정) + 빈 User-Agent. 브라우저 자동화(`HeadlessChrome`)도 봇 — E2E가 사람으로 시험할 때는 보통 브라우저 User-Agent를 쓴다 | [결정] |
| 16 | 30분 중복 제거의 기준 (ART-11 '같은 방문자의 30분 안 반복 조회는 1회') | 마지막 조회(세지 않은 반복 포함)에서 30분 — 계속 새로고침하는 방문자는 1회. 첫 조회에서 30분마다 1회씩 세는 방식이 아니다. 정확히 30분 뒤는 다시 1회 | [확인 필요] |
| 17 | '상담 사례 분야'가 어느 하위 분야인가 — PRD-01A 3장은 `/tax/[분야]`(상담 사례 분야), 1단계 하위 경로(CAT-01)·씨앗(PRD-00 5.3)에는 상담 사례가 따로 없고 '해석'이 v1.2 상담 사례(해결 사례·HOT)를 받는다 | 지방세 › 해석(`/tax/interpretations`) 기사 전체로 HOT을 매긴다(코드 `HOT_CATEGORY` 한 곳). 상담 사례 하위 분야를 따로 만들면 그 값만 바꾼다 | [확인 필요 — PRD 문구 충돌] |
| 18 | 1시간 집계 일정 — Vercel Hobby는 하루 한 번 넘게 도는 일정 줄로 배포 실패 | 하루 한 번짜리 24줄(Hobby는 그 시간 안 아무 때, Pro·사내 스케줄러는 매시 5분). Pro(상업 서비스에 필요 — 인프라 개설 요청)로 바꾸면 한 줄로 줄여도 된다 | [결정 — PO 알림] |
| 19 | 편집자 고정 기사가 해결 사례이면 | 카드로 보내지 않고 HOT 목록 맨 앞(고정 표시) — 고정의 뜻이 'HOT 맨 앞'이라. 고정끼리는 점수·최신 순 | [확인 필요] |
| 20 | 점수 있는 해결 사례가 3건 미만일 때 카드 (HOME-05는 HOT 목록만 '최신으로 채운다') | 최신 해결 사례로 카드를 채운다(배지 없는 카드라 HOT 뜻과 섞이지 않는다). 해결 사례가 0건이면 카드 줄 0 | [확인 필요] |
| 21 | 공유·30초 열람의 중복 | 조회와 같은 30분 규칙 — 한 방문자가 공유 버튼을 여러 번 눌러 점수(가중치 5)를 올리지 못하게 | [확인 필요] |
| 22 | `article_stats` 보존 기한 (방문자 정보 없음) | 원본 이벤트와 같은 `analytics.retention_days`(395일) — 3단계 대시보드가 기사별 숫자를 1년 넘게 보려면 늘린다 | [결정 안건 — #4와 함께] |
| 23 | HOT 고정 대상·상한 | 상담 사례 분야 기사만(다른 기사 422), 상한 `hot_weights.max_pins`(씨앗 2 — 3번째 409). DB 트리거가 아니라 편집국 API가 막는다(상한이 설정값) | [결정] |
| 24 | 상담 사례 목록의 탭 [HOT]·[해결 사례]·[전체] (PRD-01A 3장) | 지금은 첫 쪽에 HOT 블록(카드 3 + HOT 5) + 그 아래 전체 목록. 탭 나누기는 01B TX-09 해석 화면과 함께 | [확인 필요] |
| 25 | `hot_article_clicked`를 무엇에 보낼까 | HOT 목록 5건 누름만(순위·고정 여부). 해결 사례 카드 누름은 보내지 않는다 — '순위'의 뜻이 섞이지 않게 | [확인 필요] |
| 26 | 많이 본 기사 목록 상자의 "최근 7일 기준" 글자 | 디자인 컴포넌트 글자(고정). 창 설정(`window_hours`)을 바꾸면 `/news/popular` 머리·집계 줄은 설정을 따르지만 상자 글자는 그대로 — 바꾸면 컴포넌트에 글자 칸을 더한다 | [확인 필요] |
| 27 | HOT 후보의 광고(`sponsored`) | 상담 사례 분야에 있으면 HOT 후보다(제외 설정은 많이 본 기사 `exclude_content_types`만) | [확인 필요] |
| 28 | '비공개로 바뀐 기사는 다음 집계에서 빠진다'(ART-11) | 더 빠르게 — 순위 표 공개 범위(RLS)가 바로 뺀다. 다음 집계가 표에서도 지운다 | [결정] |
| 29 | `/admin/metrics`를 누가 보나 — PRD-00 6장 표에 행이 없다 | 관리자만(`metrics.read`) — 같은 표의 수익 대시보드도 관리자만이고, 이 대시보드에 01C 전환·도우미 비용 지표가 모인다. 거부는 감사 대상 아님(읽기) | [확인 필요 — 편집 책임자에게 분야별 유효 방문만 열지] |
| 30 | 분야별 유효 방문의 '같은 분야'·순서 | 허브와 같은 분야 기사의 30초 열람만 분자. 같은 세션이면 순서는 보지 않는다(기사 → 허브도 유효) | [확인 필요] |
| 31 | 재방문 '30일 안'의 셈 | 한국 날짜로 — 처음 본 날 D0부터 D0+30일 날짜까지 포함(31일째 제외). 같은 날 다른 세션도 재방문. 분모는 기간 안의 분야 방문자(방문자 단위 — 여러 날 와도 한 명), 기준은 기간 안 첫 열람 | [확인 필요] |
| 32 | 깔때기의 순서·겹침과 문제해결률 | 깔때기는 칸이 차례로 좁아진다(② 안의 ③, ② 뒤 30초 열람, 그 뒤 다음 행동). 첫 방문 문제해결률은 ②를 거치지 않아도 센다(PRD-01A 12장 '첫 방문 세션 중 30초 + 다음 행동') | [확인 필요] |
| 33 | 깔때기 ③의 '상황 30초 이상' | 상황 페이지 열람 시간 이벤트가 PRD-01A 12장에 없어 기사 30초만 센다 | [확인 필요 — 이벤트 더할지] |
| 34 | 요청 때 계산과 일 단위 미리 계산(롤업) | 화면을 열 때마다 원본에서 센다(세션 100,000개 넘으면 '기간을 줄이세요'). 롤업 표는 두지 않았다 — 재방문율이 방문자 단위라 롤업이 방문자 ID를 다시 담게 된다. 운영 트래픽(하루 수천 세션)이 쌓이면 세션 단위 집계 함수로 바꾼다 | [결정 — 운영 전환 뒤 다시 본다] |
| 35 | '최근 N일'에 오늘이 드나 | 든다(오늘 포함 N일 — 오늘은 지금까지). 기준선 보고는 '전환 후 첫 4주'(전환일부터 28일)를 쓴다 | [확인 필요] |
| 36 | 전환일 설정 (`domain_cutover`) | 한국 날짜 하나, 그날 0시부터 운영. 값이 없거나 틀리면 모두 시험 기간 + 화면 알림. 관리자 설정 화면이 고친다(날짜를 바꾸면 버전도) | [결정 — PRD-01A 11장 '당일 settings에 전환일 기록'] |
| 37 | 깔때기 원본 이벤트 연결 | 3단계에 `next_action_clicked`(기사·상황 페이지 다음 행동 띠)·`situation_card_clicked`(허브 상황 카드)를 붙였다 — 없으면 ②·③이 늘 0. 검색은 검색 화면(W2-d) | [결정] |
| 38 | 세션이 기간 경계를 넘을 때 | 세션은 첫 이벤트가 든 구간에 속하고 그 세션의 이벤트는 모두 그 세션 것. 기간 앞 하루 안에 이벤트가 있는 세션은 앞 기간 세션이라 뺀다 | [결정] |
| 39 | 대시보드에 아직 두지 않은 것 | CSV 내려받기, 상황 카드 진입률(UX-05 보조 지표), 월간 문제해결 세션(북극성, PRD-00 1.4), 진입 경로별 나누기 — GROW-01이 이 화면에 모으라고 한 목록 밖이라 다음 작업에서 | [확인 필요] |
| 40 | 동영상 목록을 언제 여나 (PRD-01A 1.3 '동영상 채널 — 없으면 동영상 목록은 숨긴다' · 13장 결정 안건) | 기능 키 `video_list`(씨앗 false) — 꺼져 있으면 `/news/video` 404·링크 0. 동영상 기사 한 건 한 건의 발행은 막지 않는다(채널을 정하면 관리자가 설정 화면에서 켠다, 배포 없이) | [결정 안건 — 동영상 채널 운영] |
| 41 | ART-08 '요약 텍스트'가 무엇인가 | 동영상 블록의 요약 텍스트(영상 내용을 글로 — 접근성 '동영상 자막·요약')다. 기사 요약(60자)과 따로 쓴다. 목록 카드의 요약 줄은 기사 요약 | [확인 필요] |
| 42 | 동영상 조건을 어느 블록에 | 형식과 상관없이 모든 동영상 블록 — 요약·'자막 있음'·16:9 썸네일이 없으면 발행되지 않는다. 일반 기사 안의 동영상도 같은 '누르면 재생' 카드라서 | [확인 필요] |
| 43 | 썸네일 16:9를 어떻게 아나 | 이미지 기록의 가로·세로(`media.width`·`height` — 4단계에 더한 칸)로 판정, 1% 안이면 16:9. 크기가 기록되지 않았으면 발행 불가. 이미지 등록 화면(파일에서 크기 자동 기록)은 아직 없어 지금은 이미지 기록에 손으로 적는다 | [확인 필요 — 이미지 등록 화면] |
| 44 | 저장되는 유튜브 주소 | `www.youtube-nocookie.com/embed/<영상번호 11자>`만, 칸은 시작·끝 시각·자막 켜기(`start`·`end`·`cc_load_policy`)만. 재생목록·`youtube-nocookie.com`(www 없음)·짧은 주소는 받지 않는다 — 편집자가 '퍼가기'의 개인정보 보호 주소를 붙인다 | [확인 필요] |
| 45 | 인포그래픽 템플릿 3종의 뜻 | 그림을 그려 주는 틀이 아니라 같은 내용 칸의 틀(절차 흐름 = 번호 목록, 비교 = 머리 칸 '구분·비교 1·비교 2' 표, 핵심 숫자 = 머리 칸 '항목·숫자' 표). 그림은 편집국이 만들어 올린다. 그림 디자인 템플릿이 정해지면 그 파일을 같은 템플릿 값에 잇는다 | [확인 필요 — 템플릿 디자인] |
| 46 | 형식과 블록이 맞지 않는 기사 | 형식이 인포그래픽·동영상·포토인데 그 블록이 하나도 없으면 발행 불가(카드의 형식 배지가 빈 기사에 붙지 않게 — W2-b 카드뉴스 장 규칙과 같은 생각) | [결정] |
| 47 | 포토 기사의 '사진 묶음' | 형식이 포토인 기사의 이미지 블록 전부, 1장 이상. 최소 장수는 PRD에 없어 1장 | [확인 필요 — 최소 장수] |
| 48 | 포토 기사 사진의 표기 줄 (ART-09 '사진마다 저작권·촬영자') | '촬영 ○ · 출처 ○ · 이용 조건 ○'(이미지 기록). 포토가 아닌 기사의 그림은 W2-b대로 '사진·그림 ○'(출처) | [확인 필요 — 문구] |
| 49 | 제휴사 프로필 공개 범위·계약 종료 | 공개(`visible`) 제휴사만, 계약이 끝나도 공개로 두면 프로필과 기존 기사(배지 그대로 — ART-10 '기존 기사 배지는 남는다')가 보인다. 계약 기간은 비공개 칸이라 화면에 없다. 로고는 보이지 않는다(로고 이미지 공개 정책 밖 · 1.3 '제휴사 이름·로고 사용 동의') | [확인 필요] |
| 50 | 제휴사 프로필의 기사 목록 | 그 제휴사가 지정된 공개 기사 전부 — 공동 기획(제휴 배지)과 광고(유형 배지 '광고'). PRD 3장은 '공동 기획 기사 카드 목록' | [확인 필요 — 광고 기사를 뺄지] |
| 51 | `partner_content_viewed`를 언제 | 공개 제휴사가 지정된 기사(공동 기획·광고)를 열 때 1건, 분야를 함께 | [확인 필요] |
| 52 | 비공개로 내린 제휴사의 공동 기획 기사 | **5단계에서 고쳤다** — 전에는 제휴사 이름을 읽지 못해 상세·카드의 배지가 유형 배지 '광고'로 보였다. 이제 기사가 배지 이름(`articles.partner_badge_name`)을 들고 있어 제휴사를 비공개·계약 종료로 바꿔도 카드·상세·JSON-LD·공유 제목이 '공동 기획 ○○' 그대로다(W2-a 4-2 '이미 붙은 배지는 남는다'). 프로필 링크·제휴 콘텐츠 측정은 공개 제휴사만(8.5) | [결정 — 해소] |
| 53 | 동영상 기사의 공유 이미지·구조화 데이터 | 공유 이미지 = 첫 동영상 썸네일(SEO-03), 없으면 대표 이미지. JSON-LD `VideoObject`는 W7(생성기는 있다) | [W7] |
| 54 | 동영상·포토 목록·제휴사 프로필로 가는 메뉴 링크 | 아직 0 — PRD 메뉴 표에 자리가 없다(제휴사는 기사 상세의 제휴 배지에서 간다) | [확인 필요 — 메뉴 위치] |
| 55 | 공개 그림의 크기 칸 | `media.width`·`height`를 anon 칸 권한에 더했다(공개된 그림 파일에서 누구나 아는 값). 행 범위는 그대로 — 공개 기사의 권리 확인 그림만 | [결정] |
| 56 | 기사 생산·제휴 준비 화면 경로 — 작업 지시는 `/admin/news-partner`, PRD-01A 3장 백오피스 표·화면 그림·E4 여정은 `/admin/news-readiness` | PRD 경로 `/admin/news-readiness`(대시보드)·`/admin/news-readiness/requirements`(규정 버전), 메뉴 '제휴 준비'. E2E 파일 이름만 `admin-news-partner` | [확인 필요 — 경로] |
| 57 | 규정 버전의 '담당자 승인'을 누가 — 작성자와 다른 사람이어야 하나 | 편집 책임자·관리자 누구나, 작성자와 같아도 된다(PRD에 두 사람 규칙 없음 — 기사 발행 승인과 다르다). 대신 승인 때 '원문과 실제 등록 유형을 확인했다' 표시 필수, 승인자·시각·감사 로그 | [확인 필요] |
| 58 | 규정 버전 표의 칸 범위 (PRD-01A 6.1 · 6.2 '이 문서가 표를 확장한다') | NAV-13·14가 쓰는 칸만(원문·확인일·적용 기간·등록 유형·심사 대상 기간·요건·승인). 접수 주기·다음 접수 목표·합격선·평가 대상 기간 정의(임의 3개월)·유사도·기고자 합산·부정평가 규칙 칸은 NAV-16·18·19·20·24(W7)가 마이그레이션으로 더한다 — 쓰지 않는 칸을 미리 두지 않았다 | [결정] |
| 59 | 월 마감 행 `partner_readiness_monthly` | 이번에 만들지 않았다 — NAV-14 대시보드는 화면을 열 때 원본 표에서 센다(기사 수가 적고, 규정 버전이 바뀌면 공식 정의 숫자도 바로 바뀌어야 한다). 마감 행·임의 3개월 조합·재계산 새 버전은 NAV-17 월 마감 배치(W7)가 표와 함께 만든다 | [결정 — W7] |
| 60 | '3·6·12개월'을 어떻게 잡나 | 한국 달력의 완결된 달(이번 달 제외 — 3개월 = 석 달 전 1일 ~ 지난달 끝날). 설정 `news_readiness_windows.basis`를 `including_current`로 바꾸면 이번 달 오늘까지 넣는다. 공식 정의의 비교 칸은 규정 버전의 심사 대상 기간을 따른다 | [확인 필요] |
| 61 | 대시보드가 세는 기사 | 지금 공개 중이고 그 기간에 처음 발행된 기사. 보류·삭제로 내린 기사와 이관(옛 사이트) 기사는 내부 정의에서 빼고 수만 따로 보인다. 공식 정의는 요건 거르개가 '이관 포함'일 때만 이관 기사를 넣는다 | [확인 필요] |
| 62 | 내부 정의 '자체 취재 후보' | 유형이 보도(`reported_news`)인 기사 — 발행 판정이 취재 근거·편집 승인을 요구하는 유형. 해설·가이드는 넣지 않는다. 네이버의 자체 생산 기사 기준과 같다고 보이지 않는다(화면 글자) | [확인 필요] |
| 63 | '기획·심층 기사' | 기사 기획 종류가 기획·탐사(`feature`·`investigative`)인 기획에서 나온 기사 — 기사 칸에 '심층' 표시가 따로 없어 기획 종류로 센다(NAV-21과 같은 값) | [확인 필요] |
| 64 | 근거·권리·감수 누락의 뜻 | 근거 = 자체 취재 후보 가운데 확인된 비공개 취재 근거 0 · 권리 = 권리 확인이 안 된 이미지(대표·본문·동영상 썸네일)나 권리 '미확인' 취재 근거가 있는 기사 · 편집 승인 = 최근 편집 승인 기록이 승인이 아님 · 세무 감수 = 감수 대상인데 감수 승인 없음. 발행 판정이 막으므로 보통 0이고, 직접 넣은 행·이관 자료를 찾는 칸이다 | [확인 필요] |
| 65 | 정정·반론을 어느 기간에 넣나 | 정정 기록을 결정한 시각이 그 기간 안이면(어느 기사의 정정이든). 정정·반론·추후보도 3종, 삭제·제목 변경은 넣지 않는다. 기사별 추적 표는 그 기사의 모든 정정 기록 수 | [확인 필요] |
| 66 | '기사 유사도 사전 경고'로 무엇을 세나 | 그 기간 발행 점검(`seo_checks`)에서 유사 문장 기준을 넘은 원고 수(발행되지 않은 원고 포함) + 비교 원문이 없거나 점검 기록이 없어 유사도를 확인하지 못한 발행 기사 수. 화면 이름은 '중복·표절 검토용 경고' — 네이버 심사와 관계없는 내부 점검 | [확인 필요] |
| 67 | 독자 반응 | 그 기간에 발행한 기사가 지금까지 받은 사람 조회·30초 이상 열람·공유(`article_stats` 사람 값 — 봇·편집국 제외, 1시간 집계). 기간 안 반응만 보는 방식이 아니다 | [확인 필요] |
| 68 | 공식 요건의 계산과 비교 | 계산 3종(기사 수·비율·기자 1인당 — 그 기사를 쓴 기자 수로 나눔). 기준 비교는 그 버전의 심사 대상 기간 칸 하나에서만, 월평균은 달 수로 나눔, 값이 없으면(분모 0) 미달. '매달 각각 N건' 같은 기준은 아직 적을 수 없다 — 원문에 있으면 계산 종류를 더한다 | [확인 필요 — 원문 실사 후] |
| 69 | 인력 보강·신청 연기 안내(NAV-13 '요건이 현재 인력으로 불가능하면')를 언제 | 확정 버전의 기준 비교에 미달이 하나라도 있으면 — '지금 생산량으로는 못 채운다'를 '현재 인력으로 불가능'의 대리 판단으로 쓴다. 인력 수 자체는 보지 않는다 | [확인 필요] |
| 70 | '실제 등록 유형 확인' (NAV-13 '공식 규정과 실제 등록 유형을 확인하기 전 요건 미확정') | 규정 버전의 등록 유형 칸 + 확정 때 담당자의 '실제 등록 유형을 확인했다' 표시로 본다. NAV-01 실사 기록(`news_partner_checks` registration)과 자동 대조는 하지 않는다 — 실사 화면이 생기면 대조를 더한다 | [확인 필요] |
| 71 | `news_partner_checks` | 표·규칙만 만들었다(PRD 6.1 칸 · 추가만 · 확인은 근거 위치 필수 · 부정평가 위험은 점수·날짜 필수). 실사 체크리스트·모의 점검·부정평가 기록 화면은 NAV-01·07·20이 단다 | [결정] |
| 72 | 기자별 취재 부담의 '기자' | 기사 작성자(`author_id`)별 발행 수와 그 사람이 지금 맡은 기획(배정·취재·사실 확인·검토 중) 수. 외부 필자도 보인다(구분 '외부 필자') | [확인 필요] |
| 73 | 승인자 이름 표시 | 편집국 인물 이름(`people.staff_user_id`), 인물이 없는 관리자 계정은 '계정 앞 8자리' — 이메일은 보이지 않는다 | [결정] |
| 74 | 공동 기획 배지 이름과 제휴사 이름 변경 | 기사가 들고 있는 배지 이름은 제휴사 이름을 고치면 같이 바뀐다(프로필·카드·상세가 같은 글자). 제휴사를 지워야 할 때는 그 공동 기획 기사의 처리(표기 바꾸기·내리기)를 먼저 정한다 — 제휴사 행은 지금도 기사가 가리키면 지울 수 없다(외래 키) | [결정] |
