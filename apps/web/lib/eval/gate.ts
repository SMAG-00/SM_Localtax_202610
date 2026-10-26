// 평가 게이트 - 앱 쪽 순수 판정 (PRD-04 9장 · EVAL-04, docs/dev/W12-e_설계.md). 통과 여부의 정본은 DB(eval_gate_evaluate)이고,
// 이 모듈은 ① 게이트 값 하한을 저장 전에 한 번 더 보고 ② 미달 사유를 사람 말로 보여 주며 ③ 공개 단계 순서를 안내한다.
// 이 모듈에는 '열기' 입력이 없다 - 단계·범위 변경은 승인 함수(DB)만 한다. 세무 값 없음(운영 기준 수치만).

export const STAGES = ["none", "4a", "4b", "4c"] as const;
export type RolloutStage = (typeof STAGES)[number];
export const REPORT_STAGES = ["4a", "4b", "4c"] as const;
export const SCOPES = ["trust_redevelopment", "inheritance", "gift"] as const;
export type GateScope = (typeof SCOPES)[number];
export const SCOPE_LABEL: Record<GateScope, string> = { trust_redevelopment: "신탁·정비", inheritance: "상속 취득세", gift: "증여 취득세" };

/** 4c 하한 (PRD_최종 v1.7 5.2) - 낮추지 않는다. DB 트리거(eval_thresholds_problem)와 같은 값 */
export const FLOOR = { accuracy: 0.9, citationPrecision: 0.98, recall: 0.85, clarifyOmissionMax: 0.05, stageMinItems: 300, minCross: { clarify: 60, benefits: 30, live: 15 } } as const;
export const SCOPE_MIN_ITEMS: Record<GateScope, number> = { trust_redevelopment: 100, inheritance: 30, gift: 30 };

export interface Metrics {
  set_items: number;
  set_items_excl_national: number;
  national_block_items: number;
  national_block_correct: number;
  cross_counts: { clarify: number; benefits: number; live: number };
  has_test_items: boolean;
  answered: number;
  confirmed: number;
  unconfirmed: number;
  ungraded: number;
  accuracy: number | null;
  citation_precision: number | null;
  recall: number | null;
  clarify_omission: number | null;
  invented: number;
  benefit_assertion: number;
  live_without_snapshot: number;
  fatal: number;
}

export type Threshold = Partial<{
  accuracy_min: number; citation_precision_min: number; recall_min: number; clarify_omission_max: number;
  invented_max: number; benefit_assertion_max: number; live_without_snapshot_max: number; fatal_max: number;
  min_items: number; national_block_min: number; min_cross: { clarify: number; benefits: number; live: number };
}>;

export const SHORTFALL_LABEL: Record<string, string> = {
  no_metrics: "지표를 잴 수 없습니다",
  test_items: "시험용 문항이 든 평가셋입니다 (운영 승인 불가)",
  unanswered: "답변이 없는 문항이 있습니다",
  unconfirmed: "미확정 답변이 있습니다 (2인 판정 불일치 - 3인째 필요)",
  ungraded: "채점이 끝나지 않은 답변이 있습니다",
  min_items: "문항 수가 모자랍니다",
  min_cross_clarify: "역질문 문항 수가 모자랍니다",
  min_cross_benefits: "감면 안내 문항 수가 모자랍니다",
  min_cross_live: "실시간 조회 사례 문항 수가 모자랍니다",
  accuracy: "정답률 미달",
  citation_precision: "인용 정밀도 미달",
  recall: "필수 근거 재현율 미달",
  clarify_omission: "필수 요건 역질문 누락 초과",
  invented: "답 없음 문항에서 지어낸 답이 있습니다",
  benefit_assertion: "감면 해당 여부 단정이 있습니다",
  live_without_snapshot: "스냅샷 없는 실시간 인용이 있습니다",
  fatal: "치명 오류가 허용 건수를 넘었습니다",
  national_block: "국세 금액·공제 차단 문항이 모자라거나 모두 차단되지 않았습니다",
};

/** DB eval_gate_evaluate의 앱 쪽 거울 - 화면에서 미달 사유를 미리 보일 때와 시험에서 쓴다. 정본은 DB */
export function evaluateMetrics(m: Metrics | null, th: Threshold | null): { passed: boolean; shortfalls: string[] } {
  if (!m || !th) return { passed: false, shortfalls: ["no_metrics"] };
  const v: string[] = [];
  if (m.has_test_items) v.push("test_items");
  if (m.answered < m.set_items) v.push("unanswered");
  if (m.unconfirmed > 0) v.push("unconfirmed");
  if (m.ungraded > 0) v.push("ungraded");
  if (m.set_items_excl_national < (th.min_items ?? Infinity)) v.push("min_items");
  if (th.min_cross) for (const k of ["clarify", "benefits", "live"] as const) if (m.cross_counts[k] < th.min_cross[k]) v.push(`min_cross_${k}`);
  if (m.accuracy === null || m.accuracy < (th.accuracy_min ?? 1)) v.push("accuracy");
  if (m.citation_precision === null || m.citation_precision < (th.citation_precision_min ?? 1)) v.push("citation_precision");
  if (th.recall_min !== undefined && (m.recall === null || m.recall < th.recall_min)) v.push("recall");
  if (th.clarify_omission_max !== undefined && (m.clarify_omission === null || m.clarify_omission > th.clarify_omission_max)) v.push("clarify_omission");
  if (th.invented_max !== undefined && m.invented > th.invented_max) v.push("invented");
  if (th.benefit_assertion_max !== undefined && m.benefit_assertion > th.benefit_assertion_max) v.push("benefit_assertion");
  if (th.live_without_snapshot_max !== undefined && m.live_without_snapshot > th.live_without_snapshot_max) v.push("live_without_snapshot");
  if (m.fatal > (th.fatal_max ?? 0)) v.push("fatal");
  if (th.national_block_min !== undefined && (m.national_block_items < th.national_block_min || m.national_block_correct < m.national_block_items)) v.push("national_block");
  return { passed: v.length === 0, shortfalls: v };
}

