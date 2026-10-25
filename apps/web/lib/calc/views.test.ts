import { describe, expect, it } from "vitest";
import { calcAcquisition, type CalcResult } from "@ltr/tax-engine";
import { ASSERTIVE_PATTERNS, CALC_COPY } from "./copy";
import { buildResultView, formatWon, RESULT_BLOCKS } from "./result-view";
import { COMPARE_MAX, canAddColumn, compareRows, differingLabels, type CompareColumn } from "./compare";
import { accuracyBadge, accuracyRows } from "./accuracy-view";
import { nextWetaxState, wetaxAppLink, wetaxCardFor, type WetaxLinkRow } from "./wetax";
import { toolLinkFor, type ToolContext, type ToolId } from "./tool-link";
import { ALL_OPEN, ENGINE_HASH, RULESET, gateRow } from "./fixture.test-util";

const house = { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 700_000_000, houseCount: 1, exclusiveAreaSqm: 84, isAdjustedArea: false } as const;

describe("결과 먼저 (CALC-12)", () => {
  it("블록 순서는 총액 -> 기한 -> 명세서 -> 감면 -> 근거 -> 다음 행동", () => {
    expect(RESULT_BLOCKS).toEqual(["total", "deadline", "breakdown", "reduction", "basis", "next"]);
  });
  it("총액은 명세 행 금액의 합이다", () => {
    const view = buildResultView(calcAcquisition(house, RULESET));
    expect(view.rows.length).toBeGreaterThan(1);
    expect(view.total).toBe(view.rows.reduce((s, r) => s + r.amount, 0));
    expect(view.totalText).toBe(formatWon(view.total));
    expect(view.rulesVersion).toBe(RULESET.version);
  });
  it("인지세·국민주택채권은 참고 표시로 빠지고 합계에 넣지 않는다", () => {
    const result = calcAcquisition({ ...house, propertyKind: "LAND", price: 1_000_000_000, hasContract: true, buysHousingBond: true }, RULESET);
    const view = buildResultView(result);
    const refAmount = view.reference.reduce((s, r) => s + r.amount, 0);
    expect(view.reference.map((r) => r.code).sort()).toEqual(["HOUSING_BOND", "STAMP_TAX"]);
    expect(refAmount).toBeGreaterThan(0);
    expect(view.total).toBe(result.total - refAmount);
    expect(view.rows.some((r) => r.code === "STAMP_TAX" || r.code === "HOUSING_BOND")).toBe(false);
  });
  it("총액이 0이면 zero와 이유 한 줄을 낸다", () => {
    const zero: CalcResult = { items: [{ code: "ACQ_TAX", label: "취득세", base: 5, rate: 0, amount: 0, law: "시험용 조문", reasons: ["시험용 이유 한 줄", "둘째"] }], total: 0, rulesVersion: "2026.01", engineVersion: "t", warnings: [] };
    const view = buildResultView(zero);
    expect(view).toMatchObject({ zero: true, zeroReason: "시험용 이유 한 줄", totalText: "0원", deadline: null });
  });
  it("엔진 결과에 신고 기한이 있을 때만 기한 줄 자료가 생긴다", () => {
    const r: CalcResult = { items: [], total: 0, rulesVersion: "2026.01", engineVersion: "t", warnings: [], filing: { dueDate: "2099-01-01", dueNote: "시험용 기한 설명", installment: { available: false, maxAmount: 0, note: "" }, law: "시험용" } };
    expect(buildResultView(r).deadline).toEqual({ dueDate: "2099-01-01", note: "시험용 기한 설명" });
  });
  it.each([[0, "0원"], [999, "999원"], [1000, "1,000원"], [12_833_590, "12,833,590원"]])("원 표기 %s -> %s", (n, text) => {
    expect(formatWon(n)).toBe(text);
  });
});

describe("고정 문구 (CALC-13 단정 표현 0)", () => {
  const statics = (Object.values(CALC_COPY) as unknown[]).filter((v): v is string => typeof v === "string");
  it("단정·과장 표현이 없다", () => {
    for (const s of [...statics, CALC_COPY.reductionFound(3)]) for (const p of ASSERTIVE_PATTERNS) expect(s).not.toMatch(p);
  });
  it("고정 문구에 숫자 리터럴이 없다 (기한·세율·건수는 데이터에서)", () => {
    for (const s of statics) expect(s).not.toMatch(/\d/);
  });
});

