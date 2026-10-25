// 분야 편집 입력 검사 시험 (CAT-01) — 허브는 4대 분야로 고정, 하위 분야 이름·주소·소개·순서·공개·면책·「지방세로 읽기」 필수 여부
import { describe, expect, test } from "vitest";
import { categoryFormToBody, moveInOrder, orderPlan, parseCategoryInput, parseCategoryOrder, reservedSlugBlocked, slugChangeBlocked } from "./category-rules";

const ok = <T>(r: { ok: true; value: T } | { ok: false; errors: string[] }): T => {
  if (!r.ok) throw new Error(r.errors.join(" / "));
  return r.value;
};
const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("예약된 하위 분야 주소 (W10-i)", () => {
  test("부동산재테크의 weekly는 /realestate/weekly 화면 주소라 거부", () => {
    expect(reservedSlugBlocked("realestate", "weekly")).toContain("/realestate/weekly");
  });
  test("지자체뉴스의 기존 weekly(금주 핫뉴스)와 weekly와 닮은 주소는 막지 않는다", () => {
    expect(reservedSlugBlocked("local", "weekly")).toBeNull();
    expect(reservedSlugBlocked("realestate", "weekly-news")).toBeNull();
    expect(reservedSlugBlocked("realestate", "weekly2")).toBeNull();
    expect(reservedSlugBlocked("tax", "weekly")).toBeNull();
  });
});

describe("새 하위 분야 (create)", () => {
  test("API 칸 이름 → DB 칸 이름, 이름은 앞뒤 공백을 뺀다", () => {
    expect(
      ok(parseCategoryInput({ section: "finance", slug: "reits", name: " 리츠 ", intro: "리츠 구조를 봅니다.", sort: 50, visible: true, needsDisclaimer: true, needsTaxLens: true }, "create")),
    ).toEqual({ section: "finance", slug: "reits", name: "리츠", intro: "리츠 구조를 봅니다.", sort: 50, visible: true, needs_disclaimer: true, needs_tax_lens: true });
  });
  test("허브 값이 4대 분야 밖이면 거부 (CAT-01 '허브 값이 4개 밖이면 저장 거부')", () => {
    expect(errorsOf(parseCategoryInput({ section: "tourism", slug: "a", name: "관광" }, "create"))).toEqual(["category.section: tax·realestate·finance·local 중 하나여야 합니다"]);
  });
  test("분야·주소·이름은 필수", () => {
    expect(errorsOf(parseCategoryInput({}, "create"))).toEqual(["category.section: 필요합니다", "category.slug: 필요합니다", "category.name: 필요합니다"]);
  });
  test.each([
    ["a", true],
    ["trust-pf", true],
    ["2026-amendments", true],
    ["Trust", false],
    ["trust_pf", false],
    ["trust--pf", false],
    ["-trust", false],
    ["트러스트", false],
    ["a".repeat(60), true],
    ["a".repeat(61), false],
  ])("주소 '%s' → %s", (slug, valid) => {
    expect(parseCategoryInput({ section: "tax", slug, name: "이름" }, "create").ok).toBe(valid);
  });
  test("이름 40자는 통과, 41자·공백만은 거부", () => {
    expect(parseCategoryInput({ section: "tax", slug: "a", name: "가".repeat(40) }, "create").ok).toBe(true);
    expect(parseCategoryInput({ section: "tax", slug: "a", name: "가".repeat(41) }, "create").ok).toBe(false);
    expect(errorsOf(parseCategoryInput({ section: "tax", slug: "a", name: "   " }, "create"))).toEqual(["category.name: 비울 수 없습니다"]);
  });
  test("순서는 0 이상 정수, 참·거짓 칸은 boolean만", () => {
    expect(errorsOf(parseCategoryInput({ section: "tax", slug: "a", name: "가", sort: -1, visible: "yes" }, "create"))).toEqual([
      "category.sort: 0~100000 정수여야 합니다",
      "category.visible: true/false여야 합니다",
    ]);
  });
  test("모르는 칸은 거부", () => {
    expect(errorsOf(parseCategoryInput({ section: "tax", slug: "a", name: "가", legacyName: "x" }, "create"))).toEqual(["category.legacyName: 모르는 칸입니다"]);
  });
});

