// 시험 도우미 — docs/dev/W2-c_설계.md 2장 표·씨앗 블록 읽기 (DB 시험 packages/db/tests/w2c-analytics.test.mjs가 같은 표를 읽는다). 시험에서만 부른다.
import fs from "node:fs";
import path from "node:path";

const DESIGN_PATH = path.resolve(__dirname, "../../../../docs/dev/W2-c_설계.md");
export const DESIGN = fs.readFileSync(DESIGN_PATH, "utf8");

function section(prefix: string): string {
  const sec = DESIGN.split(/^### /m).find((s) => s.startsWith(prefix));
  if (!sec) throw new Error(`설계 문서에 ${prefix} 소절이 없다`);
  return sec.split(/^## /m)[0]!;
}

/** 2.1·2.3·2.8 같은 칸 2개짜리 표의 한 줄 → 값 배열 */
export function designList(sub: "2.1" | "2.3" | "2.8", name: string): string[] {
  const line = section(sub)
    .split("\n")
    .find((l) => l.startsWith(`| ${name} `));
  if (!line) throw new Error(`설계 문서 ${sub}에 '${name}' 줄이 없다`);
  return [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

export interface DesignEventRow {
  name: string;
  section: "required" | "optional" | "none";
  props: { name: string; optional: boolean }[];
}

/** 2.2 이벤트 속성 표 */
export function designEvents(): DesignEventRow[] {
  const SECTION: Record<string, DesignEventRow["section"]> = { 필수: "required", 선택: "optional", 없음: "none" };
  const rows: DesignEventRow[] = [];
  for (const line of section("2.2").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const name = cells[1]?.match(/^`([a-z_]+)`$/)?.[1];
    if (!name) continue;
    const props = cells[3] === "없음" ? [] : cells[3]!.split("·").map((p) => ({ name: p.match(/`([a-z_]+)`/)![1]!, optional: p.includes("(선택)") }));
    rows.push({ name, section: SECTION[cells[2]!]!, props });
  }
  return rows;
}

/** 2.5(수집·집계)·2.8(기사 생산 기간) 씨앗 블록 — `#### \`키\`` 다음 json */
export function designSeeds(sub: "2.5" | "2.8" = "2.5"): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const m of section(sub).matchAll(/^#### `([a-z_]+)`\s*\n+```json\n([\s\S]*?)\n```/gm)) out.set(m[1]!, JSON.parse(m[2]!));
  return out;
}
