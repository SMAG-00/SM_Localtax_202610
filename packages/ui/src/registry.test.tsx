// DS-02 — 1단계 컴포넌트는 PRD-00 8.6에서 단계 칸에 1이 있는 70종이고, 견본 등록 목록과 이름이 1:1로 같다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { componentRegistry } from "./registry";

const ROOT = path.join(__dirname, "..", "..", "..");
const PRD00 = fs.readdirSync(path.join(ROOT, "docs", "PRD")).find((f) => f.startsWith("PRD-00"))!;
const doc = fs.readFileSync(path.join(ROOT, "docs", "PRD", PRD00), "utf8");
const section = doc.slice(doc.indexOf("### 8.6 컴포넌트"), doc.indexOf("| 화면 패턴 | 조합과 규칙"));
const smPart = section.slice(section.indexOf("**SM에서 그대로 가져오는 것"), section.indexOf("**새로 만드는 것**"));
const newPart = section.slice(section.indexOf("**새로 만드는 것**"));

const rows = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("|---") && !l.startsWith("| 컴포넌트 |"))
    .map((l) => l.split(/(?<!\\)\|/).map((c) => c.trim()).slice(1, -1));

const smNames = rows(smPart).map((c) => c[0]);
// 단계 칸(세 번째)에 '1'이 단계 번호로 있는 행 — "1", "1 · 2", "1 (모드 탭 4)" 등. PRD-X 후보는 빼고
const stageOneNames = rows(newPart)
  .filter((c) => /(^|[^\d])1($|[^\d])/.test(c[2]) && !/PRD-X/.test(c[2]))
  .map((c) => c[0]);
const expected = [...smNames, ...stageOneNames];

describe("컴포넌트 등록 목록 ↔ PRD-00 8.6", () => {
  it("문서에서 SM 17종과 새 1단계 53종, 모두 70종을 읽었다", () => {
    expect(smNames.length).toBe(17);
    expect(expected.length).toBe(70);
  });

  it("등록 목록이 70종이고 이름이 문서와 1:1로 같다", () => {
    const registered = componentRegistry.map((e) => e.name).sort();
    expect(registered).toEqual([...expected].sort());
  });

  it("data-ui 값이 서로 겹치지 않는다", () => {
    const uis = componentRegistry.map((e) => e.ui);
    expect(new Set(uis).size).toBe(uis.length);
  });

  it("PRD-X 후보 컴포넌트(장소 카드·맛집·음식문화 카드·생활정보 카드·지역 허브 네 갈래 카드·동기화 지연 변형)는 등록되지 않는다", () => {
    const names = componentRegistry.map((e) => e.name);
    for (const x of ["장소 카드", "맛집·음식문화 카드", "생활정보 카드", "지역 허브 네 갈래 카드", "데이터 출처 줄 — 동기화 지연 변형"]) {
      expect(names).not.toContain(x);
    }
  });
});
