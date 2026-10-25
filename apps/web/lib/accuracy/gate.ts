// 자체 계산기 공개 게이트 - 앱 쪽 순수 판정 (CALC-14 · FAM-07 · TX-04). 공개 가능 여부의 정본은 DB 뷰 calc_gate_status(is_open)이고,
// 이 모듈은 ① 부족한 것을 사람 말로 보여 주고(관리 화면) ② 배포된 엔진 해시와 뷰가 본 실행의 엔진 해시가 같은지 한 번 더 닫는다.
// 수동 우회 경로 없음 - 이 모듈에 '열기' 입력은 없고, 뷰가 열려 있어야만 열린다.

/** 공식 결과 일치 최소 건수(묶음마다)와 감수 표본 최소 건수(세목마다) - PRD-02 CALC-14. DB 뷰 정의와 같은 값 (시험이 뷰와 대조) */
export const GATE_OFFICIAL_MIN = 30;
export const GATE_SAMPLE_MIN = 50;

export const TAX_KINDS = ["acquisition", "property", "comprehensive"] as const;
export type TaxKind = (typeof TAX_KINDS)[number];
export const CAUSES = ["PAID", "INHERITANCE", "GIFT", "ORIGINAL"] as const;
export type Cause = (typeof CAUSES)[number];
export type CauseGroup = "INHERITANCE" | "GIFT" | "OTHER" | "ALL";

/** 사례의 묶음 - 취득세는 원인(상속·증여·그 밖=유상취득+원시취득), 다른 세목은 ALL (DB 뷰와 같은 규칙) */
export function causeGroupOf(taxKind: TaxKind, cause: Cause | null | undefined): CauseGroup {
  if (taxKind !== "acquisition") return "ALL";
  return cause === "INHERITANCE" ? "INHERITANCE" : cause === "GIFT" ? "GIFT" : "OTHER";
}

export interface GateCounts {
  officialCases: number;
  officialMatched: number;
  sampleCases: number;
  sampleMatched: number;
}

/** 건수만으로 본 공개 조건 - 건수 부족과 불일치를 구분해 말해 준다 (실행이 사례를 덮는지는 DB 뷰만 안다) */
export function evaluateGate(c: GateCounts): { open: boolean; shortfalls: string[] } {
  const shortfalls: string[] = [];
  if (c.officialCases < GATE_OFFICIAL_MIN) shortfalls.push(`공식 결과 사례 ${GATE_OFFICIAL_MIN - c.officialCases}건 부족 (${c.officialCases}/${GATE_OFFICIAL_MIN})`);
  if (c.officialMatched < c.officialCases) shortfalls.push(`공식 결과 불일치 ${c.officialCases - c.officialMatched}건`);
  if (c.sampleCases < GATE_SAMPLE_MIN) shortfalls.push(`감수 표본 ${GATE_SAMPLE_MIN - c.sampleCases}건 부족 (${c.sampleCases}/${GATE_SAMPLE_MIN})`);
  if (c.sampleMatched < c.sampleCases) shortfalls.push(`감수 표본 불일치 ${c.sampleCases - c.sampleMatched}건`);
  return { open: shortfalls.length === 0, shortfalls };
}

/** DB 뷰 calc_gate_status 한 줄 */
export interface GateRow {
  tax_kind: TaxKind;
  cause_group: CauseGroup;
  ruleset_version: string | null;
  last_run_id: number | null;
  run_at: string | null;
  engine_hash: string | null;
  official_cases: number;
  official_matched: number;
  sample_cases: number;
  sample_matched: number;
  is_open: boolean;
}

/** 묶음 하나가 열렸나 - 뷰가 열렸고, 그 실행의 엔진 해시가 지금 배포된 엔진 해시와 같을 때만 */
export function groupOpen(rows: readonly GateRow[], taxKind: TaxKind, group: CauseGroup, deployedEngineHash: string): boolean {
  const row = rows.find((r) => r.tax_kind === taxKind && r.cause_group === group);
  return !!row && row.is_open === true && row.engine_hash === deployedEngineHash;
}

/** 취득세 원인 하나의 금액을 보여도 되나 (FAM-07) - 그 원인의 묶음만 본다. 다른 세목은 ALL 묶음 */
export function causeOpen(rows: readonly GateRow[], taxKind: TaxKind, cause: Cause | null, deployedEngineHash: string): boolean {
  return groupOpen(rows, taxKind, causeGroupOf(taxKind, cause), deployedEngineHash);
}
