// 계산·감면·판정 카드의 고정 문구 자리 - 순수 (W12-c). 문구는 PO·감수 입력이다(법령 문장·요건·안내 문구를 코드에 쓰지 않는다).
// 출하 기본값은 모두 빈 칸이고, 시험에서만 `시험용` 문구를 채워 쓴다. 비어 있으면 공개 단계 승인 전 점검에서 걸린다(calcCopyReady).

export const CALC_COPY_KEYS = ["calc_notice", "benefits_notice", "determination_notice", "unsupported_note", "igt_card_note"] as const;
export type CalcCopyKey = (typeof CALC_COPY_KEYS)[number];
export type CalcCopy = Readonly<Record<CalcCopyKey, string>>;

export const EMPTY_CALC_COPY: CalcCopy = Object.fromEntries(CALC_COPY_KEYS.map((k) => [k, ""])) as unknown as CalcCopy;
export const calcCopyReady = (c: CalcCopy): boolean => CALC_COPY_KEYS.every((k) => c[k].trim() !== "");
export const missingCalcCopy = (c: CalcCopy): CalcCopyKey[] => CALC_COPY_KEYS.filter((k) => c[k].trim() === "");

/** 시험 파일에서만 쓴다 */
export const testCalcCopy = (): CalcCopy => Object.fromEntries(CALC_COPY_KEYS.map((k) => [k, `[시험용] ${k} 안내`])) as unknown as CalcCopy;
