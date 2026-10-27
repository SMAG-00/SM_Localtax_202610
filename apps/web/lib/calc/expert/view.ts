import type { CalcResult } from "@ltr/tax-engine";
import type { EntityLocalTaxResult, EntityLocalTaxSide, OligopolyExpertResult } from "@ltr/tax-engine/expert";

// 전문가 계산기 화면 모델 (W13-f) - 순수 함수. 금액·세율·근거는 엔진 결과에서만 온다. 법률·세무 문구는 쓰지 않는다
// 고정 안내 문구는 ExpertNotices(PO 감수 입력)로만 들어온다.

/** 화면 고정 안내 두 줄 - 세무 안내 문구라 코드에 글자가 없다. PO 감수 문구를 ruleset.ts 자리에 받아 읽는다(비어 있으면 계산기를 열지 않는다) */
export interface ExpertNotices {
  /** CALC-18: 국세는 비교에 포함되지 않는다는 한 줄 */
  entityNational: string;
  /** CALC-19: 과세표준은 입력값이며 세무조정은 하지 않는다는 고지 */
  corporateBase: string;
}

export const won = (n: number): string => `${Math.trunc(n).toLocaleString("ko-KR")}원`;

export interface ResultRow {
  code: string;
  label: string;
  base: number;
  rate: number | null;
  amount: number;
  law: string;
  reasons: string[];
}
const rowOf = (i: CalcResult["items"][number]): ResultRow => ({ code: i.code, label: i.label, base: i.base, rate: i.rate, amount: i.amount, law: i.law, reasons: [...i.reasons] });

export interface ScenarioView {
  title: string;
  rows: ResultRow[];
  total: number;
  warnings: string[];
}
export interface ExpertView {
  scenarios: ScenarioView[];
  /** 룰셋 버전 각인 - 결과 옆에 항상 보인다 */
  versions: string[];
  /** unknown 선택이거나 개인 대 법인이면 시나리오를 나란히 */
  sideBySide: boolean;
}

export function oligopolyView(r: OligopolyExpertResult): ExpertView {
  return {
    scenarios: r.scenarios.map((s) => ({
      title: s.listing === "listed" ? "상장법인인 경우" : "비상장법인인 경우",
      rows: s.result.items.map(rowOf),
      total: s.result.total,
      warnings: [...s.result.warnings],
    })),
    versions: [r.baseRulesVersion, r.expertRulesVersion],
    sideBySide: r.choice === "unknown",
  };
}

export function corporateView(r: CalcResult): ExpertView {
  return { scenarios: [{ title: "법인지방소득세", rows: r.items.map(rowOf), total: r.total, warnings: [...r.warnings] }], versions: [r.rulesVersion], sideBySide: false };
}

const sideView = (title: string, s: EntityLocalTaxSide): ScenarioView => ({
  title,
  rows: [...s.acquisitionItems, ...s.holdingItems].map(rowOf),
  total: s.total,
  warnings: [...s.warnings],
});

export function entityView(r: EntityLocalTaxResult): ExpertView & { totalDiff: number } {
  return {
    scenarios: [sideView("개인이 취득·보유하는 경우", r.individual), sideView("법인이 취득·보유하는 경우", r.corporation)],
    versions: [r.rulesVersion],
    sideBySide: true,
    totalDiff: r.totalDiff,
  };
}

/** SM 비교 계산기 새 창 링크 카드 - 주소는 official_links 값 그대로, 입력값·결과값을 싣지 않는다. 주소가 없으면 카드 없음 */
export interface SmCard {
  label: string;
  href: string;
}
export function smCard(links: ReadonlyArray<{ key: string; label: string; url: string }>, key: string): SmCard | null {
  const hit = links.find((l) => l.key === key);
  if (!hit) return null;
  try {
    const u = new URL(hit.url);
    if (u.protocol !== "https:") return null;
    // 링크에 질의·조각이 이미 붙어 있어도 그대로 두지 않는다 - 입력값이 실릴 자리를 없앤다
    u.search = "";
    u.hash = "";
    return { label: hit.label, href: u.toString() };
  } catch {
    return null;
  }
}
