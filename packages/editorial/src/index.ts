// packages/editorial 공개 인터페이스 — 기사 발행 판정 (W2-a 2단계, docs/dev/W2-a_설계.md §4)
// 순수 TypeScript · 결정론 · 입출력 없음 · AI 없음. 사전·기준값·seo-lint·유사도 결과는 입력으로 받는다.
export * from "./model";
export { RULES, compareFindings, finding, sortFindings, toSaveValidation } from "./findings";
export type { Finding, FindingLevel, FindingLocation, RuleDef, RuleId, SaveValidation } from "./findings";
export { BUILT_IN_CHECKS, evaluatePublish } from "./evaluate";
export type { PublishCheck, PublishEvaluation, PublishOptions } from "./evaluate";

// 저장 검사
export { isTaxLensTarget, hasTaxLensContent, validateTaxLensForSave } from "./checks/tax-lens";
export { changesDateModified, validateRevisionForSave } from "./checks/revision";
export type { RevisionInput } from "./checks/revision";
export { validateSolvedCaseForSave } from "./checks/solved-case";
export { checkScreenCopy } from "./checks/plain-language";
export type { ScreenCopy } from "./checks/plain-language";
// ART-07·08·09 — 저장 불가 조건(기사 저장 API·편집 화면 공용)과 동영상 주소·썸네일 비율 판정
export { YOUTUBE_EMBED_HOST, YOUTUBE_EMBED_PREFIX, infographicSaveProblems, isSixteenByNine, parseYoutubeEmbed } from "./checks/media-formats";
export type { BlockProblem, EmbedParse } from "./checks/media-formats";
export { infographicTexts } from "./text";

// 판정 보조 — 편집 화면이 상태 표시에 쓴다
export { isApproved, taxReviewReasons } from "./checks/reviews";
export { AMENDMENT_CATEGORY_SLUG, isAmendmentBriefing } from "./checks/amendment";
export { sponsorBadge } from "./checks/partnership";
export { RESERVED_SLUGS } from "./checks/article-basics";
export { ACTION_TRIGGER_WORDS, ROSE_BOX_TITLE } from "./checks/pressure";
export { PERSPECTIVE_LABELS } from "./checks/qualitative";

// 검사기 단위 — 개인정보 형식·문장 나누기
export { PII_KIND_LABELS, detectPii, detectRealNames } from "./pii";
export type { PiiKind, PiiMatch } from "./pii";
export { countChars, normalizeText, splitSentences } from "./text";

// 견본 — 패키지 시험과 발행 API·편집 화면 E2E가 같은 원고를 쓴다 (가상 원고)
export { SEED_DICTIONARIES } from "../fixtures/dictionaries";
export { BASE_CONTEXT } from "../fixtures/context";
export { QUANTITATIVE_NEWS } from "../fixtures/quantitative";
export { QUALITATIVE_NEWS } from "../fixtures/qualitative";
export { SOLVED_CASE, TAX_EXPLAINER } from "../fixtures/explainer";
export { FAILING_SAMPLES } from "../fixtures/failing";
export type { FailingSample } from "../fixtures/failing";
