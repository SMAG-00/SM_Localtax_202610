// OPT-03 seo-lint 결과 · OPT-06 유사도 결과 — 다른 패키지를 부르지 않고 결과를 입력으로 받는다.
// 유사도 '비교 대상 없음'(no_sources·no_body)은 통과로 보지 않고 경고로 남긴다 (seo-lint rules.v1 common.similarity와 같은 등급).
import { finding, type Finding } from "../findings";
import type { PublishContext } from "../model";

export function checkExternal(_article: unknown, ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  if (ctx.seoLint === null) {
    out.push(finding("opt03.seo-lint-missing", "최적화 점검 결과가 없습니다 — 점검을 마친 뒤 발행하세요"));
  } else {
    for (const id of new Set(ctx.seoLint.blockers)) {
      out.push(finding("opt03.seo-lint-blocker", `최적화 점검 차단 항목 ‘${id}’ — 해소해야 발행됩니다`, { field: "seoLint", phrase: id }));
    }
    for (const id of new Set(ctx.seoLint.warnings)) {
      out.push(finding("opt03.seo-lint-warning", `최적화 점검 경고 항목 ‘${id}’ — 발행 기록에 남습니다`, { field: "seoLint", phrase: id }));
    }
  }
  const similarity = ctx.similarity;
  if (similarity === null) {
    out.push(finding("opt06.similarity-missing", "유사도 검사 결과가 없습니다 — 검사를 마친 뒤 발행하세요"));
  } else if (similarity.status === "blocked") {
    out.push(finding("opt06.similarity-blocked", "유사도 기준을 넘었습니다 — 옮겨 온 문장을 요약·재구성해 주세요"));
  } else if (similarity.status === "no_sources" || similarity.status === "no_body") {
    out.push(finding("opt06.similarity-unverified", "유사도 비교 대상 없음 — 통과로 표시하지 않고 발행 기록에 남깁니다"));
  }
  return out;
}
