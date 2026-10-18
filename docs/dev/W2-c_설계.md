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

값마다 `version`이 있고, 내용을 바꾸면 버전도 바꿔야 한다(W2-a 사전·유사도 기준과 같은 규칙). 수집 API는 `analytics`·`bot_user_agents`·`analytics_referrers`를 60초까지 서버 메모리에 두고 읽는다(바꾸면 늦어도 1분 뒤 적용). `hot_weights`·`popular_rules`는 2단계 집계 배치가 읽는다 — 가중치·기간·중복 제거 창은 코드 상수 0 (HOME-05·ART-11).

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

## 3. DB가 직접 막는 것 (직접 SQL로도 깨지지 않아야 하는 규칙)

마이그레이션 `20261018000014_w2c_analytics.sql`, 시험 `packages/db/tests/w2c-analytics.test.mjs`.

- `analytics_events` — 칸은 PRD-01A 6.1 그대로 14개다: `id` · `name` · `occurred_at` · `session_id` · `visitor_id` · `first_visit` · `stage` · `mode` · `tier` · `entry` · `section` · `props` · `is_bot` · `is_staff`.
  - 개인정보·질문 원문·IP·User-Agent 원문·좌표·상세 주소·계산 입력값·검색어 원문·회원 ID 칸이 없다 (FND-06 · GROW-01 스키마 검사 — 시험이 `information_schema`를 읽어 칸 이름 목록이 위와 정확히 같은지, 금지 모양 이름(`ip`·`user_agent`·`email`·`address`·`lat`·`query`·`user_id` 등)이 없는지 본다).
  - `visitor_id`·`session_id`는 `uuid` 형식만 들어간다 — 무작위 값 말고 다른 글자를 넣을 칸이 아니다. `visitor_id`는 비울 수 있다(PRD "측정 거부 시 비움" — 9장 #1), `session_id`는 필수.
  - 이름·모드·회원 등급·진입 경로·분야는 2.1 목록 밖 거부. 단계 1~5 밖 거부.
  - `props`는 JSON 객체, 값은 글자·숫자·참거짓만(객체·배열 0), 글자로 2,048바이트 이하, 금지 이름(`ip`·`user_agent`·`email`·`phone`·`address`·`lat`·`lng`·`query`·`question`·`input`·`user_id` 등) 칸 거부 — 수집 API가 막지 못해도 DB가 막는다.
  - 서버 시각(`occurred_at` 기본값 `now()`·수집 API가 서버 시계로 적는다). 브라우저가 보낸 시각은 받지 않는다.
- `article_stats` (2단계 배치가 채운다) — `(article_id, hour)` 기본 키 · `hour`는 UTC 정시(분·초 0)만 · `views_all`(모든 조회)·`views_human`(봇·편집자·측정 거부 제외, 30분 중복 제거)·`shares`·`engaged_views`(사람만, 30초 이상) 0 이상 · `views_human ≤ views_all` · 기사를 지우면 함께 지워진다.
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

- 공개 데이터를 읽지 못한 닫힌 허브·`UNAVAILABLE` 기사는 보내지 않는다.

## 7. 공개 경로 (이 작업이 만든다)

| 경로 | 화면·응답 | 단계 |
|---|---|---|
| `POST /api/events` | 수집 API (5장) | 1 |
| `POST /api/measurement` | 측정 거부·허용 (5.1) | 1 |
| `/about/measurement` | 측정 거부 화면 (5.1) — 링크는 W2-e 바닥글 | 1 |
| `/news/popular` · `/news/video` · `/news/photo` · `/partners/[id]` | 2·4단계 | 2·4 |
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
