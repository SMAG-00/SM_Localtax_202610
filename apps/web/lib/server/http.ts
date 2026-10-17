import "server-only";
import { mapDbError, type DbErrorLike } from "./db-errors";

// 편집국 API 공용 — JSON 응답, 요청 본문 읽기, 오류 → 응답 변환. 스택·SQL 원문은 응답에 넣지 않는다.

/** 응답으로 바뀌는 오류 — 어디서 던져도 handle()이 같은 모양의 JSON으로 바꾼다 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function errorJson(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, status);
}

/** Supabase(PostgREST) 오류를 HttpError로 — 제약·트리거 문장은 409·422, 나머지는 500 */
export function dbError(error: DbErrorLike, context: string): HttpError {
  const mapped = mapDbError(error);
  if (mapped.status >= 500) console.error(`[db] ${context}:`, error.code, error.message);
  return new HttpError(mapped.status, mapped.message, mapped.constraint ? { constraint: mapped.constraint } : {});
}

const MAX_BODY_CHARS = 1_000_000;

/** 본문이 JSON 객체여야 한다 — 아니면 400. 본문이 있으면 content-type이 application/json이어야 한다(다른 사이트의 단순 POST 차단) */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  const text = await request.text().catch(() => {
    throw new HttpError(400, "요청 본문을 읽지 못했습니다");
  });
  if (text.length > MAX_BODY_CHARS) throw new HttpError(413, "요청 본문이 너무 큽니다");
  if (text.trim() !== "" && !(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "요청 본문은 application/json이어야 합니다");
  }
  try {
    value = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new HttpError(400, "요청 본문이 JSON 형식이 아닙니다");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new HttpError(400, "요청 본문은 JSON 객체여야 합니다");
  return value as Record<string, unknown>;
}

/** 경로의 숫자 ID — 숫자가 아니면 404 */
export function parseId(raw: string, what = "기사"): number {
  if (!/^[1-9]\d{0,15}$/.test(raw)) throw new HttpError(404, `${what}를 찾을 수 없습니다`);
  return Number(raw);
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** 라우트 처리기 감싸기 — HttpError는 그 응답으로, 예상 못 한 오류는 500(내용 숨김)으로 */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (err) {
      if (err instanceof HttpError) return errorJson(err.status, err.message, err.extra);
      console.error("[api] 처리 중 오류:", err instanceof Error ? err.message : String(err));
      return errorJson(500, "서버 오류가 났습니다 — 잠시 뒤 다시 시도하세요");
    }
  };
}
