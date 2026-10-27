// 계산·감면·판정 실행과 카드 이벤트 - 순수 (W12-c c1~c3·c6, PRD-04 ASK-05·18·22, FAM-09).
//  · 금액·세율·기준일·룰셋 버전·근거 조문은 모두 엔진 결과(CalcResult)에서만 온다. 모델 문장에서 가져오지 않는다.
//  · 공개 게이트·기능 키 판단은 서버가 CalcGate로 주입한다(이 파일은 tool-link·lib/igt를 불러오지 않는다 - NT9). 닫힌 세목은 unsupported.
//  · 감면 점검은 계산이 끝나면 서버가 자동으로 돌린다(benefits). 적용 금액은 엔진에 감면 계산 모듈이 없어 null.
//  · 판정은 공개(활성) 판정표 본문이 주어진 종류만 돌린다. 결론 문장은 판정표 데이터의 글이다.
//  · 상속세·증여세 금액은 만들지 않는다 - igtCards는 카드 종류만 고른다(amount 0).
import { calcAcquisition, calcHolding, type DeterminationTable, type Facts, type Ruleset } from "@ltr/tax-engine";
import type { Cause } from "../accuracy/gate";
import { acquisitionFacts, ACQUISITION_QUESTIONS, buildAcquisition } from "../calc/acquisition";
import { buildHolding, HOLDING_QUESTIONS, holdingResultFor, type HoldingGroup } from "../calc/holding";
import { reductionBlock, type ReductionBlock } from "../calc/reduction";
import { PROJECT_TAX_TYPES, projectTaxType, runDetermination, type ProjectTaxKind } from "../tax-guide/determination-run";
import type { CalcToolInput } from "./calc-tools";

export type GateState = "open" | "feature_off" | "gate_closed";
/** 서버가 toolLinkFor·calc_gate_status로 계산해 넘기는 카드 종류 (tool-link의 ToolLink와 같은 모양) */
export type CardLink =
  | { kind: "self"; href: string }
  | { kind: "sm"; linkKey: string }
  | { kind: "external"; linkKey: string }
  | { kind: "none" };
export interface CalcGate {
  acquisition(cause: Cause | null): GateState;
  /** 재산세·종합부동산세 - 세목마다 따로 열린다 */
  holding(): { state: GateState; open: Readonly<Record<HoldingGroup, boolean>> };
  igtCard(kind: "gift" | "inheritance"): CardLink;
}
export interface CalcContext {
  gate: CalcGate;
  ruleset: Ruleset | null;
  reductionTable: DeterminationTable | null;
  /** 공개(활성) 판정표 본문 - 종류별. 없는 종류는 부르지 않는다 */
  determinationTables: Partial<Record<ProjectTaxKind, unknown>>;
}

export interface CalcItem {
  code: string;
  label: string;
  baseWon: number;
  rate: number | null;
  amountWon: number;
  law: string;
}
export type UnsupportedReason = "feature_off" | "gate_closed" | "no_ruleset" | "not_in_force" | "engine_rejected";
export type CalcOutcome =
  | { status: "calculated"; tax: "acquisition" | "holding"; totalWon: number; items: CalcItem[]; rulesVersion: string; engineVersion: string; asOf: string; laws: string[]; warnings: string[]; assumed: Array<{ id: string; text: string; note: string | null }> }
  | { status: "needs_input"; tax: "acquisition" | "holding"; missing: Array<{ id: string; text: string }> }
  | { status: "unsupported"; tax: "acquisition" | "holding"; reason: UnsupportedReason }
  | { status: "not_liable"; tax: "holding" };

export interface CalcRun {
  outcome: CalcOutcome;
  /** 감면 판정표 입력 (계산이 끝난 경우에만) */
  facts: Facts | null;
}

const textOf = (qs: ReadonlyArray<{ id: string; text: string }>, id: string) => qs.find((q) => q.id === id)?.text ?? id;
const unsupported = (tax: "acquisition" | "holding", reason: UnsupportedReason): CalcRun => ({ outcome: { status: "unsupported", tax, reason }, facts: null });

