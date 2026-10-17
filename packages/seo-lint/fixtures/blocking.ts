// 차단 견본 원고 8종 (PRD-01A OPT-03 수용 기준) — 통과 견본에서 해당 차단 항목 하나만 어기게 바꾼 원고.
// 순서는 OPT-03이 적은 순서: canonical 중복 · 근거 없는 핵심 주장 · 저자 없음 · 발행/수정일 불일치 ·
// 법령 기준일 없음(대상 기사) · 구조화 데이터 불일치 · 유사도 기준 초과 · 광고 표기 불일치
import type { ArticleForLint, LintContext, LintSample } from "../src/types";
import { PASSING_SAMPLE } from "./passing";

const base = PASSING_SAMPLE.article;

function derive(
  id: string,
  violates: string,
  description: string,
  article: Partial<ArticleForLint>,
  context: LintContext = PASSING_SAMPLE.context,
): LintSample {
  return { id, violates, description, article: { ...base, ...article }, context };
}

export const BLOCKING_SAMPLES: readonly LintSample[] = [
  derive(
    "block-canonical-duplicate",
    "seo.canonical",
    "canonical 주소가 이미 공개된 다른 기사(article-sample-0002)의 canonical과 같다",
    { canonical: "https://localtaxresearch.com/news/acquisition-tax-rate-table" },
  ),
  derive("block-claim-without-evidence", "geo.claim-evidence", "핵심 주장 2개 중 1개에 근거가 이어지지 않았다", {
    claims: [base.claims[0]!, { ...base.claims[1]!, evidenceIds: [] }],
  }),
  derive("block-no-author", "geo.author", "저자가 지정되지 않았다", { authors: [] }),
  derive("block-date-mismatch", "geo.dates", "화면 수정일이 기록된 실질 수정일보다 1분 늦다", {
    dates: { data: base.dates.data, displayed: { ...base.dates.displayed, updatedAt: "2026-10-20T14:31:00+09:00" } },
  }),
  derive("block-no-law-basis-date", "geo.law-basis-date", "지방세 분야·세무 감수 대상 기사인데 법령 기준일이 없다", {
    lawBasisDate: null,
  }),
  derive("block-structured-data-mismatch", "common.structured-data", "JSON-LD dateModified가 화면 수정일과 다르다(packages/structured-data 대조 결과)", {
    structuredDataMismatches: ["dateModified"],
  }),
  derive("block-similarity-exceeded", "common.similarity", "보도자료 문장을 대부분 옮겨 유사도 기준을 넘었다(packages/similarity 결과)", {
    similarity: { status: "blocked" },
  }),
  derive("block-sponsor-label-mismatch", "common.sponsor-label", "공동 기획 기사인데 메타 제목에만 「[공동 기획 예시회계연구소]」 표기가 빠졌다", {
    metaDescription: `[공동 기획 예시회계연구소] ${base.metaDescription}`,
    sponsorship: {
      label: "공동 기획",
      partnerName: "예시회계연구소",
      pageBadge: "공동 기획 예시회계연구소",
      structuredHeadline: `[공동 기획 예시회계연구소] ${base.title}`,
    },
  }),
];