const RATIO_KEYS = ["accuracy_min", "citation_precision_min", "recall_min", "clarify_omission_max"];
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const at = (o: unknown, ...p: string[]): unknown => p.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

/** DB eval_thresholds_problem의 앱 쪽 거울 - 저장 전에 하한을 한 번 더 본다. 문제 없으면 null */
export function thresholdsProblem(p: unknown): string | null {
  if (!p || typeof p !== "object" || !at(p, "stages") || !at(p, "scopes")) return "게이트 값은 stages(4a·4b·4c)와 scopes 두 묶음을 가진 객체여야 합니다";
  for (const s of REPORT_STAGES) {
    for (const k of ["accuracy_min", "citation_precision_min", "recall_min", "clarify_omission_max", "invented_max", "benefit_assertion_max", "live_without_snapshot_max", "fatal_max", "min_items"]) {
      const n = num(at(p, "stages", s, k));
      if (n === null) return `stages.${s}.${k}: 숫자 값이 필요합니다`;
      if (n < 0 || (RATIO_KEYS.includes(k) && n > 1)) return `stages.${s}.${k}: 범위를 벗어났습니다`;
    }
    for (const k of ["clarify", "benefits", "live"] as const) if (num(at(p, "stages", s, "min_cross", k)) === null) return `stages.${s}.min_cross.${k}: 숫자 값이 필요합니다`;
    if ((num(at(p, "stages", s, "invented_max")) ?? 0) > 0 || (num(at(p, "stages", s, "benefit_assertion_max")) ?? 0) > 0 || (num(at(p, "stages", s, "live_without_snapshot_max")) ?? 0) > 0) return `stages.${s}: 지어낸 답·감면 단정·스냅샷 없는 실시간 인용의 허용 값은 0입니다`;
    if ((num(at(p, "stages", s, "min_items")) as number) < FLOOR.stageMinItems || (["clarify", "benefits", "live"] as const).some((k) => (num(at(p, "stages", s, "min_cross", k)) as number) < FLOOR.minCross[k])) return `stages.${s}: 문항 수 하한보다 낮게 저장할 수 없습니다`;
  }
  if ((num(at(p, "stages", "4a", "fatal_max")) as number) > 2) return "stages.4a.fatal_max: 4a 치명 오류 허용은 2건을 넘을 수 없습니다";
  if ((num(at(p, "stages", "4b", "fatal_max")) as number) > 0 || (num(at(p, "stages", "4c", "fatal_max")) as number) > 0) return "4b·4c의 치명 오류 허용은 0입니다";
  const c = (k: string) => num(at(p, "stages", "4c", k)) as number;
  if (c("accuracy_min") < FLOOR.accuracy || c("citation_precision_min") < FLOOR.citationPrecision || c("recall_min") < FLOOR.recall || c("clarify_omission_max") > FLOOR.clarifyOmissionMax) return "4c 기준(정답률 90% · 인용 정밀도 98% · 필수 근거 재현율 85% · 역질문 누락 5%)보다 낮은 값은 저장할 수 없습니다";
  for (const sc of SCOPES) {
    for (const k of ["accuracy_min", "citation_precision_min", "fatal_max", "min_items", "national_block_min"]) if (num(at(p, "scopes", sc, k)) === null) return `scopes.${sc}.${k}: 숫자 값이 필요합니다`;
    const g = (k: string) => num(at(p, "scopes", sc, k)) as number;
    if (g("accuracy_min") < FLOOR.accuracy || g("citation_precision_min") < FLOOR.citationPrecision || g("fatal_max") > 0) return `scopes.${sc}: 4c 기준(정답률 90% · 인용 정밀도 98% · 치명 오류 0)보다 낮은 값은 저장할 수 없습니다`;
    if (g("min_items") < SCOPE_MIN_ITEMS[sc]) return `scopes.${sc}.min_items: 문항 수 하한보다 낮게 저장할 수 없습니다`;
    if (sc !== "trust_redevelopment" && g("national_block_min") < 1) return `scopes.${sc}.national_block_min: 국세 금액·공제 차단 문항은 1개 이상이어야 합니다`;
  }
  return null;
}

/** 올릴 수 있는 다음 단계 (한 칸씩만) */
export function nextStage(cur: RolloutStage): RolloutStage | null {
  const i = STAGES.indexOf(cur);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1]! : null;
}

export const APPROVAL_CODE_LABEL: Record<string, string> = {
  actor_invalid: "승인자 표시가 올바르지 않습니다",
  report_required: "게이트 리포트 없이는 올릴 수 없습니다",
  report_not_found: "리포트가 없습니다",
  report_mismatch: "리포트의 단계·범위가 맞지 않습니다",
  report_not_confirmed: "확정하지 않은 리포트입니다",
  report_stale: "리포트 이후 지시문·모델·색인·룰셋·판정표가 바뀌었습니다",
  test_items_in_report: "시험용 문항이 든 리포트는 운영 승인에 쓸 수 없습니다",
  gate_not_met: "게이트 기준 미달입니다",
  live_check_missing: "실제 API 재실행이 통과해야 합니다",
  stage_skip: "공개 단계는 한 칸씩만 올립니다",
  already_stage: "이미 같은 단계입니다",
  already_set: "이미 같은 상태입니다",
};
