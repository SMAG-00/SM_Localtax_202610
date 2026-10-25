import { describe, expect, test } from "vitest";
import { parseGuideDraft, parseGuidePublish, parseGuideSign } from "./input";

// 시험용 지어낸 글자만 쓴다 - 실제 가이드 문장·세율·요건이 아니다.
const ok = { hub: "realestate_tax", topic: "fixture_topic", slug: "fixture-guide", title: "시험용 가이드", tax_scope: "local" };

describe("가이드 초안 입력", () => {
  test("최소 입력은 빈 절·빈 사실값·빈 출처로 받는다 (빈 칸으로 출하)", () => {
    const r = parseGuideDraft(ok);
    expect(r).toEqual({
      ok: true,
      value: { hub: "realestate_tax", topic: "fixture_topic", slug: "fixture-guide", version: { title: "시험용 가이드", sections: [], facts: {}, tax_scope: "local", as_of: null, region_codes: [], sources: [], import_origin: null } },
    });
  });

  test("절·사실값·출처는 JSON 글자로 와도 값으로 와도 같게 받고 지역 코드는 쉼표로 나눈다", () => {
    const sections = [{ heading: "시험용 절", body: "시험용 본문" }];
    const a = parseGuideDraft({ ...ok, sections: JSON.stringify(sections), facts: '{"fixture_key":"시험용"}', sources: '[{"label":"시험용 출처","url":"https://example.test/a"}]', region_codes: "1100000000, 2600000000", as_of: "2099-02-28" });
    const b = parseGuideDraft({ ...ok, sections, facts: { fixture_key: "시험용" }, sources: [{ label: "시험용 출처", url: "https://example.test/a" }], region_codes: ["1100000000", "2600000000"], as_of: "2099-02-28" });
    expect(a).toEqual(b);
    expect(a.ok && a.value.version.region_codes).toEqual(["1100000000", "2600000000"]);
  });

  test.each([
    ["모르는 허브", { hub: "transfer" }, "hub:"],
    ["대문자 주제", { topic: "Bad" }, "topic:"],
    ["공백 있는 주소", { slug: "bad slug" }, "slug:"],
    ["빈 제목", { title: "  " }, "title:"],
    ["모르는 세목 범위", { tax_scope: "regional" }, "tax_scope:"],
    ["없는 날짜(2월 30일)", { as_of: "2099-02-30" }, "as_of:"],
    ["지역 코드 9자리", { region_codes: "110000000" }, "region_codes:"],
    ["http 출처 주소", { sources: [{ label: "시험용", url: "http://example.test" }] }, "sources[0].url:"],
    ["틀린 JSON", { sections: "[{" }, "sections:"],
    ["사실값이 배열", { facts: "[]" }, "facts:"],
    ["절에 모르는 칸", { sections: [{ heading: "h", body: "b", extra: 1 }] }, "sections[0]:"],
    ["빈 절 본문", { sections: [{ heading: "h", body: " " }] }, "sections[0].body:"],
  ])("거부 - %s", (_name, over, prefix) => {
    const r = parseGuideDraft({ ...ok, ...over });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.startsWith(prefix))).toBe(true);
  });

  test("경계 - 절 50개는 받고 51개는 거부, 본문 20000자는 받고 20001자는 거부", () => {
    const sec = (n: number) => Array.from({ length: n }, () => ({ heading: "시험용", body: "시험용" }));
    expect(parseGuideDraft({ ...ok, sections: sec(50) }).ok).toBe(true);
    expect(parseGuideDraft({ ...ok, sections: sec(51) }).ok).toBe(false);
    expect(parseGuideDraft({ ...ok, sections: [{ heading: "h", body: "가".repeat(20_000) }] }).ok).toBe(true);
    expect(parseGuideDraft({ ...ok, sections: [{ heading: "h", body: "가".repeat(20_001) }] }).ok).toBe(false);
  });

  test("본문에 이메일 같은 개인정보가 있으면 거부한다", () => {
    const r = parseGuideDraft({ ...ok, sections: [{ heading: "시험용", body: "문의 hong@example.com" }] });
    expect(r.ok).toBe(false);
  });
});

describe("서명·공개 입력", () => {
  test("서명은 번호와 감수 시트 위치가 모두 있어야 한다", () => {
    expect(parseGuideSign({ id: "12", sheet_ref: " 시험용 시트 " })).toEqual({ ok: true, value: { id: 12, sheetRef: "시험용 시트" } });
    expect(parseGuideSign({ id: 12, sheet_ref: "" }).ok).toBe(false);
    expect(parseGuideSign({ id: 0, sheet_ref: "x" }).ok).toBe(false);
    expect(parseGuideSign({ id: 1, sheet_ref: "x".repeat(201) }).ok).toBe(false);
  });

  test("공개는 1 이상 정수 번호만 받는다", () => {
    expect(parseGuidePublish({ id: 3 })).toEqual({ ok: true, value: { id: 3 } });
    for (const id of [0, -1, 1.5, "abc", null]) expect(parseGuidePublish({ id }).ok).toBe(false);
  });
});
