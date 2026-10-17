# packages/similarity

문장 단위 유사도 — 핫뉴스·발행 전 검사. 1단계 W1-b 골격 — OPT-06 · LG-03 · NAV-18.

원고를 문장으로 나눠 보도자료·원자료 스냅숏·자사 기존 기사·같은 회차 핫뉴스 항목과 비교하고, 보도자료 문장을 옮긴 원고를 발행 전에 막는다. 순수 함수만 있다 — 네트워크·DB·AI 호출 0, 같은 입력이면 같은 결과.

## 공개 API (`src/index.ts`)

| 이름 | 하는 일 |
| --- | --- |
| `checkSimilarity(input)` | 판정. `{ draft, sources, thresholds, thresholdSource, rulesVersion? }` → `status`(`blocked`·`pass`·`no_sources`·`no_body`), `maxSentenceSimilarity`, `similarSentenceRatio`, `similarSentenceCount`, `bodySentenceCount`, `quoteSentenceCount`, `quoteRatio`, `quoteWarning`, `comparedSources`, `thresholdSource`, `thresholds`, `rulesVersion`, `engineVersion`, `perSentence[]` |
| `selectThresholds({ regulation?, internal? })` | 적용 기준 고르기 — 규정 버전이 있으면 '규정', 없으면 '내부'. 결과를 `checkSimilarity`에 펼쳐 넣는다 |
| `INTERNAL_SIMILARITY_RULES` | 내부 기준 초기값과 버전 (`src/rules.ts`) |
| `splitSentences(text)` · `segmentDraft(draft)` | 한국어 문장 분리 · 원고를 본문/인용 블록 문장으로 나누기 |
| `sentenceSimilarity(a, b)` · `normalizeForComparison(text)` | 문장 두 개의 유사도(0~1) · 비교용 정규화 |
| `meetsThreshold(value, threshold, "gt"·"gte")` | 기준 비교 (부동소수 오차 1e-9 허용) |
| `ENGINE_VERSION` | `seo_checks.engine_version`에 남길 엔진 버전 |

```ts
import { checkSimilarity, selectThresholds } from "@ltr/similarity";

const result = checkSimilarity({
  draft,                                   // '>'로 시작하는 줄 = 직접 인용 블록
  sources: [{ id: "pr-123", kind: "press_release", text: pressReleaseText }],
  ...selectThresholds({ regulation: null, internal: settingsValues }),
});
// result.status === "blocked" 이면 발행 차단 항목 (OPT-03)
```

## 측정 방식

1. 정규화: NFKC(전각 숫자·로마자 → 반각, 자모 합치기) → 소문자 → 글자·숫자만 남김(띄어쓰기·문장부호 제거).
2. 문장 유사도: 정규화한 글자열의 **글자 2-gram 중복집합 Dice 계수** = 2 × 겹친 2-gram 수 / (양쪽 2-gram 수 합).
3. 원고 문장마다 모든 비교 원문 문장 중 최고 일치를 찾는다. 같은 값이면 먼저 넘긴 원문·앞 문장을 고른다.

고른 이유: 한국어는 조사·어미가 붙어 단어 단위 비교가 흔들리고 띄어쓰기도 제각각이라, 형태소 분석기 없이 글자 2-gram이 '그대로 옮긴 문장'을 가장 안정적으로 잡는다. 결정론적이고 대칭이며 0~1이고, 2-gram 개수로 89%·90% 같은 경계를 정확히 만들어 시험할 수 있다. 견본에서 보도자료를 옮긴 원고는 문장별 0.80~1.00, 다시 쓴 원고는 최고 0.45다.

## 판정 규칙

| 규칙 | 값 |
| --- | --- |
| 유사 문장 | 최고 일치가 문장 기준 **이상**(기본 `gte`) — 89%는 세지 않고 90%는 센다 (LG-03) |
| 기사 차단 | 본문 중 유사 문장 비율이 기사 기준 **초과**(기본 `gt`) — 5문장 중 3개(60%) 통과, 4개(80%) 차단 |
| 비교 연산 | 규정 버전의 비교 연산 칸(초과·이상)을 `sentenceComparator`·`articleComparator`로 넘기면 그 연산을 쓴다 (NAV-18) |
| 직접 인용 블록 | `>`로 시작하는 줄(앞 공백·`>>` 허용). 기사 비율·최고 문장 유사도에서 빼고 따로 센다. 인용 비율 = 인용 문장 수 / 원고 전체 문장 수, 기준 초과면 `quoteWarning` |
| 비교 대상 없음 | 문장이 1개 이상인 원문이 0건이면 `no_sources` — 비율 값은 `null`, 통과로 표시하지 않음. 빈 스냅숏은 비교 원문으로 세지 않는다 |
| 빈 원고 | 본문 문장 0개(빈 원고·인용 블록만)면 `no_body` — 비율 값은 `null`, 통과로 표시하지 않음. 점검 엔진(seo-lint)은 경고로 남긴다 (2026-10-17 결정) |

