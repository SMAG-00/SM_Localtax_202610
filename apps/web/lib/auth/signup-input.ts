// 가입 입력 검사와 폼 열림 토큰 (W2-e 설계 4.3 · 4.5) — 순수 함수.
//  · 거부 문장은 CODE_MESSAGES 한 표에서 온다(서버 응답과 화면이 같은 문장). 봇 검사는 어느 검사에서 걸렸는지 알리지 않는 한 문장(bot)
//  · 폼 열림 토큰 = `열린 시각(ms).HMAC(열쇠, "signup_fill:" + 열린 시각)` — 너무 빨리(최소 작성 시간 안) 또는 너무 오래(유효 시간 뒤) 제출한 것은 거부
import { createHmac, timingSafeEqual } from "node:crypto";
import { charCount, checkPassword, PASSWORD_PROBLEM_MESSAGES, type PasswordRules } from "./password";

export const CODE_MESSAGES = {
  sent: "확인 메일을 보냈습니다 — 메일함을 확인해 주세요",
  bot: "제출할 수 없습니다 — 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  mail_down: "지금 메일을 보낼 수 없습니다 — 잠시 뒤 다시 시도해 주세요",
  email: "이메일 주소 형식을 확인해 주세요",
  terms: "이용약관과 개인정보 수집·이용에 모두 동의해 주세요",
  display_name: "표시 이름은 1글자 이상, 제한 글자 수 이하로 넣어 주세요 (이메일 모양은 쓸 수 없습니다)",
  interests: "관심 분야·지역 값이 맞지 않습니다 — 목록에서 다시 골라 주세요",
  password_blank: PASSWORD_PROBLEM_MESSAGES.blank,
  password_too_short: PASSWORD_PROBLEM_MESSAGES.too_short,
  password_too_long: PASSWORD_PROBLEM_MESSAGES.too_long,
  password_same_as_email: PASSWORD_PROBLEM_MESSAGES.same_as_email,
  password_repeated: PASSWORD_PROBLEM_MESSAGES.repeated,
  password_common: PASSWORD_PROBLEM_MESSAGES.common,
  password_contains_email: PASSWORD_PROBLEM_MESSAGES.contains_email,
} as const;
export type SignupCode = keyof typeof CODE_MESSAGES;
export const isSignupCode = (v: unknown): v is SignupCode => typeof v === "string" && Object.hasOwn(CODE_MESSAGES, v);

/** 폼 열림 토큰 규칙 (설계 4.5 — 최소 작성 시간 3초 · 유효 2시간) */
export const SIGNUP_MIN_FILL_SECONDS = 3;
export const SIGNUP_FILL_TOKEN_HOURS = 2;

const MAX_EMAIL = 254;
const MAX_PASSWORD_INPUT = 1000;
const MAX_CODE_CHARS = 60;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export interface SignupValue {
  email: string;
  password: string;
  displayName: string | null;
  interests: string[];
  regionCodes: string[];
}
export type SignupParse = { ok: true; value: SignupValue } | { ok: false; code: SignupCode; field: string };
export interface SignupLimits {
  password: PasswordRules;
  displayNameChars: number;
  interestMax: number;
  interestRegionLimit: number;
}

const truthy = (v: unknown) => v === true || v === "on" || v === "true";
function codeList(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= MAX_CODE_CHARS)) return null;
  return [...new Set(v.map((x: string) => x.trim()))];
}

export function parseSignupInput(raw: Record<string, unknown>, limits: SignupLimits): SignupParse {
  const email = typeof raw.email === "string" ? raw.email.trim().toLowerCase() : "";
  if (email === "" || email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email)) return { ok: false, code: "email", field: "email" };
  const password = typeof raw.password === "string" ? raw.password : "";
  if (password.length > MAX_PASSWORD_INPUT) return { ok: false, code: "password_too_long", field: "password" };
  const pw = checkPassword(password, email, limits.password);
  if (!pw.ok) return { ok: false, code: `password_${pw.problem}` as SignupCode, field: "password" };
  if (!truthy(raw.agreeTerms) || !truthy(raw.agreePrivacy)) return { ok: false, code: "terms", field: "agreeTerms" };
  let displayName: string | null = null;
  if (raw.displayName !== undefined && raw.displayName !== null && raw.displayName !== "") {
    const name = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
    if (name === "" || charCount(name) > limits.displayNameChars || EMAIL_IN_TEXT.test(name.normalize("NFKC"))) return { ok: false, code: "display_name", field: "displayName" };
    displayName = name;
  }
  const interests = codeList(raw.interests);
  const regionCodes = codeList(raw.regionCodes);
  if (!interests || !regionCodes || interests.length > limits.interestMax || regionCodes.length > limits.interestRegionLimit) return { ok: false, code: "interests", field: "interests" };
  return { ok: true, value: { email, password, displayName, interests, regionCodes } };
}

const sign = (secret: string, openedMs: number) => createHmac("sha256", secret).update(`signup_fill:${openedMs}`).digest("hex").slice(0, 32);

export function signFillToken(secret: string, openedMs: number): string {
  if (secret === "") throw new Error("해시 열쇠가 비어 있습니다");
  return `${openedMs}.${sign(secret, openedMs)}`;
}

export type FillCheck = "ok" | "bad" | "too_fast" | "expired";
export function checkFillToken(secret: string, token: unknown, nowMs: number): FillCheck {
  if (typeof token !== "string") return "bad";
  const m = /^(\d{10,15})\.([0-9a-f]{32})$/.exec(token);
  if (!m) return "bad";
  const opened = Number(m[1]);
  const given = Buffer.from(m[2]);
  const expected = Buffer.from(sign(secret, opened));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return "bad";
  const elapsed = (nowMs - opened) / 1000;
  if (elapsed < SIGNUP_MIN_FILL_SECONDS) return "too_fast";
  if (elapsed > SIGNUP_FILL_TOKEN_HOURS * 3600) return "expired";
  return "ok";
}
