import { describe, expect, test } from "vitest";
import { NAME_MAX, parsePersonInput } from "./people-rules";

const UID = "0A1B2C3D-0000-4000-8000-0123456789AB";
const base = { name: " 김기자 ", slug: "kim-reporter", roles: ["reporter", "reporter", "writer"] };

describe("등록(create)", () => {
  test("필수 칸만으로 통과하고 공백은 깎고 역할 중복은 합친다", () => {
    expect(parsePersonInput(base, "create")).toEqual({ ok: true, value: { name: "김기자", slug: "kim-reporter", roles: ["reporter", "writer"] } });
  });
  test("모든 칸 — 빈 글자는 null, 계정 ID는 소문자", () => {
    const r = parsePersonInput({ ...base, employment: "external", affiliation: "  ", beat: "취득세", conflicts: "", visibility: "public", staff_user_id: UID }, "create");
    expect(r).toEqual({ ok: true, value: { name: "김기자", slug: "kim-reporter", roles: ["reporter", "writer"], employment: "external", affiliation: null, beat: "취득세", conflicts: null, visibility: "public", staff_user_id: UID.toLowerCase() } });
  });
  test("빠진 필수 칸마다 오류", () => {
    const r = parsePersonInput({}, "create");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.errors.map((e) => e.split(":")[0])).toEqual(["name", "slug", "roles"]);
  });
  test.each([
    ["이름 경계 — 60자는 통과", { name: "가".repeat(NAME_MAX) }, true],
    ["이름 경계 — 61자는 거부", { name: "가".repeat(NAME_MAX + 1) }, false],
    ["slug 대문자", { slug: "Kim" }, false],
    ["slug 연속 하이픈", { slug: "kim--a" }, false],
    ["slug 끝 하이픈", { slug: "kim-" }, false],
    ["허용 밖 역할", { roles: ["boss"] }, false],
    ["빈 역할", { roles: [] }, false],
    ["허용 밖 고용 형태", { employment: "intern" }, false],
    ["허용 밖 공개 값", { visibility: "secret" }, false],
    ["계정 ID 형식 오류", { staff_user_id: "abc" }, false],
    ["소속 글자 아님", { affiliation: 3 }, false],
    ["이해관계 1001자", { conflicts: "가".repeat(1001) }, false],
  ])("%s", (_label, patch, ok) => {
    expect(parsePersonInput({ ...base, ...patch }, "create").ok).toBe(ok);
  });
  test("약력·동의서·등록 시각은 받지 않는다", () => {
    for (const key of ["bio_items", "consent_doc_version", "registered_at", "id"]) {
      const r = parsePersonInput({ ...base, [key]: "x" }, "create");
      expect(r.ok, key).toBe(false);
      if (!r.ok) expect(r.errors[0]).toContain(`${key}:`);
    }
  });
});

describe("고치기(patch)", () => {
  test("보낸 칸만 담긴다", () => {
    expect(parsePersonInput({ beat: "재산세" }, "patch")).toEqual({ ok: true, value: { beat: "재산세" } });
  });
  test("빈 본문은 거부", () => {
    expect(parsePersonInput({}, "patch")).toEqual({ ok: false, errors: ["body: 고칠 칸이 없습니다"] });
  });
  test("계정 해제는 null 또는 빈 글자", () => {
    expect(parsePersonInput({ staff_user_id: null }, "patch")).toEqual({ ok: true, value: { staff_user_id: null } });
    expect(parsePersonInput({ staff_user_id: "" }, "patch")).toEqual({ ok: true, value: { staff_user_id: null } });
  });
  test("고용 형태 비우기", () => {
    expect(parsePersonInput({ employment: null }, "patch")).toEqual({ ok: true, value: { employment: null } });
  });
});
