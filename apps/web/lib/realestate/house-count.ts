import { evaluateConclusionTable, evaluateListCountTable, parseTableByKind, type ConclusionOutcome, type ConclusionTable, type ListCountOutcome, type ListCountTable } from "@ltr/tax-engine";

type FactValue = number | string | boolean;

// 주택 수 판정 도우미 화면 규칙 (RE-03 · FAM-05 · b3) - 순수 함수만. 판정은 브라우저에서 서명된 판정표로 하고, 이 모듈은 판정을 만들지 않는다:
// 판정표 고르기, 입력 문자열 -> 사실값, 평가기 호출, 결과 카드 값 만들기뿐이다. 요건·기간·날짜는 판정표(감수 입력)에만 있다.
//  · 취득 원인마다 판정표 종류가 다르다: 매매 = house_count(목록 집계형), 상속 = house_count_inheritance, 증여 = house_count_gift(결론형). 서로 다른 표다.
//  · "모르겠어요" = 값 없음(undefined). 기본 가정으로 채우지 않는다. 빈 목록([])은 "하나도 없음"이라는 답이고 모름이 아니다.

export type HouseCountCause = "PAID" | "INHERITANCE" | "GIFT";
export const HOUSE_COUNT_CAUSES: readonly HouseCountCause[] = ["PAID", "INHERITANCE", "GIFT"];
export const HOUSE_COUNT_KIND: Readonly<Record<HouseCountCause, "house_count" | "house_count_inheritance" | "house_count_gift">> = {
  PAID: "house_count",
  INHERITANCE: "house_count_inheritance",
  GIFT: "house_count_gift",
};
export const HOUSE_COUNT_CAUSE_LABEL: Readonly<Record<HouseCountCause, string>> = { PAID: "매매로 취득", INHERITANCE: "상속으로 취득", GIFT: "증여로 취득" };

export type HouseCountTable = ListCountTable | ConclusionTable;

/** 서명(활성)된 판정표 행에서 원인에 맞는 표를 고른다 - 없거나 모양이 틀리면 null(그 판정은 열리지 않는다) */
export function pickHouseCountTable(rows: readonly { kind: string; body: unknown }[], cause: HouseCountCause): HouseCountTable | null {
  const kind = HOUSE_COUNT_KIND[cause];
  const row = rows.find((r) => r.kind === kind);
  if (!row) return null;
  try {
    const t = parseTableByKind(kind, row.body);
    return t.kind === kind ? (t as HouseCountTable) : null;
  } catch {
    return null;
  }
}

/** 어떤 원인의 판정이 열려 있나 (FAM-05 링크 카드·화면 선택지) */
export const openCauses = (rows: readonly { kind: string; body: unknown }[]): HouseCountCause[] => HOUSE_COUNT_CAUSES.filter((c) => pickHouseCountTable(rows, c) !== null);

/** 입력 글자 -> 사실값. 빈 글자·"모르겠어요"는 값 없음 */
export function parseFactText(text: string): FactValue | undefined {
  const t = text.trim();
  if (t === "" || t === "모르겠어요") return undefined;
  if (t === "예" || t === "true") return true;
  if (t === "아니요" || t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export interface FactQuestion {
  scope: "fact" | "entry";
  id: string;
  label: string;
}

/** 판정표가 요구하는 입력 칸 - 칸 이름과 문장은 판정표에서만 온다 */
export function questionsOf(table: HouseCountTable): FactQuestion[] {
  return table.kind === "house_count" ? table.entry_required.map((r) => ({ scope: "entry" as const, id: r.id, label: r.label })) : table.required.map((r) => ({ scope: "fact" as const, id: r.id, label: r.label }));
}

export interface HouseCountForm {
  /** 결론형 표의 사실 (목록 집계형에서는 목록 밖 사실) */
  facts: Readonly<Record<string, FactValue | undefined>>;
  /** 목록 집계형 표의 보유 목록. undefined = 목록을 모른다 */
  entries?: readonly Readonly<Record<string, FactValue | undefined>>[];
}

export interface HouseCountJudgement {
  tableKind: HouseCountTable["kind"];
  tableLabel: string;
  tableVersion: string;
  status: "결론" | "요건 확인 필요" | "표에 없는 경우";
  conclusion: { text: string; basis?: string } | null;
  missing: readonly { id: string; label: string }[];
  /** 센 개수 - 목록 집계형이고 상태가 결론일 때만. RE-04가 넘기는 값 */
  count: number | null;
}

export function judgeHouseCount(table: HouseCountTable, form: HouseCountForm): HouseCountJudgement {
  const out: ListCountOutcome | ConclusionOutcome = table.kind === "house_count" ? evaluateListCountTable(table, form.entries, form.facts) : evaluateConclusionTable(table, form.facts);
  return {
    tableKind: table.kind,
    tableLabel: table.label,
    tableVersion: out.tableVersion,
    status: out.status,
    conclusion: out.conclusion ? { text: out.conclusion.text, ...(out.conclusion.basis ? { basis: out.conclusion.basis } : {}) } : null,
    missing: out.missing,
    count: out.kind === "list_count" && out.status === "결론" ? out.count : null,
  };
}
