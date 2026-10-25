// 위택스 공식 이용 안내 (WETAX-02) - 출처와 확인일이 둘 다 있는 항목만 보인다(원칙 13). 값(이용 시간·문의처)은 편집자가 출처와 함께 넣고 이 코드에는 없다.
export interface GuideRow {
  key: string;
  label: string;
  body: string;
  source: string | null;
  confirmed_on: string | null;
}

/** 렌더해도 되는 항목 - 출처·확인일이 비어 있으면 뺀다 */
export function visibleGuides(rows: readonly GuideRow[]): GuideRow[] {
  return rows.filter((r) => (r.source ?? "").trim() !== "" && r.confirmed_on !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.confirmed_on) && r.label.trim() !== "" && r.body.trim() !== "");
}

/** 재확인 기준 - 확인일로부터 이 일수를 넘기면 백오피스 재확인 항목 (91일 0건, 92일 1건 경계) */
export const GUIDE_RECHECK_AFTER_DAYS = 91;
const DAY = 86_400_000;

export function guideAgeDays(confirmedOn: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${confirmedOn}T00:00:00Z`)) / DAY);
}

export const needsRecheck = (row: Pick<GuideRow, "confirmed_on">, today: string): boolean => row.confirmed_on === null || guideAgeDays(row.confirmed_on, today) > GUIDE_RECHECK_AFTER_DAYS;
