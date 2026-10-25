// W10-i i2 - 홈 바로가기 블록 (HOME-13): hero 바로 뒤, 열린 카드만, 0장이면 블록 0, 30자 넘는 설명은 이름만
import { describe, expect, test } from "vitest";
import { homeSections, type HomeInput, type ShortcutCard } from "./home-logic";

const base: HomeInput = {
  coreMessage: "핵심 메시지",
  searchEnabled: true,
  searchChips: [],
  latestReports: [],
  weeklyHot: null,
  trackers: { items: [], source: "none" },
  stories: [],
  column: null,
  product: null,
  experts: null,
};
const card = (key: ShortcutCard["key"], note: string | null = null): ShortcutCard => ({ key, label: key, href: `/${key}`, note });
const keys = (i: HomeInput) => homeSections(i).map((s) => s.key);

describe("홈 바로가기 블록", () => {
  test("shortcuts를 안 넘기면 블록 순서가 1단계와 같다(hero, fields)", () => {
    expect(keys(base)).toEqual(["hero", "fields"]);
  });
  test("카드 0장이면 블록 0", () => {
    expect(keys({ ...base, shortcuts: [] })).toEqual(["hero", "fields"]);
  });
  test("카드가 있으면 hero 바로 뒤, fields 앞에 한 블록이 더해진다", () => {
    expect(keys({ ...base, shortcuts: [card("calc"), card("expert_request")] })).toEqual(["hero", "shortcuts", "fields"]);
  });
  test("설명은 30자 이하만 쓰고 31자는 이름만 보인다(경계)", () => {
    const sec = homeSections({ ...base, shortcuts: [card("calc", "가".repeat(30)), card("brief_weekly", "가".repeat(31))] }).find((s) => s.key === "shortcuts");
    expect(sec && sec.key === "shortcuts" ? sec.cards.map((c) => c.note) : null).toEqual(["가".repeat(30), null]);
  });
});
