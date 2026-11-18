import { describe, expect, it } from "vitest";
import { stripLeftoverBlocks } from "./leftover-blocks";
import { parseArticleMarkdown } from "@/lib/editorial/article-markdown";

const p = (text: string) => ({ type: "paragraph", text });
const h = (text: string) => ({ type: "heading", text });

describe("stripLeftoverBlocks — 본문에 남은 편집 메모·코멘트 자리 표시를 지운다", () => {
  it("[코멘트 자리: …] 문단만 지우고 나머지는 그대로 둔다", () => {
    const blocks = [p("첫 문단"), p("[코멘트 자리: 정비사업 조합 세무를 맡는 세무사의 감면 일몰·추징 관리 취지 발언 필요]"), p("셋째 문단")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.blocks).toEqual([p("첫 문단"), p("셋째 문단")]);
    expect(r.removed).toBe(1);
  });

  it("편집 메모 표시 줄부터 끝까지 지운다 — [편집 메모]·## 편집 메모·**편집 메모** 모양 모두", () => {
    for (const marker of ["[편집 메모]", "## 편집 메모", "**편집 메모**", "편집 메모:"]) {
      const blocks = [p("본문"), p(marker), p("출처 목록"), p("- 헤럴드경제 https://example.com")];
      const r = stripLeftoverBlocks(blocks);
      expect(r.blocks, marker).toEqual([p("본문")]);
      expect(r.removed, marker).toBe(3);
    }
  });

  it("소제목 블록 모양의 편집 메모 표시도 지운다", () => {
    const r = stripLeftoverBlocks([p("본문"), h("편집 메모"), p("출처")]);
    expect(r.blocks).toEqual([p("본문")]);
  });

  it("문장 속에 '편집 메모'가 들어 있는 본문은 지우지 않는다", () => {
    const blocks = [p("편집 메모를 남기는 일은 기자의 몫이다."), p("[코멘트 자리가 아니라 일반 대괄호 문장]")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.blocks).toEqual(blocks);
    expect(r.removed).toBe(0);
  });

  it("지울 것이 없으면 그대로 돌려주고 0건이다 (빈 목록 포함)", () => {
    expect(stripLeftoverBlocks([])).toEqual({ blocks: [], removed: 0 });
    const blocks = [p("본문 하나")];
    expect(stripLeftoverBlocks(blocks)).toEqual({ blocks, removed: 0 });
  });

  it("편집 메모 앞에 남은 구분선 문단은 함께 지운다", () => {
    const r = stripLeftoverBlocks([p("본문"), p("---"), p("[편집 메모]"), p("출처")]);
    expect(r.blocks).toEqual([p("본문")]);
    expect(r.removed).toBe(3);
  });
});

describe("기사 md 가져오기 — [코멘트 자리: …] 줄은 본문에 넣지 않는다", () => {
  it("본문 한가운데의 코멘트 자리 줄을 빼고, 앞뒤 문단은 남긴다", () => {
    const md = ["[섹션] 지자체소식", "", "[제목] 시험 제목", "", "---", "", "첫 문단입니다.", "", "[코멘트 자리: 세무사 발언 필요]", "", "둘째 문단입니다.", ""].join("\n");
    const texts = parseArticleMarkdown(md).blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : []));
    expect(texts).toEqual(["첫 문단입니다.", "둘째 문단입니다."]);
  });
});
