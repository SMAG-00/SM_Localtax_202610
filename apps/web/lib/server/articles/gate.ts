// 발행 판정 한 번 — 유사도(@ltr/similarity) → 구조화 데이터 대조(@ltr/structured-data) → 최적화 점검(@ltr/seo-lint) →
// 편집 판정(@ltr/editorial). 순수 함수: 입력(기사 한 판·설정·시각)이 같으면 결과가 같다. 발행 API와 점검 패널(GET check)이 같이 쓴다.
import {
  evaluatePublish,
  KOGL_USAGE_DEFAULT,
  OFFICIAL_SOURCE_TYPES,
  R8_THRESHOLDS,
  REGIONAL_JUDGE_FIELDS_DEFAULT,
  STALE_STATISTICS_DAYS_DEFAULT,
  STALE_STATISTICS_DAYS_MAX,
  STALE_STATISTICS_DAYS_MIN,
  type EditorialField,
  type ArticleForPublish,
  type Dictionaries,
  type Finding,
  type KoglUsage,
  type PublishEvaluation,
} from "@ltr/editorial";
import { parseKoglUsage, parseOfficialSourceTypes } from "@/lib/admin/official-source-rules";
import { parseRegionalJudgeFields } from "@/lib/admin/regional-rules";
import { RULES_V1, lintArticle, type LintResult } from "@ltr/seo-lint";
import { INTERNAL_SIMILARITY_RULES, checkSimilarity, meetsThreshold, selectThresholds, type InternalSimilaritySettings, type SimilarityResult } from "@ltr/similarity";
import { compareRendered, newsArticle } from "@ltr/structured-data";
import type { ArticleGraph } from "./rows";
import { lintContext, renderedFacts, similarityDraft, similaritySources, toArticleForPublish, toArticleView, toLintArticle, type TitlePeer } from "./mapping";

export interface GateSettings {
  dictionaries: Dictionaries;
  similarity: InternalSimilaritySettings;
  /** 공공누리 이용 범위 settings.kogl_usage (PR-07 — 없거나 틀리면 KOGL_USAGE_DEFAULT, 가장 닫힌 쪽) */
  kogl?: KoglUsage;
  /** 공식 자료 종류 허용 목록 settings.official_source_types (REG1-07 — 없거나 틀리면 씨앗) */
  officialSourceTypes?: readonly string[];
  /** 판정 책임자가 있는 편집 분야 settings.regional_judge_fields (REG1-17 · W4 12장 #7 — 행이 없으면 씨앗, 모양이 틀리면 빈 목록 = 모든 분야 보류) */
  regionalJudgeFields?: readonly EditorialField[];
  /** 오래된 통계 경고 기준 일수 settings.stale_statistics_days (REG1-14 · W4 8단계 — 없거나 틀리면 씨앗 365) */
  staleStatisticsDays?: number;
}

export interface GateOptions {
  /** 판정 시각 ISO 8601 — 발행 전 기사는 이 시각을 발행 시각으로 본다 */
  now: string;
  siteUrl: string | undefined;
  publisherName: string;
  /** 같은 제목의 다른 공개 기사 (고유 제목·canonical 중복 점검) */
  peers: readonly TitlePeer[];
}

export interface GateResult {
  article: ArticleForPublish;
  similarity: SimilarityResult;
  structuredDataMismatches: string[];
  lint: LintResult;
  evaluation: PublishEvaluation;
  /** 차단 항목 ID — 편집 판정 ID와 최적화 점검 차단 ID (opt03.seo-lint-blocker 대신 그 점검 ID) */
  failed: string[];
  /** 경고 항목 ID — 발행 기록에 남긴다 */
  warnings: string[];
  canPublish: boolean;
}

/** KST(UTC+9) 날짜 YYYY-MM-DD — 제휴 계약 종료 판정의 '오늘' */
export function kstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 보도자료 재게시 (REG1-14 · W4 8단계) — 보도자료마다 본문 문장(인용 제외) 중 그 보도자료 문장과 기준 이상 같은 문장의 비율.
 * 기사 비율 기준(유사도 설정 articleRatio·articleComparator — W2 설정값)을 넘는 보도자료만 돌려준다
 */
