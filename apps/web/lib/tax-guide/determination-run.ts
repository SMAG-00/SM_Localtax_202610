// 정비·신탁 세금 판정 공용 실행 (W11-c c4·c7·c8 - TRU-03 · RDV-04 · PR-12). 판정은 브라우저에서 이 함수 하나로 합니다.
//  · 같은 사실 → 같은 결론: /calc/trust-taxpayer(TRU-03)와 /calc/project-tax의 신탁 보유세 판정은 같은 판정표(trust_taxpayer)와 같은 함수를 부른다.
//  · "모르겠어요"는 값을 빼는 것(undefined)이다 - 기본 가정으로 채우지 않는다 (FAM-05 · 6장). 결론은 필수 사실이 모두 있을 때만.
//  · 입력은 이 함수 밖으로 나가지 않는다 (서버·이벤트·URL·저장소 0). 금액을 만들지 않는다.
//  · 판정표 본문은 감수 입력 - 이 파일에는 법령 문장도 요건도 없다.
import { evaluateConclusionTable, parseTableByKind, type ConclusionOutcome, type ConclusionTable, type Facts } from "@ltr/tax-engine";

type FactValue = NonNullable<Facts[string]>;

/** PR-12 판정 종류 6가지 (정비 4 + 신탁 2) - 판정표 종류와 판정 종류 사실(judgment_type)을 잇는 유일한 표. 이름은 PRD 4-I 현재안 [감수 필요: 판정 종류] */
export const PROJECT_TAX_TYPES = [
  { id: "right_succession", label: "입주권 승계취득의 과세 대상", group: "redevelopment", kind: "redevelopment_right" },
  { id: "original_acquisition", label: "조합 원시취득의 조합원분·일반분양분 구분", group: "redevelopment", kind: "redevelopment_tax" },
  { id: "settlement_money", label: "청산금 수령·납부의 과세 여부", group: "redevelopment", kind: "redevelopment_tax" },
  { id: "land_after_demolition", label: "멸실 후 토지분 재산세", group: "redevelopment", kind: "redevelopment_tax" },
  { id: "trust_transfer", label: "신탁 설정·종료 이전의 취득세 과세 여부", group: "trust", kind: "trust_acquisition" },
  { id: "trust_holding", label: "신탁 보유세 납세의무자·물적납세의무", group: "trust", kind: "trust_taxpayer" },
] as const;
export type ProjectTaxTypeId = (typeof PROJECT_TAX_TYPES)[number]["id"];
export type ProjectTaxKind = (typeof PROJECT_TAX_TYPES)[number]["kind"];

export const PROJECT_TAX_KINDS: readonly ProjectTaxKind[] = ["redevelopment_right", "redevelopment_tax", "trust_acquisition", "trust_taxpayer"];

export function projectTaxType(id: string) {
  return PROJECT_TAX_TYPES.find((t) => t.id === id) ?? null;
}

/** 폼 응답 → 사실. "unknown"(모르겠어요)·빈 글자는 값 없음. 숫자·불리언 칸은 요건 사전이 정한 종류대로 호출 쪽이 변환해 넘긴다 */
export type RawAnswer = FactValue | "unknown" | "" | null | undefined;
export function buildFacts(answers: Readonly<Record<string, RawAnswer>>): Facts {
  const out: Record<string, FactValue> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (v === undefined || v === null || v === "" || v === "unknown") continue;
    out[k] = v;
  }
  return out;
}

export interface DeterminationRun {
  typeId: ProjectTaxTypeId;
  kind: ProjectTaxKind;
  outcome: ConclusionOutcome;
}

/**
 * 판정 한 번. 판정표는 `public_determination_tables`에서 렌더 때 내려온 본문(raw)이다.
 * 판정 종류가 정비 판정표를 공유하는 경우(원시취득·청산금·멸실 후 토지분) judgment_type 사실을 함께 넣는다 - 표가 쓰지 않으면 무시된다.
 * 표가 종류와 맞지 않으면 throw(화면은 진입 자체를 그리지 않는다).
 */
export function runDetermination(typeId: ProjectTaxTypeId, rawTable: unknown, answers: Readonly<Record<string, RawAnswer>>): DeterminationRun {
  const type = projectTaxType(typeId);
  if (!type) throw new Error(`모르는 판정 종류: ${typeId}`);
  const table = parseTableByKind(type.kind, rawTable) as ConclusionTable;
  const facts: Facts = { ...buildFacts(answers), judgment_type: type.id };
  return { typeId: type.id, kind: type.kind, outcome: evaluateConclusionTable(table, facts) };
}
