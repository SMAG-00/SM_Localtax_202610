# W2-b 공개 사이트 골격 — 설계 약속 (개발 문서)

PRD-01A 9장 W2-b(홈 골격·히어로·메뉴·4대 분야 허브 공통 골격·`뉴스 전체`·상황 페이지·기사 상세·다음 행동 띠·카드뉴스·칼럼 연재, 서버 렌더링·화면 전환·모바일)를 구현할 때 DB(packages/db)·공개 데이터 함수(apps/web/lib/server/public)·홈 배치 백오피스·공개 화면이 같은 이름과 값을 쓰도록 정한 약속이다. 요구사항 원문은 PRD-01A 4장(HOME-01~04 · UX-05 · UX-06 · CAT-02 · CAT-03 · ART-02~04 · ART-06 · FND-09)·3장 화면 표·6장 데이터, PRD-01B CORE-01·CORE-02·TX-07·TX-08·REG1-01·LG-01·LG-08·FAM-02, PRD-00 5.3·6장·8장, PRD_최종 §4.1·§4.2다. 이 문서와 PRD가 다르면 PRD가 맞고, 이 문서를 고친다. W2-a에서 정한 것(값 목록·발행 판정·권한)은 `docs/dev/W2-a_설계.md`를 그대로 따른다.

## 1. 진행 순서와 커밋

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| 1 데이터·공개 읽기 | 마이그레이션(행정구역·상황·홈 배치·공개 읽기 정책·공개 설정)·공개 데이터 함수·홈 배치 API와 화면 | DB 시험(로컬)·RLS 검증·순수 함수 시험·홈 배치 API E2E 통과 |
| 2 공통 틀·홈·메뉴 | 공개 레이아웃(헤더 상단 4·유틸 메뉴·바닥글)·히어로·홈 섹션·화면 전환(App Router 링크) | 홈 섹션 순서 E2E(DOM·화면 위치), 첫 화면 R1·R2, 사이트 안 이동 새로고침 0, 숨긴 메뉴 링크 0 |
| 3 허브·뉴스 전체·상황 | 4대 분야 허브 공통 골격·하위 분야 목록·`/news`·상황 페이지·상황 카드 CMS(백오피스) | 네 허브 DOM 골격 같음, 빈 하위 분야 `noindex`, '먼저 확인할 것' 2·3·4개 경계, 허브 5번째 카드 거부 |
| 4 기사 상세·카드뉴스·칼럼·기자 | `/news/[slug]`(블록 순서·정정 이력·「지방세로 읽기」 자리·기자 소개·다음 행동 띠)·카드뉴스 슬라이드·칼럼 목록·`/people/[slug]` | ART-02 수용 기준(배지 글자·박스 자리·정정 블록 0/1)·ART-06(자기 자신 0·버튼 2개 이하)·카드뉴스 5~7장 |
| 5 수용 E2E | PRD-01A 9장 W2-b 증거 전부 | 홈 섹션 순서 E2E · 홈·상황·기사 화면 규칙 통과 · 사이트 안 이동 새로고침 0 · 숨긴 메뉴·v1.2 경로 링크 0 |

단계마다 시험 통과 → 커밋 → push → CI 확인 → 보고 (작업 단위 규칙). 공개 화면(2~5단계)은 1단계의 데이터 함수만 부른다 — 화면 코드가 DB를 직접 읽지 않는다.

## 2. 값 목록

### 2.1 DB check 제약 값 (TypeScript 타입이 같은 값을 쓴다)

| 이름 | 값 |
|---|---|
| situations.section (상황 분야, UX-05) | `tax` · `realestate` · `finance` · `local` |
| home_curations.kind (홈 배치 종류, HOME-03) | `tracker`(개정 트래커 하이라이트) · `story`(해설 스토리) |
| regions.level (행정구역 단계, REG1-01) | `sido`(시·도) · `sigungu`(시·군·구) |

### 2.2 예약 이름 (DB가 거부한다)

| 이름 | 값 |
|---|---|
| regions.slug (REG1-01 — `/local/events`·`/local/[sido]/weekly`와 PRD-X 후보 경로) | `events` · `weekly` · `places` · `festivals` · `food` · `life` |

### 2.3 공개 설정 키와 기능 키 (TypeScript 상수가 같은 목록을 쓴다 — 시험이 이 표를 읽는다)

| 이름 | 값 |
|---|---|
| settings.public_keys (anon이 읽는 설정 키 — 마지막 키는 W2-c 2단계가 더했다: 많이 본 기사 사이드바·목록 건수) | `home_core_message` · `home_search_chips` · `hub_intros` · `amendment_confirmed_stage` · `hub_situation_limit` · `feature_flags` · `next_action_priority` · `popular_rules` |
| feature_flags (기능 공개 목록 — 없거나 false면 닫힘, `video_list`·`glossary`는 W2-c 4단계(동영상 목록)·W2-d 3단계(용어사전)가, 끝의 다섯 키는 W2-e 1단계(이용약관·이메일무단수집거부·광고·제휴 안내 페이지·회원·브리핑 사전 알림)가 더했다) | `calc` · `experts` · `store` · `edu` · `search` · `sm_calculator` · `expert_finder` · `self_calculator` · `taxbot` · `region_hubs` · `amendments` · `page_about` · `page_editorial_policy` · `page_ethics` · `page_corrections` · `page_ad_policy` · `page_privacy` · `page_help` · `video_list` · `glossary` · `page_terms` · `page_no_email` · `page_advertise` · `members` · `brief` |
| next_action (다음 행동 버튼 키, ART-06) | `situation` · `same_section` · `local_news` · `sm_calculator` · `expert_finder` · `self_calculator` · `taxbot` |
| home_sections (홈 섹션 순서 고정, HOME-01) | `hero` · `fields` · `latest_reports` · `weekly_hot` · `amendments` · `column` · `product` · `experts` |
| policy_links (기사 하단 정책 링크 7종 순서, ART-02) | `about` · `editorial_policy` · `ethics` · `corrections` · `ad_policy` · `privacy` · `help` |