export function repostedPressReleases(similarity: SimilarityResult, pressReleaseIds: readonly string[]): { sourceId: string; ratio: number }[] {
  const body = similarity.bodySentenceCount;
  if (body === 0 || pressReleaseIds.length === 0) return [];
  const { articleRatio, articleComparator } = similarity.thresholds;
  return pressReleaseIds.flatMap((sourceId) => {
    const same = similarity.perSentence.filter((m) => m.similar && !m.inQuote && m.bestSourceId === sourceId).length;
    const ratio = same / body;
    return same > 0 && meetsThreshold(ratio, articleRatio, articleComparator) ? [{ sourceId, ratio }] : [];
  });
}

function ids(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => (f.id === "opt03.seo-lint-blocker" || f.id === "opt03.seo-lint-warning" ? (f.location?.phrase ?? f.id) : f.id)))];
}

export function runGate(graph: ArticleGraph, settings: GateSettings, opts: GateOptions): GateResult {
  const article = toArticleForPublish(graph);
  const viewOpts = { siteUrl: opts.siteUrl, publisherName: opts.publisherName, now: opts.now };

  const similarity = checkSimilarity({
    draft: similarityDraft(article),
    sources: similaritySources(graph),
    ...selectThresholds({ internal: settings.similarity }),
  });

  const view = toArticleView(graph, viewOpts);
  const jsonld = newsArticle(view);
  const structuredDataMismatches = compareRendered(renderedFacts(view), jsonld);
  const headline = typeof jsonld.headline === "string" ? jsonld.headline : "";

  const lint = lintArticle(
    toLintArticle(graph, article, view, viewOpts, { similarityStatus: similarity.status, structuredDataMismatches, structuredHeadline: headline }),
    lintContext(opts.peers, opts.siteUrl),
    RULES_V1,
  );

  const evaluation = evaluatePublish(article, {
    today: kstDate(opts.now),
    dictionaries: settings.dictionaries,
    thresholds: R8_THRESHOLDS,
    seoLint: { blockers: lint.blockers, warnings: lint.warnings },
    // 원문 전재 검사(PR-07) — 원문 문장과 기준 이상 같은 본문 문장(직접 인용 블록 제외)과 그 원문
    similarity: {
      status: similarity.status,
      copied: similarity.perSentence.flatMap((m) => (m.similar && !m.inQuote && m.bestSourceId ? [{ sourceId: m.bestSourceId, sentenceIndex: m.index }] : [])),
      // 보도자료 재게시 경고(REG1-14) — 같은 보도자료와 기사 비율 기준 이상
      reposted: repostedPressReleases(similarity, article.sources.filter((s) => s.kind === "press_release").map((s) => s.id)),
    },
    kogl: settings.kogl ?? KOGL_USAGE_DEFAULT,
    officialSourceTypes: settings.officialSourceTypes ?? OFFICIAL_SOURCE_TYPES,
    regionalJudgeFields: settings.regionalJudgeFields ?? REGIONAL_JUDGE_FIELDS_DEFAULT,
    staleStatisticsDays: settings.staleStatisticsDays ?? STALE_STATISTICS_DAYS_DEFAULT,
  });

  return {
    article,
    similarity,
    structuredDataMismatches,
    lint,
    evaluation,
    failed: ids(evaluation.blockers),
    warnings: ids(evaluation.warnings),
    canPublish: evaluation.canPublish,
  };
}

/** 저장 때 도는 검사 (ART-01 "저장 때 UX-01·UX-03 검사가 돈다") — 쉬운 말·압박 완화·해결 사례 항목만 돌려준다. 저장은 막지 않는다 */
export function saveChecks(article: ArticleForPublish, dictionaries: Dictionaries): Finding[] {
  const { findings } = evaluatePublish(article, { today: "1970-01-01", dictionaries, thresholds: R8_THRESHOLDS, seoLint: null, similarity: null });
  return findings.filter((f) => f.ruleRef === "UX-01" || f.ruleRef === "UX-03" || f.ruleRef === "CAT-05");
}

/** 발행 뒤 수정에서 막는 내용 항목 — 금지·공포 표현, 개인정보 형식, 박스 세액·감면 단정 (승인 기록은 발행 때 이미 확인했다) */
export const POST_PUBLISH_BLOCKERS: ReadonlySet<string> = new Set([
  "ux01.forbidden-phrase",
  "ux03.fear-phrase",
  "cat05.pii",
  "core01.tax-amount",
  "core01.forbidden-phrase",
]);

