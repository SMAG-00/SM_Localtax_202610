// 편집국 AI 관리 입력 검사 (W12-f - /api/admin/ai-desk). 모양만 검사하고 판단은 DB 함수가 한다.
import { CHANNELS, type Channel } from "@ltr/workflows/ops";

export const DESK_OPS = ["approve_summary", "reject_summary", "approve_tag", "approve_box", "reject_box", "make_box", "approve_banner", "reject_banner", "retire_banner", "make_channels"] as const;
export type DeskOp = (typeof DESK_OPS)[number];

/** 권한 - 결정례 요지·AI 태그는 case_summary.approve, 상자·배너·채널 원고는 ai_box.approve */
export const DESK_ACTION: Record<DeskOp, "case_summary.approve" | "ai_box.approve"> = {
  approve_summary: "case_summary.approve",
  reject_summary: "case_summary.approve",
  approve_tag: "case_summary.approve",
  approve_box: "ai_box.approve",
  reject_box: "ai_box.approve",
  make_box: "ai_box.approve",
  approve_banner: "ai_box.approve",
  reject_banner: "ai_box.approve",
  retire_banner: "ai_box.approve",
  make_channels: "ai_box.approve",
};

/** 요지·상자 승인 때 편집자가 확인하는 체크 키 - DB가 종류별로 같은 목록을 요구한다(review_required_checks) */
export const CHECK_KEYS: Record<"case_summary" | "article_ai_box", readonly string[]> = {
  case_summary: ["original_compared", "numbers_dates_links", "no_personal_info", "case_facts_from_source"],
  article_ai_box: ["original_compared", "numbers_dates_links", "no_personal_info", "box_matches_article"],
};
export const CHECK_LABELS: Record<string, string> = {
  original_compared: "원문과 대조했습니다",
  numbers_dates_links: "숫자·일자·링크가 원문과 같습니다",
  no_personal_info: "개인정보가 없습니다",
  case_facts_from_source: "사건번호·일자가 원문 정보에서 왔습니다",
  box_matches_article: "상자 내용이 기사와 같습니다",
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};

export function parseDeskId(body: Record<string, unknown>, field = "id"): Parsed<number> {
  const n = posInt(body[field]);
  return n === null ? { ok: false, errors: [`${field}: 1 이상 정수 번호입니다`] } : { ok: true, value: n };
}

/** 체크 칸(불리언)과 checked 배열 -> 체크한 키 목록. 키 이름은 종류별 목록 안의 것만 받는다 */
export function parseChecked(body: Record<string, unknown>, kind: keyof typeof CHECK_KEYS): string[] {
  const keys = CHECK_KEYS[kind];
  const fromArray = Array.isArray(body.checked) ? body.checked.filter((k): k is string => typeof k === "string") : [];
  const fromFlags = keys.filter((k) => body[k] === true);
  return [...new Set([...fromArray, ...fromFlags])].filter((k) => keys.includes(k));
}

export function parseReason(body: Record<string, unknown>): Parsed<string> {
  const r = typeof body.reason === "string" ? body.reason.trim() : "";
  if (r === "") return { ok: false, errors: ["reason: 사유가 필요합니다"] };
  return r.length > 400 ? { ok: false, errors: ["reason: 400자 이내입니다"] } : { ok: true, value: r };
}

export function parseChannels(body: Record<string, unknown>): Parsed<Channel[]> {
  const raw = typeof body.channels === "string" ? body.channels.split(/[,\s]+/).filter(Boolean) : Array.isArray(body.channels) ? body.channels : [];
  const bad = raw.filter((c) => !(CHANNELS as readonly unknown[]).includes(c));
  if (raw.length === 0 || bad.length) return { ok: false, errors: [`channels: ${CHANNELS.join("·")} 중에서 하나 이상입니다`] };
  return { ok: true, value: [...new Set(raw as Channel[])] };
}
