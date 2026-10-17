// CAT-04 — 개정 브리핑(지방세 > 개정)은 연결 트래커가 없으면 발행할 수 없다
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish } from "../model";
import { isAmendmentBriefing } from "./amendment";

const briefing: ArticleForPublish = { ...TAX_EXPLAINER, category: { slug: "amendments", needsDisclaimer: true }, amendmentId: null };
const blockers = (article: ArticleForPublish) => uniqueIds(evaluatePublish(article, BASE_CONTEXT).blockers);

describe("CAT-04 개정 브리핑", () => {
  it("지방세 > 개정 분야의 기사가 개정 브리핑이다", () => {
    expect(isAmendmentBriefing(briefing)).toBe(true);
    expect(isAmendmentBriefing(TAX_EXPLAINER)).toBe(false);
    expect(isAmendmentBriefing({ ...briefing, section: "realestate" })).toBe(false);
    expect(isAmendmentBriefing({ ...briefing, category: null })).toBe(false);
  });

  it("연결 트래커가 없으면 발행 불가", () => {
    const result = evaluatePublish(briefing, BASE_CONTEXT);
    expect(result.blockers).toEqual([
      {
        id: "cat04.tracker-required",
        level: "block",
        ruleRef: "CAT-04",
        message: "개정 브리핑에 연결한 개정 트래커가 없습니다 — 트래커를 연결해야 진행 단계 배지가 보입니다",
      },
    ]);
  });

  it("트래커를 연결하면 통과", () => {
    expect(blockers({ ...briefing, amendmentId: "amendment-2026-local-tax-reform" })).toEqual([]);
  });

  it("개정 브리핑이 아닌 기사는 트래커가 없어도 된다", () => {
    expect(blockers({ ...briefing, category: { slug: "interpretations", needsDisclaimer: true } })).toEqual([]);
  });
});