describe("하위 분야 고치기 (patch)", () => {
  test("분야(허브)는 바꿀 수 없다", () => {
    expect(errorsOf(parseCategoryInput({ section: "local" }, "patch"))).toEqual(["category.section: 분야(허브)는 바꿀 수 없습니다 — 그 분야에 새 하위 분야를 만드세요"]);
  });
  test("바꿀 칸만 옮긴다, 소개는 null로 비울 수 있다", () => {
    expect(ok(parseCategoryInput({ name: "개정", intro: null }, "patch"))).toEqual({ name: "개정", intro: null });
  });
  test("바꿀 칸이 없으면 거부", () => {
    expect(errorsOf(parseCategoryInput({}, "patch"))).toEqual(["category: 바꿀 칸이 없습니다"]);
  });
  test("소개 500자는 통과, 501자는 거부", () => {
    expect(parseCategoryInput({ intro: "가".repeat(500) }, "patch").ok).toBe(true);
    expect(parseCategoryInput({ intro: "가".repeat(501) }, "patch").ok).toBe(false);
  });
});

describe("발행 판정이 쓰는 주소는 바꿀 수 없다", () => {
  test("지방세 > 개정 트래커(amendments) 주소 변경 → 사유 (CAT-04)", () => {
    expect(slugChangeBlocked({ section: "tax", slug: "amendments" }, "amendment-briefing")).toMatch(/CAT-04/);
  });
  test("같은 주소를 다시 보내거나 다른 분야의 같은 이름 주소는 막지 않는다", () => {
    expect(slugChangeBlocked({ section: "tax", slug: "amendments" }, "amendments")).toBeNull();
    expect(slugChangeBlocked({ section: "realestate", slug: "amendments" }, "other")).toBeNull();
    expect(slugChangeBlocked({ section: "tax", slug: "columns" }, "opinion")).toBeNull();
  });
});

describe("순서 바꾸기", () => {
  test("입력 — 분야와 번호 목록(겹침 없음)", () => {
    expect(ok(parseCategoryOrder({ section: "tax", ids: [3, 1, 2] }))).toEqual({ section: "tax", ids: [3, 1, 2] });
    expect(errorsOf(parseCategoryOrder({ section: "tax", ids: [1, 1] }))).toEqual(["order.ids: 같은 번호가 두 번 있습니다"]);
    expect(errorsOf(parseCategoryOrder({ section: "x", ids: [] }))).toEqual(["order.section: tax·realestate·finance·local 중 하나여야 합니다", "order.ids: 1개 이상 번호 목록이어야 합니다"]);
  });
  test("그 분야의 하위 분야 전부를 보내야 한다 — 빠지거나 다른 분야 번호면 거부", () => {
    const rows = [
      { id: 1, sort: 10 },
      { id: 2, sort: 20 },
      { id: 3, sort: 30 },
    ];
    expect(errorsOf(orderPlan(rows, [1, 2]))).toEqual(["order.ids: 이 분야의 하위 분야 전부(3개)를 순서대로 보내야 합니다"]);
    expect(errorsOf(orderPlan(rows, [1, 2, 9]))).toEqual(["order.ids: 이 분야의 하위 분야 전부(3개)를 순서대로 보내야 합니다"]);
  });
  test("새 순서는 10 간격, 바뀐 행만 고친다", () => {
    const rows = [
      { id: 1, sort: 10 },
      { id: 2, sort: 20 },
      { id: 3, sort: 30 },
    ];
    expect(ok(orderPlan(rows, [1, 3, 2]))).toEqual([
      { id: 3, sort: 20 },
      { id: 2, sort: 30 },
    ]);
    expect(ok(orderPlan(rows, [1, 2, 3]))).toEqual([]);
  });
  test("위로·아래로 — 맨 끝에서는 그대로", () => {
    expect(moveInOrder([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveInOrder([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveInOrder([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveInOrder([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
  });
});

describe("화면 폼 → 요청 본문", () => {
  const form = { section: "tax", name: "교육", slug: "edu", intro: "", visible: true, needsDisclaimer: false, needsTaxLens: false };
  test("새 하위 분야 — 빈 소개는 null", () => {
    expect(categoryFormToBody(form, "create")).toEqual({ ok: true, body: { section: "tax", name: "교육", slug: "edu", intro: null, visible: true, needsDisclaimer: false, needsTaxLens: false } });
  });
  test("고치기 — 분야는 보내지 않는다", () => {
    const r = categoryFormToBody(form, "patch");
    expect(r.ok && "section" in r.body).toBe(false);
  });
  test("칸 오류는 칸 id로", () => {
    expect(categoryFormToBody({ ...form, name: " ", slug: "Edu" }, "create", "cat-new")).toEqual({
      ok: false,
      errors: { "cat-new-name": "이름을 적어 주세요", "cat-new-slug": "주소는 영문 소문자·숫자·'-'만 씁니다 (예: trust-pf)" },
    });
  });
});
