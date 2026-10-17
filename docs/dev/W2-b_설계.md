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
| settings.public_keys (anon이 읽는 설정 키) | `home_core_message` · `home_search_chips` · `hub_intros` · `amendment_confirmed_stage` · `hub_situation_limit` · `feature_flags` · `next_action_priority` |
| feature_flags (기능 공개 목록 — 없거나 false면 닫힘) | `calc` · `experts` · `store` · `edu` · `search` · `sm_calculator` · `expert_finder` · `self_calculator` · `taxbot` · `region_hubs` · `amendments` · `page_about` · `page_editorial_policy` · `page_ethics` · `page_corrections` · `page_ad_policy` · `page_privacy` · `page_help` |
| next_action (다음 행동 버튼 키, ART-06) | `situation` · `same_section` · `local_news` · `sm_calculator` · `expert_finder` · `self_calculator` · `taxbot` |
| home_sections (홈 섹션 순서 고정, HOME-01) | `hero` · `fields` · `latest_reports` · `weekly_hot` · `amendments` · `column` · `product` · `experts` |
| policy_links (기사 하단 정책 링크 7종 순서, ART-02) | `about` · `editorial_policy` · `ethics` · `corrections` · `ad_policy` · `privacy` · `help` |

- 기능 키의 화면 이름·주소: 유틸 메뉴 `calc` 계산기 `/calc` · `experts` 전문가 소개 `/experts` · `store` 구독·도서 `/store` · `edu` 교육 `/edu` · `search` 검색 `/search` (HOME-02 순서). `sm_calculator` SM 계산기 카드(01B TX-01) · `expert_finder` [전문가 찾기](01C EXPL-06) · `self_calculator` 자체 계산기(2단계) · `taxbot` 지방세봇 모드(4단계) · `region_hubs` 시·도·시·군·구 지자체 허브 `/local/[sido](/[sigungu])`(01B W4) · `amendments` 개정 트래커 페이지 `/tax/amendments(/[slug])`(01B W3 — 홈 트래커 카드·개정 브리핑 배지의 트래커 링크) · `page_*` 정책 페이지(HELP-05 — 법률 검토 승인 기록 뒤 켠다, W2-e).
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
| `getHubData(section)` | 허브 머리(이름·아이브로·한 줄 소개 설정) · 하위 분야 탭(공개 분야 중 목록 기사 1건 이상) · 최신 목록 · 상황 카드(허브 자리 순, 상한까지, 0이면 숨김) · 관련 용어 칩. 분야 지방세 포인트·분야 고유 블록·HOT은 01B·W2-c | CAT-02 · UX-05 |
| `getCategoryList(section, slug, page)` | 하위 분야 목록 · 기사 0건이면 `noindex`와 상위 허브 안내 | CAT-02 |
| `getNewsList({ section, page })` | 편집 승인된 `reported_news`만, 허브 탭 4개 | CAT-02 · LG-04 |
| `getSituationPage(slug, { region })` | 상황(공개) · 먼저 확인할 것 3개 · 일반적 체크리스트와 고지 · 자주 틀리는 점 · 기사·해결 사례(읽히는 것만, 지정 순서) · 용어 칩 · 지역 선택(이 상황만 — 시·도 17, 고르면 그 시·도의 시·군·구도) · 지역 기사(그 지역과 하위 지역 태그, 0건이면 상위 시·도 기사와 그 사실) · 다음 행동(열린 기능만) | UX-05 · FAM-02 · CAT-03 |
| `getArticleDetail(slug)` | 아래 '기사 상세 보기 모양' | ART-02~06 · CAT-04 · TX-08 · CORE-01 |
| `getPersonPage(slug)` | 공개 인물의 공개 칸(증빙 있는 약력만) · 그 사람의 기사 목록 | ART-04 · NAV-03 |

**기사 상세 보기 모양** (`getArticleDetail` — 4단계 화면이 이 값만으로 그린다)

