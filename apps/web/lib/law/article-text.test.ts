import { describe, expect, it } from "vitest";
import { articleBodyText } from "./article-text";
import { extractArticleCitations } from "./citations";

describe("기사 본문 글자 모으기 (ART-12)", () => {
  it("글 칸만 모으고 블록 종류·근거 참조 값 칸과 링크 주소는 뺀다", () => {
    const text = articleBodyText({
      blocks: [
        { type: "paragraph", text: "시험용법 제11조의2를 본다 [안내](https://example.test/a)" },
        { type: "callout", refId: "e-1", data: { title: "시험용 제목", items: ["첫째", "둘째"] } },
        { type: "image", mediaId: 3, caption: "시험용 설명", credit: "시험용 출처" },
      ],
    });
    expect(text.split("\n")).toEqual(["시험용법 제11조의2를 본다 안내", "시험용 제목", "첫째", "둘째", "시험용 설명"]);
  });
  it("블록이 없거나 모양이 틀리면 빈 글자", () => {
    expect(articleBodyText(null)).toBe("");
    expect(articleBodyText({ blocks: "x" })).toBe("");
  });
  it("모은 글에서 가지 번호가 붙은 조문을 그대로 찾는다", () => {
    const text = articleBodyText({ blocks: [{ type: "paragraph", text: "시험용법 제11조의2 참고" }] });
    expect(extractArticleCitations(text, [{ id: 1, name: "시험용법" }])[0]).toMatchObject({ articleNo: 11, branchNo: 2 });
  });
});
