// 발행 판정 전체 — 통과 견본 3종(+해결 사례)·실패 견본·경고 발행·결정론·확장 자리
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../fixtures/context";
import { SOLVED_CASE, TAX_EXPLAINER } from "../fixtures/explainer";
import { FAILING_SAMPLES } from "../fixtures/failing";
import { uniqueIds } from "../fixtures/helpers";
import { QUALITATIVE_NEWS } from "../fixtures/qualitative";
import { QUANTITATIVE_NEWS } from "../fixtures/quantitative";
import { evaluatePublish } from "./evaluate";
import { RULES, type Finding } from "./findings";
import type { ArticleForPublish } from "./model";

describe("통과 견본 — 차단 0 · 경고 0", () => {
  it.each([
    ["정량형 보도기사", QUANTITATIVE_NEWS],
    ["정성형 보도기사(세금 쟁점·지역 정책 쟁점)", QUALITATIVE_NEWS],
    ["세법 해설(편집 승인 + 세무 감수)", TAX_EXPLAINER],
    ["해결 사례", SOLVED_CASE],
  ])("%s는 발행할 수 있다", (_name, article) => {
    const result = evaluatePublish(article, BASE_CONTEXT);
    expect(result.findings).toEqual([]);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.canPublish).toBe(true);
  });
});

describe("실패 견본 — 바꾼 한 곳의 차단 항목만 나온다", () => {
  it("견본 ID는 겹치지 않고, 기대 차단 항목은 모두 규칙 목록에 있다", () => {
    const ids = FAILING_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ruleIds = new Set<string>(RULES.map((r) => r.id));
    for (const s of FAILING_SAMPLES) for (const id of s.expectedBlockers) expect(ruleIds.has(id)).toBe(true);
  });

  it.each(FAILING_SAMPLES.map((s) => [s.id, s] as const))("%s", (_id, s) => {
    const result = evaluatePublish(s.article, s.context);
    expect(result.canPublish).toBe(false);
    expect(uniqueIds(result.blockers)).toEqual(s.expectedBlockers);
    expect(uniqueIds(result.warnings)).toEqual(s.expectedWarnings);
  });
});

describe("경고만 남은 원고 — 발행되고 경고 목록이 발행 기록용으로 나온다 (UX-01)", () => {
  const article: ArticleForPublish = {
    ...TAX_EXPLAINER,
    blocks: [
      { type: "paragraph", text: "재건축 조합은 관리처분계획 인가 뒤 이주를 시작한다." },
      ...TAX_EXPLAINER.blocks,
    ],
  };
  const result = evaluatePublish(article, BASE_CONTEXT);

  it("차단 0이라 발행할 수 있다", () => {
    expect(result.canPublish).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("경고 1건 — 풀이 없는 '관리처분계획'의 첫 등장 위치", () => {
    expect(result.warnings).toEqual([
      {
        id: "ux01.jargon-unexplained",
        level: "warn",
        ruleRef: "UX-01",
        message: "‘관리처분계획’이 처음 나오는 문단에 쉬운 풀이(새 집과 분담금을 정하는 계획)가 없습니다",
        location: { field: "blocks", blockIndex: 0, sentenceIndex: 0, phrase: "관리처분계획" },
      },
    ]);
    expect(result.findings).toEqual(result.warnings);
  });
});

describe("결정론", () => {
  it("같은 입력이면 같은 결과 — 여러 번 불러도, 입력 배열 순서를 바꿔도 결과 순서가 같다", () => {
    const messy: ArticleForPublish = {
      ...QUALITATIVE_NEWS,
      legalBasisDate: null,
      reviews: [],
      interviews: [...QUALITATIVE_NEWS.interviews].reverse().map((i) => ({ ...i, anonymityReason: null })),
      perspectives: { local_gov: null, residents_taxpayers: null, experts: null },
      evidence: [...QUALITATIVE_NEWS.evidence].reverse(),
      sources: [...QUALITATIVE_NEWS.sources].reverse(),
    };
    const first = evaluatePublish(messy, BASE_CONTEXT);
    expect(evaluatePublish(messy, BASE_CONTEXT)).toEqual(first);
    const reordered = { ...messy, interviews: [...messy.interviews].reverse(), evidence: [...messy.evidence].reverse() };
    expect(evaluatePublish(reordered, BASE_CONTEXT)).toEqual(first);
    expect(first.blockers.length).toBeGreaterThan(5);
    expect(first.findings).toEqual([...first.blockers, ...first.warnings]);
  });

  it("입력 객체를 바꾸지 않는다", () => {
    const snapshot = JSON.stringify(QUANTITATIVE_NEWS);
    evaluatePublish({ ...QUANTITATIVE_NEWS, taxLens: null }, BASE_CONTEXT);
    expect(JSON.stringify(QUANTITATIVE_NEWS)).toBe(snapshot);
  });
});

describe("확장 자리 — 지역 기사 편집 분야 게이트(REG1-17)는 나중에 extraChecks로 붙인다", () => {
  const regionalGate = (article: ArticleForPublish): Finding[] =>
    article.section === "local"
      ? [{ id: "reg117.editorial-field", level: "block", ruleRef: "REG1-17", message: "편집 분야를 지정하세요" }]
      : [];

  it("추가 검사의 차단 항목이 결과에 합쳐지고 발행이 막힌다", () => {
    const result = evaluatePublish(QUANTITATIVE_NEWS, BASE_CONTEXT, { extraChecks: [regionalGate] });
    expect(result.canPublish).toBe(false);
    expect(uniqueIds(result.blockers)).toEqual(["reg117.editorial-field"]);
  });

  it("해당 없는 기사에는 영향이 없다", () => {
    expect(evaluatePublish(TAX_EXPLAINER, BASE_CONTEXT, { extraChecks: [regionalGate] }).canPublish).toBe(true);
  });
});
