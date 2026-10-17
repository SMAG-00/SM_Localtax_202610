// packages/seo-lint 공개 인터페이스 — SEO·AEO·GEO·공통 점검 엔진 (PRD-01A OPT-03, W1-b 골격)
export * from "./types";
export { ENGINE_VERSION, lintArticle } from "./lint";
export { publishDecision } from "./gate";
export { BLOCKING_RULE_IDS, RULES_V1, RulesError, parseRules } from "./rules";
export { FORBIDDEN_PANEL_WORDS, SCORE_DISCLAIMER } from "./text";
// 견본 원고 — 패키지 견본 시험과 W7 편집기·발행 API E2E가 같은 원고를 쓴다
export { PASSING_SAMPLE } from "../fixtures/passing";
export { BLOCKING_SAMPLES } from "../fixtures/blocking";
