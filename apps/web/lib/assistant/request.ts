// 도우미 요청 스키마 — 순수 검사 (CHAT-06 · CHAT-08). 모르는 칸이 있으면 거부한다 — 브라우저가 본문·쿼리·폼 값을 몰래 실어 보내는 길을 막는다.
// 페이지 맥락은 경로·제목·분야 세 칸뿐이다. 쿼리 문자열·조각이 붙은 경로, 관리·내부 경로는 맥락 없이 처리한다.
import { ASSISTANT_DEFAULTS } from "./config";
import type { PageContext } from "./pipeline";

export const SECTION_CODES = ["tax", "realestate", "local", "finance"] as const;

export interface AssistantRequest {
  message: string;
  sessionId: string | null;
  context: PageContext | undefined;
  noticeVersion: string;
}

export type ParsedRequest = { ok: true; value: AssistantRequest } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEYS = new Set(["message", "sessionId", "context", "noticeVersion"]);
const CONTEXT_KEYS = new Set(["path", "title", "field"]);

/** 맥락 경로로 쓸 수 있는 공개 경로인가 — 쿼리·조각·관리·API 경로·이중 슬래시 제외 */
export function usableContextPath(path: string): boolean {
  return /^\/[A-Za-z0-9\-._~%/가-힣]{0,199}$/u.test(path) && !path.includes("//") && !/^\/(admin|api|_)/u.test(path);
}

export function parseAssistantRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "요청 모양이 틀립니다" };
  const o = body as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !KEYS.has(k));
  if (extra) return { ok: false, error: `알 수 없는 칸: ${extra}` };
  if (typeof o.message !== "string") return { ok: false, error: "질문(message)이 필요합니다" };
  const message = o.message.trim();
  if (message === "" || Array.from(message).length > ASSISTANT_DEFAULTS.maxQuestionChars) return { ok: false, error: `질문은 1~${ASSISTANT_DEFAULTS.maxQuestionChars}자입니다` };
  if (typeof o.noticeVersion !== "string" || o.noticeVersion === "" || o.noticeVersion.length > 40) return { ok: false, error: "고지 확인(noticeVersion)이 필요합니다" };
  if (o.sessionId !== undefined && o.sessionId !== null && (typeof o.sessionId !== "string" || !UUID.test(o.sessionId))) return { ok: false, error: "세션 값이 틀립니다" };

  let context: PageContext | undefined;
  if (o.context !== undefined && o.context !== null) {
    if (typeof o.context !== "object" || Array.isArray(o.context)) return { ok: false, error: "맥락 모양이 틀립니다" };
    const c = o.context as Record<string, unknown>;
    const bad = Object.keys(c).find((k) => !CONTEXT_KEYS.has(k));
    if (bad) return { ok: false, error: `맥락에 알 수 없는 칸: ${bad}` };
    if (typeof c.path !== "string") return { ok: false, error: "맥락 경로(path)가 필요합니다" };
    if (c.title !== undefined && (typeof c.title !== "string" || c.title.length > 120)) return { ok: false, error: "맥락 제목이 틀립니다" };
    if (c.field !== undefined && !(typeof c.field === "string" && (SECTION_CODES as readonly string[]).includes(c.field))) return { ok: false, error: "맥락 분야 코드가 틀립니다" };
    // 쿼리·조각이 붙었거나 비공개 경로면 맥락을 버리고 계속한다 (오류 화면 0)
    if (usableContextPath(c.path)) context = { path: c.path, ...(typeof c.title === "string" ? { title: c.title } : {}), ...(typeof c.field === "string" ? { field: c.field } : {}) };
  }
  return { ok: true, value: { message, sessionId: (o.sessionId as string | null | undefined) ?? null, context, noticeVersion: o.noticeVersion } };
}
