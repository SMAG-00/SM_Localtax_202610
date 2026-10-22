# packages/editorial

기사 발행 판정 (W2-a 2단계). 설계 약속은 `docs/dev/W2-a_설계.md` §2(값 목록)·§4(발행 판정 표)이고, 요구사항 원문은 PRD-01A 4장(ART-01 · ART-05 · ART-10 · UX-01 · UX-03 · CAT-04 · CAT-05 · NAV-02~04 · NAV-10~12)과 PRD-01B CORE-01이다.

- **순수 TypeScript** — 입출력·네트워크·시계·AI 없음. 같은 입력이면 같은 결과(정렬까지 같음).
- 다른 워크스페이스 패키지를 import하지 않는다. seo-lint·similarity 결과는 `PublishContext`의 평범한 칸으로 받는다.
- 금지 표현·공포 표현·쉬운 말 사전은 `settings`에서 읽어 입력으로 넘긴다(배포 없이 바뀐다). R8 기준값(60자·3문장)은 PRD-00 8.2 값이 `R8_THRESHOLDS`에 있고 문맥으로 바꿀 수 있다.

## 쓰는 법

```ts
import { evaluatePublish, R8_THRESHOLDS } from "@ltr/editorial";

const result = evaluatePublish(article, {
  today: "2026-10-17",                       // KST 날짜 — 제휴 계약 종료 판정
  dictionaries: { forbiddenPhrases, fearPhrases, jargonTerms }, // settings 값
  thresholds: R8_THRESHOLDS,                 // { guideSentenceMax: 60, boxSentenceMax: 3 }
  seoLint: { blockers, warnings },           // packages/seo-lint 결과 ID (돌리지 않았으면 null → 차단)
  similarity: { status },                    // packages/similarity 결과 (없으면 null → 차단)
});
result.canPublish;  // 차단 0이면 true
result.blockers;    // 발행 API 422 응답에 그대로
result.warnings;    // 발행 기록(check_log)에 남긴다
```

결과 항목 `Finding` = `{ id, level: "block" | "warn", ruleRef, message, location? }`. `location`은 `{ field, blockIndex?, sentenceIndex?, phrase? }` — field는 `title` · `summary` · `blocks` · `taxLens` · `solvedCase.<칸>` · `leadImage` · `sources` · `evidence` · `interviews` · `perspectives` · `datasets` · `reviews` · `partner` · `slug` · `seoLint` · `copy:<ID>`. 정렬은 차단 → 경고, 그 안에서 아래 규칙 표 순서, 같은 규칙은 위치 순서다.

## 공개 함수

| 함수 | 하는 일 | 근거 |
|---|---|---|
| `evaluatePublish(article, ctx, { extraChecks? })` | 발행 판정 — `{ canPublish, blockers, warnings, findings }` | W2-a 설계 §4 |
| `validateTaxLensForSave(lens, ctx)` | 「지방세로 읽기」 저장 검사 — 세목 0개·포인트 0줄/4줄 이상·링크 0개·세액(숫자 + 원)·감면 단정(금지 표현) 거부, 생략 사유만 있으면 저장 | 01B CORE-01 |
| `validateRevisionForSave({ updateKind, reason })` | 발행 뒤 수정 저장 검사 — 수정 종류·사유 필수 | ART-05 |
| `validateSolvedCaseForSave(solvedCase)` | 해결 사례 저장 검사 — 개인정보 형식 거부, 실명 표현 경고 (빈 칸은 발행 때 막음) | CAT-05 |
| `infographicSaveProblems({ alt, data })` | 인포그래픽 저장 불가 사유 — 대체 텍스트·같은 내용의 표·목록 (편집 화면·저장 API 같은 문장) | ART-07 |
| `parseYoutubeEmbed(url)` · `isSixteenByNine(w, h)` | 동영상 주소 검사·정리(youtube-nocookie 임베드만) · 썸네일 16:9 판정 | ART-08 |
| `checkScreenCopy(items, ctx)` | 상황 카드·허브 소개·화면 고정 문구 검사 — 금지·공포 표현(차단), 풀이 없는 용어·60자·3문장(경고) | UX-01 · UX-03 |
| `isTaxLensTarget(section, contentType)` | 박스 요구 대상 — (부동산·개발금융·지자체뉴스) × (보도·해설·가이드·칼럼) | 01B CORE-01 |
| `taxReviewReasons(article)` · `isApproved(article, kind)` | 세무 감수 대상 이유 · 현재 버전 승인 여부 | NAV-03 · NAV-12 · ART-01 |
| `changesDateModified(kind)` | 실질 수정·정정만 `dateModified`를 바꾼다 (오탈자는 그대로) | ART-05 · OPT-07 |
| `isAmendmentBriefing(article)` | 지방세 > 개정(`/tax/amendments`) 기사인가 | CAT-04 |
| `detectPii(text)` · `detectRealNames(text)` | 개인정보 형식 · 실명 표현 찾기 | CAT-05 |
| `splitSentences` · `countChars` · `normalizeText` | 문장 나누기 · 글자 수(공백 제외) · 비교용 정리 | UX-01 R8 |

