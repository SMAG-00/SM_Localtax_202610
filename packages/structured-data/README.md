# packages/structured-data

화면과 같은 소스에서 만드는 JSON-LD. 1단계 W1-b 골격 — OPT-02.

페이지는 JSON-LD를 손으로 쓰지 않는다. 화면을 그리는 데이터 객체(`src/models.ts`)를 그대로 `pageJsonLd()`에 넘기고, 결과를 `toJsonLdScriptContent()`로 `<script type="application/ld+json">`에 넣는다. 매체·브랜드 이름은 이 패키지에 없다 — 호출하는 쪽이 넘긴다.

## 유형 대응표 (`src/types-map.ts` 한 파일)

| 페이지 | 경로 | schema.org 유형 |
|---|---|---|
| 기사 | `/news/[slug]` | `NewsArticle` (+ 동영상 기사 `VideoObject`) |
| 매체 | `/about` | `NewsMediaOrganization` |
| 인물 | `/people/[slug]` | `ProfilePage` (주 엔터티 `Person`) |
| 행사 | `/local/events/[slug]` | `Event` |
| 도서 | `/store/books/[slug]` | `Book` |
| 교육원 강좌 | `/edu` | `Course` (회차 `CourseInstance`) |
| 통계 트래커·정량형 원자료 | `/finance` 트래커 | `Dataset` |
| 공통 | 경로 표시가 있는 페이지 | `BreadcrumbList` |

`FAQPage`는 넣지 않았다. OPT-02 목록에 없고, PRD-00 8.6 FAQ 블록은 "낼 때는 화면과 같은 값만"이라는 조건만 둔다 → [결정 안건]. 검사기는 대응표에 없는 최상위 유형을 오류로 본다.

## 공개 API (`src/index.ts`)

- 생성기: `newsArticle` · `videoObject` · `breadcrumbList` · `newsMediaOrganization` · `person` · `profilePage` · `event` · `book` · `course` · `dataset`, 페이지 단위 `pageJsonLd(input)`
- `displayTitle(title, label)` — 광고·공동 기획 표기를 붙인 제목. 화면 제목·메타 제목도 이 함수로 만든다 (`[광고] 제목`, `[공동 기획 ○○] 제목`)
- `sponsorLabelText(label)` — 배지 글자. 광고 `광고`(PRD-00 8.8), 공동 기획 `공동 기획 ` + 제휴사 이름(ART-10). `SponsorLabel`의 공동 기획은 `partnerName`이 필수다 — 비면 `공동 기획`만 남고, seo-lint 「광고 표기 일치」(`partnerMissing`)와 발행 판정(`art10.co-planned-partner-required`)이 막는다. seo-lint 규칙 파일 `badgeFormats`·`markerFormat`과 같은 글자다
- `toJsonLdScriptContent(value)` — `<` `>` `&` U+2028 U+2029 이스케이프, 키 순서 고정(@context → @type → @id → 이름순), NaN·함수·Date는 TypeError
- `compareRendered(rendered, jsonld)` → 불일치 id 배열. id 상수는 `MISMATCH`, 패널 문구는 `MISMATCH_LABELS` (seo-lint '구조화 데이터 불일치' 차단 항목이 쓴다). 화면 경로 표시(`rendered.breadcrumb` — 이름·절대 주소)를 넘기면 BreadcrumbList와 항목 수·이름·주소를 대조한다(`MISMATCH.BREADCRUMB`, W4 3단계 지역 허브). 넘기지 않으면 대조하지 않는다
- `validate(jsonld)` → 오류 배열 `{ node, path, code, message }`. 필수 속성 표 `REQUIRED_PROPERTIES`(근거 `google`/`platform`), 금지 속성 `FORBIDDEN_PROPERTIES`(평점·후기·가격)

## 행사 상태 대응 (`src/event-status.ts`)

| 화면 배지 | `eventStatus` |
|---|---|
| 예정 · 진행 · 종료 | `EventScheduled` — schema.org 정의가 "예정대로 열리고 있거나 열렸다". 진행·종료 전용 값은 없다 |
| 취소 | `EventCancelled` — 원래 일정은 그대로 |
| 변경 확인 중 | Event를 내지 않는다 (LG-16). `EventRescheduled`는 확정된 새 일정을 전제하므로 쓰지 않는다 |

화면 배지와 `eventStatus`는 `EventView.status` 한 칸에서 나온다 — 한쪽만 바뀔 수 없다.

## 검사기와 견본

- 필수 속성은 Google 구조화 데이터 문서 기준(`google`)과, Google 권장이지만 PRD가 필수로 정한 것(`platform` — 기사 제목·저자·발행일·이미지, 도서 판차, 강좌 운영 기관 등)으로 나눴다.
- **CI에서 쓸 외부 검사 도구는 [확인 필요]** (OPT-02). 이 검사기는 최소 검사이고 Google 리치 결과 테스트를 대신하지 않는다.
- `fixtures/samples.ts` 통과 견본 7유형 + 동영상·광고·공동 기획 기사·상업 행사, `fixtures/blocked.ts` 차단 견본 13종(항목 하나만 어김 → 그 오류 하나), `fixtures/rendered.ts` 화면 값 견본(손으로 적음). 내용은 모두 가상이다.

```
cd packages/structured-data
npx vitest run      # 견본 시험
npx tsc --noEmit    # 타입 검사
```

## 열린 질문

- CI 연결 — `scripts/ci/static.sh`에 `pnpm --filter @ltr/structured-data test` 줄이 아직 없다 (이 패키지 밖)
- `local_events`에 주소 칸이 없다 — Google Event는 `location.address`가 필수 [확인 필요]
- 제목에 붙이는 모양(`[배지] 제목`)은 화면 시안 확정 전 가정이다(배지 글자 자체는 PRD 글자로 정리됨, 2026-10-18). BIZ-08의 '협찬' 표기는 아직 정리 전
- 도서 정가·강좌 수강료는 내지 않는다 (가격 0 규칙) — Google Course info 리치 결과는 `offers`가 필수라 대상이 아니다
- 확정된 일정 변경의 `EventRescheduled` + `previousStartDate`, 엔티티 `about`·`mentions`(OPT-05), 유료 본문 `isAccessibleForFree`(OPT-08, 2단계)는 아직 없다
