// 상속·증여세 공개 게이트 판정 (FAM-12·14) - 순수 함수. 정본은 DB 뷰 calc_gate_status 의 gift ALL · inheritance ALL 줄이고,
// 이 함수는 뷰가 열렸고 그 실행의 엔진 해시가 지금 배포된 엔진 해시와 같을 때만 열린 것으로 본다. 수동으로 여는 입력은 없다.
// 증여와 상속은 따로 열린다 - 한쪽이 열려도 다른 쪽은 닫힌 채다.

export const IGT_KINDS = ["gift", "inheritance"] as const;
export type IgtKind = (typeof IGT_KINDS)[number];

/** public_calc_gate 의 한 줄(필요한 칸만) */
export interface IgtGateRow {
  tax_kind: string;
  cause_group: string;
  engine_hash: string | null;
  is_open: boolean;
}

export function igtGateOpen(rows: readonly IgtGateRow[], kind: IgtKind, deployedEngineHash: string): boolean {
  if (!deployedEngineHash) return false;
  const row = rows.find((r) => r.tax_kind === kind && r.cause_group === "ALL");
  return !!row && row.is_open === true && row.engine_hash === deployedEngineHash;
}

/** 게이트가 열려 자체 카드로 바뀐 세목 (FAM-14) */
export interface OwnState {
  gift: boolean;
  inheritance: boolean;
}

/** 「지방세로 읽기」 박스 옆 카드용 - 박스의 세목에 나온 것만 자체 카드 대상이고, 나온 세목이 모두 자체로 바뀌면 외부 카드는 빠진다 (covers) */
export interface LensOwn {
  state: OwnState;
  covers: boolean;
}
export function lensOwnFilter(topics: readonly string[], own: OwnState): LensOwn {
  const needGift = topics.some((t) => /증여세/.test(t));
  const needInheritance = topics.some((t) => /상속세/.test(t));
  const state = { gift: needGift && own.gift, inheritance: needInheritance && own.inheritance };
  return { state, covers: (needGift || needInheritance) && (!needGift || state.gift) && (!needInheritance || state.inheritance) };
}
