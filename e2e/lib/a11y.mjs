// 접근성 점수 (Lighthouse 접근성 범주, PRD_최종 §9.5 · PRD-01A 9장) — e2e/a11y.test.mjs와 e2e/w2b-acceptance.test.mjs가 같이 쓴다.
// 원격 디버깅 포트로 띄운 Chromium(Playwright)에 Lighthouse를 붙여 잰다.
import lighthouse from "lighthouse";

/** 통과 기준 — 95점 */
export const A11Y_MIN = 0.95;

/** url의 접근성 점수(0~1)와 통과하지 못한 항목 id. port = 브라우저 원격 디버깅 포트 */
export async function accessibility(url, port) {
  const r = await lighthouse(url, { port, output: "json", logLevel: "error", onlyCategories: ["accessibility"] });
  const cat = r.lhr.categories.accessibility;
  const failing = cat.auditRefs
    .map((ref) => r.lhr.audits[ref.id])
    .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary")
    .map((a) => a.id);
  console.log(`접근성 ${Math.round(cat.score * 100)}점 — ${url.replace(/^https?:\/\/[^/]+/, "")}${failing.length ? ` (미흡: ${failing.join(", ")})` : ""}`);
  return { score: cat.score, failing };
}