- 머리: 분야·하위 분야 칩, 기사 유형 배지 값(`content_type`), 형식(일반이면 배지 없음), 제휴 배지 글자(`광고` · `공동 기획 ○○` — W2-a 표기 규칙), 편집 분야(지역 기사), 화면 제목·JSON-LD(`toArticleView`·`renderedFacts`와 같은 소스 — OPT-02), 기자·최초 발행일·실질 수정일·법령 기준일.
- 정정 이력(게재된 정정, 날짜 순 — 0건이면 빈 목록 → 블록 0) · 업데이트 표시(실질 수정 기록 — 정정과 다른 라벨, ART-05).
- 개정 트래커(개정 브리핑): 현재 단계·`확정 아님`·트래커 주소, 갱신 배너(기사의 실질 수정(없으면 최초 발행)보다 늦은 단계 기록이 있을 때만 — TX-08).
- 본문 블록(이미지·인포그래픽은 권리 확인되어 읽히는 것만 — 아니면 블록을 뺀다), 출처(공개 출처), 대표 이미지.
- 「지방세로 읽기」 자리: 내용이 있고 생략 사유가 없고 현재 버전 감수가 끝난 박스만 → 아니면 `null`(박스 요소 0). 링크는 열린 기능만(계산기 = `sm_calculator`, 전문가 = `expert_finder`, 도서 = `store`). 감수자 이름 칸은 아직 공개 칸이 없다 [확인 필요 — 4단계].
- 면책: 하위 분야의 `needs_disclaimer`일 때만.
- 기자 소개(공개 인물 — 평문 이메일 칸 없음), 자사 상품 카드(01C 전 `null`), 관련 기사(같은 개정안 → 같은 하위 분야 → 같은 분야 최신, 자기 자신·비슷한 사례와 겹침 0, 4건) [확인 필요 — CMS에 관련 기사 칸이 없어 계산한다].
- 다음 행동 띠(ART-06): 비슷한 사례 3건(해결 사례 먼저 → 같은 태그 수 → 같은 분야 → 최신, 자기 자신·비공개 0, 0건이면 빈 목록) + 버튼(우선순위 설정 순서, 열린 것 중 앞 2개 — [이 지역 뉴스 더 보기]는 지역 태그가 있고 `region_hubs`가 켜졌을 때만).
- 정책 링크 7종(켜진 것만) · 많이 본 기사(W2-c 전 빈 목록, 지금 기사 제외 규칙은 W2-c).
- `digest`는 기사 상세로 그리지 않는다(주간 페이지 경로 01B LG-01) → `null`.

모든 링크는 숨긴 경로·v1.2 경로 검사(`isBlockedPath`)를 지난 것만 나온다 — `/region`·`/resources`·`/authors`·`/news/cards`·`/calc/`·`/law`·`/cases`·`/workspace`·`/qna`·`/library`와 v1.2 정책 경로(`/editorial-policy`·`/corrections`·`/advertise`·`/terms`·`/privacy`·`/no-email-collection`).

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
| `/tax` · `/realestate` · `/finance` · `/local` | 4대 분야 허브 공통 골격 | CAT-02 · UX-05 | 3 |
| `/[section]/[category]` (tax·realestate·finance) | 하위 분야 목록 — 0건이면 상위 허브 안내 + `noindex` | CAT-02 · CAT-04 | 3 |
| `/news` | 뉴스 전체 — 취재 기사만, 허브 탭 4 | CAT-02 | 3 |
| `/situations/[slug]` | 상황 페이지 | UX-05 · FAM-02 · CAT-03 | 3 |
| `/news/[slug]` | 기사 상세(카드뉴스 포함 — 형식만 다르다) | ART-02 · ART-03 · ART-05 · ART-06 · CAT-04 | 4 |
| `/tax/columns` · `/finance/columns` | 칼럼 목록 (`opinion`, 필자 링크) — 연재 회차 칸은 [확인 필요] | ART-04 | 4 |
| `/people/[slug]` | 인물(기자·필자) | ART-04 · NAV-03 | 4 |

만들지 않는 경로(다른 작업): `/news/popular`·`/news/video`·`/news/photo`(W2-c) · `/search`·`/glossary`(W2-d) · `/about/*`·`/help/*`·`/my`·`/brief`(W2-e) · `/tax/amendments(/[slug])`·`/calc`(01B W3) · `/local/[sido](/[sigungu])`·`/realestate/projects` 등(01B W4~W6) · `/experts`·`/store`·`/edu`(01C). 이 경로로 가는 링크는 기능 키가 켜질 때까지 0이다. `/local`의 하위 분야(`reporting` 등) 경로는 시·도 주소 `/local/[sido]`와 겹칠 수 있어 3단계에서 정한다 [확인 필요].

### 7.1 공개 화면 그리기·캐시·재검증 (2단계 결정 — HOME-03·HOME-04 "1분 안에 홈에 반영 (캐시 재검증)")

