import { describe, expect, it } from "vitest";
import { calcCorporateLocalIncome, calcEntityLocalTaxes, calcOligopolyByListing, parseExpertRuleset } from "@ltr/tax-engine/expert";
import { parseRuleset } from "@ltr/tax-engine";
import rules from "../../../../../rules/2026.01.json";
import { expertGateOpen, expertState, type ExpertGateRow } from "./gate";
import { loadExpertNotices, loadExpertRuleset } from "./ruleset";
import { buildCorporate, buildEntity, buildOligopoly, parsePercentRatio, parseWon, parseWonOrZero } from "./form";
import { corporateView, entityView, oligopolyView, smCard } from "./view";

// 시험용 전문가 룰셋 - 지어낸 값(2090.01, test_only). 공개 경로의 loadExpertRuleset은 이것을 읽지 않는다.
const TEST_RAW = {
  version: "2090.01",
  test_only: true,
  oligopoly_listing: {
    listed: { applies: false, law: "시험용 조문 L", condition: "시험용" },
    unlisted: { applies: true, law: "시험용 조문 U", condition: "시험용" },
  },
  corporate_local_income: {
    brackets: [
      { up_to: 1_000_000, rate: 0.01, law: "시험용 C1", condition: "시험용" },
      { up_to: null, rate: 0.02, deduction: 10_000, law: "시험용 C2", condition: "시험용" },
    ],
  },
};
const expert = parseExpertRuleset(TEST_RAW);
const base = parseRuleset(rules);
const HASH = "h".repeat(64);
const row = (o: Partial<ExpertGateRow> = {}): ExpertGateRow => ({ tax_kind: "oligopoly", cause_group: "ALL", engine_hash: HASH, is_open: true, ...o });
const ON = { calc: true, expert_calc: true };

describe("게이트 판정", () => {
  it("세목 줄이 없으면 닫힌다 (현재 calc_gate_status 상태)", () => {
    expect(expertGateOpen([], "oligopoly", HASH)).toBe(false);
    expect(expertGateOpen([row({ tax_kind: "acquisition" })], "oligopoly", HASH)).toBe(false);
  });
  it("줄이 열려 있어도 엔진 해시가 다르거나 배포 해시가 비면 닫힌다", () => {
    expect(expertGateOpen([row()], "oligopoly", HASH)).toBe(true);
    expect(expertGateOpen([row({ engine_hash: "x" })], "oligopoly", HASH)).toBe(false);
    expect(expertGateOpen([row({ engine_hash: "" })], "oligopoly", "")).toBe(false);
    expect(expertGateOpen([row({ is_open: false })], "oligopoly", HASH)).toBe(false);
  });
  it("기능 키·게이트·룰셋 중 하나라도 빠지면 unsupported", () => {
    expect(expertState({ features: ON, gateOpen: true, hasRuleset: true, hasNotices: true })).toBe("open");
    expect(expertState({ features: { calc: true, expert_calc: false }, gateOpen: true, hasRuleset: true, hasNotices: true })).toBe("unsupported");
    expect(expertState({ features: { calc: false, expert_calc: true }, gateOpen: true, hasRuleset: true, hasNotices: true })).toBe("unsupported");
    expect(expertState({ features: ON, gateOpen: false, hasRuleset: true, hasNotices: true })).toBe("unsupported");
    expect(expertState({ features: ON, gateOpen: true, hasRuleset: false, hasNotices: true })).toBe("unsupported");
    expect(expertState({ features: ON, gateOpen: true, hasRuleset: true, hasNotices: false })).toBe("unsupported");
  });
});

describe("전문가 룰셋 읽기", () => {
  it("운영 룰셋 자리는 비어 있어 null이다", () => {
    expect(loadExpertRuleset()).toBeNull();
  });
  it("시험용(test_only) 룰셋은 공개 경로가 읽지 않는다", () => {
    expect(loadExpertRuleset(TEST_RAW)).toBeNull();
  });
  it("test_only가 아닌 올바른 룰셋은 읽고 형식이 틀리면 null", () => {
    expect(loadExpertRuleset({ ...TEST_RAW, test_only: false })?.version).toBe("2090.01");
    expect(loadExpertRuleset({ version: "x" })).toBeNull();
  });
});

describe("고정 안내 문구 자리", () => {
  it("운영 자리가 비어 있으면 null (계산기 닫힘)", () => {
    expect(loadExpertNotices()).toBeNull();
  });
  it("두 문장이 모두 채워져야 읽는다 (시험용 문구로만 검증)", () => {
    expect(loadExpertNotices({ entityNational: "시험용 문구 A", corporateBase: "시험용 문구 B" })).toEqual({ entityNational: "시험용 문구 A", corporateBase: "시험용 문구 B" });
    expect(loadExpertNotices({ entityNational: "시험용 문구 A", corporateBase: "  " })).toBeNull();
    expect(loadExpertNotices({ entityNational: "시험용 문구 A" })).toBeNull();
  });
});

