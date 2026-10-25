// 수집 파이프라인 공개 진입점 (@ltr/workflows/pipelines) — 웹 앱의 작업 서버 기능이 불러 쓴다. DB·환경변수를 직접 읽지 않는다.
export { createLawApi, LawApiError, sha256 } from "./law/law-api.ts";
export type { LawApi, LawSnapshot, FetchedText } from "./law/law-api.ts";
export { runLawCheck, checkOneLaw, classifyChange } from "./law/law-watch.ts";
export type { LawStore, WatchedLaw, PrevState, VersionInput, NewSnapshot, LawCheckSummary, LawOutcome } from "./law/law-watch.ts";
export { parseLawArticles } from "./law/articles.ts";
export type { ParsedArticle } from "./law/articles.ts";
export { collectDocs, parseDocList, decisionKindOf, DOC_SPECS } from "./docs/collector.ts";
export type { DocStore, DocItem, DocSourceSpec, DocCollectSummary, KnownDoc } from "./docs/collector.ts";
export { findCredentials, redactCredentials, publicLawUrl, isPublicUrl } from "./credentials.ts";
export { pipelineGate } from "./gate.ts";
export type { SkipReason, GateInput } from "./gate.ts";
