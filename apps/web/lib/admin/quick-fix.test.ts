import { describe, expect, it } from "vitest";
import { suggestedFixReason } from "./quick-fix";
import type { EditorState } from "./editor-state";

// 견본 상태 — 비교에 쓰는 칸만 채운다 (나머지 칸은 같은 값이면 비교 결과에 영향 없음)
const base = {
  title: "부동산·지방세 브리핑",
  summary: "지방세는 공식 원문으로 전합니다.",
  blocks: [{ key: "k1", type: "paragraph", text: "첫 문단" }],
  slug: "briefing-2026-10-19",
  updateKind: "",
  reason: "",
} as unknown as EditorState;

describe("suggestedFixReason — 발행 기사 수정 사유 자동 문장", () => {
  it("요약만 바꾸면 '요약 수정'", () => {
    expect(suggestedFixReason(base, { ...base, summary: "새 요약입니다." })).toBe("요약 수정");
  });

  it("제목과 본문을 바꾸면 바꾼 칸을 순서대로 잇는다", () => {
    const next = { ...base, title: "새 제목", blocks: [{ key: "k1", type: "paragraph", text: "고친 문단" }] } as unknown as EditorState;
    expect(suggestedFixReason(base, next)).toBe("제목·본문 수정");
  });

  it("본문 블록의 화면 key만 다르면 본문이 바뀐 것으로 보지 않는다", () => {
    const next = { ...base, blocks: [{ key: "k9", type: "paragraph", text: "첫 문단" }] } as unknown as EditorState;
    expect(suggestedFixReason(base, next)).toBe("");
  });

  it("제목·요약·본문 밖의 칸만 바꾸면 '기타 칸 수정'", () => {
    expect(suggestedFixReason(base, { ...base, slug: "briefing-2026-10-20" })).toBe("기타 칸 수정");
  });

  it("수정 종류·사유 칸 입력은 바뀐 칸으로 세지 않는다 — 아무것도 안 바꾸면 빈 문장", () => {
    expect(suggestedFixReason(base, { ...base, updateKind: "typo", reason: "메모" })).toBe("");
  });
});
