import { isCommentSlotLine, isInternalNoteLine, isMemoMarkerLine } from "@/lib/editorial/article-markdown";

// 본문 블록에 남은 편집 메모·코멘트 자리 표시를 지운다 (기사 6번 사고 — 가져오기 전 버전이 메모를 본문 블록으로 넣었다).
// 순수 함수 — 화면의 '메모·표시 문구 지우기' 버튼이 부르고, 저장해야 반영된다.
//  · "[코멘트 자리: …]"·"작성 가정: …"·"썸네일 파일명(계획): …" 문단 → 그 블록만 지운다
//  · 편집 메모 시작 표시([편집 메모]·## 편집 메모·**편집 메모**) → 그 블록과 뒤의 모든 블록, 그 앞에 남은 구분선 블록
// 문장 속 '편집 메모'는 본문이므로 줄 전체가 표시일 때만 잘라 낸다.

export interface LeftoverBlockLike {
  type: string;
  text?: string;
}

const RULE_RE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const textOf = (b: LeftoverBlockLike): string => (typeof b.text === "string" ? b.text.trim() : "");

export function stripLeftoverBlocks<T extends LeftoverBlockLike>(blocks: readonly T[]): { blocks: T[]; removed: number; indexes: number[] } {
  // 원래 위치를 들고 다니며 거른다 — 화면이 '어느 블록이 지워지는지' 보여 주려면 위치가 필요하다
  let kept = blocks.map((b, i) => ({ b, i })).filter(({ b }) => !isCommentSlotLine(textOf(b)) && !isInternalNoteLine(textOf(b)));
  const memoAt = kept.findIndex(({ b }) => isMemoMarkerLine(textOf(b)));
  if (memoAt >= 0) {
    kept = kept.slice(0, memoAt);
    while (kept.length > 0 && RULE_RE.test(textOf(kept[kept.length - 1]!.b))) kept.pop();
  }
  const keptIndexes = new Set(kept.map(({ i }) => i));
  const indexes = blocks.map((_, i) => i).filter((i) => !keptIndexes.has(i));
  return { blocks: kept.map(({ b }) => b), removed: indexes.length, indexes };
}

/** 발행 전 검사 — 저장된 본문(body)에 내부 표시가 남아 있으면 그 문장, 깨끗하면 null. 모양이 이상한 body는 판정하지 않는다(null) */
export function leftoverPublishProblem(body: unknown): string | null {
  const raw = body !== null && typeof body === "object" ? (body as { blocks?: unknown }).blocks : undefined;
  if (!Array.isArray(raw)) return null;
  const blocks = raw.filter((b): b is LeftoverBlockLike => b !== null && typeof b === "object" && typeof (b as { type?: unknown }).type === "string");
  const { removed } = stripLeftoverBlocks(blocks);
  return removed > 0 ? `본문에 편집 메모·코멘트 자리 표시가 ${removed}개 블록 남아 있어 발행할 수 없습니다 — 편집 화면의 본문 블록 위 안내에서 '지우기'를 누르고 저장한 뒤 다시 발행하세요` : null;
}