describe("시나리오 비교 (CALC-05)", () => {
  const col = (id: string, price: number, liable?: boolean): CompareColumn => ({ id, label: id, tax: "acquisition", view: buildResultView(calcAcquisition({ ...house, price }, RULESET)), liable });
  it("열을 최대 3개까지 받고 4번째는 거부한다", () => {
    expect(canAddColumn(2, "acquisition", ["acquisition"], true)).toEqual({ ok: true });
    expect(COMPARE_MAX).toBe(3);
    expect(canAddColumn(3, "acquisition", ["acquisition"], true)).toEqual({ ok: false, reason: "max" });
  });
  it("비회원은 열을 더하지 못하고, 공개 전 세목은 열에 넣지 못한다", () => {
    expect(canAddColumn(1, "acquisition", ["acquisition"], false)).toEqual({ ok: false, reason: "member_only" });
    expect(canAddColumn(1, "property", ["acquisition"], true)).toEqual({ ok: false, reason: "closed" });
  });
  it("값이 다른 행만 차이 행이다", () => {
    const rows = compareRows([col("A", 700_000_000), col("B", 900_000_000)]);
    const tax = rows.find((r) => r.id === "ACQ_TAX")!;
    expect(tax.differs).toBe(true);
    expect(tax.cells).toHaveLength(2);
    expect(rows.find((r) => r.id === "ruleset")).toMatchObject({ differs: false, cells: [RULESET.version, RULESET.version] });
    expect(differingLabels(rows)).toContain("취득세");
  });
  it("같은 입력의 두 열은 차이 행이 0", () => {
    expect(differingLabels(compareRows([col("A", 700_000_000), col("B", 700_000_000)]))).toEqual([]);
  });
  it("올해 재산세 납세의무 있음/없음이 차이 행으로 나온다", () => {
    const rows = compareRows([col("A", 700_000_000, true), col("B", 700_000_000, false)]);
    expect(rows.find((r) => r.id === "liability")).toMatchObject({ cells: ["납세의무 있음", "납세의무 없음"], differs: true });
  });
  it("한 열에만 있는 항목은 다른 열에서 null", () => {
    const rows = compareRows([col("A", 700_000_000), { ...col("B", 700_000_000), view: { ...col("B", 700_000_000).view, rows: [] } }]);
    expect(rows.find((r) => r.id === "ACQ_TAX")!.cells[1]).toBeNull();
  });
});

describe("정확도 행·배지 (CALC-14 · FAM-07)", () => {
  it("취득세는 원인 묶음별 행으로 나오고 숫자는 뷰 값 그대로다", () => {
    const rows = accuracyRows([...ALL_OPEN.slice(0, 1), gateRow({ tax_kind: "acquisition", cause_group: "INHERITANCE", official_cases: 29, official_matched: 29, is_open: false })], ENGINE_HASH);
    expect(rows.map((r) => r.id)).toEqual(["acquisition_other", "acquisition_inheritance", "acquisition_gift", "property", "comprehensive"]);
    expect(rows[1]).toMatchObject({ officialCases: 29, officialMatched: 29, open: false });
    expect(rows[0]).toMatchObject({ officialCases: 30, open: true, checkedOn: "2026-10-20" });
    expect(rows[3]).toMatchObject({ officialCases: 0, open: false, checkedOn: null });
  });
  it("엔진 해시가 다르면 열린 뷰도 닫힌 것으로 본다", () => {
    expect(accuracyRows(ALL_OPEN, "x".repeat(64)).every((r) => !r.open)).toBe(true);
  });
  it("배지는 열린 묶음에서만 나오고 건수는 뷰에서 온다", () => {
    expect(accuracyBadge(ALL_OPEN, "acquisition", "OTHER", ENGINE_HASH)).toEqual({ text: "공식 결과 30건 중 30건 일치 · 2026-10-20 확인" });
    expect(accuracyBadge([gateRow({ tax_kind: "property", cause_group: "ALL", is_open: false })], "property", "ALL", ENGINE_HASH)).toBeNull();
  });
});

