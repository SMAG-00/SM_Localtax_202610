import { describe, expect, it } from "vitest";
import { calcAcquisition, calcHolding, parseDeterminationTable } from "@ltr/tax-engine";
import { groupOpen, type Cause } from "@/lib/accuracy/gate";
import { buildAcquisition } from "@/lib/calc/acquisition";
import { ALL_OPEN, ENGINE_HASH, gateRow, RULESET } from "@/lib/calc/fixture.test-util";
import { testCalcCopy } from "./calc-copy";
import { createCalcPort, igtCards, igtKindsOf, runBenefits, runCalculator, type CalcContext, type CalcGate, type CardLink } from "./calc-run";
import { BASE_TOOL_NAMES, buildToolDefs } from "./tools";
import { buildCalcToolDefs, CALC_TOOL_NAMES, parseCalcToolInput, SERVER_ONLY_TOOL_NAMES, type CalcToolInput } from "./calc-tools";
import { topicsFromDictionary } from "./dictionary-link";
import { runAgentTurn, type AgentDeps, type AgentTurnRecord } from "./flow";
import { answerResponse, fakeTools, makeDeps, makeDoc, OK_TEXT, scriptedModel } from "./flow-fixtures";
import type { AgentEvent } from "./sse";

const EXTERNAL: CardLink = { kind: "external", linkKey: "inheritance_gift" };
function gateFrom(rows = ALL_OPEN, igt: (k: "gift" | "inheritance") => CardLink = () => EXTERNAL): CalcGate {
  const open = (kind: "property" | "comprehensive") => groupOpen(rows, kind, "ALL", ENGINE_HASH);
  return {
    acquisition: (cause: Cause | null) => (groupOpen(rows, "acquisition", cause === "INHERITANCE" ? "INHERITANCE" : cause === "GIFT" ? "GIFT" : "OTHER", ENGINE_HASH) ? "open" : "gate_closed"),
    holding: () => ({ state: open("property") || open("comprehensive") ? "open" : "gate_closed", open: { property: open("property"), comprehensive: open("comprehensive") } }),
    igtCard: igt,
  };
}
const ctx = (over: Partial<CalcContext> = {}): CalcContext => ({ gate: gateFrom(), ruleset: RULESET, reductionTable: null, determinationTables: {}, ...over });

const ACQ: Extract<CalcToolInput, { name: "run_calculator"; tax: "acquisition" }> = { name: "run_calculator", tax: "acquisition", form: { ownerType: "INDIVIDUAL", propertyKind: "HOUSE", cause: "PAID", price: 500_000_000 } };
const HOLD: Extract<CalcToolInput, { name: "run_calculator"; tax: "holding" }> = { name: "run_calculator", tax: "holding", form: { ownedOnBaseDate: true, ownerType: "INDIVIDUAL", prices: [300_000_000] } };

