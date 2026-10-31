// 발행 기사 빠른 수정 — 바꾼 칸으로 수정 사유 문장을 만든다 (ART-05 사유 칸 자동 채우기, 사람은 확인·고치기만)
import type { EditorState } from "./editor-state";

// 사유 문장에 이름으로 나오는 칸 — 이 밖의 칸은 '기타 칸'으로 묶는다
const NAMED: [keyof EditorState, string][] = [
  ["title", "제목"],
  ["summary", "요약"],
  ["blocks", "본문"],
];
// 비교에서 빼는 칸 — 수정 종류·사유는 이 저장의 설명이지 기사 내용이 아니다
const IGNORED = new Set<string>(["updateKind", "reason"]);

/** 블록의 화면 key는 렌더마다 새로 붙는 값이라 비교에서 뺀다 */
function comparable(field: string, value: unknown): string {
  if (field === "blocks" && Array.isArray(value)) return JSON.stringify(value.map(({ key: _key, ...rest }) => rest));
  return JSON.stringify(value);
}

/** 처음 불러온 상태와 지금 상태를 비교해 "요약 수정"·"제목·본문 수정"·"기타 칸 수정" 같은 문장을 만든다. 바뀐 칸이 없으면 "" */
export function suggestedFixReason(initial: EditorState, current: EditorState): string {
  const changed = (field: string) => comparable(field, initial[field as keyof EditorState]) !== comparable(field, current[field as keyof EditorState]);
  const names = NAMED.filter(([field]) => changed(field)).map(([, label]) => label);
  const named = new Set<string>(NAMED.map(([field]) => field));
  const other = Object.keys(current).some((field) => !named.has(field) && !IGNORED.has(field) && changed(field));
  if (other) names.push("기타 칸");
  return names.length === 0 ? "" : `${names.join("·")} 수정`;
}
