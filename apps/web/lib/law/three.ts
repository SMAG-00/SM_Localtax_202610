// 3단 보기 행 만들기 (LAW-05) - 법률 조문마다 위임된 시행령·시행규칙 조문을 가로로 맞춘다. 순수 모듈.
export interface ProvRef {
  lawId: number;
  no: number;
  branch: number;
}
export interface DelegationEdge {
  parent: ProvRef;
  child: ProvRef;
}
export interface ThreeRow {
  statute: ProvRef;
  decree: ProvRef[];
  rule: ProvRef[];
}

const same = (a: ProvRef, b: ProvRef) => a.lawId === b.lawId && a.no === b.no && a.branch === b.branch;
const order = (a: ProvRef, b: ProvRef) => a.no - b.no || a.branch - b.branch;
function uniq(list: ProvRef[]): ProvRef[] {
  const out: ProvRef[] = [];
  for (const r of list) if (!out.some((o) => same(o, r))) out.push(r);
  return out.sort(order);
}

/** 시행령 조문이 시행규칙에 다시 위임한 조문도 같은 행의 시행규칙 칸에 모은다. 위임이 없으면 칸이 빈다('위임 조문 없음') */
export function buildThreeRows(statutes: readonly ProvRef[], edges: readonly DelegationEdge[], decreeLawId: number | null, ruleLawId: number | null): ThreeRow[] {
  return statutes.map((statute) => {
    const decree = decreeLawId === null ? [] : uniq(edges.filter((e) => same(e.parent, statute) && e.child.lawId === decreeLawId).map((e) => e.child));
    const direct = ruleLawId === null ? [] : edges.filter((e) => same(e.parent, statute) && e.child.lawId === ruleLawId).map((e) => e.child);
    const viaDecree = ruleLawId === null ? [] : edges.filter((e) => decree.some((d) => same(d, e.parent)) && e.child.lawId === ruleLawId).map((e) => e.child);
    return { statute, decree, rule: uniq([...direct, ...viaDecree]) };
  });
}
