# packages/seo-lint

기사 원고의 SEO·AEO·GEO·공통 4축 점검 엔진 — 축별 0~100점과 차단 항목 게이트 (PRD-01A OPT-03 · PRD_최종 §7.3). 1단계 **W1-b 골격**: 규칙 파일 · 견본 원고 · 엔진 인터페이스.

- 순수 함수다 — 네트워크·AI·현재 시각·난수를 쓰지 않는다. 같은 원고·같은 규칙 버전이면 결과가 같다.
- `packages/similarity`·`packages/structured-data`를 import하지 않는다. 두 패키지의 결과는 입력 칸(`similarity.status`, `structuredDataMismatches`)으로 받는다.
- 점수는 내부 품질 지표다. 패널은 점수 옆에 `SCORE_DISCLAIMER`("내부 품질 지표 — 검색 순위 예측이 아닙니다", PRD-00 8.6)를 그대로 보여 준다.

## API

```ts
import { RULES_V1, lintArticle, publishDecision } from "@ltr/seo-lint";

const result = lintArticle(article, context, RULES_V1);
// { ruleVersion, engineVersion, scores: { SEO, AEO, GEO, 공통 }, items: [{ id, axis, name, level, message, applicable }],
//   blockers: string[], warnings: string[], canPublish }
const decision = publishDecision(result);
// { allowed, httpStatus: 200 | 422, failed: 차단 항목 이름[], warnings: 경고 ID[] }
```

| 내보내기 | 하는 일 |
|---|---|
| `lintArticle(article, context, rules)` | 원고 한 판 점검. `article: ArticleForLint`(칸마다 쓰는 점검 항목을 `src/types.ts`에 적었다), `context: LintContext`(다른 공개 기사의 id·canonical·제목) |
| `publishDecision(result)` | 발행 API 판정 — 차단 항목이 남으면 422와 실패 항목 이름, 경고만 있으면 200 + 발행 기록용 경고 ID |
| `parseRules(json)` · `RULES_V1` | 규칙 파일 검사 후 `RuleSet`. 형식 오류·모르는 규칙 ID·차단 8종 누락/경고 강등·패널 금지어('순위'·'노출 예측'·'상위 노출')가 있으면 `RulesError` |
| `SCORE_DISCLAIMER` · `FORBIDDEN_PANEL_WORDS` | 패널 고정 문구(금지어가 들어가도 되는 유일한 문구)와 금지어 목록 |
| `PASSING_SAMPLE` · `BLOCKING_SAMPLES` | 견본 원고 — 통과 1종, 차단 8종 |

## 규칙 파일 `rules/rules.v1.json` (version `2026.10-w2a`)

규칙·가중치·기준값은 이 파일에 두고 코드에 박지 않는다. 규칙마다 `id · axis · level(block|warn) · name · weight · source(PRD 근거) · params · messages`.

| 축 | 차단 (OPT-03 8종) | 경고 (PRD 점검 표 항목) |
|---|---|---|
| SEO | `seo.canonical` canonical 중복 | `seo.unique-title` · `seo.meta-description` · `seo.internal-links`(2개 이상) · `seo.official-source` · `seo.image-alt` |
| AEO | — | `aeo.question-heading` · `aeo.summary-box`(3줄 이하) · `aeo.faq`(화면 노출 2~5개) |
| GEO | `geo.claim-evidence` 근거 없는 핵심 주장 · `geo.author` 저자 없음 · `geo.dates` 발행/수정일 불일치 · `geo.law-basis-date` 법령 기준일 없음 | — |
| 공통 | `common.structured-data` 구조화 데이터 불일치 · `common.similarity` 유사도 기준 초과 · `common.sponsor-label` 광고 표기 불일치 | — |