describe("run_calculator - 엔진 직접 결과", () => {
  it("취득세 금액·룰셋 버전·기준일·근거 조문이 엔진을 직접 부른 결과와 같다", () => {
    const run = runCalculator(ACQ, ctx(), "2026-10-27");
    const built = buildAcquisition(ACQ.form);
    const direct = calcAcquisition(built.input!, RULESET);
    expect(run.outcome.status).toBe("calculated");
    if (run.outcome.status !== "calculated") return;
    expect(run.outcome.totalWon).toBe(direct.total);
    expect(run.outcome.rulesVersion).toBe(direct.rulesVersion);
    expect(run.outcome.asOf).toBe("2026-10-27");
    expect(run.outcome.items.map((i) => [i.code, i.amountWon, i.law])).toEqual(direct.items.map((i) => [i.code, i.amount, i.law]));
    expect(run.outcome.items.reduce((s, i) => s + i.amountWon, 0)).toBe(run.outcome.totalWon);
  });
  it("게이트가 닫힌 취득 원인은 unsupported - 금액 0행", () => {
    const rows = ALL_OPEN.filter((r) => r.cause_group !== "GIFT");
    const run = runCalculator({ ...ACQ, form: { ...ACQ.form, cause: "GIFT" } }, ctx({ gate: gateFrom(rows) }), "2026-10-27");
    expect(run.outcome).toEqual({ status: "unsupported", tax: "acquisition", reason: "gate_closed" });
    expect(run.facts).toBeNull();
  });
  it("엔진 해시가 다른 실행만 있는 게이트는 열린 것으로 치지 않는다", () => {
    const stale = ALL_OPEN.map((r) => ({ ...r, engine_hash: "x".repeat(64) }));
    expect(runCalculator(ACQ, ctx({ gate: gateFrom(stale) }), "2026-10-27").outcome).toMatchObject({ status: "unsupported", reason: "gate_closed" });
  });
  it("룰셋이 없으면 unsupported(no_ruleset), 기준일이 룰셋 시행일 전이면 not_in_force (경계: 시행일 당일은 계산)", () => {
    expect(runCalculator(ACQ, ctx({ ruleset: null }), "2026-10-27").outcome).toMatchObject({ reason: "no_ruleset" });
    expect(runCalculator(ACQ, ctx(), "2025-12-31").outcome).toMatchObject({ status: "unsupported", reason: "not_in_force" });
    expect(runCalculator(ACQ, ctx(), RULESET.effective_from).outcome.status).toBe("calculated");
  });
  it("필수 값이 비면 needs_input과 비운 질문 문장 목록", () => {
    const run = runCalculator({ ...ACQ, form: { ownerType: "INDIVIDUAL" } }, ctx(), "2026-10-27");
    expect(run.outcome.status).toBe("needs_input");
    if (run.outcome.status !== "needs_input") return;
    expect(run.outcome.missing.map((m) => m.id)).toEqual(["propertyKind", "cause", "price"]);
    expect(run.outcome.missing.every((m) => m.text.length > 0)).toBe(true);
  });
  it("재산세만 열리고 종합부동산세는 닫힌 경우 재산세 항목만 보인다 (세목별 따로)", () => {
    const rows = ALL_OPEN.filter((r) => r.tax_kind !== "comprehensive");
    const run = runCalculator(HOLD, ctx({ gate: gateFrom(rows) }), "2026-10-27");
    expect(run.outcome.status).toBe("calculated");
    if (run.outcome.status !== "calculated") return;
    const all = calcHolding({ ownerType: "INDIVIDUAL", propertyKind: "HOUSE", publishedPrices: [300_000_000] } as never, RULESET);
    expect(run.outcome.items.every((i) => !i.code.startsWith("CRET_"))).toBe(true);
    expect(run.outcome.totalWon).toBe(all.items.filter((i) => !i.code.startsWith("CRET_")).reduce((s, i) => s + i.amount, 0));
  });
  it("보유세 두 세목이 모두 닫히면 unsupported, 과세기준일 소유가 아니면 not_liable", () => {
    const none = ALL_OPEN.filter((r) => r.tax_kind === "acquisition");
    expect(runCalculator(HOLD, ctx({ gate: gateFrom(none) }), "2026-10-27").outcome).toMatchObject({ status: "unsupported", reason: "gate_closed" });
    expect(runCalculator({ ...HOLD, form: { ownedOnBaseDate: false } }, ctx(), "2026-10-27").outcome).toEqual({ status: "not_liable", tax: "holding" });
  });
});

describe("check_benefits - 계산 직후 서버 자동", () => {
  const table = parseDeterminationTable({
    kind: "reduction", version: "2099.01", label: "시험용 감면 판정표",
    items: [{ id: "first_home", label: "시험용 감면 가", law: "시험용 조문", requirements: [{ id: "house_count", label: "시험용: 주택 한 채", check: { op: "eq", field: "house_count", value: 1 } }, { id: "no_history", label: "시험용: 이력 없음", check: { op: "manual" } }] }],
  });
  const withHouse: typeof ACQ = { ...ACQ, form: { ...ACQ.form, houseCount: 1 } };
  it("계산이 끝난 경우에만 판정표를 돌리고 적용 금액은 null", () => {
    const run = runCalculator(withHouse, ctx({ reductionTable: table }), "2026-10-27");
    const b = runBenefits(run, table);
    expect(b.state).toBe("found");
    if (b.state !== "found") return;
    expect(b.tableVersion).toBe("2099.01");
    expect(b.items[0]!.requirements.map((r) => r.state)).toEqual(["입력으로 확인", "직접 확인 필요"]);
  });
  it("계산이 안 된 결과(unsupported)와 판정표 없음은 hidden", () => {
    const closed = runCalculator(ACQ, ctx({ ruleset: null }), "2026-10-27");
    expect(runBenefits(closed, table)).toEqual({ state: "hidden" });
    expect(runBenefits(runCalculator(ACQ, ctx(), "2026-10-27"), null)).toEqual({ state: "hidden" });
  });
});

