// W4 24단계 지역 측정 이벤트 속성 검사 시험 — 지역 코드·종류 키만 받고 주소·좌표·검색어·외부 주소를 담을 칸은 없다 (REG1-15)
import { describe, expect, test } from "vitest";
import { validateEvent } from "./events";

const RC = "1100000000";
const ok = (body: unknown) => validateEvent(body).ok;

describe("W4 24단계 지역 이벤트", () => {
  test("region_viewed — 지역 코드 10자리 + 단계(sido/sigungu)면 통과하고 속성이 그대로 남는다", () => {
    const r = validateEvent({ name: "region_viewed", section: "local", props: { region_code: RC, level: "sido" } });
    expect(r.ok && r.event.props).toEqual({ region_code: RC, level: "sido" });
  });
  test("region_viewed — 분야가 없으면 거부", () => {
    expect(ok({ name: "region_viewed", props: { region_code: RC, level: "sido" } })).toBe(false);
  });
  test.each([
    ["지역 코드 9자리", { region_code: "110000000", level: "sido" }],
    ["지역 코드에 글자", { region_code: "11000000ab", level: "sido" }],
    ["목록 밖 단계", { region_code: RC, level: "dong" }],
    ["상세 주소 칸", { region_code: RC, level: "sido", address: "서울시 중구 1-1" }],
    ["좌표 칸", { region_code: RC, level: "sido", lat: 37.5 }],
    ["검색어 칸", { region_code: RC, level: "sido", query: "취득세" }],
    ["외부 주소 칸", { region_code: RC, level: "sido", url: "https://x.example.test" }],
  ])("region_viewed — %s는 거부", (_n, props) => {
    expect(ok({ name: "region_viewed", section: "local", props })).toBe(false);
  });
  test("target 값 — 세금 쪽은 situation·explainer·official_source만, 부동산 쪽은 project·project_list·supply·supply_list만", () => {
    for (const t of ["situation", "explainer", "official_source"]) expect(ok({ name: "region_to_tax_clicked", section: "local", props: { region_code: RC, target: t } }), t).toBe(true);
    expect(ok({ name: "region_to_tax_clicked", section: "local", props: { region_code: RC, target: "project" } })).toBe(false);
    for (const t of ["project", "project_list", "supply", "supply_list"]) expect(ok({ name: "region_to_realestate_clicked", section: "local", props: { region_code: RC, target: t } }), t).toBe(true);
    expect(ok({ name: "region_to_realestate_clicked", section: "local", props: { region_code: RC, target: "situation" } })).toBe(false);
  });
  test("project_viewed — 지역 코드·사업 유형 키·단계 키 필수, 대문자·공백 키는 거부", () => {
    expect(ok({ name: "project_viewed", section: "realestate", props: { region_code: RC, project_type: "redevelopment", stage: "notice" } })).toBe(true);
    expect(ok({ name: "project_viewed", section: "realestate", props: { region_code: RC, project_type: "Re Dev", stage: "notice" } })).toBe(false);
    expect(ok({ name: "project_viewed", section: "realestate", props: { region_code: RC, project_type: "redevelopment" } })).toBe(false);
  });
  test("dev_method_viewed — 방법 slug 7종만, 목록 밖 값은 거부", () => {
    for (const m of ["redevelopment", "reconstruction", "small-scale", "public", "trust", "renewal", "rapid-planning"]) expect(ok({ name: "dev_method_viewed", section: "realestate", props: { method: m } }), m).toBe(true);
    expect(ok({ name: "dev_method_viewed", section: "realestate", props: { method: "unknown" } })).toBe(false);
  });
  test("regional_source_opened — 자료 종류는 허용 6종만(차단 종류 tourism 거부), 원문 주소 칸 거부", () => {
    expect(ok({ name: "regional_source_opened", section: "local", props: { region_code: RC, source_type: "ordinance" } })).toBe(true);
    expect(ok({ name: "regional_source_opened", section: "local", props: { region_code: RC, source_type: "tourism" } })).toBe(false);
    expect(ok({ name: "regional_source_opened", section: "local", props: { region_code: RC, source_type: "ordinance", href: "https://g.example.test" } })).toBe(false);
  });
  test("calculator_card_clicked — 새 화면 값 4개는 통과, 목록 밖 화면은 거부", () => {
    for (const screen of ["inheritance_gift", "project", "region_hub", "dev_method"]) expect(ok({ name: "calculator_card_clicked", props: { card: "acquisition", screen, rank: 1 } }), screen).toBe(true);
    expect(ok({ name: "calculator_card_clicked", props: { card: "acquisition", screen: "article", rank: 1 } })).toBe(false);
  });
});