## 문장 분리 규칙 (결정 사항)

- 나누는 곳: `. ? ! … ‥ 。 ｡ ． ？ ！`와 줄바꿈. 이어진 부호(`?!`, `...`)와 바로 뒤 닫는 괄호·따옴표는 앞 문장에 붙인다.
- 나누지 않는 곳: 소수점(3.5%·1.2배), 주소·이메일, 보도자료식 날짜(`2026. 11. 2.(월)`, `12. 15.까지`, `2026. 1. 1. 이후`), 문장 첫머리 번호(`1. ` `가. `), 짝이 맞는 따옴표(“” ‘’ "" '' 「」 『』) 안.
- 따옴표가 종결부호로 끝나고 닫힌 뒤 띄어 쓴 새 문장이 오면(`“…다.” 시는`) 닫는 따옴표 뒤에서 나눈다. `“…다.”라고`는 한 문장.
- 짝 없는 여는 따옴표와 연도 생략 부호(`'26년`)는 따옴표로 보지 않는다. 따옴표가 열려 있어도 줄바꿈에서는 나눈다.
- `등.`은 약어가 아니라 문장 끝으로 본다. 글자·숫자가 없는 조각(부호만)은 문장이 아니다.
- 한계: 날짜만으로 끝나는 문장 뒤에 같은 줄에서 새 문장이 이어지면 두 문장이 합쳐진다. 영문 약어 끝 마침표(`U.S. `)에서는 나눈다.

## 기준값 (`src/rules.ts`)

| 항목 | 내부 초기값 | 근거 |
| --- | --- | --- |
| 문장 유사 | 0.9 이상 | PRD_최종 §7.2 `[웹확인]` 네이버 2026 규정 요점, OPT-06 초기값, LG-03 |
| 기사 비율 | 0.6 초과 | 같음 |
| 인용 비율 | 0.3 초과 — **임시값** | 견본 원고 시험 뒤 편집 책임자가 정한다 (PRD-01A 13장 결정 안건) |

출처 표시는 '내부'다. 운영에서는 `settings` 값을 `selectThresholds({ internal })`로 넘겨 배포 없이 바꾸고, NAV-18이 규정 버전(`news_partner_requirements`)을 등록하면 `selectThresholds({ regulation })`로 문장·기사 기준과 비교 연산이 규정 값으로 바뀌고 출처가 '규정'이 된다. 인용 비율은 규정 항목이 아니라 언제나 내부 기준이다.

## 견본 원고 (`fixtures/`)

가상 지자체 '가온시'의 착한 임대인 재산세 감면 보도자료와 그 원고들이다. 기관·수치·주소는 모두 가상이고 실존 인물은 없다.

| 파일 | 용도 | 기대 |
| --- | --- | --- |
| `press-release_gaon-property-tax.txt` | 보도자료 원문 (`press_release`) | — |
| `draft_copied-from-press-release.txt` | 보도자료를 문장마다 옮기고 몇 단어만 바꾼 원고 | 차단 (유사 문장 90%) |
| `draft_rewritten-by-editor.txt` | 같은 사실을 편집자 문장으로 다시 쓴 원고 + 인용 블록 1개 | 통과 (유사 문장 0%) |
| `own-article_gaon-2025-result.txt` | 자사 기존 기사 (`own_article`) | 비교 원문 |

## 골격(W1-b)과 나중 일

- 지금: 문장 분리·측정·판정·규칙 파일·견본 시험(`pnpm --filter @ltr/similarity test`). 차단 견본은 차단, 통과 견본은 통과.
- 나중(W6·W7): `settings`·`news_partner_requirements`에서 기준 읽기, `seo_checks.similarity` 저장, 편집기 패널의 유사 문장 목록 표시, `digest_items` 유사도 기록, 월별 유사 기사 판정 수(NAV-17), CI 스크립트(`scripts/`)에서 이 패키지 시험 호출, 원고 자신(같은 기사 이전 버전)을 비교 원문에서 빼는 일은 호출하는 쪽이 한다.

## 실행

```sh
npx vitest run     # 견본·단위 시험
npx tsc --noEmit   # 타입 검사
```
