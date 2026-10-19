// 회원·시도 제한·보존 기한 설정의 읽기와 검사 (W2-e 설계 2.2) — 순수 모듈.
//  · parse*는 서버가 DB settings 값을 읽을 때 쓴다 — 모양이 틀리면 null(호출하는 쪽이 닫는다: 한도를 모르는 채로 열지 않는다)
//  · check*Setting은 운영 설정 화면(settings-rules)이 쓴다 — 같은 규칙, 틀린 곳마다 문장
//  · 범위는 DB 함수(throttle_args_check)·트리거(profiles_guard)와 같은 안전 범위다. 설계 문서 2.2 블록 = DB 씨앗 = 이 검사를 통과하는 값 (시험이 확인한다)

export const THROTTLE_SCOPES = [
  "login_pair",
  "login_account",
  "login_ip",
  "password_change",
  "signup_ip",
  "signup_email",
  "reset_ip",
  "reset_email",
  "form_ip",
  "brief_ip",
  "brief_email",
  "confirm_resend",
] as const;
export type ThrottleScope = (typeof THROTTLE_SCOPES)[number];

export interface ThrottleLimit {
  /** 창 길이(초) — 첫 시도 때 열려 이 시간 동안 간다 */
  window: number;
  /** 그 창에서 허용하는 횟수 — 이 횟수까지 허용, 다음 번부터 차단 */
  limit: number;
}
export type AuthLimits = Readonly<Record<ThrottleScope, ThrottleLimit>>;

export interface MemberSettings {
  interestRegionLimit: number;
  interestMax: number;
  displayNameChars: number;
  signupConfirmHours: number;
  passwordMinChars: number;
  passwordMaxBytes: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export const AUTH_WINDOW_RANGE = [1, 86400] as const;
export const AUTH_LIMIT_RANGE = [1, 100000] as const;

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** 값을 바꿨는데 version이 그대로면 문장 — 점검·기록에 남는 버전이 값과 어긋나지 않게 (다른 버전 있는 설정과 같은 규칙) */
function versionErrors(value: Obj, current: unknown, errors: string[]): void {
  if (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80) errors.push("version: 버전 글자가 필요합니다");
  if (errors.length === 0 && isObj(current) && value.version === current.version) {
    const next = { ...value };
    const now = { ...current };
    delete next.version;
    delete now.version;
    if (!sameJson(next, now)) errors.push(`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
}

function exactKeys(value: Obj, keys: readonly string[], errors: string[]): void {
  for (const k of keys) if (value[k] === undefined) errors.push(`${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) errors.push(`${k}: 모르는 칸입니다`);
}

// ── auth_limits ──

export function checkAuthLimitsSetting(value: unknown, current: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", ...THROTTLE_SCOPES], errors);
  for (const scope of THROTTLE_SCOPES) {
    const entry = value[scope];
    if (entry === undefined) continue;
    if (!isObj(entry)) {
      errors.push(`${scope}: { "window": 초, "limit": 횟수 } 모양이어야 합니다`);
      continue;
    }
    for (const k of Object.keys(entry)) if (k !== "window" && k !== "limit") errors.push(`${scope}.${k}: 모르는 칸입니다`);
    if (!isInt(entry.window, AUTH_WINDOW_RANGE[0], AUTH_WINDOW_RANGE[1])) errors.push(`${scope}.window: ${AUTH_WINDOW_RANGE[0]}~${AUTH_WINDOW_RANGE[1]}초 정수여야 합니다`);
    if (!isInt(entry.limit, AUTH_LIMIT_RANGE[0], AUTH_LIMIT_RANGE[1])) errors.push(`${scope}.limit: ${AUTH_LIMIT_RANGE[0]}~${AUTH_LIMIT_RANGE[1]}회 정수여야 합니다`);
  }
  versionErrors(value, current, errors);
  return errors;
}

/** DB 값 → 범위별 한도. 모양이 틀리면 null (로그인 등은 닫는다) */
export function parseAuthLimits(value: unknown): AuthLimits | null {
  if (!isObj(value) || checkAuthLimitsSetting(value, null).length > 0) return null;
  const out: Partial<Record<ThrottleScope, ThrottleLimit>> = {};
  for (const scope of THROTTLE_SCOPES) {
    const entry = value[scope] as Obj;
    out[scope] = { window: entry.window as number, limit: entry.limit as number };
  }
  return out as AuthLimits;
}

// ── member ──

const MEMBER_FIELDS = {
  interest_region_limit: [1, 20],
  interest_max: [1, 50],
  display_name_chars: [1, 30], // DB check가 30글자 이하다 — 설정이 그보다 크면 저장이 거부된다
  signup_confirm_hours: [1, 168],
  password_min_chars: [8, 72],
  password_max_bytes: [10, 72], // bcrypt가 72바이트까지만 읽는다
} as const satisfies Record<string, readonly [number, number]>;

export function checkMemberSetting(value: unknown, current: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", ...Object.keys(MEMBER_FIELDS)], errors);
  for (const [name, [min, max]] of Object.entries(MEMBER_FIELDS)) {
    if (value[name] !== undefined && !isInt(value[name], min, max)) errors.push(`${name}: ${min}~${max} 정수여야 합니다`);
  }
  if (isInt(value.password_min_chars, 8, 72) && isInt(value.password_max_bytes, 10, 72) && value.password_min_chars > value.password_max_bytes) {
    errors.push("password_min_chars: 최대 바이트보다 클 수 없습니다");
  }
  versionErrors(value, current, errors);
  return errors;
}

export function parseMemberSettings(value: unknown): MemberSettings | null {
  if (!isObj(value) || checkMemberSetting(value, null).length > 0) return null;
  return {
    interestRegionLimit: value.interest_region_limit as number,
    interestMax: value.interest_max as number,
    displayNameChars: value.display_name_chars as number,
    signupConfirmHours: value.signup_confirm_hours as number,
    passwordMinChars: value.password_min_chars as number,
    passwordMaxBytes: value.password_max_bytes as number,
  };
}

// ── privacy_retention ──

const RETENTION_FIELDS = {
  unconfirmed_signup_days: [1, 365],
  unconfirmed_consent_days: [1, 365],
  revoked_consent_days: [1, 365],
  inquiry_contact_days: [1, 3650],
  inquiry_attachment_days: [1, 3650],
  throttle_hours: [1, 8760], // 가장 긴 시도 창(auth_limits)보다 길어야 한다 — DB throttle_purge가 1시간 미만을 받지 않는다
} as const satisfies Record<string, readonly [number, number]>;

export function checkPrivacyRetentionSetting(value: unknown, current: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", ...Object.keys(RETENTION_FIELDS)], errors);
  for (const [name, [min, max]] of Object.entries(RETENTION_FIELDS)) {
    if (value[name] !== undefined && !isInt(value[name], min, max)) errors.push(`${name}: ${min}~${max} 정수여야 합니다`);
  }
  versionErrors(value, current, errors);
  return errors;
}
