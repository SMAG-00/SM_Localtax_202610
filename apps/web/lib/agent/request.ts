// /api/ask 요청 스키마 - 순수 (W12-b b6). 모르는 칸이 있으면 거부한다 - 브라우저가 입력 구조체·기관 정보를 몰래 실어 보내는 길을 막는다.
// 역질문 답은 슬롯 ID와 선택지 ID뿐이다(자유 글 0).
import { ASSISTANT_DEFAULTS } from "../assistant/config";
import { parseEntryId } from "./entry";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ID = /^[a-z0-9_-]{1,40}$/u;
const KEYS = new Set(["message", "sessionId", "mode", "entry", "clarifyAnswers", "saveOff", "entryId"]);
export const ENTRIES = ["mode_switch", "search_results", "law", "case", "calc", "article", "step", "issue_map"] as const;
export type Entry = (typeof ENTRIES)[number];

export interface AskRequest {
  message: string;
  sessionId: string | null;
  mode: "general" | "expert";
  entry: Entry | null;
  clarifyAnswers: Record<string, string>;
  /** 이 세션의 글을 서버에 저장하지 않는다 (ASK-12 저장 끄기) */
  saveOff: boolean;
  /** 진입한 맥락 ID(조문·결정례·기사·단계·쟁점) - 첫 질문에만 붙는다 (ASK-13) */
  entryId: string | null;
}
export type ParsedAsk = { ok: true; value: AskRequest } | { ok: false; error: string };

export function parseAskRequest(body: unknown): ParsedAsk {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, error: "요청 모양이 틀립니다" };
  const o = body as Record<string, unknown>;
  const extra = Object.keys(o).find((k) => !KEYS.has(k));
  if (extra) return { ok: false, error: `알 수 없는 칸: ${extra}` };
  if (typeof o.message !== "string") return { ok: false, error: "질문(message)이 필요합니다" };
  const message = o.message.trim();
  // 질문 길이 상한은 도우미와 같은 값을 쓴다 (입력 검사 코드 경로 하나)
  if (message === "" || Array.from(message).length > ASSISTANT_DEFAULTS.maxQuestionChars) return { ok: false, error: `질문은 1~${ASSISTANT_DEFAULTS.maxQuestionChars}자입니다` };
  if (o.sessionId !== undefined && o.sessionId !== null && (typeof o.sessionId !== "string" || !UUID.test(o.sessionId))) return { ok: false, error: "세션 값이 틀립니다" };
  const mode = o.mode === undefined ? "general" : o.mode;
  if (mode !== "general" && mode !== "expert") return { ok: false, error: "모드 값이 틀립니다" };
  if (o.entry !== undefined && o.entry !== null && !(ENTRIES as readonly unknown[]).includes(o.entry)) return { ok: false, error: "진입점 값이 틀립니다" };
  const answers: Record<string, string> = {};
  if (o.clarifyAnswers !== undefined) {
    if (!Array.isArray(o.clarifyAnswers) || o.clarifyAnswers.length > 6) return { ok: false, error: "역질문 답 모양이 틀립니다" };
    for (const a of o.clarifyAnswers) {
      const r = a as { slot?: unknown; value?: unknown };
      if (typeof a !== "object" || a === null || typeof r.slot !== "string" || typeof r.value !== "string" || !ID.test(r.slot) || !ID.test(r.value)) return { ok: false, error: "역질문 답 모양이 틀립니다" };
      answers[r.slot] = r.value;
    }
  }
  const entryId = parseEntryId(o.entryId);
  if (entryId === "invalid") return { ok: false, error: "맥락 ID 값이 틀립니다" };
  if (o.saveOff !== undefined && typeof o.saveOff !== "boolean") return { ok: false, error: "저장 끄기 값이 틀립니다" };
  return { ok: true, value: { message, sessionId: (o.sessionId as string | null | undefined) ?? null, mode, entry: (o.entry as Entry | null | undefined) ?? null, clarifyAnswers: answers, saveOff: o.saveOff === true, entryId } };
}
