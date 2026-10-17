// 점검 결과 응답 모양 — 점검 패널(GET check)과 발행 API 422 응답이 같은 모양을 쓴다. 순수 함수
import { taxReviewReasons } from "@ltr/editorial";
import { SCORE_DISCLAIMER } from "@ltr/seo-lint";
import { MISMATCH_LABELS, type MismatchId } from "@ltr/structured-data";
import type { GateResult } from "./gate";

export function gateReport(gate: GateResult) {
  return {
    canPublish: gate.canPublish,
    failed: gate.failed,
    warnings: gate.warnings,
    findings: gate.evaluation.findings,
    taxReviewReasons: taxReviewReasons(gate.article),
    seoLint: {
      disclaimer: SCORE_DISCLAIMER,
      ruleVersion: gate.lint.ruleVersion,
      engineVersion: gate.lint.engineVersion,
      scores: gate.lint.scores,
      blockers: gate.lint.blockers,
      warnings: gate.lint.warnings,
      items: gate.lint.items.filter((i) => i.level !== "pass"),
    },
    similarity: {
      status: gate.similarity.status,
      maxSentenceSimilarity: gate.similarity.maxSentenceSimilarity,
      similarSentenceRatio: gate.similarity.similarSentenceRatio,
      quoteRatio: gate.similarity.quoteRatio,
      quoteWarning: gate.similarity.quoteWarning,
      comparedSources: gate.similarity.comparedSources,
      thresholdSource: gate.similarity.thresholdSource,
      rulesVersion: gate.similarity.rulesVersion,
    },
    structuredData: gate.structuredDataMismatches.map((id) => ({ id, label: MISMATCH_LABELS[id as MismatchId] ?? id })),
  };
}

/** seo_checks 한 줄 (OPT-03 점검 이력 — 추가만) */
export function seoCheckRow(gate: GateResult, published: boolean) {
  const s = gate.lint.scores;
  return {
    target_type: "article",
    target_id: gate.article.id,
    target_version: gate.article.version,
    rules_version: gate.lint.ruleVersion,
    engine_version: gate.lint.engineVersion,
    scores: { seo: s.SEO, aeo: s.AEO, geo: s.GEO, common: s["공통"] },
    blocking_failures: gate.failed,
    warnings: gate.warnings,
    similarity: {
      status: gate.similarity.status,
      maxSentenceSimilarity: gate.similarity.maxSentenceSimilarity,
      similarSentenceRatio: gate.similarity.similarSentenceRatio,
      comparedSources: gate.similarity.comparedSources,
      thresholdSource: gate.similarity.thresholdSource,
      rulesVersion: gate.similarity.rulesVersion,
      engineVersion: gate.similarity.engineVersion,
    },
    checked_by: "editor",
    published_with_warnings: published && gate.warnings.length > 0,
  };
}
