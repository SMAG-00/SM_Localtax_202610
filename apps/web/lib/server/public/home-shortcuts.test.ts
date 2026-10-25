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
  test("메뉴 바로가기 4장이 모두 오면 4장 그대로 카드가 된다(도착이 준비 중이어도 카드는 빠지지 않는다)", () => {
    const four = [card("calc"), card("realestate_weekly"), card("brief_weekly"), card("expert_request")];
    const sec = homeSections({ ...base, shortcuts: four }).find((s) => s.key === "shortcuts");
    expect(sec && sec.key === "shortcuts" ? sec.cards.map((c) => [c.key, c.href]) : null).toEqual([["calc", "/calc"], ["realestate_weekly", "/realestate_weekly"], ["brief_weekly", "/brief_weekly"], ["expert_request", "/expert_request"]]);
  });
  test("설명은 30자 이하만 쓰고 31자는 이름만 보인다(경계)", () => {
    const sec = homeSections({ ...base, shortcuts: [card("calc", "가".repeat(30)), card("brief_weekly", "가".repeat(31))] }).find((s) => s.key === "shortcuts");
    expect(sec && sec.key === "shortcuts" ? sec.cards.map((c) => c.note) : null).toEqual(["가".repeat(30), null]);
  });
});
