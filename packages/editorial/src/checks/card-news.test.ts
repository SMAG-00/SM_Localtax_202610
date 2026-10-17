// ART-03 카드뉴스 — 5~7장 경계(4장·8장 발행 불가), 장마다 대체 텍스트·글자, 카드뉴스가 아닌 기사의 장 블록
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleBlock, ArticleForPublish, SlideBlock } from "../model";
import { blockSentences } from "../text";
import { checkCardNews } from "./card-news";

const slide = (i: number, over: Partial<SlideBlock> = {}): SlideBlock => ({
  type: "slide",
  title: `${i}. 취득세는 60일 안에`,
  text: "잔금일과 등기일 중 빠른 날부터 셉니다.",
  alt: `${i}번째 장 — 달력 그림 위에 60일을 표시했습니다`,
  ...over,
});
const slides = (n: number) => Array.from({ length: n }, (_, i) => slide(i + 1));
/** 통과 견본(세법 해설)을 카드뉴스로 — 장 n개 + 원래 FAQ 블록 */
const cardNews = (blocks: ArticleBlock[]): ArticleForPublish => ({ ...TAX_EXPLAINER, format: "cardnews", blocks, claims: [] });
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);

describe("ART-03 장 수 — 5~7장만 발행된다", () => {
  it.each([5, 6, 7])("%i장 → 카드뉴스 차단 0, 발행 가능", (n) => {
    const result = run(cardNews(slides(n)));
    expect(result.blockers.filter((f) => f.ruleRef === "ART-03")).toEqual([]);
    expect(result.canPublish).toBe(true);
  });

  it.each([4, 8, 0])("%i장 → 장 수 차단 하나 (지금 장 수를 알려 준다)", (n) => {
    const findings = checkCardNews(cardNews(slides(n)));
    expect(findings).toEqual([expect.objectContaining({ id: "art03.slide-count", level: "block", location: { field: "blocks" } })]);
    expect(findings[0]!.message).toContain(`지금 ${n}장`);
    expect(run(cardNews(slides(n))).canPublish).toBe(false);
  });

  it("장이 아닌 블록(FAQ 등)은 장 수에 세지 않는다", () => {
    const faq = TAX_EXPLAINER.blocks.find((b) => b.type === "faq")!;
    expect(checkCardNews(cardNews([...slides(4), faq]))).toEqual([expect.objectContaining({ id: "art03.slide-count" })]);
    expect(checkCardNews(cardNews([...slides(5), faq]))).toEqual([]);
  });
});

describe("ART-03 장마다 대체 텍스트와 글자", () => {
  it("대체 텍스트가 빈 장(공백만 포함) → 그 장의 블록 위치로 차단", () => {
    const blocks = slides(5);
    blocks[2] = slide(3, { alt: "   " });
    expect(checkCardNews(cardNews(blocks))).toEqual([expect.objectContaining({ id: "art03.slide-alt", location: { field: "blocks", blockIndex: 2 } })]);
  });

  it("제목도 글도 없는 장 → 글자 없음 차단, 제목만 있는 장은 통과", () => {
    const blocks = slides(6);
    blocks[0] = slide(1, { title: "", text: " " });
    blocks[5] = slide(6, { text: "" });
    expect(uniqueIds(checkCardNews(cardNews(blocks)))).toEqual(["art03.slide-text"]);
    expect(checkCardNews(cardNews(blocks))[0]!.location).toEqual({ field: "blocks", blockIndex: 0 });
  });

  it("장 글자는 금지 표현·문장 수 검사 대상이다 — 제목·글·대체 텍스트 순서로 문장이 된다", () => {
    expect(blockSentences(slide(1, { title: "제목.", text: "첫 문장. 둘째 문장.", alt: "설명" }))).toEqual(["제목.", "첫 문장.", "둘째 문장.", "설명"]);
    const blocks = slides(5);
    blocks[1] = slide(2, { text: "하나입니다. 둘입니다. 셋입니다. 넷입니다." });
    const result = run(cardNews(blocks));
    expect(result.warnings).toContainEqual(expect.objectContaining({ id: "ux01.box-too-many-sentences", location: { field: "blocks", blockIndex: 1 } }));
  });

  it("긴 대체 텍스트는 안내 문장 길이 경고에 들지 않는다 (화면 글자가 아니다)", () => {
    const blocks = slides(5);
    blocks[0] = slide(1, { alt: "가".repeat(80) });
    expect(run(cardNews(blocks)).warnings.filter((f) => f.id === "ux01.guide-sentence-long" && f.location?.blockIndex === 0)).toEqual([]);
  });
});

describe("ART-03 카드뉴스가 아닌 기사의 장 블록", () => {
  it("일반 형식 기사에 장 블록이 있으면 장마다 차단", () => {
    const article: ArticleForPublish = { ...TAX_EXPLAINER, blocks: [...TAX_EXPLAINER.blocks, slide(1), slide(2)] };
    const findings = checkCardNews(article);
    expect(findings.map((f) => [f.id, f.location?.blockIndex])).toEqual([
      ["art03.slide-outside-cardnews", TAX_EXPLAINER.blocks.length],
      ["art03.slide-outside-cardnews", TAX_EXPLAINER.blocks.length + 1],
    ]);
  });

  it("장 블록이 없는 일반 기사는 카드뉴스 검사 0", () => {
    expect(checkCardNews(TAX_EXPLAINER)).toEqual([]);
  });
});
