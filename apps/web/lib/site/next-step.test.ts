import { describe, expect, test } from "vitest";
import { NEXT_STEPS, calcResultConsultHref } from "./next-step";

describe("다음 한 걸음", () => {
  test("읽기에서 계산 단계는 /calc 이고 글자에 AI 낱말이 없다", () => {
    expect(NEXT_STEPS.read_to_calc).toMatchObject({ label: "이 내용으로 계산해 보기", href: "/calc" });
    for (const s of Object.values(NEXT_STEPS)) expect(s.label).not.toMatch(/AI/);
  });
  test("상담 완료 뒤 단계는 브리핑 구독으로 간다", () => {
    expect(NEXT_STEPS.consult_to_brief.href).toBe("/brief/subscribe");
  });
  test("계산 결과에서 상담 요청 링크는 source와 field 두 키뿐이다", () => {
    const u = new URL(calcResultConsultHref("realestate"), "https://x.test");
    expect(u.pathname).toBe("/experts/request");
    expect([...u.searchParams.keys()].sort()).toEqual(["field", "source"]);
    expect(u.searchParams.get("source")).toBe("calc_result");
    expect(u.searchParams.get("field")).toBe("realestate");
  });
});