/** settings 행 → 판정 설정. 사전이 없으면 문제 목록에 적는다(닫힌 쪽으로 실패 — 빈 사전으로 발행하지 않는다) */
export function parseGateSettings(
  rows: readonly { key: string; value: unknown }[],
  glossary: readonly { term: string; plain: string | null }[],
): { settings: GateSettings; problems: string[] } {
  const problems: string[] = [];
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const phrases = (key: string): string[] => {
    const v = byKey.get(key) as { phrases?: unknown } | undefined;
    const list = v && Array.isArray(v.phrases) ? v.phrases.filter((p): p is string => typeof p === "string" && p.trim() !== "") : null;
    if (!list) problems.push(`settings.${key}이 없거나 형식이 틀립니다`);
    return list ?? [];
  };
  const forbiddenPhrases = phrases("forbidden_phrases");
  const fearPhrases = phrases("fear_phrases");

  let similarity: InternalSimilaritySettings = INTERNAL_SIMILARITY_RULES;
  const raw = byKey.get("similarity_internal") as Record<string, unknown> | undefined;
  const num = (k: string) => (raw && typeof raw[k] === "number" && (raw[k] as number) >= 0 && (raw[k] as number) <= 1 ? (raw[k] as number) : null);
  const cmp = (k: string) => (raw && (raw[k] === "gt" || raw[k] === "gte") ? (raw[k] as "gt" | "gte") : null);
  if (raw) {
    const s = num("sentenceSimilarity");
    const ar = num("articleRatio");
    const q = num("quoteRatio");
    if (s === null || ar === null || q === null || typeof raw.version !== "string") {
      problems.push("settings.similarity_internal 형식이 틀립니다");
    } else {
      similarity = {
        version: raw.version,
        sentenceSimilarity: s,
        sentenceComparator: cmp("sentenceComparator") ?? INTERNAL_SIMILARITY_RULES.sentenceComparator,
        articleRatio: ar,
        articleComparator: cmp("articleComparator") ?? INTERNAL_SIMILARITY_RULES.articleComparator,
        quoteRatio: q,
        quoteComparator: cmp("quoteComparator") ?? INTERNAL_SIMILARITY_RULES.quoteComparator,
      };
    }
  }

  const jargonTerms = glossary.flatMap((g) => (g.term.trim() && g.plain && g.plain.trim() ? [{ term: g.term, plain: g.plain }] : []));
  // W4 5단계 — 공공누리 이용 범위·자료 종류 허용 목록. 없으면 권고 기본값·씨앗(닫힌 쪽), 모양이 틀리면 문제 목록에 적는다
  const koglRaw = byKey.get("kogl_usage");
  const kogl = parseKoglUsage(koglRaw);
  if (koglRaw !== undefined && !kogl) problems.push("settings.kogl_usage 형식이 틀립니다");
  const typesRaw = byKey.get("official_source_types");
  const officialSourceTypes = parseOfficialSourceTypes(typesRaw);
  if (typesRaw !== undefined && !officialSourceTypes) problems.push("settings.official_source_types 형식이 틀립니다");
  // W4 7단계 — 판정 책임자가 있는 편집 분야. 행이 없으면 씨앗, 모양이 틀리면 빈 목록(모든 지역 기사 보류 — 닫힌 쪽, 문제로 적지 않는다: 발행 판정이 이유를 보인다)
  const judgeRaw = byKey.get("regional_judge_fields");
  const regionalJudgeFields = judgeRaw === undefined ? [...REGIONAL_JUDGE_FIELDS_DEFAULT] : (parseRegionalJudgeFields(judgeRaw) ?? []);
  // W4 8단계 — 오래된 통계 경고 기준. 경고일 뿐이라 없거나 틀리면 씨앗(365)으로 본다 (DB 트리거가 1~3650 정수만 저장한다)
  const staleRaw = byKey.get("stale_statistics_days");
  const staleStatisticsDays =
    typeof staleRaw === "number" && Number.isInteger(staleRaw) && staleRaw >= STALE_STATISTICS_DAYS_MIN && staleRaw <= STALE_STATISTICS_DAYS_MAX ? staleRaw : STALE_STATISTICS_DAYS_DEFAULT;
  return {
    settings: {
      dictionaries: { forbiddenPhrases, fearPhrases, jargonTerms },
      similarity,
      kogl: kogl ?? KOGL_USAGE_DEFAULT,
      officialSourceTypes: officialSourceTypes ?? [...OFFICIAL_SOURCE_TYPES],
      regionalJudgeFields,
      staleStatisticsDays,
    },
    problems,
  };
}
