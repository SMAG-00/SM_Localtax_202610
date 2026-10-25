import { isoToKstDate } from "@/lib/admin/form-utils";
import { groupOpen, type CauseGroup, type GateRow, type TaxKind } from "@/lib/accuracy/gate";

// 계산 정확도 검증 화면·배지의 숫자 (CALC-14 · FAM-07) - 숫자는 calc_gate_status 공개 뷰(마지막 대조 실행 결과)에서만 온다. 코드에 건수 리터럴 0.

export interface AccuracyRowSpec {
  id: string;
  label: string;
  taxKind: TaxKind;
  group: CauseGroup;
}

/** 화면 행 - 취득세는 원인 묶음별 행 (FAM-07) */
export const ACCURACY_ROW_SPECS: readonly AccuracyRowSpec[] = [
  { id: "acquisition_other", label: "취득세 · 유상취득(매매)·원시취득(신축)", taxKind: "acquisition", group: "OTHER" },
  { id: "acquisition_inheritance", label: "취득세 · 상속 원인", taxKind: "acquisition", group: "INHERITANCE" },
  { id: "acquisition_gift", label: "취득세 · 증여 원인", taxKind: "acquisition", group: "GIFT" },
  { id: "property", label: "재산세", taxKind: "property", group: "ALL" },
  { id: "comprehensive", label: "종합부동산세", taxKind: "comprehensive", group: "ALL" },
];

export interface AccuracyRow extends AccuracyRowSpec {
  officialCases: number;
  officialMatched: number;
  sampleCases: number;
  sampleMatched: number;
  checkedOn: string | null;
  rulesetVersion: string | null;
  open: boolean;
}

export function accuracyRows(rows: readonly GateRow[], deployedEngineHash: string): AccuracyRow[] {
  return ACCURACY_ROW_SPECS.map((spec) => {
    const r = rows.find((x) => x.tax_kind === spec.taxKind && x.cause_group === spec.group);
    return {
      ...spec,
      officialCases: r?.official_cases ?? 0,
      officialMatched: r?.official_matched ?? 0,
      sampleCases: r?.sample_cases ?? 0,
      sampleMatched: r?.sample_matched ?? 0,
      checkedOn: r?.run_at ? isoToKstDate(r.run_at) : null,
      rulesetVersion: r?.ruleset_version ?? null,
      open: groupOpen(rows, spec.taxKind, spec.group, deployedEngineHash),
    };
  });
}

/** 결과 화면 정확도 배지 - 열린 묶음에서만 글을 낸다(닫힌 묶음은 결과 자체가 없다) */
export function accuracyBadge(rows: readonly GateRow[], taxKind: TaxKind, group: CauseGroup, deployedEngineHash: string): { text: string } | null {
  const row = accuracyRows(rows, deployedEngineHash).find((r) => r.taxKind === taxKind && r.group === group);
  if (!row || !row.open) return null;
  const date = row.checkedOn ? ` · ${row.checkedOn} 확인` : "";
  return { text: `공식 결과 ${row.officialCases}건 중 ${row.officialMatched}건 일치${date}` };
}
