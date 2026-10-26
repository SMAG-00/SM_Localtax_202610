// 보안 정책 페이지(SEC-01, W12-g) 순수 규칙. 이 모듈에 보안 정책 문구는 없다 - 7개 항목의 이름(PRD 항목명)과 입력 모양 검사, 인증 단정 표현 문구 검사만 있다.
import { detectPii } from "@ltr/editorial";

export const SECURITY_ITEM_KEYS = ["data_location", "encryption", "access_control", "ai_provider_data", "calc_input_not_stored", "conversation_retention", "vulnerability_contact"] as const;
export type SecurityItemKey = (typeof SECURITY_ITEM_KEYS)[number];
export const SECURITY_ITEM_TITLES: Record<SecurityItemKey, string> = {
  data_location: "데이터 위치",
  encryption: "암호화",
  access_control: "접근 통제",
  ai_provider_data: "AI 제공사 데이터 정책",
  calc_input_not_stored: "계산 입력값 미저장",
  conversation_retention: "대화 보존·파기",
  vulnerability_contact: "취약점 신고 연락처",
};
export const isSecurityItemKey = (v: unknown): v is SecurityItemKey => typeof v === "string" && (SECURITY_ITEM_KEYS as readonly string[]).includes(v);

/** 인증 단정 표현 낱말 조합 - DB 함수 security_text_violations(마이그레이션 177)와 같은 목록 (시험이 대조). 목록 추가는 양쪽을 함께 */
export const CERT_CLAIM_PATTERNS: readonly string[] = [
  "인증\\s*(획득|취득|완료|보유)",
  "인증(을|은)?\\s*받(은|았|아)",
  "인증된\\s*보안",
  "27001[^.]{0,12}(준수|적합|부합)",
  "(100%|완벽|절대)[^.]{0,6}(안전|보안|보호)",
];
/** 걸린 패턴 목록 (없으면 빈 배열) */
export const findCertClaims = (text: string): string[] => CERT_CLAIM_PATTERNS.filter((p) => new RegExp(p).test(text)).sort();

export const SECURITY_ENTRIES = ["footer", "agent", "direct", "search"] as const;
export type SecurityEntry = (typeof SECURITY_ENTRIES)[number];
export const parseSecurityEntry = (v: unknown): SecurityEntry => ((SECURITY_ENTRIES as readonly string[]).includes(String(v)) ? (v as SecurityEntry) : "direct");

export interface SecurityItemView {
  item_key: SecurityItemKey;
  body: string;
  confirmed_on: string;
}
/** 화면 열림 판정(이중 방어) - 7개 항목이 모두 있고 확인일이 있고 단정 표현이 없을 때만 true. 뷰가 이미 같은 조건을 걸지만 화면도 다시 본다 */
export function securityPageReady(items: readonly SecurityItemView[]): boolean {
  const keys = new Set(items.map((i) => i.item_key));
  return SECURITY_ITEM_KEYS.every((k) => keys.has(k)) && items.every((i) => i.body.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(i.confirmed_on) && findCertClaims(i.body).length === 0);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const SECURITY_OPS = ["draft", "publish", "retire", "check", "complete_round"] as const;

export interface ItemDraftInput {
  item_key: SecurityItemKey;
  body: string;
  confirmed_on: string;
  contract_verified: boolean;
}
export function parseItemDraft(body: Record<string, unknown>): Parsed<ItemDraftInput> {
  const errors: string[] = [];
  const key = str(body.item_key);
  if (!isSecurityItemKey(key)) errors.push(`item_key: ${SECURITY_ITEM_KEYS.join("·")} 중 하나입니다`);
  const text = str(body.body);
  if (text.length < 1 || text.length > 4000) errors.push("body: 1~4000자입니다");
  const claims = findCertClaims(text);
  if (claims.length > 0) errors.push("body: 인증을 받은 것으로 읽히는 표현이 있습니다 (인증 취득 전에는 쓸 수 없습니다)");
  if (text && detectPii(text).some((m) => m.kind !== "phone" && m.kind !== "email")) errors.push("body: 개인정보로 보이는 글자가 있습니다 (신고 연락처의 전화·이메일은 허용)");
  const date = str(body.confirmed_on);
  if (!isDate(date)) errors.push("confirmed_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  const cv = body.contract_verified === true || body.contract_verified === "true" || body.contract_verified === "on";
  return errors.length ? fail(errors) : { ok: true, value: { item_key: key as SecurityItemKey, body: text, confirmed_on: date, contract_verified: cv } };
}

export interface CheckInput {
  round_no: number;
  control_key: string;
  control_title: string;
  result: "met" | "gap" | "na";
  checked_on: string;
  gap_plan: string | null;
  due_on: string | null;
}
export function parseCheck(body: Record<string, unknown>): Parsed<CheckInput> {
  const errors: string[] = [];
  const round = posInt(body.round_no);
  if (round === null) errors.push("round_no: 점검 회차(1 이상 정수)입니다");
  const ck = str(body.control_key);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(ck)) errors.push("control_key: 영문 소문자로 시작하는 소문자·숫자·'_' 2~40자입니다");
  const title = str(body.control_title);
  if (title.length < 1 || title.length > 120) errors.push("control_title: 1~120자입니다");
  const result = str(body.result);
  if (result !== "met" && result !== "gap" && result !== "na") errors.push("result: met·gap·na 중 하나입니다");
  const on = str(body.checked_on);
  if (!isDate(on)) errors.push("checked_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  const plan = str(body.gap_plan);
  const due = str(body.due_on);
  if (plan.length > 1000) errors.push("gap_plan: 1000자 이하입니다");
  if (due !== "" && !isDate(due)) errors.push("due_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  if (result === "gap" && (plan === "" || due === "")) errors.push("gap_plan·due_on: 미흡 항목은 조치 계획과 기한이 필요합니다");
  return errors.length ? fail(errors) : { ok: true, value: { round_no: round as number, control_key: ck, control_title: title, result: result as CheckInput["result"], checked_on: on, gap_plan: plan || null, due_on: due || null } };
}

export function parseId(body: Record<string, unknown>, what: string): Parsed<{ id: number }> {
  const id = posInt(body.id);
  return id === null ? fail([`id: ${what} 번호(1 이상 정수)입니다`]) : { ok: true, value: { id } };
}
export function parseRound(body: Record<string, unknown>): Parsed<{ round: number }> {
  const r = posInt(body.round_no);
  return r === null ? fail(["round_no: 점검 회차(1 이상 정수)입니다"]) : { ok: true, value: { round: r } };
}