- **축 점수** = round(100 × 통과 항목 가중치 합 ÷ 해당 항목 가중치 합). v1 가중치는 차단 3 · 경고 1(초기값). '해당 없음' 항목(법령 기준일 비대상 기사)은 뺀다.
- **법령 기준일**은 지방세 분야(`section` = `tax`, 규칙 파일 값) · 세무 감수 대상 · 「지방세로 읽기」가 있는 기사에서만 필수다.
- **발행/수정일**은 시간대가 붙은 ISO 8601만 읽는다(같은 순간이면 같은 값, 1분이라도 다르면 차단). 화면에 날짜만 보이면 한국 시각(규칙 파일 `displayUtcOffsetMinutes` 540) 날짜로 비교한다. 수정일이 발행일보다 앞서면 차단.
- **유사도 '비교 대상 없음'**(`no_sources`)은 통과로 표시하지 않고 **경고**로 남긴다(점수에서도 통과로 세지 않음). 기준 '초과'가 아니라 비교하지 못한 상태이고 OPT-06은 '통과로 표시하지 않음'만 정하기 때문이다. 차단으로 바꾸려면 규칙 파일의 `unverifiedLevel`을 `block`으로 바꾼다.
- **광고 표기**는 광고·공동 기획 기사의 화면 배지 · 메타 제목 · 메타 설명 · JSON-LD `headline`에 같은 표기가 있는지, 표기 없는 기사에 표기가 없는지, 둘을 섞지 않았는지 본다.
  - 배지 글자는 PRD 그대로다 — 광고 `광고`(PRD-00 8.8), 공동 기획 제휴 배지 `공동 기획 ○○`(PRD-01A ART-10, ○○ = 제휴사 이름 `sponsorship.partnerName`). 규칙 파일 `badgeFormats` `["공동 기획 {partner}", "광고"]`.
  - 메타·headline에는 `markerFormat` `[{badge}]` 모양으로 넣는다 — `[광고] 제목` · `[공동 기획 가온세무법인] 제목` (packages/structured-data `displayTitle`과 같다).
  - 공동 기획인데 제휴사 이름이 비면 배지를 만들 수 없어 차단(`partnerMissing`). 공동 기획 기사에 `[광고]`, 광고 기사에 `[공동 기획 …]`이 함께 있으면 차단(`mixed`).
  - 2026-10-18 바꿈(W2-a 4-2): 이전 `2026.10-w1b`는 제휴사 이름 없는 `[공동 기획]`을 기대해 structured-data의 `공동 기획 ○○`와 어긋났다.

## 견본 원고 `fixtures/`

- `passing.ts` — 지방세 해설(생애최초 주택 취득세 감면) 가상 원고. 차단 0 + 경고 2(내부 링크 1개 · 질문형 소제목 없음 — PRD-01A 편집기 패널 견본과 같은 두 경고).
- `blocking.ts` — 통과 견본에서 차단 항목 하나만 어긴 원고 8종.

## 시험

```
npx vitest run     # 견본 시험(차단 견본 실패 · 통과 견본 통과) · 항목별 경계 · 점수·결정론 · 규칙 파일 ↔ PRD
npx tsc --noEmit
```

규칙 파일 ↔ PRD 시험은 `docs/PRD`의 OPT-03 차단 견본 8종 이름, 점검 표 축·굵은 글씨(차단) 칸, PRD-00 8.6 고정 문구를 직접 읽어 대조한다.

## 골격(W1-b)과 W7 완성

| 지금(W1-b) | W7에서 |
|---|---|
| 엔진·규칙 파일·견본 원고·발행 판정 함수 | 편집기 실시간 패널(입력이 멈추면 다시 계산) · 발행 버튼 비활성 · 발행 API 422 연결 |
| 결과 객체(`ruleVersion`·`engineVersion`·`blockers`·`warnings`) | `seo_checks` 저장(점수 키 seo·aeo·geo·common, 유사도 상세, checked_at·checked_by, published_with_warnings) |
| 규칙 파일 기준값 | `settings` 값으로 기준값 덮어쓰기, 가중치 조정 |
| 경고 8종 | 정식 명칭·엔티티(OPT-05) · 키워드 반복 밀도(OPT-10) · 제목 위계 · 리드 직접 답 · 인용 블록 비율(OPT-06) 등 나머지 점검 표 항목 |
