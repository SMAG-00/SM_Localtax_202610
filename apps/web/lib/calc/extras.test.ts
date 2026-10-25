import { describe, expect, it } from "vitest";
import { ACQUISITION_QUESTIONS } from "./acquisition";
import { HOLDING_QUESTIONS } from "./holding";
import { GUIDE_RECHECK_AFTER_DAYS, guideAgeDays, needsRecheck, visibleGuides, type GuideRow } from "./guide";
import { encodeHash, parseHash } from "./hash";
import { selfHref, toolCardsFor } from "./tool-cards";
import type { ToolContext } from "./tool-link";
import { ALL_OPEN, ENGINE_HASH, gateRow } from "./fixture.test-util";
import { newestBundled, validBundleEntries } from "@/lib/server/public/ruleset-bundle-logic";

const features = { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: true, calc_holding: true, calc_refund: true };
const ctx = (o: Partial<ToolContext> = {}): ToolContext => ({ features, gateRows: ALL_OPEN, engineHash: ENGINE_HASH, refundTableActive: true, ...o });

describe("진입점 도구 카드 (HOME-08 · REG1-10)", () => {
  it("모두 열리면 자체 카드 3장 (취득세·재산세·환급), 도구마다 1장", () => {
    const cards = toolCardsFor(ctx());
    expect(cards.map((c) => [c.tool, c.link.kind])).toEqual([["acquisition", "self"], ["holding", "self"], ["refund", "self"]]);
    expect(new Set(cards.map((c) => c.tool)).size).toBe(cards.length);
  });
  it("게이트가 닫힌 세액 계산기는 그 자리에 SM 카드, 환급 진단은 카드 0", () => {
    const cards = toolCardsFor(ctx({ gateRows: [], refundTableActive: false }));
    expect(cards.map((c) => [c.tool, c.link.kind])).toEqual([["acquisition", "sm"], ["holding", "sm"]]);
    expect(cards[1]!.link).toEqual({ kind: "sm", linkKey: "property_tax" });
  });
  it("취득세만 열리면 취득세는 자체, 재산세는 SM (세목별 전환)", () => {
    const cards = toolCardsFor(ctx({ gateRows: [ALL_OPEN[0]!, gateRow({ tax_kind: "property", cause_group: "ALL", is_open: false })], refundTableActive: false }));
    expect(cards.map((c) => [c.tool, c.link.kind])).toEqual([["acquisition", "self"], ["holding", "sm"]]);
  });
  it("자체 계산기 스위치를 끄고 SM 연결도 꺼지면 카드 0 - 같은 도구를 두 번 달라고 해도 1장", () => {
    expect(toolCardsFor(ctx({ features: { ...features, self_calculator: false, sm_calculator: false } }))).toEqual([]);
    expect(toolCardsFor(ctx(), ["acquisition", "acquisition"])).toHaveLength(1);
  });
  it("지역 코드는 해시로만 붙고 잘못된 모양은 버린다", () => {
    expect(selfHref("/calc/acquisition", "11680")).toBe("/calc/acquisition#region=11680");
    expect(selfHref("/calc/acquisition", null)).toBe("/calc/acquisition");
    expect(selfHref("/calc/acquisition", "11680?x=1")).toBe("/calc/acquisition");
  });
});

describe("URL 해시 미리 채움·공유 (GROW-02 · CALC-06)", () => {
  const form = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 700000000, houseCount: 1, isAdjustedArea: false, exclusiveAreaSqm: 84.5 };
  it("보낸 것을 그대로 읽는다", () => {
    const hash = encodeHash("acquisition", "2026.01", form, ACQUISITION_QUESTIONS);
    const back = parseHash(hash, ACQUISITION_QUESTIONS);
    expect(back).toMatchObject({ tool: "acquisition", version: "2026.01", region: null });
    expect(back.values).toEqual(form);
  });
  it("공시가격 목록과 예/아니요", () => {
    const hash = encodeHash("holding", null, { ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [300, 500] }, HOLDING_QUESTIONS);
    expect(hash).toContain("prices=300%2C500");
    expect(parseHash(hash, HOLDING_QUESTIONS).values).toEqual({ ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [300, 500] });
  });
  it("모르는 칸·틀린 값·프로토타입 이름·원인 4종 밖은 버린다", () => {
    const p = parseHash("#price=abc&cause=EXCHANGE&__proto__=1&constructor=x&evil=1&houseCount=2&ownerType=INDIVIDUAL&price=-5", ACQUISITION_QUESTIONS);
    expect(p.values).toEqual({ houseCount: 2, ownerType: "INDIVIDUAL" });
    expect(Object.keys(p.values).sort()).toEqual(p.ids.sort());
  });
  it("답이 없는 칸은 싣지 않고, 메타는 허용 글자만", () => {
    expect(encodeHash("acquisition", null, { price: 5 }, ACQUISITION_QUESTIONS)).toBe("#t=acquisition&price=5");
    expect(parseHash("#t=a b&v=2026.01&region=11 ", ACQUISITION_QUESTIONS)).toMatchObject({ tool: null, version: "2026.01", region: null });
  });
  it("입력값이 있어도 해시일 뿐이라 경로·쿼리는 바뀌지 않는다", () => {
    expect(encodeHash("acquisition", "2026.01", form, ACQUISITION_QUESTIONS).startsWith("#")).toBe(true);
  });
});

describe("위택스 이용 안내 (WETAX-02)", () => {
  const row = (o: Partial<GuideRow>): GuideRow => ({ key: "g1", label: "시험용 안내", body: "시험용 내용", source: "시험용 출처", confirmed_on: "2099-01-01", ...o });
  it("출처·확인일이 없는 항목은 렌더하지 않는다", () => {
    expect(visibleGuides([row({}), row({ key: "g2", source: null }), row({ key: "g3", source: "  " }), row({ key: "g4", confirmed_on: null }), row({ key: "g5", body: " " })]).map((g) => g.key)).toEqual(["g1"]);
  });
  it("확인일 91일은 재확인 0건, 92일은 1건 (경계)", () => {
    expect(GUIDE_RECHECK_AFTER_DAYS).toBe(91);
    expect(guideAgeDays("2099-01-01", "2099-04-02")).toBe(91);
    expect(needsRecheck({ confirmed_on: "2099-01-01" }, "2099-04-02")).toBe(false);
    expect(needsRecheck({ confirmed_on: "2099-01-01" }, "2099-04-03")).toBe(true);
    expect(needsRecheck({ confirmed_on: null }, "2099-04-03")).toBe(true);
  });
});

describe("번들 룰셋 폴백 (CALC-08)", () => {
  const e = (version: string, extra: object = {}) => ({ version, signedBy: "시험용 감수위원", signedAt: "2099-01-01T00:00:00Z", sha256: "abc", ...extra });
  it("번들이 비어 있으면 폴백 없음 (계산기는 닫힌 채)", () => {
    expect(newestBundled({ versions: [] })).toBeNull();
    expect(newestBundled(null)).toBeNull();
    expect(newestBundled({})).toBeNull();
  });
  it("서명 기록이 없는 항목은 걸러내고 가장 새 버전을 고른다", () => {
    const raw = { versions: [e("2026.01"), e("2026.08"), e("2026.09", { signedBy: " " }), e("2026.10", { sha256: undefined }), e("bad")] };
    expect(validBundleEntries(raw).map((x) => x.version)).toEqual(["2026.01", "2026.08"]);
    expect(newestBundled(raw)?.version).toBe("2026.08");
  });
});
