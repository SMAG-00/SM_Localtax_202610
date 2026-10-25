// 설정 저장 검사 (W10-i) - home_shortcut_copy · campaign_utm_values. DB 트리거 w10i_settings_guard와 같은 규칙 (시험 settings-check.test.ts)
const COPY_KEYS = ["calc", "expert_request", "brief_weekly", "realestate_weekly"] as const;
const UTM_KEYS = ["source", "medium", "content"] as const;
export const SHORTCUT_COPY_MAX = 30;
export const UTM_LIST_MAX = 20;
const UTM_VALUE = /^[a-z0-9][a-z0-9_-]{0,19}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function shortcutCopyErrors(value: unknown): string[] {
  if (!isObj(value)) return ["객체여야 합니다"];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (!(COPY_KEYS as readonly string[]).includes(k)) out.push(`${k}: 아는 키(${COPY_KEYS.join("·")})가 아닙니다`);
    else if (typeof v !== "string" || v.trim().length > SHORTCUT_COPY_MAX || /[\r\n]/.test(v)) out.push(`${k}: ${SHORTCUT_COPY_MAX}자 이하 한 줄 글자여야 합니다`);
  }
  return out;
}

export function utmRegistryErrors(value: unknown): string[] {
  if (!isObj(value)) return ["객체여야 합니다"];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (!(UTM_KEYS as readonly string[]).includes(k)) {
      out.push(`${k}: 아는 키(${UTM_KEYS.join("·")})가 아닙니다`);
      continue;
    }
    if (!Array.isArray(v) || v.length > UTM_LIST_MAX) {
      out.push(`${k}: ${UTM_LIST_MAX}개 이하 목록이어야 합니다`);
      continue;
    }
    for (const e of v) if (typeof e !== "string" || !UTM_VALUE.test(e) || e === "other") out.push(`${k}: '${String(e)}'은 쓸 수 없는 값입니다 (소문자·숫자·-·_ 20자 이하, other 제외)`);
  }
  return out;
}