function holdingFacts(f: { ownerType?: string; isSingleHouseOneHousehold?: boolean; isUrbanArea?: boolean; ownerAge?: number; holdingYears?: number }): Facts {
  const out: Record<string, string | number | boolean> = {};
  if (f.ownerType !== undefined) out.owner_type = f.ownerType;
  if (f.isSingleHouseOneHousehold !== undefined) out.is_single_house_one_household = f.isSingleHouseOneHousehold;
  if (f.isUrbanArea !== undefined) out.is_urban_area = f.isUrbanArea;
  if (f.ownerAge !== undefined) out.owner_age = f.ownerAge;
  if (f.holdingYears !== undefined) out.holding_years = f.holdingYears;
  return out;
}

const uniq = (xs: readonly string[]) => [...new Set(xs.filter((x) => x.trim() !== ""))];

/** run_calculator - 엔진 직접 호출. 기준일이 룰셋 시행일 전이면 계산하지 않는다 */
export function runCalculator(input: Extract<CalcToolInput, { name: "run_calculator" }>, ctx: CalcContext, asOf: string): CalcRun {
  const rs = ctx.ruleset;
  try {
    if (input.tax === "acquisition") {
      const gate = ctx.gate.acquisition((input.form.cause as Cause | undefined) ?? null);
      if (gate !== "open") return unsupported("acquisition", gate);
      if (!rs) return unsupported("acquisition", "no_ruleset");
      if (asOf < rs.effective_from) return unsupported("acquisition", "not_in_force");
      const built = buildAcquisition(input.form);
      if (!built.input) return { outcome: { status: "needs_input", tax: "acquisition", missing: built.missing.map((id) => ({ id, text: textOf(ACQUISITION_QUESTIONS, id) })) }, facts: null };
      const r = calcAcquisition(built.input, rs);
      return {
        outcome: {
          status: "calculated", tax: "acquisition", totalWon: r.total, rulesVersion: r.rulesVersion, engineVersion: r.engineVersion, asOf,
          items: r.items.map((i) => ({ code: i.code, label: i.label, baseWon: i.base, rate: i.rate, amountWon: i.amount, law: i.law })),
          laws: uniq(r.items.map((i) => i.law)), warnings: [...r.warnings], assumed: built.assumed.map((a) => ({ id: a.id, text: a.text, note: a.note })),
        },
        facts: acquisitionFacts(built.form),
      };
    }
    const gate = ctx.gate.holding();
    if (gate.state !== "open") return unsupported("holding", gate.state);
    if (!rs) return unsupported("holding", "no_ruleset");
    if (asOf < rs.effective_from) return unsupported("holding", "not_in_force");
    const built = buildHolding(input.form);
    if (!built.liable) return { outcome: { status: "not_liable", tax: "holding" }, facts: null };
    if (!built.input) return { outcome: { status: "needs_input", tax: "holding", missing: built.missing.map((id) => ({ id, text: textOf(HOLDING_QUESTIONS, id) })) }, facts: null };
    const r = calcHolding(built.input, rs);
    const shown = holdingResultFor(r, gate.open);
    if (shown.items.length === 0) return unsupported("holding", "gate_closed");
    return {
      outcome: {
        status: "calculated", tax: "holding", totalWon: shown.total, rulesVersion: r.rulesVersion, engineVersion: r.engineVersion, asOf,
        items: shown.items.map((i) => ({ code: i.code, label: i.label, baseWon: i.base, rate: i.rate, amountWon: i.amount, law: i.law })),
        laws: uniq(shown.items.map((i) => i.law)), warnings: [...r.warnings], assumed: built.assumed.map((a) => ({ id: a.id, text: a.text, note: a.note })),
      },
      facts: holdingFacts(built.form),
    };
  } catch {
    return unsupported(input.tax, "engine_rejected");
  }
}

/** check_benefits - 계산이 끝난 경우에만 감면 판정표를 돌린다 (서버 자동). 표가 없거나 계산 전이면 hidden */
export function runBenefits(run: CalcRun, table: DeterminationTable | null): ReductionBlock {
  if (run.outcome.status !== "calculated" || !run.facts) return { state: "hidden" };
  return reductionBlock(table, run.facts);
}

export type DeterminationStatus = "conclusion" | "need_more" | "not_in_table" | "unavailable";
export interface DeterminationResult {
  typeId: string;
  label: string;
  status: DeterminationStatus;
  tableVersion: string | null;
  conclusion: { text: string; basis: string | null; ruleId: string | null } | null;
  missing: Array<{ id: string; label: string }>;
}

