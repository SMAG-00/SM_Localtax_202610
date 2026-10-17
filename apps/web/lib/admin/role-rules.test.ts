// 역할 겸직 금지 화면 검사 시험 (ACC-04 · ADM-02 "겸직 금지 조합을 부여하려 하면 화면이 막고 사유를 보인다").
// 기대값은 PRD-00 6장 "편집 승인 권한(editor)과 편집국 외 역할(ad_ops·store_ops·brand_ops·expert_ops)은 한 계정에 함께 주지 않는다"를 옮긴 표다.
import { describe, expect, test } from "vitest";
import { STAFF_ROLES, type StaffRole } from "@/lib/access";
import { grantChoices, roleConflict } from "./role-rules";

const NON_NEWSROOM: StaffRole[] = ["ad_ops", "store_ops", "brand_ops", "expert_ops"];

describe("겸직 금지 — editor와 편집국 외 역할 4종 (양쪽 방향)", () => {
  test.each(NON_NEWSROOM)("editor가 있는 계정에 %s를 주면 막고 두 역할 이름을 사유에 적는다", (role) => {
    const reason = roleConflict(["editor"], role);
    expect(reason).not.toBeNull();
    expect(reason).toContain("편집 책임자(editor)");
    expect(reason).toContain(`(${role})`);
    expect(reason).toContain("ACC-04");
  });

  test.each(NON_NEWSROOM)("%s가 있는 계정에 editor를 주면 막는다", (role) => {
    const reason = roleConflict([role], "editor");
    expect(reason).toContain(`(${role})`);
    expect(reason).toContain("편집 책임자(editor)");
  });

  test("기자·세무 감수위원과 editor, 편집국 외 역할끼리는 함께 줄 수 있다", () => {
    expect(roleConflict(["reporter", "reviewer"], "editor")).toBeNull();
    expect(roleConflict(["ad_ops"], "store_ops")).toBeNull();
    expect(roleConflict(["reporter"], "ad_ops")).toBeNull();
    expect(roleConflict([], "editor")).toBeNull();
  });

  test("이미 있는 역할은 '이미 부여됨'으로 막는다 (겸직 사유와 다르다)", () => {
    expect(roleConflict(["editor"], "editor")).toBe("이미 부여된 역할입니다");
  });
});

describe("부여할 수 있는 역할 목록", () => {
  test("editor 계정 — 이미 있는 editor는 빼고, 편집국 외 역할 4종은 고를 수 있지만 사유가 붙는다", () => {
    const choices = grantChoices(["editor"]);
    expect(choices.map((c) => c.role)).toEqual(STAFF_ROLES.filter((r) => r !== "editor"));
    for (const c of choices) {
      if (NON_NEWSROOM.includes(c.role)) expect(c.blockedReason).toMatch(/ACC-04/);
      else expect(c.blockedReason).toBeNull();
    }
  });
  test("역할 없는 계정 — 7종 모두 막힘 없음", () => {
    expect(grantChoices([]).every((c) => c.blockedReason === null)).toBe(true);
    expect(grantChoices([]).length).toBe(7);
  });
});