- 기능 키의 화면 이름·주소: 유틸 메뉴 `calc` 계산기 `/calc` · `experts` 전문가 소개 `/experts` · `store` 구독·도서 `/store` · `edu` 교육 `/edu` · `search` 검색 `/search` (HOME-02 순서). `sm_calculator` SM 계산기 카드(01B TX-01) · `expert_finder` [전문가 찾기](01C EXPL-06) · `self_calculator` 자체 계산기(2단계) · `taxbot` 지방세봇 모드(4단계) · `region_hubs` 시·도·시·군·구 지자체 허브 `/local/[sido](/[sigungu])`(01B W4) · `amendments` 개정 트래커 페이지 `/tax/amendments/[slug]`(01B W3 — 홈 트래커 카드·개정 브리핑 배지의 트래커 링크. `/tax/amendments` 자체는 3단계부터 하위 분야 목록 — 9장 #28) · `page_*` 정책 페이지(HELP-05 — 법률 검토 승인 기록 뒤 켠다, W2-e) · `video_list` 동영상 목록 `/news/video`(W2-c 4단계 — 동영상 채널 결정 전에는 꺼 둔다, PRD-01A 1.3. 꺼져 있으면 404·링크 0) · `glossary` 용어사전 `/glossary`·`/glossary/[번호]`(W2-d 3단계 — 꺼져 있으면 404, 검색 결과·용어 칩·본문 툴팁의 용어사전 링크 0. W2-d 설계 2.5).
- 정책 링크 주소: 회사 소개 `/about` · 편집 원칙 `/about/editorial-policy` · 윤리강령 `/about/ethics` · 정정·반론 창구 `/about/corrections` · 광고 정책 `/about/ad-policy` · 개인정보처리방침 `/about/privacy` · 고객센터 `/help/report` [확인 필요 — 3장 화면 표에 고객센터 첫 화면 경로가 없어 첫 폼(기사 제보)으로 둔다].
- 다음 행동 버튼 글자: `situation` 이 상황 모아 보기 · `same_section` 같은 분야 더 보기 · `local_news` 이 지역 뉴스 더 보기 · `sm_calculator` SM 계산기로 계산하기(새 창) · `expert_finder` 전문가 찾기 · `self_calculator` 계산해 보기 · `taxbot` 지방세봇에게 묻기. 우선순위는 `settings.next_action_priority`(씨앗 = 위 순서 — ART-06 본문에 적힌 순서).

### 2.4 공개 설정 씨앗 값

| 키 | 씨앗 값 | 근거 |
|---|---|---|
| `home_core_message` | "부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다" | HOME-01 · CORE-02 (문구 원문) |
| `home_search_chips` | `[]` — 칩 줄 숨김 | HOME-01 "편집자가 지정한 3~6개, 0개면 숨김" — 편집자 지정 전 |
| `hub_intros` | `{}` — 허브 한 줄 소개 없음 | CAT-02 허브 머리의 한 줄 소개 — 문구는 편집국이 쓴다 |
| `hub_situation_limit` | `4` | UX-05 초기값 |
| `feature_flags` | 모든 키 `false` | HOME-02·ART-06·HELP-05 — 공개 승인 전에는 링크 요소 0 |
| `next_action_priority` | 2.3 `next_action` 순서 | ART-06 |
| `amendment_confirmed_stage` | `promulgated` (W2-a) | TX-08 |

값 모양 검사는 `apps/web/lib/admin/settings-rules.ts`가 한다(관리자 설정 화면). 공개 함수는 모양이 틀린 값을 닫힌 쪽(숨김·기본값)으로 읽는다 — 추천 검색어가 1~2개 또는 7개 이상이면 칩 줄을 숨긴다.

## 3. DB가 직접 막는 것 (직접 SQL로도 깨지지 않아야 하는 규칙)

- 새 표 모두 RLS 기본 거부. 공개 읽기는 4장 정책으로만. service_role은 모든 표에 읽기·쓰기 권한(관리자 전권 — `packages/db/tests/admin-rights.test.mjs`).
- `regions` (REG1-01)
  - 코드는 법정동코드 10자리 숫자. 시·도는 뒤 8자리가 0, 시·군·구는 앞 2자리가 부모(시·도)와 같다.
  - 단계 2종 밖 거부. 시·도는 부모가 없고, 시·군·구의 부모는 시·도다(없는 부모 거부 — 외래 키).
  - 자기 자신이나 자기 하위를 부모로 둔 행은 거부(트리거 — 조상 사슬을 따라가 자기 코드를 만나면 거부). 하위가 있는 행의 단계를 바꾸면 거부.
  - `(parent_code, slug)` unique — 시·도끼리도(부모 null끼리) 겹치지 않는다(`nulls not distinct`).
  - slug는 영문 소문자·숫자·`-`, 2.2 예약 이름 거부. `valid_to ≥ valid_from`.
  - 기사가 쓰는 코드의 행은 지울 수 없다 — 폐지는 `valid_to`로 한다.
- `articles.region_codes` (CAT-03) — 없는 코드는 거부. 새로 단 코드는 오늘(한국 날짜) 유효해야 한다 — 폐지된 코드(`valid_to`가 지남)·시작 전 코드 거부. 이미 단 코드는 나중에 폐지돼도 남는다.
- `situations` (UX-05 · FAM-02)
  - `section` 필수·4종. slug 형식(영문 소문자·숫자·`-`). 예약 이름은 없다 — `/situations/` 아래 목록 경로가 PRD에 없다 [확인 필요].
  - `checks`(먼저 확인할 것)는 배열이고 3개 이하, 항목마다 제목(`title`) 글자 필수. **공개(`visible`)면 정확히 3개**이고 세무 감수 기록(`reviewer_id`·`reviewed_at`)이 있어야 한다 (PRD-01A 1.3 '상황 카드 먼저 확인할 것' 감수 대상, FAM-02 '감수 승인 뒤 공개').
  - 감수 대상 칸(`checks`·`checklist`·`mistakes`)을 고치면서 감수 기록을 새로 넣지 않으면 감수 기록이 지워진다 — 공개 행은 다시 감수하거나 내려야 저장된다.
  - `checklist`(FAM-02 일반적 체크리스트)는 null 또는 `{ items: 글자 1개 이상, notice: 고지 글자 }`. `mistakes`(자주 틀리는 점)는 3개 이하·빈 글자 없음. `tool_links`는 `{ feature }` 객체 배열.
  - `hub_slot`(허브 상황 카드 줄의 자리)은 1 이상 허브 상한(`settings.hub_situation_limit`, 없거나 틀리면 4) 이하, 같은 분야에서 같은 자리 중복 거부 → 상한 4에서 5번째 지정은 거부된다. 허브에 내지 않는 상황(`hub_slot` 없음)의 공개는 막지 않는다.
- `home_curations` (HOME-03)
  - 종류 2종. `tracker`는 개정안(`amendment_id`)만, `story`는 기사(`article_id`)만 가리킨다(둘 다·둘 다 없음 거부).
  - 노출 기간은 한국 날짜 `starts_on`~`ends_on`(그날까지, 비면 끝 없음). `ends_on ≥ starts_on`.
  - **같은 날 보이는 카드 수** — `tracker` 3장, `story` 6장을 넘기는 지정은 거부(기간이 겹치는 날 기준 — 끝난 카드·아직 시작 안 한 카드는 겹치지 않으면 세지 않는다). 7장째 스토리 카드 거부.
  - 같은 대상을 기간이 겹치게 두 번 지정하면 거부. 스토리 대상이 광고(`sponsored`)·금주 핫뉴스(`digest`)면 거부 (원칙 ⑥ 기사·광고 분리 — 기본값).
  - 대상 기사·개정안을 지우면 배치도 지워진다(외래 키 cascade).
- `articles` 칸 더함 — `reported_approved`(편집 승인된 보도기사 = `content_type = reported_news`이고 `editorial_status = approved`, 계산 칸) · `body_media_ids`(본문 이미지·인포그래픽 블록이 가리키는 media 번호, 계산 칸). 둘 다 직접 쓸 수 없다.
- `articles.series_title`·`series_episode` (4단계 — ART-04 칼럼 연재 회차, `20261018000013_w2b_article_detail.sql`) — 둘 다 있거나 둘 다 없다 · 회차 1 이상 · 이름 1~100자 · 칼럼(`opinion`)만 · 같은 분야·같은 연재의 같은 회차는 하나(삭제된 기사는 세지 않는다 — 부분 unique 색인). 단독 칼럼은 둘 다 비운다.
- `article_tombstones` (4단계 — NAV-06 삭제 기사 410) — 첫 발행일이 있는 기사가 `deleted`가 되는 순간 트리거가 `(article_id, slug, removed_at)` 한 줄을 남긴다(이관 기사처럼 삭제 상태로 들어온 행도). 추가만 — service_role·소유자도 고치기·지우기 거부. 발행된 적 없는 기사는 남기지 않는다(그 주소는 404).

## 4. 공개 읽기 (anon·authenticated — 쓰기 권한 0, 함수 실행 권한 0)

정책 원칙은 W2-a 그대로다 — 칸 단위 권한으로 내부 칸을 막고 RLS 정책으로 행을 거른다. 정책 안의 하위 질의는 읽는 역할의 RLS로 돌아서 "읽을 수 있는 기사·개정안·상황에 딸린 행"이 된다. 정책은 `supabase/migrations/20261018000012_w2b_public_read.sql`, 허용 목록은 `scripts/verify-rls.mjs`, 경계 시험은 `tests/w2b-public-read.test.mjs`.

| 표 | 읽는 행 | 읽는 칸 (그 밖은 비공개) |
|---|---|---|
| `regions` | 모든 행 (공개 참조 자료 — 행정구역 표준코드) | 전부 |
| `situations` | `visible` | 감수자(`reviewer_id`)·마지막 수정자(`updated_by`) 빼고 전부 |
| `home_curations` | 오늘(한국 날짜)이 노출 기간 안이고, 대상(공개 개정안·읽을 수 있는 기사)이 읽히는 행 | `id`·`kind`·`amendment_id`·`article_id`·`sort`·`starts_on`·`ends_on` |
| `glossary_terms` | 모든 행 (PRD-00 6장 — 용어사전은 비회원 공개) | `jargon`·`updated_at` 빼고 |
| `tags` | 읽을 수 있는 기사에 붙은 태그 | 전부 |
| `article_tags` | 읽을 수 있는 기사의 연결 | 전부 |
| `article_corrections` | 게재 시각(`published_at`)이 지났고 읽을 수 있는 기사의 정정 | `id`·`article_id`·`kind`·`reason`·`reader_notice`·`published_at`·`created_at` (결정자·문의·전후 버전 번호 비공개) |
| `article_revisions` | 실질 수정(`update_kind = substantive`)이고 읽을 수 있는 기사의 것 | `id`·`article_id`·`version`·`edited_at`·`reason`·`update_kind` (제목·본문·작성자 비공개 — ART-05 업데이트 표시) |
| `settings` | 2.3 `settings.public_keys`의 키만 | `key`·`value`·`updated_at` |
| `articles` (W2-a 정책 유지) | 발행·대표 이미지 권리 확인·무료 | W2-a 칸 + `reported_approved` · `body_media_ids` |
| `media` (W2-a 정책 넓힘) | 권리 확인이고 읽을 수 있는 기사의 대표 이미지 **또는 본문 이미지·인포그래픽** | W2-a 그대로 |
| `article_tombstones` (4단계) | 모든 행 (공개됐다가 삭제된 기사 주소 — 410 안내) | `slug`·`removed_at` (기사 번호 비공개) |
| `articles` 칸 더함 (4단계) | 발행 기사 (W2-a 정책 그대로) | `series_title`·`series_episode` — 뷰 `public_articles` 끝에 더함 |
| 뷰 `public_category_article_counts` | 하위 분야별 공개 목록 기사 수(유형 있음·`digest` 제외) — 읽는 역할의 RLS로 센다(security_invoker) | `category_id`·`article_count` |

- 비공개 그대로: 취재 근거 3종·승인 기록·역할·기획·점검 결과·문의함·원본 스냅샷·대응표, 그리고 `settings`의 나머지 키(금지·공포 표현 사전·유사도 기준).
- 노출 기간이 끝난 홈 카드는 DB가 0행으로 주고, 공개 함수도 한국 날짜로 다시 거른다(이중).
- 공개 데이터 함수는 **anon 키**로 읽는다(`lib/server/supabase.ts anonClient`) — RLS가 경계이고 함수의 필터는 두 번째 방어다. service_role로 읽지 않는 이유: 함수에 필터를 하나 빠뜨려도 초안·비공개 행이 새지 않게 (FND-04 · 심층 방어). 예외 없음.

## 5. 공개 데이터 함수 (apps/web/lib/server/public — 서버 전용)

순서·대체·선정 규칙은 순수 함수(`*-logic.ts`, 시험 `*.test.ts`)에 두고, 읽기 함수(`server-only`)는 읽은 행을 순수 함수에 넣기만 한다.

| 함수 | 돌려주는 것 | 요구사항 |
|---|---|---|
| `getSiteChrome()` | 상단 메뉴 4개(고정 순서) · 분야별 하위 메뉴(공개 분야 중 목록 기사 1건 이상 + 공통 `뉴스 전체` `/news`) · 유틸 메뉴(기능 키가 켜진 것만, HOME-02 순서) · 정책 링크(기능 키가 켜진 것만) | HOME-02 · HELP-05 |
| `getHomeData()` | 섹션 목록 — 2.3 `home_sections` 순서 고정, 내용 0건 섹션은 빼고 돌려준다 | HOME-01 |
| ↳ 히어로 | 핵심 메시지(설정) · 검색 폼(`search` 키가 켜졌을 때만 — 주소 `/search`, 추천 검색어는 3~6개일 때만, 9장 #18). 핵심 메시지도 검색 폼도 없으면 히어로째 0 | HOME-01 · CORE-02 |
| ↳ 4대 분야 카드 | 4장 고정(분야 이름·주소·픽토그램 — `@ltr/ui FIELDS`). 분야 지방세 포인트 한 줄은 01B W3 | HOME-01 |
| ↳ 최신 자체 취재 | 편집 승인된 `reported_news` 5건(최신 발행 순, 4대 분야 통합). 다른 유형·이관 미분류 0 | HOME-04 |
| ↳ 금주 핫뉴스 | 없음(숨김) — `weekly_digests`는 01B W6 | HOME-04 |
| ↳ 개정 트래커 하이라이트 | 트래커 1~3건: 지정(오늘 노출 중, 순서) → 지정 0건이면 현재 단계가 가장 최근에 바뀐 공개 트래커 1건 → 공개 트래커가 없으면 섹션 숨김. 스토리 3~6장: 지정(순서) → 3장 미만이면 최신 해설(`explainer`)로 3장까지 채움(지정과 중복 0). 트래커 카드 = 현재 단계·화면 글자(시행 예정 포함)·`확정 아님` 여부(설정 기준)·현재 단계 원문 링크. 스토리 카드 = 제목·요약·형식(일반이면 배지 없음) | HOME-03 · TX-07 · TX-08 |
| ↳ 김의효 칼럼 · 자사 상품 · 전문가 | 없음(숨김) — 01C W7c·W8 | HOME-01 |
| `getHubData(section, { topic })` | 허브 머리(이름·아이브로·한 줄 소개 설정) · 탭(`[전체]` + 공개 분야 중 목록 기사 1건 이상 — 지자체뉴스는 기사 있는 편집 분야 `?topic=`, 헤더 하위 메뉴와 같은 목록 `subsectionLinks`) · 지금 탭 · 최신 목록(지자체뉴스는 고른 편집 분야만) · 분야 고유 블록(지자체뉴스 전체 보기만 — LG-08 ② 지방세·지방재정 ③ 부동산·개발, 블록마다 4장, 0건 블록 없음) · 상황 카드(허브 자리 순, 상한까지, 0이면 숨김) · 관련 용어 칩 · `noindex`(고른 편집 분야에 기사 0건). 분야 지방세 포인트·지방세·부동산·개발금융의 분야 고유 블록·HOT은 01B·W2-c | CAT-02 · UX-05 · LG-08 |
| `getCategoryList(section, slug, page)` | 하위 분야 목록 · 상위 허브(이름·아이브로·주소) · 허브와 같은 탭 · 기사 0건이면 `noindex`와 상위 허브 안내 · 목록 끝을 넘긴 쪽은 빈 쪽(화면이 404) | CAT-02 |
| `getNewsList({ section, page })` | 편집 승인된 `reported_news`만, 탭 `[전체]` + 허브 4개(글자 지방세·부동산·개발금융·지자체 — 3장 화면 표) · 편집 원칙·정정·반론 창구 링크(정책 페이지 기능 키가 켜진 것만) | CAT-02 · LG-04 |
| `getSituationPage(slug, { region })` | 상황(공개) · 먼저 확인할 것 3개 · 일반적 체크리스트와 고지 · 자주 틀리는 점 · 기사·해결 사례(읽히는 것만, 지정 순서) · 용어 칩 · 지역 선택(이 상황만 — 시·도 17, 고르면 그 시·도의 시·군·구도) · 지역 기사(그 지역과 하위 지역 태그, 0건이면 상위 시·도 기사와 그 사실) · 다음 행동(`[같은 분야 더 보기]` = 그 분야 허브 + 열린 기능만) · 감수일(한국 날짜) | UX-05 · FAM-02 · CAT-03 |
| `getArticleDetail(slug)` | 아래 '기사 상세 보기 모양' | ART-02~06 · CAT-04 · TX-08 · CORE-01 |
| `getPersonPage(slug, page)` | 공개 인물의 공개 칸(증빙 있는 약력 — 항목·증빙 번호, 평문 이메일 0) · 화면 역할(기자·필자·감수자·전문가) · 그 사람의 공개 기사·칼럼(쪽 넘김) · 구조화 데이터 값(ProfilePage — 이름·주소) | ART-04 · NAV-03 · OPT-02 |
| `getColumnList(section)` (4단계) | 칼럼 목록 — 그 분야에 공개 하위 분야 `columns`가 있을 때만(없으면 null → 404). 칼럼 = 그 분야의 공개 `opinion`(하위 분야와 상관없이 — ART-04 정의). 연재마다 회차 오름차순, 묶음은 최근 새 회차가 나온 연재부터, 단독 칼럼은 끝에 최신 순(`column-logic.ts`). 100편까지 한 쪽 | ART-04 |
| `readPublic(화면, 읽기, 닫힌 값)` (4단계) | 공개 데이터를 읽지 못할 때(접속값 없음·네트워크 오류·표 없음 = `PublicDataError`)의 한 곳 — 모든 공개 화면(틀·홈·허브·하위 분야·칼럼·뉴스 전체·상황·기사·인물)이 이 함수로 읽는다. 목록은 닫힌 값(머리 + 안내 한 줄), 상세는 `UNAVAILABLE` 표시. 원인은 서버 로그 `[public]`에만, 그 밖의 오류는 그대로 던진다(`fallback.ts`) | FND-09 · 운영 |

**기사 상세 보기 모양** (`getArticleDetail` — 4단계 화면이 이 값만으로 그린다)

- 머리: 분야·하위 분야 칩, 기사 유형 배지 값(`content_type`), 형식(일반이면 배지 없음), 제휴 배지 글자(`광고` · `공동 기획 ○○` — W2-a 표기 규칙), 편집 분야(지역 기사), 화면 제목·JSON-LD(`toArticleView`·`renderedFacts`와 같은 소스 — OPT-02), 기자·최초 발행일·실질 수정일·법령 기준일.
- 정정 이력(게재된 정정, 날짜 순 — 0건이면 빈 목록 → 블록 0) · 업데이트 표시(실질 수정 기록 — 정정과 다른 라벨, ART-05).
- 개정 트래커(개정 브리핑): 현재 단계·`확정 아님`·트래커 주소, 갱신 배너(기사의 실질 수정(없으면 최초 발행)보다 늦은 단계 기록이 있을 때만 — TX-08).
- 본문 블록(이미지·인포그래픽은 권리 확인되어 읽히는 것만 — 아니면 블록을 뺀다), 출처(공개 출처), 대표 이미지.
- 「지방세로 읽기」 자리: 내용이 있고 생략 사유가 없고 현재 버전 감수가 끝났고 **서명 기록의 감수위원이 공개 인물이고 법령 기준일이 있는** 박스만 → 아니면 `null`(박스 요소 0). 링크는 열린 기능만(계산기 = `sm_calculator`, 전문가 = `expert_finder`, 도서 = `store`). '감수 ○○'는 세무 감수 승인 때 서버가 박스에 남기는 서명 기록(`tax_lens.reviewed_by` = 감수위원 people.id · `reviewed_at`)에서만 그린다 — 손으로 넣는 이름 칸 0 (01C BR-03, 9장 #13).
- 본문: 카드뉴스면 장(`slide` 블록)은 `slides`(번호·제목·줄·대체 텍스트)로, 나머지 블록은 `blocks`로 — 카드뉴스가 아닌 기사의 장 블록은 그리지 않는다. 이미지 주소는 화면과 JSON-LD가 같은 함수(`absolute` — 사이트 주소 + media.path)로 만든다.
- 해결 사례: 4칸 · 결론 배지(`conclusion`) · 결과 근거(번호 + http 링크)가 다 있을 때만 카드 값(`solvedCase`), 아니면 null (상황 페이지는 `solvedCaseCards`로 같은 카드).
- 표기(`sponsor`): 광고 `{ kind: "ad" }` · 공동 기획 `{ kind: "co_planned", partner }` — 목록 카드(`ArticleListItem.sponsor`)와 같은 값. `partner`는 기사의 배지 이름 칸(`articles.partner_badge_name`, W2-c 5단계 — 트리거가 제휴사 이름으로 채운다)에서 읽는다: 제휴사를 비공개로 내려도 '공동 기획 ○○' 그대로이고, 제휴사 프로필 링크만 공개 제휴사일 때 붙는다. 공유 미리보기(`share`) — 제목·설명(카드뉴스는 첫 장 글, 표기가 있으면 `[배지] …`)·대표 이미지·주소.
- 칼럼(`series`)·필자(`author.kind` — 칼럼은 필자 블록)
- 면책: 하위 분야의 `needs_disclaimer`일 때만.
- 기자 소개(공개 인물 — 평문 이메일 칸 없음), 자사 상품 카드(01C 전 `null`), 관련 기사(같은 개정안 → 같은 하위 분야 → 같은 분야 최신, 자기 자신·비슷한 사례와 겹침 0, 4건) [확인 필요 — CMS에 관련 기사 칸이 없어 계산한다].
- 다음 행동 띠(ART-06): 비슷한 사례 3건(해결 사례 먼저 → 같은 태그 수 → 같은 분야 → 최신, 자기 자신·비공개 0, 0건이면 빈 목록) + 버튼(우선순위 설정 순서, 열린 것 중 앞 2개 — [이 지역 뉴스 더 보기]는 지역 태그가 있고 `region_hubs`가 켜졌을 때만).
- 정책 링크 7종(켜진 것만) · 많이 본 기사(W2-c 전 빈 목록, 지금 기사 제외 규칙은 W2-c).
- `digest`는 기사 상세로 그리지 않는다(주간 페이지 경로 01B LG-01) → `null`.

모든 링크는 숨긴 경로·v1.2 경로 검사(`isBlockedPath`)를 지난 것만 나온다 — `/region`·`/resources`·`/academy`·`/authors`·`/pricing`·`/ask`·`/realestate/trust`·`/news/cards`·`/calc/`·`/law`·`/cases`·`/workspace`·`/qna`·`/library`와 v1.2 정책 경로(`/editorial-policy`·`/corrections`·`/advertise`·`/terms`·`/privacy`·`/no-email-collection`) (PRD-01A 3장 · PRD-00 8장 'v1.2 경로 대체'). 편집국이 손으로 쓴 사이트 안 링크(기사 문단 `[글](/주소)`·「지방세로 읽기」 해설 링크)는 한 번 더 열린 화면 검사(`isOpenPath` — 숨긴·v1.2 경로, 7장 '만들지 않는 경로' 중 기능 키가 없는 화면, 꺼진 기능의 화면이면 닫힘)를 지난다 — 닫힌 화면으로 가는 문단 링크는 글자만 남고(기능을 켜면 배포 없이 다시 링크), 숨긴·v1.2 옛 주소는 표기 그대로 보여 편집자가 고친다 (9장 #53).

## 6. 홈 배치 백오피스 (W2-a에서 미룬 것)

- 접근: 작업 `article.home`(편집 책임자 — 관리자도 editor 필요). 거부는 403 + 감사 로그 `article.home.denied`.
- API (`/api/admin/home-curations`)

| 경로 | 하는 일 | 주요 응답 |
|---|---|---|
| `GET home-curations` | 배치 목록(종류별 순서, 상태 `active`·`upcoming`·`expired` — 한국 날짜) · 대상 후보(공개 개정안·발행 기사) · 상한 · **지금 홈에 보이는 모습**(공개 데이터 함수가 anon으로 계산 — 끝난 카드 0, 대체 채움 표시) | 200 · 403 |
| `POST home-curations` | 카드 더하기 `{ kind, targetId, startsOn, endsOn?, sort? }` | 201 · 403 · 409(같은 날 상한 초과·같은 대상 겹침) · 422(대상 없음·비공개·광고·금주 핫뉴스·날짜) |
| `PATCH home-curations/[id]` | 기간·순서 고치기 (종류·대상은 못 바꾼다 — 빼고 다시 더한다) | 200 · 404 · 409 · 422 |
| `DELETE home-curations/[id]` | 카드 빼기 | 200 · 404 |
| `POST home-curations/order` | 한 종류의 노출 중·예정 카드 전부를 받아 10 간격으로 순서 | 200 · 422 |

- 감사 로그: `home_curation.create`·`.update`·`.delete`·`.reorder`, 대상 `home_curations:<id>`(순서는 `home_curations:order:<kind>`), 전후 값.
- 화면 `/admin/home` (메뉴 `홈 배치` — 편집 책임자): 종류별 카드 목록(상태 칩·노출 기간 고정폭·대상 제목·트래커 단계), 위로·아래로·기간 고치기·빼기, 카드 더하기(대상 고르기·시작일·종료일). 고른 기간에 이미 상한만큼 보이는 날이 있으면 더하기 단추를 막고 사유를 보인다(서버와 같은 규칙 `lib/admin/home-curation-rules.ts`). 아래에 '지금 홈에 보이는 모습'.
- 날짜 규칙: 새 카드의 종료일은 오늘(한국 날짜) 이후여야 한다(이미 끝난 카드를 새로 만들지 않는다). 스토리 대상은 발행된 기사, 트래커 대상은 공개 개정안이어야 한다(지정 때 검사 — 나중에 비공개가 되면 홈에서 자동으로 빠진다).

## 7. 공개 경로 (2~4단계가 만든다)

| 경로 | 화면 | 요구사항 | 단계 |
|---|---|---|---|
| `/` | 홈 — 섹션 순서 고정, 빈 섹션 0 | HOME-01~04 · UX-06 · FND-09 | 2 |
| (모든 공개 화면) | 공개 레이아웃 — 헤더 상단 4·유틸, 바닥글, 화면 전환 | HOME-02 · HELP-05(링크 자리) · FND-09 · UX-06 | 2 |
| `/tax` · `/realestate` · `/finance` · `/local` | 4대 분야 허브 공통 골격 (`/local?topic=<편집 분야>` — 분야 탭) | CAT-02 · UX-05 · LG-08 | 3 |
| `/[section]/[category]` (tax·realestate·finance) | 하위 분야 목록 — 없는·비공개 하위 분야 404, 0건이면 200 + 상위 허브 안내 + `noindex`, `?page=` | CAT-02 · CAT-04 | 3 |
| `/news` | 뉴스 전체 — 취재 기사만, 탭 `[전체]` + 허브 4 (`?section=`), `?page=` | CAT-02 | 3 |
| `/situations/[slug]` | 상황 페이지 (`?region=<법정동코드>` — 지역 선택 상황만). 숨긴·감수 전·없는 상황 404 | UX-05 · FAM-02 · CAT-03 | 3 |
| `/news/[slug]` | 기사 상세(카드뉴스 포함 — 형식만 다르다) | ART-02 · ART-03 · ART-05 · ART-06 · CAT-04 | 4 |
| `/tax/columns` · `/finance/columns` | 칼럼 목록 (`opinion`, 연재 회차 순서, 의견 고지, 필자 링크) — `/[section]/[category]`의 `columns` 하위 분야가 칼럼 목록이 된다(부동산은 01B W4가 하위 분야를 더하면 같은 규칙) | ART-04 | 4 |
| `/people/[slug]` | 인물(기자·필자) — 비공개·없는 인물 404 | ART-04 · NAV-03 | 4 |

만들지 않는 경로(다른 작업): `/search`·`/glossary`(W2-d — 둘 다 W2-d가 만들고 기능 키 search·glossary로 연다) · `/about/*`·`/help/*`·`/my`·`/brief`(W2-e) · `/tax/amendments/[slug]`·`/calc`(01B W3) · `/local/[sido](/[sigungu])`·`/local/events`(01B W4~W6) · `/experts`·`/store`·`/edu`(01C). 이 경로로 가는 링크는 기능 키가 켜질 때까지 0이다.

W2-c가 만든 목록 — 많이 본 기사(2단계)·포토 목록(4단계)은 열린 화면이고, 동영상 목록(4단계)은 기능 키 video_list가 켜졌을 때만 열린다(꺼져 있으면 404). 메뉴 링크는 셋 다 아직 없다 (W2-c 설계 7장·9장).

- **하위 분야 목록은 공개 하위 분야 전부의 경로다** (3단계 결정 — 9장 #28). PRD-01A 3장 '하위 분야 목록'(기사 카드 목록)은 01A 화면이고, `/tax/amendments`·`/realestate/projects` 같은 01B 화면은 같은 경로에 분야 고유 목록(트래커·프로젝트·사례)을 더한다. 기사 0건이면 탭·메뉴에 없다. `amendments` 기능 키는 트래커 상세(`/tax/amendments/[slug]`) 링크만 연다.
- **지자체뉴스의 하위 경로는 만들지 않는다** (9장 #27). `/local/[category]`는 시·도 주소 `/local/[sido]`와 겹친다 — 허브 탭·헤더 하위 메뉴는 기사 있는 편집 분야(`/local?topic=local_tax` 등, 분야 필터 값)로 두고, `/local/reporting` 등은 404다.

### 7.0 공개 상세 화면의 응답 상태 (4단계 — NAV-06 · 운영)

| 상황 | 기사 `/news/[slug]` | 상황 `/situations/[slug]` · 인물 `/people/[slug]` | 목록(홈·허브·하위 분야·칼럼·뉴스 전체) |
|---|---|---|---|
| 공개 | 200 | 200 | 200 |
| 없음·초안·비공개 | 404 (공개 틀 안 안내) | 404 | 하위 분야·칼럼이 없으면 404, 기사 0건은 200 + `noindex` |
| 삭제된 기사 | **410** + 삭제 안내(삭제일·뉴스 전체·홈 링크, 제목·사유 0, `no-store`) | — | — |
| 발행 뒤 주소 바꿈 | 생기지 않는다 — 발행된 기사 slug 변경은 편집국 API 409(W2-a). 옛 주소 301은 이관 기사만(W9 MIG-02 `redirects`) | — | — |
| 공개 데이터를 읽지 못함 | **503** "잠시 뒤 다시 확인해 주세요"(`no-store` · `retry-after: 30` · `noindex`) — 있는지 모르므로 404·410 0 | 503 같은 안내 | 200 + 안내 한 줄, 낡은 자료 0 |

- 410·503은 `proxy.ts`가 화면보다 먼저 정한다(Next.js 화면은 404 밖의 상태를 정할 수 없다). 상세 경로마다 anon 키로 공개 표 하나를 읽는다 — 기사는 `article_tombstones`(있으면 410), 상황은 `situations`, 인물은 `public_people`(읽히기만 하면 화면으로). 4초 안에 답이 없거나 접속값이 없거나 표가 없으면 503. 규칙은 `lib/site/public-gate.ts`(순수 — 시험 `public-gate.test.ts`).
- 확인을 지난 뒤 화면의 읽기가 실패하면(드문 경우) 화면이 같은 안내를 그린다 — 이때 응답은 200 + `noindex`다 [확인 필요].
- 상세 확인 요청은 기사·상황·인물을 열 때마다 한 번 더 생긴다(캐시하지 않는다 — 삭제가 바로 410이 되게).
- E2E `e2e/site-degraded.test.mjs` — 접속값 없음·닿지 않는 주소·표 없는 DB 세 경우에 목록 200 + 안내, 상세 503, 500 0, 처리되지 않은 오류 0.

### 7.1 공개 화면 그리기·캐시·재검증 (2단계 결정 — HOME-03·HOME-04 "1분 안에 홈에 반영 (캐시 재검증)")

- **요청 때 그린다.** 공개 레이아웃(`app/(site)/layout.tsx`)과 홈이 `connection()`을 부른다 — 빌드 때 DB를 읽지 않는다. Docker 이미지·CI 빌드·비밀값 검사 빌드(`scan-bundle-secrets --build`)에는 DB 접속값이 없거나 가짜라서, 빌드 때 미리 그리는 방식(ISR)은 빌드가 실패하거나 빈 값을 굳힌다.
- **읽은 공개 행은 Next.js 데이터 캐시에 둔다.** 공개 데이터 함수의 anon 요청(`lib/server/public/db.ts` → `cache.ts`)에 `next: { revalidate: 30, tags: ["public-data"] }`(규칙 `cache-policy.ts`)를 붙인다 — 이 판(Cache Components를 켜지 않은 Next 16)의 문서 방식 `fetch` 캐시. `unstable_cache`는 Next 16에서 `use cache`로 대체 예정이라 쓰지 않고, Cache Components(`cacheComponents`)는 백오피스 전체의 `dynamic` 설정과 맞지 않아 켜지 않는다.
- **편집국 쓰기는 바로 만료한다 (요청 때 재검증).** 공개 화면에 보이는 값을 쓰는 편집국 API는 `handle(fn, { revalidatesPublic: true })` — 쓰기가 성공(2xx)하면 `revalidateTag("public-data", immediateExpiryProfile(…))` — 즉시 만료. 다음 요청은 낡은 값을 보이지 않고 DB를 새로 읽는다. 만료 시각은 Next.js가 벽시계로 적고 단조 시계로 읽어서, 두 시계가 어긋난 만큼 + 10ms 앞당겨 적는다(`{ expire: 0 }`은 벽시계가 앞선 서버에서 쓰기 직후 몇 ms 동안 옛 값을 한 번 보였다 — W2-c 설계 8.6에서 찾아 고침, `cache-policy.ts`). 대상: 기사 고치기·발행·배치·편집 승인·정정·출처, 분야 더하기·고치기·순서, 용어 더하기·고치기·지우기, 제휴사 고치기, 운영 설정, 홈 배치 더하기·고치기·빼기·순서, 상황 카드 만들기·고치기·공개·허브 자리·순서·감수 서명(3단계). 01B W3의 트래커 단계 기록 API도 같은 표시를 단다.
- **손으로 고친 DB 값(트래커 단계 등 아직 API가 없는 값)은 시간 재검증으로.** 30초가 지난 값은 다음 요청이 한 번 보이고 뒤에서 새로 읽는다(stale-while-revalidate) — 방문이 이어지면 늦어도 1분 안에 새 값이 나온다 (E2E `site-home` g: DB에 직접 단계를 기록하고 60초 안에 홈에서 확인).
- 백오피스의 '지금 홈에 보이는 모습'(홈 배치 화면·API)도 같은 캐시를 읽는다 — 공개 홈과 같은 모습이다. 편집국 쓰기 뒤에는 바로 새 값.
- 한계: 캐시는 서버마다 따로다(Vercel은 공유). 사내 서버에서 같은 컨테이너를 다시 띄우면 재시작 전 마지막으로 읽은 값을 첫 요청에 한 번 보일 수 있다 — 새 이미지·새 컨테이너 배포는 빈 캐시에서 시작한다. 시험 서버는 띄울 때마다 캐시를 비운다(`e2e/lib/local.mjs`).

## 8. 산출물

### 8.1 1단계 (2026-10-18)

- 마이그레이션: `20261018000009_regions.sql`(행정구역·기사 지역 태그 검사) · `20261018000010_situations.sql`(상황·허브 상한 설정) · `20261018000011_home_curations.sql`(홈 배치) · `20261018000012_w2b_public_read.sql`(공개 읽기·계산 칸·공개 설정 씨앗·분야별 기사 수 뷰)
- DB 시험: `packages/db/tests/w2b-values.test.mjs`(이 문서 2장 표를 읽는다) · `w2b-regions` · `w2b-situations` · `w2b-home-curations` · `w2b-public-read`. W2-a 시험 `w2a-public-read`의 비공개 표 목록에서 W2-b가 공개 행을 연 표(설정·용어·태그·정정·수정 이력)를 빼고 W2-b 시험이 공개·비공개 행을 함께 본다. `scripts/verify-rls.mjs` 허용 목록에 9개 표를 이유와 함께 더했다.
- 공개 데이터 함수: `apps/web/lib/server/public/` — 읽기(`index.ts`가 내보냄, `server-only`)와 순수 규칙(`*-logic.ts`·`cards.ts`·`settings.ts`·`constants.ts`, 시험 `*.test.ts`). 통합 시험 `public-data.itest.mjs`(로컬 Supabase에 anon 키로 — `pnpm --filter @ltr/web test:integration`, CI 2단계). 화면 데이터·JSON-LD는 편집국과 같은 `toArticleView`(입력 모양을 공개 칸만으로도 받게 넓혔다).
- `뉴스 전체`의 분야 탭 주소는 `/news?section=<분야>` (하위 메뉴 `뉴스 전체`도 같은 주소).
- 홈 배치: API `apps/web/app/api/admin/home-curations/`(목록·더하기 · `[id]` 고치기·빼기 · `order`), 규칙 `apps/web/lib/admin/home-curation-rules.ts`(+시험), 화면 `apps/web/app/admin/(desk)/home/page.tsx` + `components/admin/HomeCurationControls.tsx`, 메뉴 `홈 배치`(편집 책임자 — 편집국 외 역할 0). E2E `e2e/admin-home-api.test.mjs`(CI 2단계).
- 관리자 설정 화면이 고치는 키에 공개 설정 6개를 더했다(`lib/admin/settings-rules.ts` — 공개 데이터 함수가 읽는 모양과 같은 검사).

### 8.2 2단계 — 공통 틀·홈·메뉴 (2026-10-18)

- 공개 레이아웃 `apps/web/app/(site)/layout.tsx` — 건너뛰기 링크 · 헤더(`components/site/SiteHeader.tsx` — 상단 4대 분야 + 기능 키가 켜진 유틸 메뉴, 지금 보는 분야는 주소에서) · `main#main` · 바닥글(면책 + 공개 승인된 정책 링크만, 개인정보처리방침 굵게). 루트 레이아웃(검색 노출 차단 noindex)은 그대로 — 백오피스·`/_design`은 이 틀 밖이다.
- 공개 데이터를 읽지 못하면(접속값 없음·DB 꺼짐) 닫힌 쪽으로 그린다 — 화면 틀은 상단 메뉴만(`closedChrome`), 홈은 4대 분야 카드와 안내 한 줄(`closedHomeData`), 응답 200, 원인은 서버 로그 `[public]`. 그 밖의 본문 오류는 `app/(site)/error.tsx`(다시 불러오기). DB 없이 띄우는 개발 서버 3001 E2E(`e2e/dev-port.mjs`)도 홈 200을 본다.
- 홈 `apps/web/app/(site)/page.tsx` + `components/site/HomeSections.tsx` — `getHomeData()`가 준 섹션만 순서대로(섹션마다 `data-home-section`). 히어로(아이브로 · 핵심 메시지 = 설정 · 검색 폼은 `search` 키가 켜졌을 때만 — #18) → 4대 분야 카드 4 → 최신 자체 취재(기사 카드 · '보도' 배지 · 기자명) → 개정 트래커 하이라이트(진행 단계 배지 · 확정 전 '확정 아님' 1 · 현재 단계 원문 링크 · 트래커 페이지 링크는 `amendments` 키 뒤) + 해설 스토리(형식 배지는 일반 0). 금주 핫뉴스·칼럼·상품·전문가는 데이터가 없어 0. 섹션 바탕은 보이는 순서대로 ivory·ivory-dark. 화면 값은 `lib/site/home-view.ts`·`chrome-view.ts`(순수 — 시험 `*.test.ts`).
- 홈 데이터 바꿈: 히어로 = `{ coreMessage, search: { action, chips } | null }`(핵심 메시지도 검색도 없으면 히어로째 0) · 스토리 카드에 기사 카드 값(하위 분야·유형·발행일·기자·지역) · 트래커 상태에 확정 기준 단계(`confirmStage` — 배지가 같은 기준으로 그린다).
- 화면 전환: `@ltr/ui`에 `LinkProvider`·`UiLink`(사이트 안·같은 창 주소만 앱 링크, 외부·새 창·내려받기는 a 요소)를 더하고 헤더·바닥글·홈 큰 입력창 칩·링크 카드·버튼 링크·기사 카드가 쓴다. 공개 레이아웃만 Next.js `Link`(prefetch 끔 — #19)를 넘긴다. 펼친 모바일 메뉴는 항목을 누르면 닫힌다. 3·4단계에서 쓰는 나머지 컴포넌트(상황 카드·다음 행동 띠·기자 소개 등)의 링크도 그때 `UiLink`로 바꾼다.
- `@ltr/ui` 바꿈: 기사 카드 `byline`(기자명) · 히어로 제목 생략 가능(핵심 메시지가 없을 때) · 홈 큰 입력창의 360px 주 버튼을 글자 폭으로(화면 폭 버튼은 R3 오렌지 면적 7.4%로 실패).
- 캐시·재검증: 7.1. 편집국 API 18곳에 `revalidatesPublic`.
- 시험: 순수 함수 `lib/site/*.test.ts`·`cache-policy.test.ts`·`chrome-logic`(닫힌 틀)·`home-logic`(히어로·스토리 값) · `@ltr/ui` `link.test.tsx`·헤더(메뉴 닫힘)·기사 카드(기자명)·히어로(제목 없음) · E2E `e2e/site-home.test.mjs`(섹션 순서 DOM·위치, R1·R2·R3 360·640·1024, 화면 전환, 숨긴 메뉴·v1.2 경로 0, 360px, '확정 아님' 1, 7장째 거부, 끝난 카드 0, 편집국 쓰기 즉시·DB 직접 1분 안 반영) · `e2e/a11y.test.mjs` 홈(시험 자료를 넣은 모습) 접근성 95 이상 · `run-screen-rules`가 로컬 Supabase에 붙어 홈을 잰다. CI `scripts/ci/db-e2e.sh`에 `site-home`을 더했다.
- 3단계로 넘김: 허브 4곳·하위 분야·`/news`가 생기면 `site-home` (c)를 '허브로 화면 전환 → 뒤로 가기에도 표식 유지'로 조이고(지금은 없는 화면이라 Next.js가 문서 이동으로 404를 연다 — 링크가 화면 전환 요청부터 하는 것까지 본다), 헤더 하위 메뉴(분야 데이터 + `뉴스 전체` — `getSiteChrome().sections[].children`)를 그린다. → 8.3에서 했다.

### 8.3 3단계 — 허브·하위 분야·뉴스 전체·상황 페이지·상황 카드 백오피스 (2026-10-18)

- **허브 공통 골격** — 경로 `app/(site)/{tax,realestate,finance,local}/page.tsx`가 분야 값만 넘기고 `components/site/routes.tsx` → `HubView.tsx` 하나가 그린다. 부분 순서 고정(`lib/site/hub-view.ts` `HUB_PARTS`): 머리(`FieldHubHead` — 아이브로·제목·소개 → 분야 지방세 포인트 → 탭) → 분야 고유 블록 → 최신 목록 → 상황 카드(0~상한) → 관련 용어. 0건 부분은 빠지고, 바탕은 ivory부터 번갈아. 부분마다 `data-hub-part`(E2E 골격 비교). 공개 데이터를 읽지 못하면 닫힌 허브(머리와 안내 한 줄, 200 — `closedHubData`).
- **분야 허브 머리 순서 바꿈** (`@ltr/ui FieldHubHead`) — 소개 다음에 분야 지방세 포인트, 그다음 탭 (CAT-02 수용 기준 '머리 → 지방세 포인트 → 탭', PRD-00 8.10 지자체 허브 골격). 한 줄 소개는 없으면 줄째 없다. `field="news"`(뉴스 전체 — 지방세 포인트 없음)를 더했다.
- **탭 = 헤더 하위 메뉴** — `[전체]` + 기사 있는 하위 분야(`chrome-logic.ts subsectionLinks` 하나에서). 지자체뉴스는 기사 있는 편집 분야(`/local?topic=` — `@ltr/ui TOPIC_FILTER_ITEMS` 순서, 수는 `reads.ts readTopicCounts`). 하위 분야가 하나도 없으면 탭째 없다. 지자체뉴스 전체 보기에는 LG-08 블록 중 데이터가 있는 ② 지방세·지방재정(편집 분야 지방세·지방재정) ③ 부동산·개발(부동산·도시정책)을 둔다 — ① 금주 핫뉴스·④ 행사안내는 01B W6, ⑤ 공식 자료/해설은 W4.
- **하위 분야 목록** `app/(site)/{tax,realestate,finance}/[category]/page.tsx` → `CategoryView.tsx` — 허브와 같은 머리(제목 = 하위 분야 이름, 지금 하위 분야가 고른 탭)와 기사 카드·쪽 넘김(`?page=`). 주소 형식 밖·없는·비공개 하위 분야는 404, 기사 0건은 200 + `noindex`(`listRobots`) + "아직 공개된 기사가 없습니다 · ○○ 허브로 가기", 목록 끝을 넘긴 쪽 404(PostgREST 416 → 빈 쪽, `db.ts pageOf`).
- **뉴스 전체** `app/(site)/news/page.tsx` → `NewsView.tsx` — 같은 머리(아이브로 NEWS · 탭 `[전체]` + 허브 4)와 편집 승인된 `reported_news` 카드만, 편집 원칙·정정·반론 창구 링크는 정책 기능 키가 켜졌을 때만. 모르는 `section` 값은 전체.
- **상황 페이지** `app/(site)/situations/[slug]/page.tsx` → `SituationView.tsx` — 아이브로(SITUATION · 분야) · 픽토그램 + 제목(h1) · 한 줄 · 먼저 확인할 것(단계 타임라인 3) + 감수일 · 일반적 체크리스트와 고지(있을 때) · 지역 선택 칩(그 상황만 — 시·도 17, 고르면 시·군·구, 고른 지역 기사·상위 시·도 대체 안내) · 자주 틀리는 점(rose 상태 상자, 있을 때만) · 해결 사례 · 관련 기사 · 용어 칩 · 다음 행동 띠. 숨긴·감수 전·없는 상황은 404(`app/(site)/not-found.tsx` — 공개 틀 안 안내).
- **다음 행동 띠** (`@ltr/ui NextActionBand`) — 640px 미만은 위아래 선만 있는 띠(안쪽 좌우 16px)이고 화면이 띠를 화면 폭으로 펼친다 → 360px에서 버튼 328px (UX-06). 루트 글자가 17px이라 `px-4`(17px)가 아니라 16px로 둔다.
- **헤더 하위 메뉴** (`@ltr/ui Header submenus` · `HeaderNav`) — 분야 링크는 그대로 허브로 가고, 옆 펼침 단추(`○○ 하위 메뉴`, 44px)로 하위 메뉴를 연다. 한 번에 하나, Esc는 하위 메뉴 먼저 닫고 단추로 포커스, 바깥 누름·포커스가 그 분야 밖으로 나가면 닫힘, 항목을 누르면 하위 메뉴·펼친 모바일 메뉴가 함께 닫힌다. 닫힌 하위 메뉴는 `hidden`(JS가 꺼져도 분야 링크는 동작). 상단 메뉴 HTML은 여전히 정확히 4개(`[data-part="section-link"]`).
- **사이트 안 링크** — 2단계에 남은 `@ltr/ui` 링크를 `UiLink`로 바꿨다: 링크 탭(`TabNav`)·단계 타임라인 링크 단계·분야 지방세 포인트·지자체 허브 블록 더 보기·다음 행동 띠 비슷한 사례·해결 사례 제목과 근거(외부 근거는 a 요소 그대로).
- **상황 카드 백오피스** — 접근 판정 `lib/access.ts` 작업 2개: `situation.edit`(기자·편집 책임자·관리자 — PRD-00 6장 'CMS 작성·상황 카드') · `situation.publish`(공개·내리기·허브 자리·허브 순서 — 편집 책임자, 관리자도 editor 필요, 거부 감사). 감수 서명은 기존 `review.tax_review`(세무 감수위원, 거부 감사). 메뉴 `상황 카드`(`lib/admin/menu.ts` — 쓰는 사람·공개하는 사람·감수위원, 편집국 외 역할 0).
  - 규칙 `lib/admin/situation-rules.ts`(+시험): 먼저 확인할 것 정확히 3개(화면은 2·4개면 API를 부르지 않고 묶음 칸 오류 — 서버도 422, DB는 3개 초과·공개 행 3개 아님 거부), 분야 필수, 픽토그램은 `@ltr/ui PICTOGRAM_NAMES`, 자주 틀리는 점 3개까지, 일반적 체크리스트는 고지와 함께(기본 문구 FAM-02), 연결 칸은 다음 행동 기능 키 4종, 주소는 만들 때만, 허브 자리는 상한(설정)까지 — 상한이 찬 분야에 5번째는 409, 감수 대상 칸 비교는 칸 순서와 상관없이(jsonb).
  - API `app/api/admin/situations/`: `GET`(목록·상한·허브 자리) · `POST`(만들기 — 비공개·허브 밖으로 시작) · `[id]` `GET`·`PATCH`(내용은 `situation.edit`, 공개·허브는 `situation.publish`로 따로 판정. 공개 중 감수 대상 문장 고치기 409 · 감수 전 공개 409 · 허브에 놓인 상황의 분야 바꾸기 409 · 연결 번호 없음 422 · 응답 `reviewCleared`) · `[id]/review` `POST { updatedAt }`(감수위원이 읽은 판에만 — 바뀌었으면 409, 감수자 인물 기록 필요) · `order` `POST { section, ids }`(허브 카드 전부를 새 순서 — 자리를 먼저 비우고 채운다, 실패하면 되돌림). 모두 `revalidatesPublic`(저장 즉시 공개 화면), 감사 로그 `situation.create`·`.update`(감수 기록이 지워지면 전후에 포함)·`.publish`·`.unpublish`·`.hub`·`.review`·`.reorder`, 대상 `situations:<id>`(순서는 `situations:order:<분야>`). DB 오류 문장 `lib/server/db-errors.ts`(공개 조건·모양·주소 중복·허브 자리 중복·감수자 외래 키).
  - 화면 `app/admin/(desk)/situations/` — 목록(분야마다 허브 카드 `n/상한` 자리 순 + 허브 밖, 상태 칩 공개·감수·허브 자리, 편집 책임자에게만 공개하기·내리기·허브에 넣기(빈 첫 자리)·빼기·위로·아래로 — 찬 허브는 [허브에 넣기]를 끄고 사유), `new`(만들기), `[id]`(지금 상태 · 감수위원에게 감수할 문장과 [감수 서명] · 쓰는 사람에게 고치기 폼 — 감수 기록이 있으면 '고치면 지워진다' 안내, 저장 뒤 '감수 기록이 지워졌습니다'). 폼 `components/admin/SituationForm.tsx`(픽토그램 고르기 24종 · 확인할 것 더하기·빼기), 단추 `SituationControls.tsx`.
- **시험** — 순수 함수 `hub-logic.test.ts`(탭 숨김·탭=메뉴·LG-08 블록·쪽 번호·닫힌 허브) · `hub-view.test.ts`(골격 순서·noindex·쪽 넘김·상황 단계) · `chrome-view.test.ts`(헤더 하위 메뉴) · `situation-rules.test.ts`(2·3·4개 경계·허브 5번째·감수 대상 비교·폼) · `access.test.ts`·`menu.test.ts`·`db-errors.test.ts` · `@ltr/ui` 헤더 하위 메뉴·분야 허브 머리 순서·다음 행동 띠·`link.test.tsx`(새 링크) · 통합 `public-data.itest.mjs`(지자체뉴스 탭·블록·편집 분야 거르기·빈 쪽·다음 행동) · E2E `e2e/site-hubs.test.mjs`(네 허브 골격·빈 하위 분야 noindex·404·취재 기사만·상황 페이지·상한·화면 전환·R1~R3·360px·328px·꺼진 링크 0) · `e2e/admin-situations.test.mjs`(API·화면) · `site-home` (c) 허브까지 조임·하위 메뉴 · `a11y` 허브·상황 페이지 95 이상 · `admin-ui`·`admin-settings-ui` 메뉴에 `상황 카드` · `run-screen-rules` 대상에 `/tax`·`/local`·`/news`. CI `scripts/ci/db-e2e.sh`에 새 E2E 2개.
- 4단계로 넘김: 기사 상세 `/news/[slug]`(지금 허브·목록·상황의 기사 카드 링크가 갈 곳) · 해결 사례 카드(결론 배지 칸 — #36) · 기자별 보기(인물 `/people/[slug]`, 뉴스 전체의 기자 링크) · 칼럼 목록 `/tax/columns`·`/finance/columns`(지금은 일반 하위 분야 목록으로 열린다).

### 8.4 4단계 — 기사 상세·카드뉴스·칼럼·인물·해결 사례 카드 (2026-10-18)

- **DB** `20261018000013_w2b_article_detail.sql` — 칼럼 연재 칸(`series_title`·`series_episode`, 3장)·삭제된 기사 주소 표(`article_tombstones` + 기록 트리거, 4장). 시험 `packages/db/tests/w2b-article-detail.test.mjs`(12) · `scripts/verify-rls.mjs` 허용 목록에 `article_tombstones`.
- **발행 판정** (`packages/editorial`) — 블록 종류 `slide`(카드뉴스 한 장: 제목·글·대체 텍스트, 글은 금지·공포 표현·상자 문장 수 검사 대상), 검사 `checks/card-news.ts`: `art03.slide-count`(5~7장 — 4장·8장 차단) · `art03.slide-alt`(장마다 대체 텍스트) · `art03.slide-text`(글자 없는 장) · `art03.slide-outside-cardnews`(카드뉴스가 아닌 기사의 장). 해결 사례 결론 배지 `SolvedCase.conclusion`(인용 `accepted` · 일부 인용 `partial` · 기각 `rejected` · 각하 `dismissed` · 해석 `interpretation`) — 없으면 `cat05.conclusion-missing` 차단. README 규칙 표·판정 기준 갱신.
- **편집국** — 블록 편집기에 `카드뉴스 장`(제목·글·대체 텍스트), 해결 사례에 `결과의 결론` 고르기, 칼럼에 `칼럼 연재`(이름·회차 — 칼럼만, 둘 다 적거나 둘 다 비움). 세무 감수 승인이 「지방세로 읽기」 박스에 서명 기록(`reviewed_by`·`reviewed_at`)을 남기고, 박스를 그대로 두는 수정은 서명 기록을 새 버전으로 옮긴다(`plan.ts`). 입력 검사 `input.ts`(`seriesTitle`·`seriesEpisode`)·`content.ts`(장·결론·서명 기록).
- **공개 데이터** — `getArticleDetail` 넓힘(5장) · `getColumnList` · `getPersonPage` 넓힘 · 상황 페이지 `solvedCaseCards` · 목록 카드 `sponsor`·`seriesTitle`·`seriesEpisode` · `readPublic`(닫힌 화면 한 곳). 순수 규칙 `article-logic.ts`(장 나누기·해결 사례 카드 값·표기·기자 블록 종류·공유 설명·서명자 있는 박스) · `column-logic.ts`.
- **화면** — `/news/[slug]` `components/site/ArticleView.tsx`(부분 순서 `lib/site/article-view.ts ARTICLE_PARTS`: 머리 → 알림(업데이트 표시 '수정 날짜: 사유' · 갱신 배너 · 정정 이력 — 본문 위) → 본문(대표 이미지 · 카드뉴스 · 해결 사례 카드 · 블록 `ArticleBlocks.tsx` · 개정 트래커 · 출처) → 「지방세로 읽기」 → 기자 소개 → 자사 상품(0) → 면책 → 관련 기사 → 다음 행동 띠 → 정책 링크, 부분마다 `data-article-part`) · JSON-LD는 `pageJsonLd(detail.view)` 한 스크립트 · 메타(제목·설명·canonical·og). 카드뉴스 `CardNewsSlider.tsx`(4:5 장, 가로 스크롤 맞춤 스와이프, ←/→·Home·End, 이전·다음 44px, 장 이름 = 대체 텍스트). 공유 `ShareButton.tsx`(기기 공유 창 또는 주소 복사 — 바깥 스크립트 0). 칼럼 `ColumnView.tsx` · 인물 `PersonView.tsx` · 상황 페이지 해결 사례 카드 · 목록 카드의 표기 배지(`ArticleItem.tsx` — 상세 머리와 같은 함수) · 닫힌 화면 `Unavailable.tsx`·`ClosedListView.tsx`.
- **`@ltr/ui` 바꿈** — 기자 소개 블록·`SiteLink`·갱신 배너 링크를 `UiLink`로(화면 전환), 기자 소개의 정책 링크는 `null`이면 그리지 않는다(정책 페이지 공개 승인 전 — HELP-05) · 해결 사례 카드 결론 `interpretation`(해석, navy) · 모르는 결론 값이면 카드 0 · 인물 페이지 머리 확인일 없으면 줄 0.
- **응답 상태** — 7.0 (삭제 410 · 읽지 못함 503 · 목록은 200 + 안내).
- **시험** — 단위 `article-logic.test.ts`(서명자 있는 박스·장 나누기·해결 사례 카드·표기·공유 설명·약력 증빙) · `column-logic.test.ts` · `lib/site/article-view.test.ts`(표기 배지 = 목록 카드 규칙·부분 순서·날짜 줄·문단 링크·표·박스 링크·정책 링크) · `lib/site/public-gate.test.ts` · `input.test.ts`·`plan.test.ts`·`editor-state.test.ts`(장·연재·서명 기록) · editorial `card-news.test.ts`·`solved-case.test.ts`(결론) · `@ltr/ui` 기자 소개 정책 링크·해결 사례 해석·인물 확인일·`link.test.tsx`(기사 신뢰 블록 화면 전환) · 통합 `public-data.itest.mjs`(서명자 이름·이미지 주소·칼럼 목록·칼럼 상세) · E2E `e2e/site-article.test.mjs`(a~l — 1장 4단계 증거) · `e2e/site-degraded.test.mjs` · `a11y` 기사 상세·카드뉴스 95 이상 · `site-hubs`의 꺼진 기능 목록에서 `/people` 뺌(이제 있는 화면). CI `scripts/ci/db-e2e.sh`에 E2E 2개.
- 5단계로 넘김: W2-b 9장 증거 전부를 한 E2E로 — 홈·상황·기사 화면 규칙(run-screen-rules 대상에 기사 상세·카드뉴스·칼럼 목록 — 주소가 시험 자료라 지금은 site-article이 잰다) · 사이트 안 이동 새로고침 0(홈 → 허브 → 상황 → 기사 → 인물 → 칼럼 이어서) · 숨긴 메뉴·v1.2 경로 링크 0을 기사 상세·칼럼·인물까지 · 삭제 410·503을 배포 주소(E2E_BASE_URL)에서 다시. → 8.5에서 했다(배포 주소는 남음).

### 8.5 5단계 — 수용 E2E (2026-10-18)

- **E2E** `e2e/w2b-acceptance.test.mjs` — standalone 빌드 하나·브라우저 하나(원격 디버깅 포트 — 같은 브라우저로 Lighthouse)·시험 자료 하나. 자료는 편집국 API로 만든다: 기자·편집 책임자·세무 감수위원·필자 계정(StaffFixture) → 보도 3(정량형 지자체뉴스·경기 태그 / 정성형 부동산·서울 태그 / 정성형 지방세 — 출처·근거·필수 기록·편집 승인·발행) · 세법 해설(세무 감수 → 발행 → 정정 1건, 개정안 연결) · 「지방세로 읽기」 박스 기사(감수 서명 기록) · 카드뉴스 5장 · 해결 사례 · 칼럼 연재 2회 · 삭제 기사(410) · 초안(404) · 용어 2(사전 API) · 상황 카드 2(작성 → 감수 서명 → 공개·허브 자리, 하나는 지역 선택) · 홈 배치(트래커 1·스토리 3). API가 없는 개정 트래커만 DB에 직접. 기사 본문에 실제 원고처럼 사이트 안 링크(열린 화면·꺼진 기능 `/calc`·`/about/editorial-policy`·아직 없는 `/glossary`·v1.2 `/region/…`·`/resources/…`·`/pricing`·`/ask`)를 섞는다. 기준 목록은 문서에서 읽는다 — 홈 순서(PRD_최종 §4.1 홈 줄 = 2.3 `home_sections`), 꺼진 기능·아직 없는 화면(7장 '만들지 않는 경로' + 2.3 정책 링크 주소), 단계 전·v1.2 경로(PRD-01A 3장 + PRD-00 8장 'v1.2 경로 대체'의 옛 주소). 끝나면 만든 행을 지우고 표 23개·계정 수·운영 설정이 시험 전과 같은지 본다. 로컬 2분 40초쯤(빌드 포함). CI `scripts/ci/db-e2e.sh`에 더했다.
- **링크 전수의 '화면 전환' 판정** — 페이지마다 모든 `a[href]`를 합성 클릭하고, 창(window) 단계에서 기본 동작이 이미 취소됐는지(앱 링크가 받음) 본 뒤 기본 동작을 막는다. 앱이 시작한 화면 전환의 RSC 요청(`_rsc`)은 그 페이지 안의 `fetch`에서 붙잡아 서버로 보내지 않는다(브라우저 가로채기로 붙잡으면 서버가 '스트림이 일찍 닫힘'을 남긴다). 바깥 링크는 반대로 앱이 받지 않아야 한다(전체 이동, FND-09).
- **고친 결함 (제품 코드)**
  1. v1.2 옛 주소 4개가 숨긴 경로 목록에 없었다 — PRD-00 8장 'v1.2 경로 대체'의 `/academy`·`/pricing`·`/ask`(`/ask/[sessionId]`)·`/realestate/trust`. 기사 문단의 `[구독 안내](/pricing)`·`[지방세봇](/ask)`이 404로 가는 링크가 됐다 → `constants.ts BLOCKED_PREFIXES`에 더하고, 단위 시험이 PRD-00 줄을 읽어 옛 주소는 모두 막고 새 주소는 막지 않는지 본다.
  2. 기사 문단의 손 링크가 기능 공개 목록을 보지 않았다 — 꺼진 기능(`/calc`·`/about/editorial-policy`)·아직 없는 화면(`/glossary`)으로 가는 링크가 그대로 나와 404였다(HOME-02 '빈 링크 0'). → `isOpenPath`(5장 끝)를 더하고 공개 데이터 함수가 문단의 닫힌 화면 링크를 글자로 바꾼다(`article-logic.ts openParagraphLinks`·`openBlockLinks`, `getArticleDetail`). 「지방세로 읽기」 해설 링크도 같은 판정(계산기·도서·전문가 링크는 지금처럼 그 기능 키로). 화면의 링크 표기는 `MARKDOWN_LINK` 하나를 공개 데이터 함수와 화면이 같이 쓴다.
  3. 어느 화면에도 맞지 않는 주소(예: `/local/reporting` — 9장 #27, 지운 옛 주소)는 Next.js 기본 영어 404 화면이었다 → `app/not-found.tsx`가 공개 화면과 같은 쉬운 말 안내(`components/site/NotFoundNotice.tsx` — `app/(site)/not-found.tsx`도 같은 것)를 보인다. 응답 404·noindex 그대로 (9장 #54).
- **시험 정리** — 접근성 측정 함수를 `e2e/lib/a11y.mjs`로 옮겨 `a11y.test.mjs`와 함께 쓴다. `run-screen-rules`는 고정 주소만 재므로(시험 자료 주소는 시험이 잰다) 설정 파일에는 설명만 더했다. 화면 규칙 표는 `e2e/reports/w2b-acceptance-screen-rules.md`(CI 기록).
- **로컬에서 증명하지 못한 것** — 배포 주소(E2E_BASE_URL)의 삭제 410·503 · Docker 이미지로 같은 수용 E2E(E2E_TARGET=docker — 이 시험은 로컬 standalone으로만 돌렸다) · 카카오톡 인앱 브라우저·실기기 점검(UX-06) · JS를 끈 브라우저 본문 확인(FND-09 — site-article·site-hubs 범위) · 측정 이벤트(`home_entry_clicked`·`situation_card_clicked`·`next_action_clicked` — 표가 아직 없다, 9장 #26).

#### W2-b 수용 결과 (PRD-01A 9장 증거 → 시험 → 결과)

| 9장 증거 (요구사항) | 시험 (`e2e/w2b-acceptance.test.mjs`) | 결과 |
|---|---|---|
| 홈 섹션 순서 E2E (HOME-01·03·04 · UX-05 '홈에 상황 카드 0') | `1) 홈 섹션 순서 = PRD_최종 §4.1` | 통과 — 360·1280 모두 DOM·화면 위치 히어로 → 4대 분야 → 최신 자체 취재 → 개정 트래커, 내용 없는 금주 핫뉴스·칼럼·상품·전문가 요소 0, 보도 3건 최신 순·트래커 '확정 아님' 1·스토리 3(배치 순), 상황 카드 0 |
| 홈·상황·기사 화면 규칙 통과 (UX-02 · UX-06 · HOME-01) | `2) 화면 규칙 R1·R2·R3` | 통과 — 홈·허브·상황·기사 상세 × 360·640·1024 = 12회: R1(360) 92~143자, R2 주 버튼 0(기능이 모두 꺼져 검색 단추 없음), R3 오렌지 0.08% 이하 |
| 사이트 안 이동 새로고침 0 (FND-09) | `3) 이어 걷기` · `4c) 사이트 안 링크는 모두 화면 전환` | 통과 — 링크 15곳을 차례로 누르고 뒤로 15번: 문서 요청 0·표식 유지·navigation 1, 뒤로 가기 뒤 홈 스크롤 위치 복원 / 전수 1,178개 사이트 안 링크 모두 앱이 받음, 새 창·내려받기 0, 바깥 8개는 전체 이동 |
| 숨긴 메뉴·v1.2 경로 링크 0 (HOME-02 · HELP-05 · ART-06 · MIG-02) | `4b)` · `4b′) 기사 본문의 손으로 쓴 링크` | 통과(결함 1·2 고친 뒤) — 46쪽 1,232개 링크에 꺼진 기능·아직 없는 화면·단계 전·v1.2 경로 0, 모든 쪽 상단 메뉴 4·헤더 정책 링크 0·지방세봇/지역·축제/AI 도우미 0, 본문 닫힌 화면 링크는 글자만 |
| (링크 검사 404 0 — HOME-01 · ART-02 · UX-05) | `4a) 전수 페이지 응답 200` · `4d) 설계대로의 응답` | 통과 — 46쪽 모두 200·화면 오류 0·제목 1, 삭제 기사·초안 링크 0 / 삭제 410·초안·없는 기사·인물·상황·하위 분야 404·`/local/reporting`·`/realestate/columns` 404(결함 3 고친 뒤 쉬운 말 안내), 빈 하위 분야 200 + noindex + 상위 허브 안내 |
| (SEO-04 SITE_INDEXING off — 전 페이지 noindex) | `5) noindex` | 통과 — 46쪽 robots 메타 1개·noindex, `/admin` 머리글·`/admin/login` 머리글·메타 |
| (UX-06 · FND-09 360px 가로 스크롤 0) | `6) 360px` | 통과 — 46쪽 모두 0 |
| (PRD_최종 §9.5 접근성 95) | `7) 접근성 95점 이상` | 통과 — 홈·허브·상황·기사 상세 100점 |
| (시험 정리 — 남는 행 0) | `정리` · `시험 동안 예상 못 한 서버 오류가 없었다` | 통과 — 표 23개·계정·운영 설정 시험 전과 같음, 서버 오류 줄 0 |

## 9. 결정·확인 필요

| # | 내용 | 지금 기본값 | 표시 |
|---|---|---|---|
| 1 | 행정구역 코드 체계 — 법정동코드(10자리) / 행정기관코드(7자리) | 법정동코드 10자리. 시·도 17곳만 씨앗, 시·군·구는 W4 전국 적재 | [확인 필요] |
| 2 | 시·도 17곳 코드 값 — 출처 행정표준코드관리시스템(code.go.kr) 법정동코드. 강원특별자치도 `5100000000`(옛 강원도 `42`)·전북특별자치도 `5200000000`(옛 전라북도 `45`) | 씨앗에 현재 코드만, `valid_from` 비움 | [확인 필요 — W4 전국 적재 전 원본 파일과 대조] |
| 3 | 시·도 공개 slug(영속 주소 `/local/[sido]`) — 로마자 짧은 이름(`seoul`·`gyeonggi` …) | 씨앗 값 | [확인 필요 — 영속 주소] |
| 4 | 일반구(예: 수원시 장안구)를 시·군·구 단계로 둘지 | 단계 2종만(시·도·시·군·구) | [확인 필요 — W4] |
| 5 | `regions.status`·`seo_status` 칸(PRD-01B 5.5) | 만들지 않음 — 색인 판정은 렌더 때 설정 기준값으로 계산(REG-09) | [확인 필요 — W4] |
| 6 | 상황 목록 확정·지자체뉴스 상황 카드 여부 (UX-05) | 씨앗 없음 — 초안 12개(지방세: 고지서를 받았어요 · 차를 팔았어요·폐차했어요 · 세금을 돌려받고 싶어요 · 지방세 실무자예요 / 부동산: 집을 샀어요 · 재건축·재개발 조합원이에요 · 부모님 집을 상속받았어요 · 형제자매와 공동상속했어요 · 자녀에게 집을 증여하려 해요 · 부담부증여를 검토해요 / 개발금융: 신탁 부동산이에요 · 법인이 부동산을 사요)는 3단계 CMS(`/admin/situations`)로 편집국이 만들고 PO가 감수 서명한다. `local` 분야 값은 DB·CMS가 받는다 | [결정 안건] |
| 7 | `situations`의 '자주 틀리는 점'(`mistakes`)·감수 기록(`reviewer_id`·`reviewed_at`) 칸 — 6.1 칸 목록에 없고 3장 화면 표·1.3·FAM-02에서 나왔다. PRD-00 9장의 `doc_checklist`(3)는 이 문서의 `checks`(정확히 3개)다 | 더함 | [확인 필요 — PRD-00 9장 칸 이름] |
| 8 | 홈 카드 노출 기간의 끝을 비울 수 있는가 | 비우면 끝 없음(빼기 전까지) | [확인 필요] |
| 9 | 스토리 카드 대상 유형 | 광고·금주 핫뉴스만 거부(나머지 유형 허용) | [확인 필요] |
| 10 | 트래커 대체의 '최근 단계가 바뀐' 기준 | 현재 단계 기록의 날짜(`occurred_on`), 같으면 늦게 기록된 것 | [확인 필요] |
| 11 | 편집 승인 취소(발행 뒤 desk_edit 반려) 기사 | 공개는 유지, 홈·`/news` 취재 목록에서는 빠진다(`reported_approved` false) | [확인 필요] |
| 12 | 용어사전 공개 범위 — 모든 용어 공개(PRD-00 6장). 공개 상태 칸이 생기면(W2-d) 정책을 좁힌다 | W2-d 3단계에서 좁혔다 — 공개 상태 칸 `visible`(새 용어는 숨김, 칸이 생기기 전 용어는 공개 그대로)인 용어만 공개 (W2-d 설계 2.5 · 12장) | [확인 필요 — W2-d 12장] |
| 13 | 「지방세로 읽기」 박스의 감수자 이름·감수일 공개 칸 (TaxLensBox가 요구) | 4단계 — 세무 감수 승인 때 서버가 박스에 서명 기록(`reviewed_by` 감수위원 people.id · `reviewed_at`)을 남기고(PRD-01B 6장 tax_lens 칸), 공개 화면은 그 감수위원이 공개 인물일 때만 '감수 ○○'와 박스를 보인다(BR-03 — 손으로 넣는 이름 0). 비공개 감수위원·서명 기록 없는 박스는 박스 0. 기사 단위 '세무 감수 ○○'(기자 소개 블록)는 서명 기록 공개 칸이 없어 0 — BR-03 재감수(실질 수정 판정)와 함께 01C | [결정 — 기사 단위는 01C 확인 필요] |
| 14 | 칼럼 연재 회차 칸 (ART-04) | 4단계 — `articles.series_title`·`series_episode` 칸(마이그레이션 13, 3장). 연재 표(`column_series`)는 두지 않았다(PRD 6장에 없음). 필자 체계(이해관계·자격·계약 — 01B TX-14~17)는 W3 | [결정 — 연재 표가 필요하면 W3] |
| 15 | 관련 기사 — CMS 칸 없음 | 같은 개정안 → 같은 하위 분야 → 같은 분야 최신으로 계산 | [확인 필요] |
| 16 | 추천 검색어 편집 화면 — HOME-01은 편집자 지정, 지금은 설정 화면(관리자) | 칩은 검색 폼 안에 있어 `search` 키(검색 화면 W2-d)가 켜질 때까지 보이지 않는다(#18) → 편집 책임자용 편집 칸은 W2-d에서 홈 배치 화면에 더한다. 그때까지 관리자 설정 화면 | [확인 필요] |
| 17 | 지자체뉴스 기사 지역 태그 필수(CAT-03) 발행 차단 | 01B W4(지역 기사 CMS)와 함께 발행 판정에 더한다 — W2-a 시험 기사들이 지역 없이 발행돼 있다 | [확인 필요 — W4] |
| 18 | 히어로 검색 폼 — HOME-01은 히어로에 통합 검색, `/search`는 W2-d | `search` 키가 켜졌을 때만 검색 폼·추천 검색어 칩을 그린다(없는 화면으로 가는 폼 0). 꺼진 동안 첫 화면 주 버튼은 0개 | [결정 — W2-d에서 검색 화면과 함께 켠다] |
| 19 | 사이트 안 링크 미리 받기(prefetch) | 끈다 — 공개 화면은 모두 요청 때 그려 미리 받을 것이 경로 모양뿐이고, 보이는 링크마다 서버 요청이 생긴다. 누르면 그때 받아 화면을 바꾼다(새로고침 0). 화면마다 `loading.tsx`(즉시 뼈대)를 둘 때 다시 본다 | [확인 필요] |
| 20 | 홈 반영 시간 (HOME-03·04 1분) | 편집국 쓰기 = 바로, DB 직접 수정 = 30초 재검증(방문이 이어지면 1분 안). 7.1 | [결정] |
| 21 | 헤더 하위 메뉴(분야 데이터 + `뉴스 전체`, HOME-02) | 3단계에서 그렸다 — 분야 링크 옆 펼침 단추로 연다(8.3). 하위 메뉴는 허브 탭과 같은 목록 | [결정] |
| 22 | AI 도우미 런처 (모든 공개 페이지 우측 하단, 01C CHAT-01) | 아직 두지 않는다 — 패널·첫 사용 고지와 함께 01C에서. 누를 곳 없는 단추 0 | [01C] |
| 23 | 바닥글의 이용약관·이메일무단수집거부·측정 거부·대표전화·오시는 길 (HELP-05) | 링크 0·줄 숨김 — 정책 페이지 기능 키(2.3)에 이 셋이 없고, 매체 정보는 공개 설정 키가 아니다. W2-e에서 기능 키·설정 키를 더한다 | [확인 필요 — W2-e] |
| 24 | 헤더 [로그인] 버튼 | 두지 않는다 — 회원 화면(W2-e) 전 | [W2-e] |
| 25 | 히어로 아이브로·입력창 안내·섹션 제목 글자 | 아이브로 `LOCAL TAX · REAL ESTATE · DEVELOPMENT FINANCE · LOCAL`(PRD-01A 3장 골격 — PRD-00 8.10의 `LOCAL TAX FIRST`는 결정 안건), 안내 "예: 2026년 지방세제 개편안", 섹션 제목은 PRD 화면 표 이름(4대 분야 · 최신 자체 취재 · 개정 트래커 하이라이트 · 해설 스토리). 핵심 메시지만 설정 값 | [확인 필요 — 편집국 문구] |
| 26 | 4대 분야 카드를 누르면 `home_entry_clicked`(HOME-01) | W2-c 1단계부터 보낸다(측정 거부·GPC면 0 — `docs/dev/W2-c_설계.md` 6장). 상황 카드 `situation_card_clicked`(UX-05)는 W2-c 뒤 단계가 같은 도우미로 붙인다 | [W2-c] |
| 27 | 지자체뉴스 허브의 탭·헤더 하위 메뉴 | 하위 분야(`reporting` 등) 경로를 만들지 않고 기사 있는 편집 분야(`/local?topic=` — 분야 필터 값·글자)로 둔다. `/local/[category]`는 시·도 주소와 겹친다 | [확인 필요] |
| 28 | `/tax/amendments`·`/realestate/projects` 등 01B 화면이 있는 하위 분야 | 3단계는 모든 공개 하위 분야를 일반 하위 분야 목록(기사 카드)으로 연다(기사 있을 때 탭·메뉴). 01B가 같은 경로에 트래커·프로젝트 목록을 더한다. `amendments` 키는 트래커 상세 링크만 | [확인 필요] |
| 29 | 기사 0건 하위 분야·기사 없는 편집 분야로 직접 들어올 때 | 200 + `noindex` + 상위 허브 안내 (CAT-02 '상위 허브 안내 + noindex', REG1-01 빈 지역과 같은 방식). 없는·비공개 하위 분야는 404 | [결정] |
| 30 | 허브·뉴스 전체 탭 맨 앞 `[전체]` | 둔다 — 하위 분야에서 허브로 돌아가는 탭. 하위 분야가 0개면 탭째 없다 | [확인 필요] |
| 31 | 상황 카드 '먼저 확인할 것'을 초안에서도 3개로 | 백오피스는 초안도 정확히 3개로만 저장한다(DB는 초안 3개 이하를 받는다) — 감수할 문장이 정해진 뒤 서명받게 | [확인 필요] |
| 32 | 상황 카드 권한 | 쓰기 = 기자·편집 책임자·관리자(PRD-00 6장 'CMS 작성·상황 카드'), 공개·허브 배치·순서 = 편집 책임자(발행 승인·홈 배치와 같은 편집 행위), 감수 서명 = 세무 감수위원 | [확인 필요] |
| 33 | 공개 중인 상황의 감수 대상 문장(먼저 확인할 것·체크리스트·자주 틀리는 점) 고치기 | 막는다(409) — 먼저 내리고 고친 뒤 다시 감수·공개. 제목·한 줄·연결은 공개 중에도 고친다(감수 대상 아님 — DB 규칙과 같다) | [결정] |
| 34 | 감수 서명이 가리키는 판 | 감수위원이 읽은 판(`updatedAt`)에만 서명 — 그 사이 바뀌었으면 409 | [결정] |
| 35 | LG-08 블록에 담는 편집 분야 | ② 지방세·지방재정 = `local_tax`·`local_finance`, ③ 부동산·개발 = `realestate`·`urban_policy`(도시정책) | [확인 필요] |
| 36 | 해결 사례 카드의 결론 배지 (3장 화면 표 · CAT-05) | 4단계 — `solved_case.conclusion`(JSON 칸 — DB 칸 아님) 값 5종 인용·일부 인용·기각·각하·해석. 결론 없으면 발행 불가(`cat05.conclusion-missing` — 결과 칸의 일부). '해석'은 결정례가 아니라 유권해석·예규로 결론이 난 사례(PRD-00 8.6 결정례 카드는 인용·기각·각하만) | [확인 필요 — 값 목록] |
| 42 | 발행 뒤 주소(slug) 바꾸기와 301 (NAV-05) | 발행된 기사의 slug는 바꿀 수 없다(W2-a 편집국 API 409) — 옛 주소가 생기지 않아 4단계에 301이 없다. 이관 기사 옛 주소 301은 W9 MIG-02 `redirects` 표 | [결정] |
| 43 | 삭제된 기사 410 (NAV-06) | `article_tombstones`(주소·삭제 시각만 공개) + `proxy.ts`가 410 안내 쪽(공개 틀 없이 혼자 서는 HTML — 디자인 토큰 CSS가 없는 응답)을 보낸다. 삭제 이유·제목은 보이지 않는다 | [확인 필요 — 안내 문구·사유 공개 여부] |
| 44 | 공개 데이터를 읽지 못할 때 (운영 — 시험 주소 500 결함) | 목록 200 + 안내 한 줄 · 상세 503 "잠시 뒤 다시 확인해 주세요"(no-store) · 500 0 — 7.0 | [결정] |
| 45 | 카드뉴스 공유 미리보기 (ART-03 '첫 장이 보인다') | og:description = 첫 장 제목·글, og:image = 대표 이미지(권리 확인). 첫 장을 그림으로 만드는 일(서버 그림 생성)은 하지 않았다 — 저장소 글꼴이 woff2뿐이라 그림 생성기가 한글을 그릴 수 없다(ttf·otf 필요). 카카오톡 미리보기에 첫 장 '그림'이 필요하면 글꼴 파일을 더해 `opengraph-image`로 [확인 필요] | [확인 필요] |
| 46 | 카드뉴스 템플릿 3종 (ART-03) | 값이 PRD에 없어 장 모양 하나(4:5 navy 장) — 템플릿 칸은 템플릿이 정해지면 더한다 | [확인 필요] |
| 47 | 카드뉴스 장의 대체 텍스트 | 장 글자가 HTML이라, 대체 텍스트는 장의 그림·배치를 글로 적은 것 — 화면 읽기 프로그램이 장 이름("2 / 5 — 설명")으로 읽는다 | [확인 필요] |
| 48 | 칼럼 목록에 넣는 기사 | 그 분야의 공개 `opinion` 전부(하위 분야 상관없이 — ART-04 정의). 허브 탭 '칼럼'은 여전히 하위 분야 `columns`에 기사가 있을 때만(3단계 규칙). 부동산 칼럼 경로는 01B W4가 하위 분야 `columns`를 더하면 열린다(지금 404). 한 쪽 100편 | [확인 필요] |
| 49 | 공동 기획 기사의 기사 유형 배지 | 공동 기획(`sponsored` + `co_planned`)은 유형 배지 '광고'를 빼고 제휴 배지 '공동 기획 ○○'만 — PRD-00 8.8 '광고와 공동 기획을 섞지 않는다'. 광고는 유형 배지 '광고' 하나. 목록 카드·상세 머리가 같은 함수 | [확인 필요] |
| 50 | 칼럼 필자 블록의 이해관계 줄 (TX-15) | 이해관계 공개 칸이 아직 없어 '이해관계: 확인 필요'로 보인다(컴포넌트 규칙 — 줄을 빼지 않는다). 필자 체계 W3에서 칸을 정한다 | [확인 필요 — W3] |
| 51 | 동영상 블록·인포그래픽 블록 | W2-c 4단계에서 바꿨다 — 동영상은 누르면 그 자리에서 재생되는 카드(누르기 전 유튜브 요청 0, 새 창 링크 없앰), 인포그래픽은 그림 + 같은 내용의 표·목록(기본 접힘)·단위·출처 (W2-c 설계 8.4) | [W2-c] |
| 52 | 기사 상세 첫 화면 R1 (2026-10-18 고침 — Linux CI에서 줄바꿈 차이로 알림 첫 줄이 첫 화면에 들어와 168자) | 좁은 화면(sm 680px 미만)은 **머리가 첫 화면을 맡는다** — 분야 칩·배지·제목·요약은 위, 기자 줄은 첫 화면 아래 끝(머리 상자 높이 = 화면 높이 − 머리글 64px − 위 여백 80px). 날짜 줄(최초 발행·실질 수정·법령 기준일)·공유 버튼·알림(업데이트·정정)·본문은 첫 화면 바로 아래에서 시작한다. 첫 화면 글자 = 머리글 + 칩·배지 + 제목 + 요약 + 기자 — 줄바꿈·알림 길이와 상관없이 정해진다(최악 견본: 제목 40자·요약 60자 자연 문장 100자, 공백 없는 글자 125자). 넓은 화면은 그대로 흐른다(칩 → 제목 → 요약 → 기자 → 날짜 → 공유). 요약도 제목처럼 긴 낱말을 줄바꿈한다(`overflow-wrap:anywhere`). 날짜는 그대로 `<time datetime>` — JSON-LD·compareRendered 일치 그대로. 시험 `e2e/site-article.test.mjs` l)(최악 견본 2개 + 알림 — 기자 줄은 첫 화면 안, 날짜·알림은 첫 화면 아래) | [결정 — PO 확인: 휴대폰 첫 화면에 날짜·공유가 안 보인다] |
| 37 | 상황 페이지 다음 행동 | `[같은 분야 더 보기]`(그 분야 허브)를 늘 둔다 + 연결 칸 기능이 열리면 그 버튼(우선순위 설정 순서, 2개까지) | [확인 필요] |
| 38 | R1(첫 화면 150자)을 재는 폭 | PRD-00 8.2대로 360×740에서만 — 허브는 1024px에서 기사 카드 3장이 한 줄에 보여 150자를 넘는다(시험 자료 180자). 640·1024는 R2·R3만 판정 | [확인 필요] |
| 39 | 하위 분야 목록의 기간·지역 필터 칩 (3장 화면 표) | 필터 값(기간 구간·지역 단위)이 PRD에 없어 3단계에 두지 않는다 — 01B W4 지역 목록과 함께 | [확인 필요] |
| 40 | 지방세·부동산·개발금융 허브의 분야 고유 블록(트래커 하이라이트·프로젝트·구조 해설) | 01B W3·W4가 그 표·화면과 함께 같은 자리(탭과 최신 목록 사이)에 더한다 | [01B] |
| 41 | 허브·상황 페이지의 용어 칩 | 용어와 쉬운 풀이 — 기능 키 `glossary`가 켜지면 칩이 그 용어의 용어사전 쪽(`/glossary/[번호]`) 링크가 된다(W2-d 3단계), 꺼져 있으면 링크 0 | [W2-d] |
| 53 | 기사 문단에 편집자가 쓴 사이트 안 링크가 닫힌 화면으로 갈 때 | 꺼진 기능의 화면·아직 없는 화면(`isOpenPath`)이면 공개 화면이 글자만 보인다 — 원고는 그대로, 기능을 켜면 배포 없이 링크. 숨긴·v1.2 옛 주소는 표기 `[글](주소)`를 그대로 보여 편집자가 고친다(4단계 결정 유지). 발행 판정에서 옛 주소를 막을지는 W2-c 이후 | [확인 필요] |
| 54 | 어느 화면에도 맞지 않는 주소의 404 화면 | `app/not-found.tsx` — 공개 화면 404와 같은 쉬운 말 안내와 홈 링크(공개 틀 밖 — 분야 메뉴를 읽지 않는다). 백오피스의 없는 주소도 같은 화면이다 | [확인 필요 — 공개 틀 안으로 넣을지] |
| 55 | 기사 제목·요약 글자 상한 (R1 — 52의 머리 글자를 묶는다) | 제목 40자 · 요약 60자(R8 화면 문장 60자와 같은 값), 공백 포함·앞뒤 공백 뺌. 기사 저장 API(`lib/server/articles/input.ts` — 422 "제목은 40자 이하여야 합니다 (지금 n자 …)")와 편집 화면·새 기사 화면이 같은 문장으로 막는다(`@ltr/editorial` `ARTICLE_HEAD_LIMITS`·`headLengthProblem`). 화면 칸에 "40자 이하 — 지금 n자" 안내. 이미 저장된 긴 제목은 그 칸을 고칠 때 막힌다(DB 제약 아님). 목록 카드·해결 사례 카드·비슷한 사례 제목도 공백 없는 긴 글자를 줄바꿈한다(360px 가로 스크롤 0) | [결정 — PO 확인: 상한 값] |
