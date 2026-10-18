// 편집 화면의 표 칸 글자 ↔ 행 목록 — 표 블록·인포그래픽의 같은 내용 표가 같이 쓴다. 순수 함수 (시험: editor-state.test.ts)

/** 표 글자 → 행 목록. 줄마다 한 행, 칸은 | 로 나눈다 (빈 줄 제외) */
export function textToRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("|").map((cell) => cell.trim()));
}

export function rowsToText(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.join(" | ")).join("\n");
}
