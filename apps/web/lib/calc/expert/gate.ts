// 전문가 계산기 공개 판정 (W13-f · CALC-17~19) - 순수 함수. 공개 가능 여부의 정본은 DB 뷰 calc_gate_status(is_open)이고,
// 이 모듈은 ① 세목 줄이 있는지 ② 배포된 엔진 해시와 같은지 ③ 기능 키·룰셋이 있는지를 한 곳에서 AND 한다. 수동으로 여는 입력은 없다.

export const EXPERT_KINDS = ["oligopoly", "entity", "corporate_local_income"] as const;
export type ExpertKind = (typeof EXPERT_KINDS)[number];

/** calc_gate_status 한 줄 중 이 모듈이 보는 칸 (세목 값은 뷰가 정한다) */
export interface ExpertGateRow {
  tax_kind: string;
  cause_group: string;
  engine_hash: string | null;
  is_open: boolean;
}

/** 세목 줄이 있고, 열려 있고, 엔진 해시가 같을 때만 true. 줄이 없으면(현재 상태) 닫힘 */
export function expertGateOpen(rows: readonly ExpertGateRow[], kind: ExpertKind, deployedEngineHash: string): boolean {
  const row = rows.find((r) => r.tax_kind === kind && r.cause_group === "ALL");
  return !!row && row.is_open === true && !!deployedEngineHash && row.engine_hash === deployedEngineHash;
}

export type ExpertState = "open" | "unsupported";

export interface ExpertStateInput {
  features: { calc: boolean; expert_calc: boolean };
  gateOpen: boolean;
  /** 이 세목이 쓰는 룰셋(CALC-17·19 전문가 룰셋 / CALC-18 기본 룰셋)이 읽혔나 */
  hasRuleset: boolean;
  /** 화면 고정 안내 문구(PO 감수 입력)가 채워졌나 - 비면 열지 않는다 */
  hasNotices: boolean;
}

/** 하나라도 빠지면 unsupported - 화면은 404, 에이전트 도구는 unsupported 카드 */
export function expertState(i: ExpertStateInput): ExpertState {
  return i.features.calc && i.features.expert_calc && i.gateOpen && i.hasRuleset && i.hasNotices ? "open" : "unsupported";
}