- **요청 때 그린다.** 공개 레이아웃(`app/(site)/layout.tsx`)과 홈이 `connection()`을 부른다 — 빌드 때 DB를 읽지 않는다. Docker 이미지·CI 빌드·비밀값 검사 빌드(`scan-bundle-secrets --build`)에는 DB 접속값이 없거나 가짜라서, 빌드 때 미리 그리는 방식(ISR)은 빌드가 실패하거나 빈 값을 굳힌다.
- **읽은 공개 행은 Next.js 데이터 캐시에 둔다.** 공개 데이터 함수의 anon 요청(`lib/server/public/db.ts` → `cache.ts`)에 `next: { revalidate: 30, tags: ["public-data"] }`(규칙 `cache-policy.ts`)를 붙인다 — 이 판(Cache Components를 켜지 않은 Next 16)의 문서 방식 `fetch` 캐시. `unstable_cache`는 Next 16에서 `use cache`로 대체 예정이라 쓰지 않고, Cache Components(`cacheComponents`)는 백오피스 전체의 `dynamic` 설정과 맞지 않아 켜지 않는다.
- **편집국 쓰기는 바로 만료한다 (요청 때 재검증).** 공개 화면에 보이는 값을 쓰는 편집국 API는 `handle(fn, { revalidatesPublic: true })` — 쓰기가 성공(2xx)하면 `revalidateTag("public-data", { expire: 0 })`. 다음 요청은 낡은 값을 보이지 않고 DB를 새로 읽는다. 대상: 기사 고치기·발행·배치·편집 승인·정정·출처, 분야 더하기·고치기·순서, 용어 더하기·고치기·지우기, 제휴사 고치기, 운영 설정, 홈 배치 더하기·고치기·빼기·순서. 01B W3의 트래커 단계 기록 API도 같은 표시를 단다.
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
- 3단계로 넘김: 허브 4곳·하위 분야·`/news`가 생기면 `site-home` (c)를 '허브로 화면 전환 → 뒤로 가기에도 표식 유지'로 조이고(지금은 없는 화면이라 Next.js가 문서 이동으로 404를 연다 — 링크가 화면 전환 요청부터 하는 것까지 본다), 헤더 하위 메뉴(분야 데이터 + `뉴스 전체` — `getSiteChrome().sections[].children`)를 그린다.

## 9. 결정·확인 필요

