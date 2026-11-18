import { isCommentSlotLine, isMemoMarkerLine } from "@/lib/editorial/article-markdown";

// 본문 블록에 남은 편집 메모·코멘트 자리 표시를 지운다 (기사 6번 사고 — 가져오기 전 버전이 메모를 본문 블록으로 넣었다).
// 순수 함수 — 화면의 '메모·표시 문구 지우기' 버튼이 부르고, 저장해야 반영된다.
//  · "[코멘트 자리: …]" 문단 → 그 블록만 지운다
//  · 편집 메모 시작 표시([편집 메모]·## 편집 메모·**편집 메모**) → 그 블록과 뒤의 모든 블록, 그 앞에 남은 구분선 블록
// 문장 속 '편집 메모'는 본문이므로 줄 전체가 표시일 때만 잘라 낸다.

export interface LeftoverBlockLike {
  type: string;
  text?: string;
}

const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const textOf = (b: LeftoverBlockLike): string => (typeof b.text === "string" ? b.text.trim() : "");

export function stripLeftoverBlocks<T extends LeftoverBlockLike>(blocks: readonly T[]): { blocks: T[]; removed: number } {
  let kept = blocks.filter((b) => !isCommentSlotLine(textOf(b)));
  const memoAt = kept.findIndex((b) => isMemoMarkerLine(textOf(b)));
  if (memoAt >= 0) {
    kept = kept.slice(0, memoAt);
    while (kept.length > 0 && RULE_RE.test(textOf(kept[kept.length - 1]!))) kept.pop();
  }
  return { blocks: kept, removed: blocks.length - kept.length };
}