/** run_determination - 공개 판정표 종류만. 표가 없으면 unavailable(호출하지 않음) */
export function runDeterminationTool(input: Extract<CalcToolInput, { name: "run_determination" }>, ctx: CalcContext): DeterminationResult {
  const type = projectTaxType(input.typeId);
  const none = (label: string = input.typeId): DeterminationResult => ({ typeId: input.typeId, label, status: "unavailable", tableVersion: null, conclusion: null, missing: [] });
  if (!type) return none();
  const raw = ctx.determinationTables[type.kind];
  if (raw === undefined) return none(type.label);
  try {
    const { outcome } = runDetermination(type.id, raw, input.answers);
    const status: DeterminationStatus = outcome.status === "결론" ? "conclusion" : outcome.status === "요건 확인 필요" ? "need_more" : "not_in_table";
    return {
      typeId: type.id, label: type.label, status, tableVersion: outcome.tableVersion,
      conclusion: outcome.conclusion ? { text: outcome.conclusion.text, basis: outcome.conclusion.basis ?? null, ruleId: outcome.conclusion.ruleId } : null,
      missing: outcome.missing.map((m) => ({ id: m.id, label: m.label })),
    };
  } catch {
    return none(type.label);
  }
}

// ── 결과 요약 봉인 (agent_results 한 줄) - 입력값 없음 ──
export interface AgentResultSummary {
  tool: "run_calculator" | "check_benefits" | "run_determination";
  subject: string;
  status: string;
  total_won: number | null;
  as_of: string | null;
  ruleset_version: string | null;
  table_version: string | null;
  laws: string[];
  item_count: number;
}
export function summaryOfCalc(o: CalcOutcome): AgentResultSummary {
  const base = { tool: "run_calculator" as const, subject: o.tax, status: o.status, total_won: null, as_of: null, ruleset_version: null, table_version: null, laws: [] as string[], item_count: 0 };
  return o.status === "calculated" ? { ...base, total_won: o.totalWon, as_of: o.asOf, ruleset_version: o.rulesVersion, laws: o.laws, item_count: o.items.length } : base;
}
export function summaryOfBenefits(b: ReductionBlock): AgentResultSummary {
  const base = { tool: "check_benefits" as const, subject: "reduction", status: b.state, total_won: null, as_of: null, ruleset_version: null, table_version: null, laws: [] as string[], item_count: 0 };
  if (b.state === "hidden") return base;
  return { ...base, table_version: b.tableVersion, item_count: b.state === "found" ? b.count : 0, laws: b.state === "found" ? uniq(b.items.map((i) => i.law ?? "")) : [] };
}
export function summaryOfDetermination(d: DeterminationResult): AgentResultSummary {
  const status = d.status === "unavailable" ? "not_in_table" : d.status;
  return { tool: "run_determination", subject: d.typeId, status, total_won: null, as_of: null, ruleset_version: null, table_version: d.tableVersion, laws: [], item_count: d.conclusion ? 1 : 0 };
}

// ── 카드 이벤트 데이터 (입력값을 싣지 않는다) ──
export function calcEventData(o: CalcOutcome, resultId: string, notices: { calc: string; unsupported: string }): Record<string, unknown> {
  if (o.status === "calculated") {
    return { resultId, tax: o.tax, status: o.status, totalWon: o.totalWon, items: o.items, rulesVersion: o.rulesVersion, engineVersion: o.engineVersion, asOf: o.asOf, laws: o.laws, warnings: o.warnings, assumed: o.assumed, notice: notices.calc };
  }
  if (o.status === "needs_input") return { resultId, tax: o.tax, status: o.status, missing: o.missing };
  if (o.status === "unsupported") return { resultId, tax: o.tax, status: o.status, reason: o.reason, notice: notices.unsupported };
  return { resultId, tax: o.tax, status: o.status };
}
export function benefitsEventData(b: ReductionBlock, resultId: string, notice: string): Record<string, unknown> | null {
  if (b.state === "hidden") return null;
  return {
    resultId, state: b.state, tableVersion: b.tableVersion, checked: b.checked, notice,
    // 적용 시 금액은 엔진에 감면 계산 모듈이 생길 때까지 null
    items: b.state === "found" ? b.items.map((i) => ({ id: i.id, label: i.label, law: i.law ?? null, amountWon: null, requirements: i.requirements.map((r) => ({ id: r.id, label: r.label, state: r.state })) })) : [],
  };
}
export function determinationEventData(d: DeterminationResult, resultId: string, notice: string): Record<string, unknown> {
  return { resultId, typeId: d.typeId, label: d.label, status: d.status, tableVersion: d.tableVersion, conclusion: d.conclusion, missing: d.missing, notice };
}