값 목록 상수(`SECTIONS` · `CONTENT_TYPES` · `REPORTING_METHODS` · `FORMATS` · `LABELS` · `SUBTYPES` · `UPDATE_KINDS` · `SOURCE_KINDS` · `EVIDENCE_TYPES` · `REVIEW_KINDS` · `REVIEW_DECISIONS` …)는 W2-a 설계 §2와 같고 DB check 제약과 같은 값이다. 규칙 목록 `RULES`가 아래 표의 원본이다(이 README 표와 같은지 시험이 본다).

견본(가상 원고 · 가상 도시 가온시)도 내보낸다 — `QUANTITATIVE_NEWS`(정량형 보도) · `QUALITATIVE_NEWS`(정성형 보도, 세금·지역 정책 쟁점) · `TAX_EXPLAINER`(세법 해설, 편집 승인 + 세무 감수) · `SOLVED_CASE` · `FAILING_SAMPLES`(한 곳만 바꾼 실패 견본과 기대 차단 항목) · `BASE_CONTEXT` · `SEED_DICTIONARIES`(settings 초기 사전 견본). 발행 API·편집 화면 E2E가 같은 견본을 쓴다.

## 규칙 표

| 항목 ID | 근거 | 등급 | 이름 |
|---|---|---|---|
| `art01.section-required` | ART-01 | 차단 | 분야(section) 없음 |
| `art01.content-type-required` | ART-01 | 차단 | 기사 유형(content_type) 없음 |
| `art01.reporting-method-required` | ART-01 | 차단 | 보도기사에 취재 방식 없음 |
| `art01.reporting-method-not-allowed` | ART-01 | 차단 | 보도기사가 아닌데 취재 방식 지정 |
| `art01.sponsored-label-required` | ART-01 | 차단 | 광고·협찬 기사에 표기 없음 |
| `art01.digest-link-required` | ART-01 | 차단 | 금주 핫뉴스에 주간 회차 연결 없음 |
| `art01.reserved-slug` | ART-01 | 차단 | 예약된 slug(video·photo·popular) |
| `art03.slide-count` | ART-03 | 차단 | 카드뉴스가 5~7장이 아님 |
| `art03.slide-alt` | ART-03 | 차단 | 카드뉴스 장에 대체 텍스트 없음 |
| `art03.slide-text` | ART-03 | 차단 | 카드뉴스 장에 글자 없음 |
| `art03.slide-outside-cardnews` | ART-03 | 차단 | 카드뉴스가 아닌 기사에 카드뉴스 장 |
| `art07.infographic-required` | ART-07 | 차단 | 인포그래픽 형식 기사에 인포그래픽 블록 없음 |
| `art07.infographic-alt` | ART-07 | 차단 | 인포그래픽에 대체 텍스트 없음 |
| `art07.infographic-data` | ART-07 | 차단 | 인포그래픽에 같은 내용의 표·목록 없음 |
| `art08.video-required` | ART-08 | 차단 | 동영상 형식 기사에 동영상 블록 없음 |
| `art08.embed-url` | ART-08 | 차단 | 동영상 주소가 youtube-nocookie 임베드 주소가 아님 |
| `art08.summary-required` | ART-08 | 차단 | 동영상 요약 텍스트 없음 |
| `art08.captions-unconfirmed` | ART-08 | 차단 | '자막 있음' 확인 안 함 |
| `art08.thumbnail-required` | ART-08 | 차단 | 동영상 썸네일 없음 |
| `art08.thumbnail-ratio` | ART-08 | 차단 | 썸네일이 16:9가 아니거나 크기를 모름 |
| `art09.photos-required` | ART-09 | 차단 | 포토 기사에 사진 없음 |
| `art09.photo-credit` | ART-09 | 차단 | 사진 출처(media.credit) 없음 |
| `art09.photo-license` | ART-09 | 차단 | 사진 이용 조건(media.license) 없음 |
| `art09.photo-alt` | ART-09 | 차단 | 사진 대체 텍스트 없음 |
| `nav02.press-release-only` | NAV-02 | 차단 | 출처가 보도자료뿐인 보도기사 |
| `nav03.author-required` | NAV-03 | 차단 | 작성 기자 없음 |
| `nav03.desk-edit-required` | NAV-03 | 차단 | 편집 승인 없음 |
| `nav03.tax-review-required` | NAV-03 | 차단 | 세무 감수 서명 없음(대상 기사) |
| `nav04.sources-required` | NAV-04 | 차단 | 보도기사에 출처 없음 |
| `nav04.own-evidence-required` | NAV-04 | 차단 | 자체 취재 근거 없음 |
| `nav04.image-rights` | NAV-04 | 차단 | 사진 권리 미확인 |
| `reg1_07.source-type` | REG1-07 | 차단 | 공식 자료 종류가 허용 목록 밖(교통·관광·음식점·생활 안내 차단) |
| `reg1_09.official-fields` | REG1-09 | 차단 | 공식 자료의 발표일·기준일·지역 단위·수집일·확인일 빔 |
| `pr07.license-required` | PR-07 | 차단 | 공식 자료·보도자료·사진 출처에 공공누리 유형 없음 |
| `pr07.photo-license` | PR-07 | 차단 | 게시하지 않는 공공누리 유형의 사진(제4유형·미표시·법률 검토 전 제2·3유형) |
| `pr07.full-text` | PR-07 | 차단 | 공공 자료 원문 본문을 그대로 옮김 |
| `reg1_17.region-tag-required` | REG1-17 | 차단 | 지자체뉴스 기사에 지역 태그 없음(새 발행) |
| `reg1_17.editorial-field` | REG1-17 | 차단 | 지역 기사에 편집 분야 없음 |
| `reg1_17.public-question` | REG1-17 | 차단 | 지역 기사에 공익적 질문 없음 |
| `reg1_17.field-judge-missing` | REG1-17 | 차단 | 판정 책임자가 없는 편집 분야(보류) |
| `reg1_17.non-news-judgement` | REG1-17 | 차단 | 여행 후기·맛집 추천·행사 홍보 판정 원고를 보도·해설로 발행 |
| `reg1_17.relation-required` | REG1-17 | 차단 | 축제·명소·상권 소재에 관계 유형 없음(보류) |
| `reg1_17.relation-evidence` | REG1-17 | 차단 | 축제·명소·상권 소재에 관계 근거 없음(보류) |
| `reg1_17.desk-checklist` | REG1-17 | 차단 | 지역 기사 편집 승인에 근거·관계·광고 독립성 확인 없음 |
| `reg1_17.interest-disclosure` | REG1-17 | 차단 | 광고·협찬 계약 제휴사를 다룬 원고에 이해관계 표시 없음 |
| `reg1_14.press-release-repost` | REG1-14 | 경고 | 같은 보도자료를 유사도 기준 이상 다시 실음 |
| `reg1_14.unsupported-figure` | REG1-14 | 경고 | 지역 수치 문단에 공식 자료·근거 연결 없음 |
| `reg1_14.photo-rights` | REG1-14 | 경고 | 사진 권리 정보 누락 |
| `reg1_14.stale-statistics` | REG1-14 | 경고 | 기준일이 설정 기간보다 오래된 통계 |
| `nav10.source-data` | NAV-10 | 차단 | 원자료(파일/URL·제공기관·수집일·이용권리) 빔 |
| `nav10.indicator-definition` | NAV-10 | 차단 | 지표 정의(정의·기간·단위·지역 단위·분모·제외값) 빔 |
| `nav10.calculation` | NAV-10 | 차단 | 계산 과정(수식·재현 파일) 빔 |
| `nav10.source-cross-check` | NAV-10 | 차단 | 원자료 대조 기록 빔 |
| `nav10.chart-labels` | NAV-10 | 차단 | 그래프·표의 축/단위/출처 빔 |
| `nav10.limitations` | NAV-10 | 차단 | 수치의 한계 빔 |
| `nav10.related-party-check` | NAV-10 | 차단 | 관련 기관·전문가 확인 빔 |
| `nav10.no-causal-claim` | NAV-10 | 차단 | '인과 단정 없음' 미확인 |
| `nav11.interview-questions` | NAV-11 | 차단 | 취재 질문 기록 없음 |
| `nav11.field-record` | NAV-11 | 차단 | 현장 확인 기록 없음 |
| `nav11.independent-sources` | NAV-11 | 차단 | 서로 독립적인 근거 2건 미만 |
| `nav11.counter-perspective` | NAV-11 | 차단 | 반대/보완 관점 기록 없음 |
| `nav11.document-evidence` | NAV-11 | 차단 | 문서 근거 없음 |
| `nav11.conflicts-of-interest` | NAV-11 | 차단 | 이해관계 확인 기록 없음 |
| `nav11.quote-record` | NAV-11 | 차단 | 인용에 인터뷰 기록·문서 근거 없음 |
| `nav11.anonymity-reason` | NAV-11 | 차단 | 익명 취재원에 익명 사유 없음 |
| `nav11.unverified-evidence` | NAV-11 | 차단 | 미확인 인터뷰·현장 기록 |
| `nav11.legal-basis-date` | NAV-11 | 차단 | 세금 쟁점에 법령 기준일 없음 |
| `nav11.perspective` | NAV-11 | 차단 | 지역 정책 쟁점의 관점 기록 없음 |
| `nav11.original-text-check` | NAV-11 | 차단 | 지역 정책 쟁점의 원문 대조 기록 없음 |
| `nav11.inheritance-consent` | NAV-11 | 차단 | 상속·증여 사례 동의 미확인 |
| `nav11.inheritance-deidentified` | NAV-11 | 차단 | 상속·증여 사례 비식별 검토 미확인 |
| `nav12.self-desk-edit` | NAV-12 | 차단 | 작성 기자 본인의 편집 승인 |
| `core01.box-or-reason` | CORE-01 | 차단 | 대상 기사에 박스도 생략 사유도 없음 |
| `core01.topics-required` | CORE-01 | 차단 | 박스의 관련 세목 0개 |
| `core01.points-count` | CORE-01 | 차단 | 박스 핵심 포인트가 1~3줄이 아님 |
| `core01.links-required` | CORE-01 | 차단 | 박스 링크 0개 |
| `core01.tax-amount` | CORE-01 | 차단 | 박스에 세액 표현(숫자 + 원) |
| `core01.forbidden-phrase` | CORE-01 | 차단 | 박스에 감면 단정 등 금지 표현 |
| `core01.box-unreviewed` | CORE-01 | 차단 | 세무 감수 안 된 박스 |
| `core01.box-re-review` | CORE-01 | 차단 | 박스 재감수 필요 |
| `cat04.tracker-required` | CAT-04 | 차단 | 개정 브리핑에 연결 트래커 없음 |
| `cat05.cell-empty` | CAT-05 | 차단 | 해결 사례 4칸 중 빈 칸 |
| `cat05.result-evidence` | CAT-05 | 차단 | 결과 근거(사건번호·해석 번호 + 링크) 0개 |
| `cat05.conclusion-missing` | CAT-05 | 차단 | 결과의 결론 배지(인용·일부 인용·기각·각하·해석) 없음 |
| `cat05.pii` | CAT-05 | 차단 | 개인정보 형식(주민등록번호·전화·이메일·상세 주소) |
| `cat05.real-name` | CAT-05 | 경고 | 실명으로 보이는 표현 |
| `ux01.forbidden-phrase` | UX-01 | 차단 | 금지 표현 |
| `ux01.jargon-unexplained` | UX-01 | 경고 | 풀이 없는 전문 용어 첫 등장 |
| `ux01.guide-sentence-long` | UX-01 | 경고 | 안내 문장 기준 글자 수 초과 |
| `ux01.box-too-many-sentences` | UX-01 | 경고 | 한 상자 기준 문장 수 초과 |
| `ux03.fear-phrase` | UX-03 | 차단 | 공포 표현 |
| `ux03.action-not-written` | UX-03 | 차단 | '기한'·'가산세' 블록의 '할 일을 함께 썼다' 미확인 |
| `ux03.rose-box-title` | UX-03 | 차단 | rose 상자 제목이 '자주 틀리는 점'이 아님 |
| `art10.label-requires-sponsored` | ART-10 | 차단 | 표기가 있는데 sponsored가 아님 |
| `art10.co-planned-partner-required` | ART-10 | 차단 | 공동 기획에 제휴사(이름) 없음 — 배지 '공동 기획 ○○'를 만들 수 없음 |
| `art10.partner-requires-label` | ART-10 | 차단 | 제휴사를 지정했는데 표기 없음 |
| `art10.partner-contract-expired` | ART-10 | 차단 | 계약이 끝난 제휴사를 새 기사에 지정 |
| `art05.update-kind-required` | ART-05 | 차단 | 수정 종류 없음 |
| `art05.reason-required` | ART-05 | 차단 | 수정 사유 없음 |
| `opt03.seo-lint-missing` | OPT-03 | 차단 | 최적화 점검 결과 없음 |
| `opt03.seo-lint-blocker` | OPT-03 | 차단 | 최적화 점검 차단 항목 |
| `opt03.seo-lint-warning` | OPT-03 | 경고 | 최적화 점검 경고 항목 |
| `opt06.similarity-missing` | OPT-06 | 차단 | 유사도 검사 결과 없음 |
| `opt06.similarity-blocked` | OPT-06 | 차단 | 유사도 기준 초과 |
| `opt06.similarity-unverified` | OPT-06 | 경고 | 유사도 비교 대상 없음 |

