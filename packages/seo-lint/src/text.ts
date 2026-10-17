// 패널 문구 규칙 (OPT-03 · PRD-00 8.6 '최적화 점검 패널')

/** 점수 옆 고정 문구 (PRD-00 8.6). 금지어가 들어가도 되는 유일한 패널 문구다 */
export const SCORE_DISCLAIMER = "내부 품질 지표 — 검색 순위 예측이 아닙니다";

/** 패널·대시보드 문구에 쓰지 않는 낱말 (OPT-03 수용 기준). 규칙 파일을 읽을 때 이 낱말이 든 문구를 거부한다 */
export const FORBIDDEN_PANEL_WORDS = ["순위", "노출 예측", "상위 노출"] as const;

export type Vars = Readonly<Record<string, string | number>>;

/** 문구 속 금지어 — 없으면 undefined */
export function forbiddenWordIn(text: string): string | undefined {
  return FORBIDDEN_PANEL_WORDS.find((w) => text.includes(w));
}

/** 규칙 파일 문구의 {이름} 자리를 채운다. 값이 없는 자리는 그대로 둔다 */
export function fill(template: string, vars: Vars = {}): string {
  return template.replace(/\{([A-Za-z.]+)\}/g, (whole, key: string) => (Object.hasOwn(vars, key) ? String(vars[key]) : whole));
}