describe("도구 목록과 입력 검사", () => {
  it("모델 도구 이름에 양도세·상속세·증여세 계산이 없다 (감면 점검은 서버 전용)", () => {
    const names = [...BASE_TOOL_NAMES, ...CALC_TOOL_NAMES, ...SERVER_ONLY_TOOL_NAMES, "web_search_official"];
    expect(names.filter((n) => /transfer|inherit|gift|igt|cgt|양도|상속|증여/iu.test(n))).toEqual([]);
    const defs = [...buildToolDefs({ liveAvailable: true, officialSearchEnabled: true }), ...buildCalcToolDefs({ calculatorOpen: true, determinationTypes: ["trust_holding"] })];
    expect(defs.map((d) => d.name).filter((n) => /transfer|inherit|gift|양도|상속|증여/iu.test(n))).toEqual([]);
    expect(defs.map((d) => d.name)).not.toContain("check_benefits");
  });
  it("계산기가 닫혔거나 공개 판정표가 없으면 그 도구의 정의가 0", () => {
    expect(buildCalcToolDefs({ calculatorOpen: false, determinationTypes: [] })).toEqual([]);
    expect(buildCalcToolDefs({ calculatorOpen: true, determinationTypes: ["아님"] }).map((d) => d.name)).toEqual(["run_calculator"]);
  });
  it("모르는 칸·맞지 않는 값·잘못된 세목은 거부", () => {
    expect(parseCalcToolInput("run_calculator", { tax: "acquisition", cause: "PAID", price: 100 })).toMatchObject({ tax: "acquisition", form: { cause: "PAID", price: 100 } });
    expect(parseCalcToolInput("run_calculator", { tax: "acquisition", price: -5 })).toBeNull();
    expect(parseCalcToolInput("run_calculator", { tax: "acquisition", price: 1.5 })).toBeNull();
    expect(parseCalcToolInput("run_calculator", { tax: "acquisition", cause: "SELL" })).toBeNull();
    expect(parseCalcToolInput("run_calculator", { tax: "acquisition", transfer_gain: 5 })).toBeNull();
    expect(parseCalcToolInput("run_calculator", { tax: "transfer", price: 5 })).toBeNull();
    expect(parseCalcToolInput("run_calculator", { tax: "holding", prices: [] })).toBeNull();
    expect(parseCalcToolInput("run_calculator", "문자열")).toBeNull();
  });
  it("판정 입력: 알려진 판정 종류만, 답은 20개 이하 단순 값만", () => {
    expect(parseCalcToolInput("run_determination", { judgment_type: "trust_holding", answers: { a_b: "예", nn: 2, ok: true } })).toMatchObject({ typeId: "trust_holding" });
    expect(parseCalcToolInput("run_determination", { judgment_type: "모름" })).toBeNull();
    expect(parseCalcToolInput("run_determination", { judgment_type: "trust_holding", answers: { "Bad Key": 1 } })).toBeNull();
    expect(parseCalcToolInput("run_determination", { judgment_type: "trust_holding", answers: { a_b: { x: 1 } } })).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k_${i}`, 1]));
    expect(parseCalcToolInput("run_determination", { judgment_type: "trust_holding", answers: many })).toBeNull();
  });
});

describe("FAM-09 - 상속·증여 카드 고르기", () => {
  it("질문 낱말로 증여/상속/둘 다를 고른다", () => {
    expect(igtKindsOf("증여세 공제가 얼마인가요")).toEqual(["gift"]);
    expect(igtKindsOf("상속세 계산")).toEqual(["inheritance"]);
    expect(igtKindsOf("상속과 증여 공제")).toEqual(["gift", "inheritance"]);
    expect(igtKindsOf("세금 공제")).toEqual(["gift", "inheritance"]);
  });
  it("게이트 상태대로 카드를 정한다 - 닫힌 세목은 외부 카드, 열린 세목은 자체 카드", () => {
    const gate = { igtCard: (k: "gift" | "inheritance"): CardLink => (k === "gift" ? { kind: "self", href: "/calc/gift-tax" } : EXTERNAL) };
    expect(igtCards("증여세 공제", gate)).toEqual([{ kind: "gift", link: { kind: "self", href: "/calc/gift-tax" } }]);
    expect(igtCards("상속세 공제", gate)).toEqual([{ kind: "inheritance", link: EXTERNAL }]);
    expect(igtCards("상속세와 증여세", gate).map((c) => c.kind)).toEqual(["gift", "inheritance"]);
  });
  it("둘 다 같은 외부 카드면 한 장으로 합친다", () => {
    expect(igtCards("상속세와 증여세", { igtCard: () => EXTERNAL })).toEqual([{ kind: "both", link: EXTERNAL }]);
  });
});

describe("요건 사전 연결", () => {
  const row = { topic: "house_count", version: "2099.01", body: { keywords: ["시험용주제"], tax_items: ["acquisition"], fields: [{ id: "has_x", question: "시험용 질문입니까", options: ["예", "아니오"], required: true }, { id: "opt_y", question: "선택", options: ["가"], required: false }, { id: "no_q", options: ["가"] }, { id: "no_opt", question: "선택지 없음" }] } };
  it("질문 문장·선택지가 있는 필수 칸만 슬롯이 된다", () => {
    const d = topicsFromDictionary([row]);
    expect(d.topics).toHaveLength(1);
    expect(d.topics[0]!.required.map((s) => s.id)).toEqual(["house_count.has_x"]);
    expect(d.topics[0]!.required[0]!.options.map((o) => o.label)).toEqual(["예", "아니오"]);
    expect(d.version).toBe("house_count@2099.01");
  });
  it("주제 낱말이 없거나 슬롯이 0이면 주제를 건너뛴다", () => {
    expect(topicsFromDictionary([{ ...row, body: { ...row.body, keywords: [] } }]).topics).toEqual([]);
    expect(topicsFromDictionary([{ ...row, body: { keywords: ["a"], fields: [] } }]).topics).toEqual([]);
    expect(topicsFromDictionary([{ topic: "BAD TOPIC", version: "1", body: row.body }]).topics).toEqual([]);
  });
});

// ── 흐름 안 (가짜 모델) ──
async function run(deps: AgentDeps, message: string): Promise<{ events: AgentEvent[]; rec: AgentTurnRecord }> {
  const gen = runAgentTurn({ message, mode: "general", turn: 0, clarify: { rounds: 0, answers: {} } }, deps);
  const events: AgentEvent[] = [];
  for (;;) {
    const n = await gen.next();
    if (n.done) return { events, rec: n.value };
    events.push(n.value);
  }
}
const toolUse = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: "tu1", name, input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } }) as never;

describe("flow - 계산 도구 연결", () => {
  const port = () => createCalcPort(ctx());
  it("금액은 calc 카드(엔진 결과)에만 나오고 도구 결과 글에는 없다. 감면 점검 결과 요약이 자동으로 남는다", async () => {
    const models = scriptedModel([toolUse("run_calculator", { tax: "acquisition", owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", price: 500_000_000 }), answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models, calc: port(), calcCopy: testCalcCopy() }), "시험용 취득세 질문입니다");
    const calc = events.find((e) => e.event === "calc")!;
    const direct = calcAcquisition(buildAcquisition(ACQ.form).input!, RULESET);
    expect(calc.data).toMatchObject({ status: "calculated", totalWon: direct.total, rulesVersion: direct.rulesVersion, asOf: "2026-10-27", notice: "[시험용] calc_notice 안내" });
    const second = JSON.stringify(models.requests[1]);
    expect(second).not.toContain(String(direct.total));
    expect(rec.results.map((r) => [r.tool, r.status])).toEqual([["run_calculator", "calculated"], ["check_benefits", "hidden"]]);
    expect(rec.results[0]).toMatchObject({ total_won: direct.total, ruleset_version: direct.rulesVersion, as_of: "2026-10-27" });
    expect(events.at(-1)!.data).toMatchObject({ rulesetVersion: direct.rulesVersion });
    expect(rec.toolCalls.map((t) => t.name)).toEqual(["check_benefits", "run_calculator"]);
    expect(rec.toolCalls.every((t) => !JSON.stringify(t).includes("500000000"))).toBe(true);
  });
  it("calc 카드는 문단 뒤에 나온다. 모델이 금액을 문장에 쓰면 V3가 막는다 (모델 금액 0)", async () => {
    const wrong = answerResponse("시험용 설명입니다. 세액은 9876543원입니다.", [0]);
    const models = scriptedModel([toolUse("run_calculator", { tax: "acquisition", owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", price: 500_000_000 }), wrong, answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models, calc: port() }), "시험용 취득세 질문입니다");
    expect(rec.regenerated).toBe(true);
    const names = events.map((e) => e.event);
    expect(names.indexOf("paragraph")).toBeLessThan(names.indexOf("calc"));
    expect(events.filter((e) => e.event === "paragraph").every((e) => !String(e.data.text).includes("9876543"))).toBe(true);
  });
  it("닫힌 세목은 unsupported 카드 - 금액 칸 없음", async () => {
    const closedPort = createCalcPort(ctx({ gate: gateFrom([gateRow({ tax_kind: "property", cause_group: "ALL" })]) }));
    const models = scriptedModel([toolUse("run_calculator", { tax: "acquisition", owner_type: "INDIVIDUAL", property_kind: "HOUSE", cause: "PAID", price: 500_000_000 }), answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models, calc: closedPort }), "시험용 취득세 질문입니다");
    const calc = events.find((e) => e.event === "calc")!;
    expect(calc.data).toMatchObject({ status: "unsupported", reason: "gate_closed" });
    expect("totalWon" in calc.data).toBe(false);
    expect(events.some((e) => e.event === "benefits")).toBe(false);
    expect(rec.results.map((r) => r.tool)).toEqual(["run_calculator"]);
  });
  it("포트가 없으면 계산·판정 도구 정의가 요청에 없다. 모양이 틀린 입력은 계산하지 않는다", async () => {
    const m1 = scriptedModel([answerResponse(OK_TEXT, [0])]);
    await run(makeDeps({ models: m1 }), "시험용 취득세 질문입니다");
    expect((m1.requests[0] as unknown as { tools: Array<{ name: string }> }).tools.map((t) => t.name)).not.toContain("run_calculator");
    const m2 = scriptedModel([toolUse("run_calculator", { tax: "acquisition", price: -1 }), answerResponse(OK_TEXT, [0])]);
    const { events, rec } = await run(makeDeps({ models: m2, calc: port() }), "시험용 취득세 질문입니다");
    expect(events.some((e) => e.event === "calc")).toBe(false);
    expect(rec.results).toEqual([]);
  });
  it("상속세·증여세 금액 질문은 모델 호출 0 · 금액 0 · 게이트 상태대로 카드 (범위 플래그와 무관)", async () => {
    for (const flags of [{ trust_redevelopment: false, inheritance: false, gift: false }, { trust_redevelopment: true, inheritance: true, gift: true }]) {
      const models = scriptedModel([answerResponse(OK_TEXT, [0])]);
      const gateOpenGift = createCalcPort(ctx({ gate: gateFrom(ALL_OPEN, (k) => (k === "gift" ? { kind: "self", href: "/calc/gift-tax" } : EXTERNAL)) }));
      const { events } = await run(makeDeps({ models, calc: gateOpenGift, scopeFlags: flags, tools: fakeTools([makeDoc()]) }), "증여세 공제 금액이 얼마인가요");
      const fb = events.find((e) => e.event === "fallback")!;
      expect(models.requests).toHaveLength(0);
      expect(fb.data).toMatchObject({ reason: "scope", amount: 0, cards: [{ kind: "gift", link: { kind: "self", href: "/calc/gift-tax" } }] });
    }
  });
});