## 판정 기준 — PRD 문장이 다 정하지 않아 이 패키지가 정한 것

PO 확인이 필요하면 고치고 이 절과 시험을 함께 바꾼다.

- **승인은 현재 버전만** — `editorial_reviews.version`이 기사 `version`과 같고 서명 시각이 있는 기록만 센다. 같은 종류의 기록 중 가장 늦은 결정(시간대를 맞춘 실제 시각)이 approve여야 승인이다. 편집 승인은 모든 기사 유형에 필요하다(세무 감수는 편집 승인을 대신하지 않는다).
- **작성 기자 본인 편집 승인**은 승인으로 세지 않고, 현재 버전에 그런 기록이 있으면 독립 승인이 따로 있어도 차단 항목으로 남긴다(DB도 거부하는 기록). 세무 감수는 본인 여부를 보지 않는다(DB 규칙과 같음).
- **세무 감수 대상** = 세금 계산·법률 주장(`hasTaxOrLegalClaims` 또는 핵심 주장 kind `tax_calculation`·`legal`) · 면책 대상 하위 분야(`categories.needs_disclaimer`)의 해설·가이드 · 세금 쟁점 원고(NAV-11) · 해결 사례(CAT-05 "결과·교훈은 감수 대상").
- **자체 취재 근거**는 `verification_status = verified`인 근거만 센다. 확인되지 않은 인터뷰·현장 기록은 유형과 상관없이 반려(NAV-11 "미확인 방문 기록").
- **NAV-10 7묶음**: 원자료 = URL·제공기관·수집일·이용권리, 지표 정의 = 정의·기간·단위·지역 단위·분모·제외값(없으면 '없음'이라고 적는다), 계산 과정 = 수식과 재현 파일 해시 둘 다, 그래프·표 = 표·인포그래픽이 1개 이상이고 모두 축·단위·출처를 적음. 혼합형(`mixed`)은 NAV-10과 NAV-11 양쪽을 요구한다.
- **NAV-11**: 독립 근거 = 검증된 인터뷰·현장·문서 근거 2건 이상, 인용 동의 `partial`은 동의로, `none`은 거부. 문서 인용(`origin: document`)은 출처나 문서 근거에 이으면 인터뷰 기록이 없어도 된다. 인용 기록·익명 사유·세금/지역 정책 쟁점·상속·증여 검사는 표시가 있으면 기사 유형과 상관없이 적용한다.
- **CORE-01**: 박스 감수는 박스의 `reviewed`·`reviewedForVersion`으로 본다(기사 버전이 올라가면 '재감수 필요'). 대상이 아닌 기사(지방세 분야·sponsored)도 박스를 달았으면 감수가 필요하다. `digest`는 결정 안건이라 대상에서 뺐다. 세액 표현은 아라비아 숫자 + (만·억 등) + '원'만 잡는다(한글 숫자 금액 '백만 원'은 못 잡음).
- **UX-01**: 글자 수는 공백을 빼고 센다(e2e R1 글자 수 검사와 같은 셈법). 기사에서 안내 문장 기준은 요약과 상자 블록(콜아웃·핵심 요약 상자)에 쓰고 본문 문단에는 쓰지 않는다. 전문 용어 첫 등장은 본문 블록에서 찾고, 그 블록 안 어디든 풀이 글자가 있으면 풀었다고 본다. 사전 표현은 연속 공백을 하나로 맞춰 비교한다(붙여 쓴 '절세보장'은 다른 표현 — 필요하면 사전에 따로 넣는다).
- **UX-03**: '기한'은 '납부기한'처럼 붙여 써도 잡고, '~기하다' 동사 활용(등기한·제기한·포기한·연기한 등)은 뺀다.
- **CAT-05**: 개인정보 형식 검사는 해결 사례 원고에만 적용한다(일반 기사의 기관 대표 전화 등). 주소는 지번(동·리·가 + 지번)과 시·군·구가 붙은 도로명 + 건물번호를 잡는다. 기업 대표번호(1588 등)는 잡지 않는다. 결과 근거는 번호와 `http(s)://` 링크가 둘 다 있어야 한다. 결과 칸에는 결론 배지(`SOLVED_CASE_CONCLUSIONS` — 인용 `accepted` · 일부 인용 `partial` · 기각 `rejected` · 각하 `dismissed` · 해석 `interpretation`)가 있어야 한다 — PRD-00 8.6 해결 사례 카드 '결과(결론 배지)' (W2-b 4단계, 설계 9장 #36).
- **ART-03**: 카드뉴스 장은 블록 종류 `slide`(제목·글·대체 텍스트)다. 형식이 카드뉴스(`cardnews`)인 기사는 장이 5~7개(`CARDNEWS_SLIDES`)여야 하고, 장마다 대체 텍스트와 글자(제목 또는 글)가 있어야 한다. 카드뉴스가 아닌 기사에 장 블록이 있으면 막는다(공개 화면이 장을 슬라이드로만 그린다). 한 장의 글은 상자처럼 문장 수를 센다(UX-01 경고).
- **ART-07 인포그래픽**: 블록은 이미지(media)·대체 텍스트·템플릿(`INFOGRAPHIC_TEMPLATES` — 절차 흐름 `flow` · 비교 `compare` · 핵심 숫자 `numbers`)·같은 내용(`data` — 표 `{ columns, rows }` 또는 목록 `{ items }`)이다. **저장 불가**(`infographicSaveProblems` — 기사 저장 API 422와 편집 화면이 같은 문장): 대체 텍스트 빔, 같은 내용 없음, 표 머리 칸 빔·내용 행 0·행의 칸 수가 머리 칸 수와 다름·빈 행, 목록 항목 0·빈 항목. 발행 판정도 같은 조건을 한 번 더 본다(`art07.infographic-alt`·`art07.infographic-data` — DB에 직접 넣은 행·이관 자료). 형식이 인포그래픽인 기사는 인포그래픽 블록 1개 이상(`art07.infographic-required` — 기사 카드의 '인포그래픽' 배지가 빈 기사에 붙지 않게).
- **ART-08 동영상**: 주소는 `https://www.youtube-nocookie.com/embed/<영상번호 11자>`(+ `start`·`end`·`cc_load_policy`)만 — `parseYoutubeEmbed`가 http·youtube.com·youtu.be·다른 호스트·끝 점·포트·사용자 정보(@)·역슬래시·`..` 경로·영상번호 없음·덧붙인 경로·모르는 칸·겹친 칸·`#`·빈칸·300자 초과를 거부하고, 통과하면 정리한 주소로 저장한다(**저장 불가**). 발행에는 요약 텍스트(`summary`)·편집자 '자막 있음' 확인(`captions`)·썸네일(media 번호, 권리 확인 — NAV-04)·썸네일 16:9(`VIDEO_THUMBNAIL_RATIO` — 가로÷세로가 16÷9에서 1% 안, 크기를 모르면 막는다)가 필요하다. 형식과 상관없이 모든 동영상 블록에 같은 조건(어느 기사에서나 같은 '누르면 재생' 카드로 그린다). 형식이 동영상인 기사는 동영상 블록 1개 이상(`art08.video-required`).
- **ART-09 포토**: 형식이 포토인 기사의 사진 = 이미지 블록(사진 묶음). 1장 이상(`art09.photos-required`), 사진마다 media 출처(`credit`)·이용 조건(`license`)·대체 텍스트(블록 또는 media의 대체 텍스트)가 있어야 발행된다. 출처·이용 조건은 판정 입력이 media 표에서 채운다(작성자가 적어 넣을 수 없다). 포토가 아닌 기사의 이미지는 NAV-04 권리 확인만 본다.
- **ART-10**: 공동 기획에는 제휴사(이름 포함)가, 제휴사를 지정했으면 표기가 있어야 한다. 계약 종료일 당일까지 유효, 첫 발행 전 기사에만 적용. '공동 기획과 광고 함께 지정'은 표기 칸이 하나라 입력에서 생길 수 없다. 배지 글자는 `sponsorBadge(label, partnerName)` — 광고 `광고`, 공동 기획 `공동 기획 ○○`(PRD 글자 그대로, packages/structured-data `sponsorLabelText`·packages/seo-lint `badgeFormats`와 같다). 제휴사 이름이 비면 배지가 없어(null) `art10.co-planned-partner-required`로 막는다.
- **ART-05**: 이미 발행된 기사(`firstPublishedAt` 있음)를 다시 발행할 때 수정 종류·사유를 요구한다.
- **OPT-06**: 유사도 `no_sources`·`no_body`는 경고(seo-lint rules.v1과 같은 등급). seo-lint·유사도 결과가 없으면(null) 차단.
- **REG1-07·REG1-09·PR-07 공식 자료·공공누리 (01B — W4 5단계, `docs/dev/W4_설계.md` 1장 5단계 · 12장 #13)**: 공식 자료 = 출처 종류 `official_doc`·`dataset`(대체되지 않은 최신 판만 — 판정 입력이 고른다). 발표일·기준일·지역 단위·수집일·확인일이 하나라도 비면 칸마다 `reg1_09.official-fields`(위치 `sources.<API 칸>` — 422가 빈 칸을 이름으로 알린다). 공공누리 유형은 공식 자료·보도자료·사진 출처의 필수 칸(`pr07.license-required`). 자료 종류(`sourceType`)는 비면 보지 않고(국세·지방세 법령 출처는 6종 밖), 적었으면 허용 목록(`ctx.officialSourceTypes`, 없으면 씨앗 `OFFICIAL_SOURCE_TYPES`) 안이고 차단 4종(`BLOCKED_OFFICIAL_SOURCE_TYPES`) 밖이며 공식 자료 행이어야 한다(`reg1_07.source-type`). 고시·조례(`TAX_REVIEW_SOURCE_TYPES`) 자료를 쓴 해설·가이드는 세무 감수 대상 이유에 '고시·조례 자료를 쓴 해설 (REG1-07)'이 더해져 `nav03.tax-review-required`로 막힌다. 사진은 권리가 확인된 것만 유형을 본다 — 유형이 `ctx.kogl.photoTypes`(없으면 `KOGL_USAGE_DEFAULT` = 제1유형·해당 없음) 밖이면 `pr07.photo-license`, 제4유형·미표시는 설정과 상관없이 막는다(`KOGL_NEVER`). 원문 전재는 `ctx.similarity.copied`(유사도 검사기가 기준 이상 같다고 본 본문 문장 — 직접 인용 블록 제외)의 원문이 '해당 없음'이 아니고 `kogl.fullTextTypes` 밖이면 원문마다 `pr07.full-text`(기본값 = 모든 유형 전재 0). 유형 배지 글자는 `LICENSE_TYPE_LABELS`.
- **REG1-17 지역 기사 편집 게이트 (01B — W4 7단계, `docs/dev/W4_설계.md` 1장 7단계 · 2.1 · 12장 #7·#30)**: 입력은 `article.regional`(`RegionalFacts` — 지역 태그·편집 분야·공익적 질문·소재·관계 유형·편집자 판정·광고 계약 제휴사·이해관계 표시, 없으면 지역 태그 0). 지자체뉴스(`section = local`) 새 발행(`firstPublishedAt` 없음)에 지역 태그 0 → `reg1_17.region-tag-required`. 지역 태그 기사(광고·협찬 제외)는 편집 분야(`reg1_17.editorial-field`)·공익적 질문(`reg1_17.public-question`), 편집 분야가 `ctx.regionalJudgeFields`(없으면 씨앗 4종) 밖이면 판정 책임자 없음 → 보류(`reg1_17.field-judge-missing`). 판정 여행 후기·맛집 추천·행사 홍보(`NON_NEWS_JUDGEMENTS`) + 보도·해설 → `reg1_17.non-news-judgement`. 축제·명소·상권 소재(광고·협찬 제외)는 관계 유형 1개 이상(`reg1_17.relation-required`)·반려 아닌 취재 근거 1건 이상(`reg1_17.relation-evidence`). 지역 기사(지역 태그 또는 지자체뉴스, 광고·협찬 제외)의 최근 편집 승인 checklist에 `evidence`·`relation`·`ad_independence`가 모두 true가 아니면 `reg1_17.desk-checklist`, 광고 계약 제휴사를 다뤘는데 이해관계 표시가 비면 `reg1_17.interest-disclosure`. 편집 화면 상태는 `regionalState`(후보·보류·별도 상품·지역 기사 아님). DB 트리거(`…43`)가 같은 규칙을 다시 본다.
- **REG1-14 지역 기사 편집 경고 4종 (01B — W4 8단계, `docs/dev/W4_설계.md` 1장 8단계 · 2.2 · 12장)**: 지역 기사(`isRegionalArticle`)에만, 발행은 막지 않는 경고. 보도자료 재게시 — `ctx.similarity.reposted`(본문 문장 중 그 보도자료와 같은 문장 비율이 유사도 설정의 기사 비율 기준 이상인 보도자료, 판정 입력이 계산)마다 `reg1_14.press-release-repost` 1건. 근거 없는 지역 수치 — 숫자 + 단위(`REGIONAL_FIGURE_UNITS`)가 있는 문단에 그 문단을 가리키는 핵심 주장이 공식 자료(`official_doc`·`dataset`) 출처나 반려 아닌 취재 근거를 잇지 않으면 `reg1_14.unsupported-figure`. 사진 권리 누락 — 대표 사진·본문 이미지·인포그래픽·동영상 썸네일·사진 출처 중 권리 미확인·공공누리 유형 없음·출처(촬영자) 없음(본문 이미지)이 있으면 `reg1_14.photo-rights`. 오래된 통계 — 통계 자료(`dataset`, 예산/결산·지방세 세수·부동산 거래 공식 문서)의 기준일이 오늘(KST)보다 `ctx.staleStatisticsDays`(씨앗 365)일을 넘겨 앞서면 `reg1_14.stale-statistics`(기준 당일 0건). 단계 순서 `stageSkipProblem` — 지역 기사는 처음 공개를 승인(`approved`)에서만, 승인 단계는 현재 판 편집 승인이 있어야(세무 감수 반려·보류면 거부). DB 트리거(`…44`)가 같은 규칙을 다시 본다.
- **권리·검증 상태 값**: PRD 6.1이 값 목록을 정하지 않아 `rights_status`는 `confirmed`·`unconfirmed`, `verification_status`는 `verified`·`unverified`로 두었다 — W2-a 설계 §2에 더해 DB와 맞춰야 한다.

## 이 패키지가 하지 않는 것 (뒤로 미룬 것)

- **digest 규칙** — CORE-01의 digest 적용 방식(결정 안건), 01B LG-02~04(편집자 요약·원문 링크, digest → reported_news 변경 거부 — 이전 값이 필요한 변경 검사).
- **입출력이 필요한 것** — NAV-10 재현 파일 해시로 수치 재계산, CORE-01 박스 링크 전수(404·비공개·미공개 기능 0), 트래커 현재 단계 읽기(CAT-04 배지), 감사 로그·403 역할 검사(서버 기능 3단계), RLS·보존 기간 삭제(DB 1단계).
- 핵심 주장마다 근거 연결은 seo-lint(OPT-03 「핵심 주장마다 근거」)가 차단하고, 그 결과를 `seoLint.blockers`로 받는다.

## 시험

```
npx vitest run     # 요구사항 경계 시험
npx tsc --noEmit   # 타입 검사
```