/** 모델에 돌려주는 도구 결과 글 - 금액·세율을 싣지 않는다 (금액은 카드에만) */
export function calcToolText(o: CalcOutcome): string {
  switch (o.status) {
    case "calculated":
      return "계산이 끝났고 결과 카드가 화면에 표시됩니다. 문장에 금액·세율을 쓰지 말고 카드를 보라고만 안내하세요";
    case "needs_input":
      return `계산에 필요한 값이 비었습니다: ${o.missing.map((m) => m.text).join(" / ")}`;
    case "unsupported":
      return "이 계산은 지금 제공하지 않습니다. 계산기 링크 안내만 하세요";
    case "not_liable":
      return "과세기준일에 소유하지 않아 계산 대상이 아닙니다";
  }
}
export function determinationToolText(d: DeterminationResult): string {
  return d.status === "unavailable" ? "공개된 판정표가 없어 판정하지 않습니다" : d.status === "need_more" ? `판정에 필요한 값이 비었습니다: ${d.missing.map((m) => m.label).join(" / ")}` : "판정 결과 카드가 화면에 표시됩니다. 카드 밖에서 결론을 만들지 마세요";
}

// ── FAM-09: 상속세·증여세 금액·공제 질문 - 금액 0 + 게이트 상태대로 카드 ──
export interface IgtCard {
  kind: "gift" | "inheritance" | "both";
  link: CardLink;
}
/** 질문에 증여만/상속만/둘 다/어느 쪽도 아님 - 어느 쪽도 아니면 둘 다로 본다 */
export function igtKindsOf(text: string): Array<"gift" | "inheritance"> {
  const n = text.normalize("NFKC");
  const gift = /증여/u.test(n);
  const inh = /상속/u.test(n);
  return gift && !inh ? ["gift"] : inh && !gift ? ["inheritance"] : ["gift", "inheritance"];
}
/** 카드 고르기 - 세목마다 gate 결과(link)를 쓰고, 같은 외부 카드가 겹치면 한 장으로 합친다 */
export function igtCards(text: string, gate: Pick<CalcGate, "igtCard">): IgtCard[] {
  const cards = igtKindsOf(text).map((k): IgtCard => ({ kind: k, link: gate.igtCard(k) }));
  const ext = cards.filter((c) => c.link.kind === "external");
  if (ext.length === 2 && JSON.stringify(ext[0]!.link) === JSON.stringify(ext[1]!.link)) {
    return [...cards.filter((c) => c.link.kind !== "external"), { kind: "both", link: ext[0]!.link }];
  }
  return cards;
}

export interface CalcPort {
  availability(): { calculator: boolean; determinationTypes: string[] };
  run(input: Extract<CalcToolInput, { name: "run_calculator" }>, asOf: string): CalcRun;
  benefits(run: CalcRun): ReductionBlock;
  determine(input: Extract<CalcToolInput, { name: "run_determination" }>): DeterminationResult;
  igtCards(text: string): IgtCard[];
}

/** 서버가 데이터를 미리 읽어 만든 포트 - 순수 함수만 부른다 */
export function createCalcPort(ctx: CalcContext): CalcPort {
  const hasRuleset = ctx.ruleset !== null;
  return {
    availability: () => ({
      calculator: hasRuleset,
      determinationTypes: PROJECT_TAX_TYPES.filter((t) => ctx.determinationTables[t.kind] !== undefined).map((t) => t.id),
    }),
    run: (input, asOf) => runCalculator(input, ctx, asOf),
    benefits: (run) => runBenefits(run, ctx.reductionTable),
    determine: (input) => runDeterminationTool(input, ctx),
    igtCards: (text) => igtCards(text, ctx.gate),
  };
}