describe("입력 변환", () => {
  it("금액·지분율 파싱 경계", () => {
    expect(parseWon("1,000")).toBe(1000);
    expect(parseWon("0")).toBeNull();
    expect(parseWon("1000000000000000")).toBeNull();
    expect(parseWon("12.5")).toBeNull();
    expect(parseWonOrZero("0")).toBe(0);
    expect(parsePercentRatio("50.0001")).toBe(0.500001);
    expect(parsePercentRatio("100")).toBe(1);
    expect(parsePercentRatio("100.0001")).toBeNull();
    expect(parsePercentRatio("-1")).toBeNull();
    expect(parsePercentRatio("5.12345")).toBeNull();
  });
  it("과점주주 폼: 상장 여부 미선택·지분율 오류를 칸별로 알린다", () => {
    const r = buildOligopoly({ listing: "", bookValue: "", beforePercent: "abc", afterPercent: "60" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["beforePercent", "bookValue", "listing"]);
    const ok = buildOligopoly({ listing: "unknown", bookValue: "1,000,000,000", beforePercent: "20", afterPercent: "60" });
    expect(ok.ok && ok.input.input).toEqual({ bookValue: 1_000_000_000, beforeRatio: 0.2, afterRatio: 0.6 });
  });
  it("법인지방소득세 폼: 0은 허용하고 음수·글자는 거부", () => {
    expect(buildCorporate({ taxBase: "0" })).toEqual({ ok: true, input: { taxBase: 0 } });
    expect(buildCorporate({ taxBase: "-5" }).ok).toBe(false);
    expect(buildCorporate({ taxBase: "" }).ok).toBe(false);
  });
  it("개인 vs 법인 폼: 공시가격은 비워도 되고 입력하면 보유 입력이 붙는다", () => {
    const a = buildEntity({ propertyKind: "COMMERCIAL", price: "1,000,000,000", publishedPrice: "" });
    expect(a.ok && a.input.holding).toBeUndefined();
    const b = buildEntity({ propertyKind: "COMMERCIAL", price: "1000000000", publishedPrice: "800000000" });
    expect(b.ok && b.input.holding?.publishedPrices).toEqual([800_000_000]);
    expect(buildEntity({ propertyKind: "", price: "1", publishedPrice: "x" }).ok).toBe(false);
  });
});

describe("화면 모델", () => {
  it("모르겠어요는 상장·비상장 두 시나리오를 나란히, 룰셋 버전 두 개를 각인한다", () => {
    const v = oligopolyView(calcOligopolyByListing({ bookValue: 1_000_000_000, beforeRatio: 0.2, afterRatio: 0.6 }, "unknown", base, expert));
    expect(v.sideBySide).toBe(true);
    expect(v.scenarios.map((s) => s.title)).toEqual(["상장법인인 경우", "비상장법인인 경우"]);
    expect(v.scenarios[0]!.total).toBe(0);
    expect(v.versions).toEqual([base.version, "2090.01"]);
  });
  it("법인지방소득세 결과 줄의 세액은 엔진 결과 그대로", () => {
    const r = calcCorporateLocalIncome({ taxBase: 2_000_000 }, expert);
    const v = corporateView(r);
    expect(v.scenarios[0]!.total).toBe(2_000_000 * 0.02 - 10_000);
    expect(v.scenarios[0]!.rows[0]!.code).toBe("CORP_LOCAL_INCOME");
  });
  it("개인 vs 법인 화면에는 국세 줄이 없고 고정 문구가 있다", () => {
    const r = calcEntityLocalTaxes({ acquisition: { propertyKind: "COMMERCIAL", cause: "PAID", price: 1_000_000_000 }, holding: { propertyKind: "COMMERCIAL", publishedPrices: [800_000_000] } }, base);
    const v = entityView(r);
    const codes = v.scenarios.flatMap((s) => s.rows.map((x) => x.code));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((c) => /^(CRET|ACQ_RURAL|STAMP)/.test(c))).toEqual([]);
    expect(v.totalDiff).toBe(v.scenarios[1]!.total - v.scenarios[0]!.total);
  });
});

describe("SM 링크 카드", () => {
  it("https 주소만, 질의·조각은 지운다 (입력값이 실릴 자리 0)", () => {
    expect(smCard([{ key: "compare", label: "SM 비교 계산기", url: "https://sm.example.com/calc?price=1#x" }], "compare")).toEqual({ label: "SM 비교 계산기", href: "https://sm.example.com/calc" });
  });
  it("주소가 없거나 https가 아니거나 키가 없으면 카드 없음", () => {
    expect(smCard([{ key: "compare", label: "l", url: "http://sm.example.com" }], "compare")).toBeNull();
    expect(smCard([{ key: "compare", label: "l", url: "not a url" }], "compare")).toBeNull();
    expect(smCard([], "compare")).toBeNull();
  });
});