describe("위택스 바로가기 (WETAX-01)", () => {
  const row = (o: Partial<WetaxLinkRow> & Pick<WetaxLinkRow, "key" | "kind" | "tax_kind">): WetaxLinkRow => ({ label: o.key, url: `https://wetax.example.test/${o.key}`, status: "ok", fail_count: 0, fallback_key: "home", checked_at: "2026-10-20T01:00:00Z", ...o });
  const rows = [row({ key: "home", kind: "home", tax_kind: "all", fallback_key: null }), row({ key: "file", kind: "filing", tax_kind: "acquisition" }), row({ key: "pay", kind: "payment", tax_kind: "property" }), row({ key: "ref", kind: "refund", tax_kind: "refund" }), row({ key: "app", kind: "app", tax_kind: "all" })];
  it("화면별 메뉴: 취득세 -> 신고, 재산세 -> 납부, 환급 -> 환급금 조회", () => {
    expect(wetaxCardFor("acquisition", rows)).toMatchObject({ mode: "link", url: "https://wetax.example.test/file", checkedOn: "2026-10-20" });
    expect(wetaxCardFor("property", rows)).toMatchObject({ mode: "link", url: "https://wetax.example.test/pay" });
    expect(wetaxCardFor("refund", rows)).toMatchObject({ mode: "link", url: "https://wetax.example.test/ref" });
  });
  it("메뉴가 broken이면 첫 화면 주소로 대체", () => {
    const r = rows.map((x) => (x.key === "file" ? { ...x, status: "broken" as const } : x));
    expect(wetaxCardFor("acquisition", r)).toMatchObject({ mode: "fallback", url: "https://wetax.example.test/home" });
  });
  it("메뉴 주소가 아직 없으면 첫 화면 주소로, 첫 화면도 broken이면 링크 없이 안내 문장만", () => {
    const empty = rows.map((x) => (x.key === "pay" ? { ...x, url: null } : x));
    expect(wetaxCardFor("property", empty)).toMatchObject({ mode: "fallback" });
    const none = empty.map((x) => (x.key === "home" ? { ...x, status: "broken" as const } : x));
    expect(wetaxCardFor("property", none)).toEqual({ mode: "text" });
    expect(wetaxCardFor("property", [])).toEqual({ mode: "text" });
  });
  it.each(["https://w.example.test/a?x=1", "https://w.example.test/a#h", "javascript:alert(1)", "https://u:p@w.example.test/a"])("입력값이 실릴 수 있는 주소 %s 는 쓰지 않는다", (url) => {
    expect(wetaxCardFor("acquisition", [row({ key: "file", kind: "filing", tax_kind: "acquisition", url, fallback_key: null })])).toEqual({ mode: "text" });
  });
  it("앱 안내 링크는 쓸 수 있는 주소가 있을 때만", () => {
    expect(wetaxAppLink(rows)).toEqual({ url: "https://wetax.example.test/app", label: "app" });
    expect(wetaxAppLink(rows.filter((r) => r.kind !== "app"))).toBeNull();
  });
  it("오류 연속 2회에 broken, 1회는 이전 상태 유지, 성공하면 초기화", () => {
    const first = nextWetaxState({ status: "ok", fail_count: 0 }, "broken");
    expect(first).toEqual({ status: "ok", fail_count: 1 });
    const second = nextWetaxState(first, "broken");
    expect(second).toEqual({ status: "broken", fail_count: 2 });
    expect(nextWetaxState(second, "broken")).toEqual({ status: "broken", fail_count: 3 });
    expect(nextWetaxState(second, "ok")).toEqual({ status: "ok", fail_count: 0 });
    expect(nextWetaxState({ status: "unchecked", fail_count: 0 }, "broken").status).toBe("unchecked");
  });
});

