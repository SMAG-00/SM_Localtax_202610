// 편집국 화면 → 편집국 API (/api/admin/…) 호출 도구. 쿠키 세션(같은 사이트)으로 부르고, 본문은 JSON이다 (서버 CSRF 규칙).
// 응답 → 화면 문장 변환은 순수 함수 (시험: api-client.test.ts)

export interface ApiResult {
  /** HTTP 상태 — 연결 실패는 0 */
  status: number;
  body: Record<string, unknown>;
}

/** JSON 요청 — 실패해도 예외를 던지지 않고 { status, body }를 돌려준다 */
export async function adminApi(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return { status: 0, body: {} };
  }
}

/** 파일 올리기(multipart/form-data) — 사진 보관함. content-type은 브라우저가 경계값과 함께 붙인다 */
export async function adminUpload(path: string, form: FormData): Promise<ApiResult> {
  try {
    const res = await fetch(path, { method: "POST", credentials: "same-origin", headers: { accept: "application/json" }, body: form, cache: "no-store" });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return { status: 0, body: {} };
  }
}

const DEFAULTS: Record<number, string> = {
  400: "요청 모양이 맞지 않습니다",
  403: "이 작업을 할 권한이 없습니다",
  404: "찾을 수 없습니다",
  409: "지금 상태에서는 할 수 없습니다",
  413: "내용이 너무 깁니다",
  415: "요청 형식이 맞지 않습니다",
  422: "입력값을 확인하세요",
  503: "서버 설정을 읽지 못했습니다 — 관리자에게 알려 주세요",
};

/** 응답 → 화면 한 줄 */
export function apiErrorMessage(r: ApiResult): string {
  if (r.status === 0) return "서버에 닿지 않았습니다 — 연결을 확인하고 다시 시도하세요";
  if (r.status === 401) return "로그인이 끝났습니다 — 다시 로그인해 주세요";
  const message = r.body.error;
  if (typeof message === "string" && message.trim() !== "") return message;
  return DEFAULTS[r.status] ?? "서버 오류가 났습니다 — 잠시 뒤 다시 시도하세요";
}

/** 422 자세히 — 칸 오류(errors)와 차단 판정 문장(findings, level=block). 겹치는 문장은 하나만 */
export function apiErrorDetails(r: ApiResult): string[] {
  const out: string[] = [];
  const errors = Array.isArray(r.body.errors) ? r.body.errors : [];
  for (const e of errors) if (typeof e === "string") out.push(e);
  const findings = Array.isArray(r.body.findings) ? r.body.findings : [];
  for (const f of findings) {
    if (typeof f !== "object" || f === null) continue;
    const { level, message } = f as { level?: unknown; message?: unknown };
    if (level === "block" && typeof message === "string") out.push(message);
  }
  return [...new Set(out)];
}