| # | 내용 | 지금 기본값 | 표시 |
|---|---|---|---|
| 1 | 행정구역 코드 체계 — 법정동코드(10자리) / 행정기관코드(7자리) | 법정동코드 10자리. 시·도 17곳만 씨앗, 시·군·구는 W4 전국 적재 | [확인 필요] |
| 2 | 시·도 17곳 코드 값 — 출처 행정표준코드관리시스템(code.go.kr) 법정동코드. 강원특별자치도 `5100000000`(옛 강원도 `42`)·전북특별자치도 `5200000000`(옛 전라북도 `45`) | 씨앗에 현재 코드만, `valid_from` 비움 | [확인 필요 — W4 전국 적재 전 원본 파일과 대조] |
| 3 | 시·도 공개 slug(영속 주소 `/local/[sido]`) — 로마자 짧은 이름(`seoul`·`gyeonggi` …) | 씨앗 값 | [확인 필요 — 영속 주소] |
| 4 | 일반구(예: 수원시 장안구)를 시·군·구 단계로 둘지 | 단계 2종만(시·도·시·군·구) | [확인 필요 — W4] |
| 5 | `regions.status`·`seo_status` 칸(PRD-01B 5.5) | 만들지 않음 — 색인 판정은 렌더 때 설정 기준값으로 계산(REG-09) | [확인 필요 — W4] |
| 6 | 상황 목록 확정·지자체뉴스 상황 카드 여부 (UX-05) | 씨앗 없음 — 초안 12개(지방세: 고지서를 받았어요 · 차를 팔았어요·폐차했어요 · 세금을 돌려받고 싶어요 · 지방세 실무자예요 / 부동산: 집을 샀어요 · 재건축·재개발 조합원이에요 · 부모님 집을 상속받았어요 · 형제자매와 공동상속했어요 · 자녀에게 집을 증여하려 해요 · 부담부증여를 검토해요 / 개발금융: 신탁 부동산이에요 · 법인이 부동산을 사요)는 3단계 CMS로 편집국이 만든다. `local` 분야 값은 DB가 받는다 | [결정 안건] |
| 7 | `situations`의 '자주 틀리는 점'(`mistakes`)·감수 기록(`reviewer_id`·`reviewed_at`) 칸 — 6.1 칸 목록에 없고 3장 화면 표·1.3·FAM-02에서 나왔다. PRD-00 9장의 `doc_checklist`(3)는 이 문서의 `checks`(정확히 3개)다 | 더함 | [확인 필요 — PRD-00 9장 칸 이름] |
| 8 | 홈 카드 노출 기간의 끝을 비울 수 있는가 | 비우면 끝 없음(빼기 전까지) | [확인 필요] |
| 9 | 스토리 카드 대상 유형 | 광고·금주 핫뉴스만 거부(나머지 유형 허용) | [확인 필요] |
| 10 | 트래커 대체의 '최근 단계가 바뀐' 기준 | 현재 단계 기록의 날짜(`occurred_on`), 같으면 늦게 기록된 것 | [확인 필요] |
| 11 | 편집 승인 취소(발행 뒤 desk_edit 반려) 기사 | 공개는 유지, 홈·`/news` 취재 목록에서는 빠진다(`reported_approved` false) | [확인 필요] |
| 12 | 용어사전 공개 범위 — 모든 용어 공개(PRD-00 6장). 공개 상태 칸이 생기면(W2-d) 정책을 좁힌다 | 전부 공개 | [확인 필요 — W2-d] |
| 13 | 「지방세로 읽기」 박스의 감수자 이름·감수일 공개 칸 (TaxLensBox가 요구) | 아직 없음 — 박스 자리의 `reviewer`는 null | [확인 필요 — 4단계] |
| 14 | 칼럼 연재 회차 칸 (ART-04) | 없음 — 필자 체계(01B TX-14~17)와 함께 | [확인 필요 — 4단계] |
| 15 | 관련 기사 — CMS 칸 없음 | 같은 개정안 → 같은 하위 분야 → 같은 분야 최신으로 계산 | [확인 필요] |
| 16 | 추천 검색어 편집 화면 — HOME-01은 편집자 지정, 지금은 설정 화면(관리자) | 칩은 검색 폼 안에 있어 `search` 키(검색 화면 W2-d)가 켜질 때까지 보이지 않는다(#18) → 편집 책임자용 편집 칸은 W2-d에서 홈 배치 화면에 더한다. 그때까지 관리자 설정 화면 | [확인 필요] |
| 17 | 지자체뉴스 기사 지역 태그 필수(CAT-03) 발행 차단 | 01B W4(지역 기사 CMS)와 함께 발행 판정에 더한다 — W2-a 시험 기사들이 지역 없이 발행돼 있다 | [확인 필요 — W4] |
| 18 | 히어로 검색 폼 — HOME-01은 히어로에 통합 검색, `/search`는 W2-d | `search` 키가 켜졌을 때만 검색 폼·추천 검색어 칩을 그린다(없는 화면으로 가는 폼 0). 꺼진 동안 첫 화면 주 버튼은 0개 | [결정 — W2-d에서 검색 화면과 함께 켠다] |
| 19 | 사이트 안 링크 미리 받기(prefetch) | 끈다 — 공개 화면은 모두 요청 때 그려 미리 받을 것이 경로 모양뿐이고, 보이는 링크마다 서버 요청이 생긴다. 누르면 그때 받아 화면을 바꾼다(새로고침 0). 화면마다 `loading.tsx`(즉시 뼈대)를 둘 때 다시 본다 | [확인 필요] |
| 20 | 홈 반영 시간 (HOME-03·04 1분) | 편집국 쓰기 = 바로, DB 직접 수정 = 30초 재검증(방문이 이어지면 1분 안). 7.1 | [결정] |
| 21 | 헤더 하위 메뉴(분야 데이터 + `뉴스 전체`, HOME-02) | 데이터 함수는 준비됐고 화면은 3단계 — 갈 화면(하위 분야 목록·`/news`)과 함께 그린다 | [3단계] |
| 22 | AI 도우미 런처 (모든 공개 페이지 우측 하단, 01C CHAT-01) | 아직 두지 않는다 — 패널·첫 사용 고지와 함께 01C에서. 누를 곳 없는 단추 0 | [01C] |
| 23 | 바닥글의 이용약관·이메일무단수집거부·측정 거부·대표전화·오시는 길 (HELP-05) | 링크 0·줄 숨김 — 정책 페이지 기능 키(2.3)에 이 셋이 없고, 매체 정보는 공개 설정 키가 아니다. W2-e에서 기능 키·설정 키를 더한다 | [확인 필요 — W2-e] |
| 24 | 헤더 [로그인] 버튼 | 두지 않는다 — 회원 화면(W2-e) 전 | [W2-e] |
| 25 | 히어로 아이브로·입력창 안내·섹션 제목 글자 | 아이브로 `LOCAL TAX · REAL ESTATE · DEVELOPMENT FINANCE · LOCAL`(PRD-01A 3장 골격 — PRD-00 8.10의 `LOCAL TAX FIRST`는 결정 안건), 안내 "예: 2026년 지방세제 개편안", 섹션 제목은 PRD 화면 표 이름(4대 분야 · 최신 자체 취재 · 개정 트래커 하이라이트 · 해설 스토리). 핵심 메시지만 설정 값 | [확인 필요 — 편집국 문구] |
| 26 | 4대 분야 카드를 누르면 `home_entry_clicked`(HOME-01) | 측정 이벤트 표(`analytics_events`, GROW-01)가 아직 없어 보내지 않는다 | [확인 필요 — 측정 작업] |