describe("도구 전환 함수 toolLinkFor (TX-04)", () => {
  const features = { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: true, calc_holding: true, calc_refund: true };
  const ctx = (o: Partial<ToolContext> = {}): ToolContext => ({ features, gateRows: ALL_OPEN, engineHash: ENGINE_HASH, refundTableActive: true, ...o });
  it("게이트가 열린 세목은 자체 계산기", () => {
    expect(toolLinkFor("acquisition", null, ctx())).toEqual({ kind: "self", href: "/calc/acquisition" });
    expect(toolLinkFor("property", null, ctx())).toEqual({ kind: "self", href: "/calc/holding" });
    expect(toolLinkFor("refund", null, ctx())).toEqual({ kind: "self", href: "/calc/refund" });
  });
  it("취득세는 열리고 재산세는 닫히면 취득세만 자체, 재산세는 SM 카드", () => {
    const rows = [ALL_OPEN[0]!, gateRow({ tax_kind: "property", cause_group: "ALL", is_open: false })];
    expect(toolLinkFor("acquisition", null, ctx({ gateRows: rows }))).toEqual({ kind: "self", href: "/calc/acquisition" });
    expect(toolLinkFor("property", null, ctx({ gateRows: rows }))).toEqual({ kind: "sm", linkKey: "property_tax" });
  });
  it("상속 원인만 닫히면 그 원인은 SM 카드, 다른 원인과 세목은 자체 (FAM-07)", () => {
    const rows = ALL_OPEN.map((r) => (r.cause_group === "INHERITANCE" ? { ...r, is_open: false } : r));
    expect(toolLinkFor("acquisition", "INHERITANCE", ctx({ gateRows: rows }))).toEqual({ kind: "sm", linkKey: "acquisition" });
    expect(toolLinkFor("acquisition", "GIFT", ctx({ gateRows: rows }))).toEqual({ kind: "self", href: "/calc/acquisition" });
    expect(toolLinkFor("acquisition", null, ctx({ gateRows: rows }))).toEqual({ kind: "self", href: "/calc/acquisition" });
  });
  it("엔진 해시가 바뀌면(엔진 코드 변경) 열려 있던 게이트도 닫힌다", () => {
    expect(toolLinkFor("acquisition", null, ctx({ engineHash: "z".repeat(64) }))).toEqual({ kind: "sm", linkKey: "acquisition" });
  });
  it("self_calculator를 끄면 게이트가 열려 있어도 자체 카드 0 (끄는 스위치)", () => {
    expect(toolLinkFor("acquisition", null, ctx({ features: { ...features, self_calculator: false } })).kind).toBe("sm");
  });
  it("기능 키 calc_acquisition이 꺼져 있으면 자체 계산기로 보내지 않는다 (키 기본 꺼짐)", () => {
    expect(toolLinkFor("acquisition", null, ctx({ features: { ...features, calc_acquisition: false } })).kind).toBe("sm");
  });
  it("SM 연결도 꺼져 있고 게이트가 닫히면 카드 없음", () => {
    expect(toolLinkFor("acquisition", null, ctx({ gateRows: [], features: { ...features, sm_calculator: false } }))).toEqual({ kind: "none" });
  });
  it("환급 진단은 서명된 판정표가 없으면 카드 0", () => {
    expect(toolLinkFor("refund", null, ctx({ refundTableActive: false }))).toEqual({ kind: "none" });
  });
  it("재산세·종부세 묶음(holding)은 둘 중 하나만 열려도 자체, 둘 다 닫히면 SM 카드 한 장", () => {
    const onlyComprehensive = [gateRow({ tax_kind: "property", cause_group: "ALL", is_open: false }), gateRow({ tax_kind: "comprehensive", cause_group: "ALL" })];
    expect(toolLinkFor("holding", null, ctx({ gateRows: onlyComprehensive }))).toEqual({ kind: "self", href: "/calc/holding" });
    expect(toolLinkFor("property", null, ctx({ gateRows: onlyComprehensive }))).toEqual({ kind: "sm", linkKey: "property_tax" });
    expect(toolLinkFor("holding", null, ctx({ gateRows: [] }))).toEqual({ kind: "sm", linkKey: "property_tax" });
  });
  it("국세 도구는 어떤 조건에서도 자체 계산기로 가지 않는다", () => {
    const tools: ToolId[] = ["transfer", "inheritance_gift", "oligopoly"];
    for (const t of tools) for (const sm of [true, false]) expect(toolLinkFor(t, null, ctx({ features: { ...features, sm_calculator: sm } })).kind).not.toBe("self");
    expect(toolLinkFor("inheritance_gift", null, ctx())).toEqual({ kind: "external", linkKey: "inheritance_gift" });
    expect(toolLinkFor("transfer", null, ctx())).toEqual({ kind: "sm", linkKey: "transfer" });
  });
  it("세목마다 결과가 정확히 하나다 (카드 0장·2장 없음)", () => {
    const tools: ToolId[] = ["acquisition", "property", "comprehensive", "refund", "transfer", "inheritance_gift", "oligopoly"];
    for (const t of tools) expect(["self", "sm", "external", "none"]).toContain(toolLinkFor(t, null, ctx()).kind);
  });
});
