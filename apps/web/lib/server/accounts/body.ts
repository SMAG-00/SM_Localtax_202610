import "server-only";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson } from "@/lib/server/http";

/** 계정 API 공통 — Origin 필수·같은 사이트, JSON 또는 폼 본문에서 문자열 칸만 읽는다(모르는 칸은 버린다). 거부면 Response */
export async function readAccountBody(request: Request, names: readonly string[]): Promise<{ isForm: boolean; fields: Record<string, string> } | Response> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const text = await request.text();
  if (text.length > 5000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  const fields: Record<string, string> = {};
  if (isForm) {
    const p = new URLSearchParams(text);
    for (const n of names) fields[n] = p.get(n) ?? "";
  } else {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 형식이 아닙니다");
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
    const obj = v as Record<string, unknown>;
    for (const n of names) fields[n] = typeof obj[n] === "string" ? obj[n] : "";
  }
  return { isForm, fields };
}

export const redirect303 = (location: string, headers: Record<string, string> = {}): Response => new Response(null, { status: 303, headers: { location, ...headers } });
