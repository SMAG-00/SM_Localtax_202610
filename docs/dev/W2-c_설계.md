# W2-c 측정·많이 본 기사·형식 콘텐츠·기사 생산 대시보드 — 설계 약속 (개발 문서)

PRD-01A 9장 W2-c(분석 이벤트·첫 방문·지표 대시보드, 많이 본 기사·HOT 집계, 인포그래픽·동영상·포토·제휴 콘텐츠, 기사 생산 대시보드)를 구현할 때 DB(packages/db)·수집 API(apps/web/app/api/events)·브라우저 도우미(apps/web/lib/analytics)·집계 배치·대시보드가 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항 원문은 PRD-01A 4장(FND-06 · GROW-01 · ART-07 · ART-08 · ART-09 · ART-10 · ART-11 · HOME-05 · NAV-13 · NAV-14)·6장 데이터·8.2 시험·12장 측정·13장 결정 안건, PRD-00 13장 측정 공통·6장 회원 등급, PRD_최종 §3.3·§10이다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다. W2-a·W2-b에서 정한 것(값 목록·권한·공개 읽기)은 `docs/dev/W2-a_설계.md`·`docs/dev/W2-b_설계.md`를 그대로 따른다.

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 측정 기반 | `analytics_events`·`article_stats` 마이그레이션·RLS·수집 설정 씨앗, 익명 방문자 ID·세션·측정 거부(GPC), 수집 API `POST /api/events`(검사·크기·같은 사이트·속도 제한·봇 표시·첫 방문), 측정 거부 화면·API, 브라우저 도우미와 시범 연결(기사 상세·허브·홈 분야 카드) | DB 시험(칸 검사 — 개인정보 칸 0·`events` 표 0)·RLS 검증·단위 시험(29분·30분·31분 세션 경계, 29초·30초 열람)·E2E `analytics-api`(거부·GPC 전송 0, 봇 표시, 4xx 저장 0, 429) |
| 2 집계·많이 본 기사·HOT | 1시간 배치 `/api/jobs/popular-hourly`(→ `article_stats`, 멱등), 많이 본 기사(사이드바 5·`/news/popular` 20), 상담 사례 HOT(지방세 허브·상담 사례 목록 — 카드 3 + HOT 5), 원본 이벤트 보존 기한 정리 | 봇 100회 + 사람 3회 < 사람 5회, 168시간·169시간 경계, 30분 안 반복 1회, 비공개 전환 제외, 고정 최대 2건·동점 최신 앞, 가중치 설정 변경 → 다음 집계 순위 변화 |
| 3 지표 대시보드 | `/admin/metrics` — GROW-01 분야별 유효 방문·재방문율·첫 방문 깔때기, 다른 문서 지표 자리(`수집 전`), 시험 기간 분리(전환일 설정) | 지방세 허브 → 기사 29초 0·30초 1, 재방문 30일 포함·31일 제외, 새 브라우저 시나리오 깔때기 세 칸 +1, 편집자·봇 제외 |
| 4 형식·제휴 콘텐츠 | 인포그래픽 블록(ART-07)·동영상 기사와 `/news/video`(ART-08)·포토 기사와 `/news/photo`(ART-09)·제휴사 프로필 `/partners/[id]`(ART-10) | 저장 불가 조건, 재생 전 유튜브 요청 0, `video_played`·`partner_content_viewed` 1건 |
| 5 기사 생산·제휴 준비 대시보드 | 규정 버전 `news_partner_requirements`·점검 `news_partner_checks`·월 행 `partner_readiness_monthly`, 3·6·12개월 대시보드(NAV-13·14) | 확정 버전 없으면 `요건 미확정`, 시작일 하루 전 제외·시작일 포함, '인정'·'예상 점수' 0, 코드·설정 기본값에 기준 상수 0 |
| 6 수용 E2E | PRD-01A 9장 W2-c 증거 전부 | 봇 제외·168시간 경계, 유효 방문 29초·30초, 규정 미확정 시 `요건 미확정` |

단계마다 시험 통과 → 커밋 → push → CI 확인 → 보고 (작업 단위 규칙). 이 문서의 1단계 밖 내용(2~6단계)은 순서와 약속만 적었고, 그 단계에서 고친다.

## 2. 값 목록

### 2.1 DB check 제약 값 (TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| analytics_events.name (이벤트 이름 — PRD-01A 12장 19종) | `home_entry_clicked` · `hub_viewed` · `article_viewed` · `article_engaged` · `article_shared` · `search_submitted` · `glossary_opened` · `situation_card_clicked` · `next_action_clicked` · `hot_article_clicked` · `popular_article_clicked` · `video_played` · `partner_content_viewed` · `signup_completed` · `brief_preregistered` · `inquiry_submitted` · `policy_page_viewed` · `redirect_hit` · `not_found_viewed` |
| analytics_events.mode (모드 — PRD-00 13장 일반·전문가) | `general` · `expert` |
| analytics_events.tier (회원 등급 — PRD-00 6장 비회원·일반·프리미엄·기관 좌석) | `guest` · `basic` · `premium` · `institution` |
| analytics_events.entry (진입 경로 — PRD-00 13장) | `search` · `ai_answer_engine` · `naver` · `brief` · `assistant` · `experts` · `tax_lens` · `direct` · `referral` |
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

속성 값의 모양 — 번호(`article_id`·`term_id`·`partner_id`)는 1 이상 정수, 개수(`query_length` 0~200 · `result_count` 0~10000 · `result_type_count` 0~20 · `interest_count`·`region_count` 0~20), 순위(`rank`) 1~100, 참·거짓(`region_classified`·`pinned`), `situation`·`category`는 slug(영문 소문자·숫자·`-`, 100자 이하), 주소(`from_path`·`to_path`·`path`)는 `/`로 시작하는 경로만(쿼리·조각 없음, 200자 이하, 풀어 읽은 글자에 이메일·전화·주민등록번호 모양 0), 나머지는 아래 2.3 목록 값이다. `format`·`content_type`은 W2-a 값 목록(`general` … · `reported_news` …), `action`은 W2-b 2.3 `next_action` 키다. 검색어 원문·질문 원문·계산 입력값·이메일·주소를 담을 칸은 어느 이벤트에도 없다.

### 2.3 속성 값 목록 (TypeScript 상수가 같은 값을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| article_shared.channel (공유 채널) | `native_share` · `copy_link` |
| situation_card_clicked.position (상황 카드 위치) | `hub` · `search_empty` |
| next_action_clicked.screen (화면) | `article` · `situation` |
| popular_article_clicked.position (위치) | `sidebar` · `list` |
| policy_page_viewed.policy (정책 종류) | `editorial_policy` · `ethics` · `corrections` · `ad_policy` · `privacy` |
| inquiry_submitted.kind (문의 종류 — W2-a inquiries.kind) | `tip` · `subscription` · `advertising` · `reader_submission` · `correction` · `product` · `assistant_report` |
| hub_viewed.topic (지자체뉴스 편집 분야 — W2-a editorial_field) | `local_tax` · `realestate` · `local_finance` · `urban_policy` |
| client.entry (브라우저가 정해 보내도 되는 진입 경로 — 사이트 안 출발점) | `assistant` · `experts` · `tax_lens` |
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
| `/news/video` · `/news/photo` · `/partners/[id]` | 4단계 | 4 |
| `/admin/metrics` · 기사 생산·제휴 준비 대시보드 | 3·5단계 | 3·5 |

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
