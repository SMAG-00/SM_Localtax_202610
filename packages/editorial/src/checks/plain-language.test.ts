// UX-01 쉬운 말 — 풀이 없는 전문 용어 첫 등장(경고), 안내 문장 60자(경고), 한 상자 3문장(경고), 금지 표현(차단·위치)
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withBlock, withExtraBlock } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, PublishContext } from "../model";
import { countChars } from "../text";
import { checkScreenCopy } from "./plain-language";

const ex = TAX_EXPLAINER;
const run = (article: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => evaluatePublish(article, ctx);

/** 공백을 뺀 글자 수가 정확히 n인 안내 문장 (띄어쓰기를 섞어 공백을 세지 않는 것도 함께 본다) */
function sentenceOfLength(n: number): string {
  const body = "잔금일부터 육십일 안에 구청에 신고하고 납부합니다 ".repeat(5).replace(/\s+/g, " ");
  let out = "";
  for (const ch of body) {
    if (countChars(out) === n - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}.`;
}

describe("풀이 없는 전문 용어 첫 등장 — 경고(저장·발행은 된다)", () => {
  const plainCtx = BASE_CONTEXT;

  it("'과세표준'이 풀이 없이 처음 나오면 경고 1건", () => {
    const article = withBlock(ex, 0, { type: "paragraph", text: "세액은 과세표준에 세율을 곱해 정한다." });
    const result = run(article, plainCtx);
    expect(result.canPublish).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        id: "ux01.jargon-unexplained",
        location: { field: "blocks", blockIndex: 0, sentenceIndex: 0, phrase: "과세표준" },
      }),
    ]);
  });

  it("같은 문단에 '과세표준(세금을 매기는 기준 금액)'이 있으면 경고 0", () => {
    const article = withBlock(ex, 0, { type: "paragraph", text: "세액은 과세표준(세금을 매기는 기준 금액)에 세율을 곱해 정한다." });
    expect(run(article).warnings).toEqual([]);
  });

  it("풀이가 다음 문단에야 나오면 첫 등장 문단 기준으로 경고", () => {
    const article: ArticleForPublish = {
      ...ex,
      blocks: [
        { type: "paragraph", text: "과세표준이 핵심이다." },
        { type: "paragraph", text: "과세표준(세금을 매기는 기준 금액)은 거래 가격이다." },
      ],
    };
    expect(uniqueIds(run(article).warnings)).toEqual(["ux01.jargon-unexplained"]);
  });

  it("첫 등장에서 풀었으면 두 번째부터는 풀지 않아도 된다", () => {
    const second = ex.blocks[2]!;
    expect(second.type === "paragraph" ? second.text : "").toMatch(/^과세표준은 /);
    expect(run(ex).warnings).toEqual([]);
  });

  it("사전에 없는 용어나 나오지 않는 용어는 검사하지 않는다", () => {
    const ctx: PublishContext = { ...BASE_CONTEXT, dictionaries: { ...BASE_CONTEXT.dictionaries, jargonTerms: [] } };
    const article = withBlock(ex, 0, { type: "paragraph", text: "세액은 과세표준에 세율을 곱해 정한다." });
    expect(run(article, ctx).warnings).toEqual([]);
  });
});

describe("안내 문장 60자 — 60자 통과, 61자 경고 (공백 제외)", () => {
  it("만든 문장의 글자 수가 정확하다", () => {
    expect(countChars(sentenceOfLength(60))).toBe(60);
    expect(countChars(sentenceOfLength(61))).toBe(61);
    expect(sentenceOfLength(60)).toContain(" ");
  });

  it("상황 카드 안내 문장 60자는 통과", () => {
    expect(checkScreenCopy([{ id: "situation-first-home.guide", kind: "guide", text: sentenceOfLength(60) }], BASE_CONTEXT)).toEqual([]);
  });

  it("상황 카드 안내 문장 61자는 경고 1건", () => {
    expect(checkScreenCopy([{ id: "situation-first-home.guide", kind: "guide", text: sentenceOfLength(61) }], BASE_CONTEXT)).toEqual([
      {
        id: "ux01.guide-sentence-long",
        level: "warn",
        ruleRef: "UX-01",
        message: "안내 문장이 61자입니다(기준 60자) — 문장을 나눠 주세요",
        location: { field: "copy:situation-first-home.guide", sentenceIndex: 0 },
      },
    ]);
  });

  it("기사의 요약·상자 문장도 같은 기준 — 콜아웃 61자 문장은 경고", () => {
    const article = withExtraBlock(ex, { type: "callout", kind: "info", title: "알아 두기", text: sentenceOfLength(61) });
    expect(run(article).warnings).toEqual([
      expect.objectContaining({ id: "ux01.guide-sentence-long", location: { field: "blocks", blockIndex: 7, sentenceIndex: 1 } }),
    ]);
  });

  it("본문 문단은 안내 문장 기준을 적용하지 않는다", () => {
    const article = withExtraBlock(ex, { type: "paragraph", text: sentenceOfLength(75) });
    expect(run(article).warnings).toEqual([]);
  });

  it("기준값은 문맥에서 받는다 — 기준을 61로 두면 61자도 통과", () => {
    const ctx: PublishContext = { ...BASE_CONTEXT, thresholds: { ...BASE_CONTEXT.thresholds, guideSentenceMax: 61 } };
    expect(checkScreenCopy([{ id: "hub.intro", kind: "guide", text: sentenceOfLength(61) }], ctx)).toEqual([]);
  });
});

describe("한 상자 3문장 — 3문장 통과, 4문장 경고", () => {
  const three = "잔금일을 확인합니다. 60일을 셉니다. 구청에 신고합니다.";
  const four = `${three} 납부도 함께 합니다.`;

  it("콜아웃 3문장은 통과", () => {
    expect(run(withExtraBlock(ex, { type: "callout", kind: "info", title: "순서", text: three })).warnings).toEqual([]);
  });

  it("콜아웃 4문장은 경고 1건 — 위치는 그 상자", () => {
    expect(run(withExtraBlock(ex, { type: "callout", kind: "info", title: "순서", text: four })).warnings).toEqual([
      expect.objectContaining({
        id: "ux01.box-too-many-sentences",
        message: "한 상자에 4문장이 있습니다(기준 3문장) — 줄이거나 나눠 주세요",
        location: { field: "blocks", blockIndex: 7 },
      }),
    ]);
  });

  it("핵심 요약 상자 4줄은 경고", () => {
    const keySummary = ex.blocks[0]!;
    if (keySummary.type !== "key_summary") throw new Error("견본 0번 블록은 핵심 요약 상자다");
    const article = withBlock(ex, 0, { ...keySummary, lines: [...keySummary.lines, "감면은 신고할 때 신청합니다."] });
    expect(uniqueIds(run(article).warnings)).toEqual(["ux01.box-too-many-sentences"]);
  });

  it("화면 문구 상자(kind box)도 같은 기준", () => {
    expect(checkScreenCopy([{ id: "hub.tax-points", kind: "box", text: three }], BASE_CONTEXT)).toEqual([]);
    expect(uniqueIds(checkScreenCopy([{ id: "hub.tax-points", kind: "box", text: four }], BASE_CONTEXT))).toEqual([
      "ux01.box-too-many-sentences",
    ]);
  });
});

describe("금지 표현 — 발행 차단, 위치(블록·문장)를 알려 준다", () => {
  it("'절세 보장'이 든 기사는 막히고 블록·문장·표현을 알려 준다", () => {
    const article = withBlock(ex, 2, {
      type: "paragraph",
      text: "과세표준은 원칙적으로 실제 거래 가격이다. 이 방법이면 절세 보장이다.",
    });
    const result = run(article);
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toEqual([
      {
        id: "ux01.forbidden-phrase",
        level: "block",
        ruleRef: "UX-01",
        message: "금지 표현 ‘절세 보장’ — 이 표현을 빼야 발행됩니다",
        location: { field: "blocks", blockIndex: 2, sentenceIndex: 1, phrase: "절세 보장" },
      },
    ]);
  });

  it("'현지 1위'가 든 기사도 같은 방식으로 막힌다", () => {
    const article = withExtraBlock(ex, { type: "paragraph", text: "가온시 취득세 상담 현지 1위 세무사무소가 있다." });
    expect(run(article).blockers).toEqual([
      expect.objectContaining({
        id: "ux01.forbidden-phrase",
        location: { field: "blocks", blockIndex: 7, sentenceIndex: 0, phrase: "현지 1위" },
      }),
    ]);
  });

  it("제목·요약·FAQ·표 칸에 있어도 막는다", () => {
    expect(run({ ...ex, title: "취득세 절세 보장 비법" }).blockers[0]!.location).toEqual({ field: "title", sentenceIndex: 0, phrase: "절세 보장" });
    expect(run({ ...ex, summary: "60일 안에 신고합니다. 최저가 대행도 있습니다." }).blockers[0]!.location).toEqual({
      field: "summary",
      sentenceIndex: 1,
      phrase: "최저가",
    });
    const faq = withExtraBlock(ex, { type: "faq", items: [{ question: "대행 비용은?", answer: "무료 상담으로 안내합니다." }] });
    expect(run(faq).blockers[0]!.location).toEqual({ field: "blocks", blockIndex: 7, sentenceIndex: 1, phrase: "무료 상담" });
    const table = withExtraBlock(ex, { type: "table", caption: "비교", rows: [["구분", "내용"], ["대행", "수익 보장"]], chart: null });
    expect(run(table).blockers[0]!.location).toEqual(expect.objectContaining({ field: "blocks", blockIndex: 7, phrase: "수익 보장" }));
  });

  it("띄어쓰기가 여러 칸이어도 같은 표현으로 본다", () => {
    expect(uniqueIds(run({ ...ex, title: "취득세 절세   보장 비법" }).blockers)).toEqual(["ux01.forbidden-phrase"]);
  });

  it("사전에 새 표현을 넣으면 배포 없이 다음 판정부터 막힌다", () => {
    const article = withExtraBlock(ex, { type: "paragraph", text: "전문가들은 이 방법을 가장 확실한 절세법이라 부른다." });
    expect(run(article).canPublish).toBe(true);
    const updated: PublishContext = {
      ...BASE_CONTEXT,
      dictionaries: { ...BASE_CONTEXT.dictionaries, forbiddenPhrases: [...BASE_CONTEXT.dictionaries.forbiddenPhrases, "가장 확실한 절세법"] },
    };
    const result = run(article, updated);
    expect(result.canPublish).toBe(false);
    expect(result.blockers[0]!.location).toEqual({ field: "blocks", blockIndex: 7, sentenceIndex: 0, phrase: "가장 확실한 절세법" });
  });

  it("화면 문구 검사에도 같은 사전을 쓴다", () => {
    expect(checkScreenCopy([{ id: "banner.home", kind: "guide", text: "최저가 신고 대행" }], BASE_CONTEXT)).toEqual([
      expect.objectContaining({ id: "ux01.forbidden-phrase", location: { field: "copy:banner.home", sentenceIndex: 0, phrase: "최저가" } }),
    ]);
  });
});
