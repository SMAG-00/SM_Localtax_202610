// 제휴사(partners) 입력·계약 상태 시험 (ART-10 · ADM-01 제휴사 관리) — 계약 종료일 당일까지 유효(발행 판정 art10.partner-contract-expired와 같은 경계)
import { describe, expect, test } from "vitest";
import { evaluatePublish, BASE_CONTEXT, TAX_EXPLAINER } from "@ltr/editorial";
import { newPartnerBlocked, parsePartnerInput, partnerChoices, partnerDatesError, partnerFormToBody, partnerStatus } from "./partner-rules";

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("제휴사 입력 (API)", () => {
  test("API 칸 → DB 칸", () => {
    expect(
      parsePartnerInput(
        { name: " 가온세무법인 ", kind: "tax_firm", intro: "지방세 실무 공동 기획", url: "https://gaon-tax.example", contractFrom: "2026-01-01", contractTo: "2026-12-31", visible: true },
        "create",
      ),
    ).toEqual({
      ok: true,
      value: { name: "가온세무법인", kind: "tax_firm", intro: "지방세 실무 공동 기획", url: "https://gaon-tax.example", contract_from: "2026-01-01", contract_to: "2026-12-31", visible: true },
    });
  });
  test("이름·종류는 필수, 종류는 4종(세무법인·언론·기관·지역 사업자)만", () => {
    expect(errorsOf(parsePartnerInput({}, "create"))).toEqual(["partner.name: 필요합니다", "partner.kind: 필요합니다"]);
    expect(errorsOf(parsePartnerInput({ name: "가", kind: "bank" }, "create"))).toEqual(["partner.kind: tax_firm·media·institution·local_business 중 하나여야 합니다"]);
  });
  test("주소는 http(s)만, 날짜는 실제 있는 YYYY-MM-DD", () => {
    expect(errorsOf(parsePartnerInput({ url: "javascript:alert(1)", contractFrom: "2026-02-30", contractTo: "20261231" }, "patch"))).toEqual([
      "partner.url: http:// 또는 https://로 시작하는 주소여야 합니다",
      "partner.contractFrom: YYYY-MM-DD 날짜여야 합니다",
      "partner.contractTo: YYYY-MM-DD 날짜여야 합니다",
    ]);
  });
  test("빈 글자·null은 칸을 비운다, 바꿀 칸이 없으면 거부", () => {
    expect(parsePartnerInput({ intro: "", url: null, contractTo: null }, "patch")).toEqual({ ok: true, value: { intro: null, url: null, contract_to: null } });
    expect(errorsOf(parsePartnerInput({}, "patch"))).toEqual(["partner: 바꿀 칸이 없습니다"]);
  });
  test("계약 종료일이 시작일보다 앞이면 거부 (DB check와 같다), 같은 날은 통과", () => {
    expect(partnerDatesError("2026-05-01", "2026-04-30")).toBe("계약 종료일이 시작일보다 앞입니다");
    expect(partnerDatesError("2026-05-01", "2026-05-01")).toBeNull();
    expect(partnerDatesError(null, "2026-05-01")).toBeNull();
  });
});

describe("계약 상태 — 종료일 당일까지 계약 중", () => {
  const p = (contract_from: string | null, contract_to: string | null) => ({ contract_from, contract_to });
  test.each([
    ["어제 끝난 계약", p("2026-01-01", "2026-10-17"), "expired"],
    ["오늘 끝나는 계약", p("2026-01-01", "2026-10-18"), "active"],
    ["종료일 없음", p(null, null), "active"],
    ["내일 시작", p("2026-10-19", null), "upcoming"],
  ] as const)("%s → %s", (_n, partner, status) => {
    expect(partnerStatus(partner, "2026-10-18")).toBe(status);
  });

  test("새로 지정할 수 없는 사유는 발행 판정(ART-10 계약 종료)과 같은 경계다", () => {
    const base = { ...TAX_EXPLAINER, contentType: "sponsored" as const, label: "co_planned" as const };
    for (const contractTo of ["2026-10-16", "2026-10-17"]) {
      const blocked = newPartnerBlocked({ id: 5, name: "가온세무법인", contract_to: contractTo }, BASE_CONTEXT.today);
      const gate = evaluatePublish({ ...base, partner: { id: "5", name: "가온세무법인", contractFrom: null, contractTo } }, BASE_CONTEXT).blockers.map((f) => f.id);
      expect(blocked !== null, contractTo).toBe(gate.includes("art10.partner-contract-expired"));
    }
  });
});

describe("기사 편집기의 제휴사 고르기", () => {
  const partners = [
    { id: 1, name: "가온세무법인", contract_to: "2026-12-31" },
    { id: 2, name: "누리일보", contract_to: "2026-09-30" },
    { id: 3, name: "가람연구원", contract_to: null },
  ];
  test("계약이 끝난 제휴사는 선택지에서 빼고 따로 알린다", () => {
    const r = partnerChoices(partners, "2026-10-18", null);
    expect(r.options.map((o) => o.value)).toEqual(["1", "3"]);
    expect(r.expired).toEqual([{ id: 2, name: "누리일보", contractTo: "2026-09-30" }]);
    expect(r.options[0]!.label).toBe("가온세무법인 (계약 2026-12-31까지)");
  });
  test("이미 지정된 제휴사는 계약이 끝나도 남긴다 — 기존 배지는 남는다", () => {
    const r = partnerChoices(partners, "2026-10-18", 2);
    expect(r.options.map((o) => o.value)).toEqual(["1", "2", "3"]);
    expect(r.options[1]!.label).toBe("누리일보 (계약 종료 2026-09-30 — 지금 지정된 제휴사)");
  });
});

describe("화면 폼 → 요청 본문", () => {
  const form = { name: "가온세무법인", kind: "tax_firm", intro: "", url: "", contractFrom: "2026-01-01", contractTo: "", visible: false };
  test("빈 칸은 null", () => {
    expect(partnerFormToBody(form)).toEqual({
      ok: true,
      body: { name: "가온세무법인", kind: "tax_firm", intro: null, url: null, contractFrom: "2026-01-01", contractTo: null, visible: false },
    });
  });
  test("칸 오류", () => {
    expect(partnerFormToBody({ ...form, name: "", kind: "", url: "gaon.example", contractTo: "2025-12-31" }, "p")).toEqual({
      ok: false,
      errors: {
        "p-name": "제휴사 이름을 적어 주세요",
        "p-kind": "종류를 골라 주세요",
        "p-url": "http:// 또는 https://로 시작하는 주소를 적어 주세요",
        "p-contract-to": "계약 종료일이 시작일보다 앞입니다",
      },
    });
  });
});
