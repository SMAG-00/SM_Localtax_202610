// UX-03 압박 완화 — 공포 표현 차단, '기한'·'가산세' 블록의 '할 일을 함께 썼다', rose 상자 제목 고정
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withExtraBlock } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleBlock, ArticleForPublish, PublishContext } from "../model";
import { checkScreenCopy } from "./plain-language";

const ex = TAX_EXPLAINER;
const run = (article: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => evaluatePublish(article, ctx);
const blockers = (article: ArticleForPublish, ctx?: PublishContext) => uniqueIds(run(article, ctx).blockers);

describe("공포 표현 — 발행 차단", () => {
  it("'큰일'이 든 기사는 막힌다 — 위치와 표현", () => {
    const result = run(withExtraBlock(ex, { type: "paragraph", text: "신고를 미루면 큰일이 난다는 말은 사실이 아니다." }));
    expect(result.blockers).toEqual([
      {
        id: "ux03.fear-phrase",
        level: "block",
        ruleRef: "UX-03",
        message: "공포 표현 ‘큰일’ — 해야 할 일을 알려 주는 문장으로 바꿔 주세요",
        location: { field: "blocks", blockIndex: 7, sentenceIndex: 0, phrase: "큰일" },
      },
    ]);
  });

  it("'놓치면 끝'이 든 기사는 막힌다", () => {
    expect(blockers({ ...ex, title: "취득세 신고, 놓치면 끝" })).toContain("ux03.fear-phrase");
  });

  it("사전에서 표현을 지우면 다음 판정부터 막히지 않는다", () => {
    const article = withExtraBlock(ex, { type: "paragraph", text: "신고를 미루면 큰일이 난다는 말은 사실이 아니다." });
    const removed: PublishContext = {
      ...BASE_CONTEXT,
      dictionaries: { ...BASE_CONTEXT.dictionaries, fearPhrases: BASE_CONTEXT.dictionaries.fearPhrases.filter((p) => p !== "큰일") },
    };
    expect(blockers(article)).toEqual(["ux03.fear-phrase"]);
    expect(blockers(article, removed)).toEqual([]);
  });

  it("화면 고정 문구 검사도 같은 사전을 쓴다", () => {
    expect(uniqueIds(checkScreenCopy([{ id: "calc.result", kind: "guide", text: "세금 폭탄을 피하세요" }], BASE_CONTEXT))).toEqual([
      "ux01.forbidden-phrase",
      "ux03.fear-phrase",
    ]);
  });
});

describe("'기한'·'가산세'가 든 블록 — '할 일을 함께 썼다'를 체크해야 발행된다", () => {
  const deadline: ArticleBlock = { type: "paragraph", text: "신고 기한은 취득일부터 60일이다." };
  const penalty: ArticleBlock = { type: "paragraph", text: "늦게 신고하면 가산세가 붙는다." };

  it.each([
    ["기한", deadline],
    ["가산세", penalty],
  ])("'%s' 블록에 체크가 없으면 발행 0", (word, block) => {
    const result = run(withExtraBlock(ex, block));
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "ux03.action-not-written", location: { field: "blocks", blockIndex: 7, phrase: word } }),
    ]);
  });

  it("체크하면 발행된다", () => {
    expect(blockers(withExtraBlock(ex, { ...deadline, checklist: { actionWritten: true } }))).toEqual([]);
  });

  it("체크 항목이 false면 체크 안 한 것과 같다", () => {
    expect(blockers(withExtraBlock(ex, { ...penalty, checklist: { actionWritten: false } }))).toEqual(["ux03.action-not-written"]);
  });

  it("FAQ 답·표 칸·핵심 요약 줄에 있어도 그 블록의 체크가 필요하다", () => {
    expect(blockers(withExtraBlock(ex, { type: "faq", items: [{ question: "늦으면?", answer: "가산세가 붙습니다." }] }))).toEqual([
      "ux03.action-not-written",
    ]);
    expect(blockers(withExtraBlock(ex, { type: "table", caption: "신고 일정", rows: [["항목", "기한"], ["취득세", "60일"]], chart: null }))).toEqual([
      "ux03.action-not-written",
    ]);
    expect(blockers(withExtraBlock(ex, { type: "key_summary", lines: ["신고 기한은 60일입니다."] }))).toEqual(["ux03.action-not-written"]);
  });

  it("두 낱말이 모두 없는 블록은 체크가 필요 없다", () => {
    expect(blockers(withExtraBlock(ex, { type: "paragraph", text: "60일 안에 신고하면 됩니다." }))).toEqual([]);
  });

  it.each(["납부기한은 60일이다.", "신고기한을 넘겼다.", "제출 기한까지 낸다."])("붙여 쓴 '기한'도 낱말로 본다 — '%s'", (text) => {
    expect(blockers(withExtraBlock(ex, { type: "paragraph", text }))).toEqual(["ux03.action-not-written"]);
  });

  it.each(["잔금을 치른 날과 등기한 날 중 빠른 날이다.", "이의를 제기한 납세자가 있다.", "상속을 포기한 경우다.", "신고를 연기한 사례다."])(
    "'~기하다' 동사의 '기한'은 기한이 아니다 — '%s'",
    (text) => {
      expect(blockers(withExtraBlock(ex, { type: "paragraph", text }))).toEqual([]);
    },
  );
});

describe("rose 상자는 '자주 틀리는 점'에만", () => {
  it("rose(mistake) 상자에 다른 제목을 넣으면 발행 불가", () => {
    const result = run(withExtraBlock(ex, { type: "callout", kind: "mistake", title: "주의하세요", text: "잔금일이 취득일입니다." }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "ux03.rose-box-title", location: { field: "blocks", blockIndex: 7, phrase: "주의하세요" } }),
    ]);
  });

  it("제목이 '자주 틀리는 점'이면 통과", () => {
    expect(blockers(withExtraBlock(ex, { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "잔금일이 취득일입니다." }))).toEqual([]);
  });

  it("다른 상자는 제목이 자유롭다", () => {
    expect(blockers(withExtraBlock(ex, { type: "callout", kind: "caution", title: "주의하세요", text: "잔금일이 취득일입니다." }))).toEqual([]);
  });
});
