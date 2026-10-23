// Claude Messages API 클라이언트 — fetch 직접 호출 (설계 12장 #1: SDK 미설치, 잠금 파일 불변). 키는 서버 전용(ANTHROPIC_API_KEY).
// 시험은 ModelClient를 흉내 객체로 바꿔 끼운다 — 시험에서 실제 API를 부르지 않는다.
// 이 파일은 순수 TS다(서버 전용 표시는 서버 어댑터가 한다). 모델 ID는 요청마다 호출하는 쪽이 넘긴다 — 코드에 두지 않는다.

export interface Citation {
  type: string;
  source?: string;
  title?: string;
  cited_text?: string;
}
export interface TextBlock {
  type: "text";
  text: string;
  citations?: Citation[] | null;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
export type ContentBlock = TextBlock | ToolUseBlock | { type: string };

export interface ModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
export interface MessagesResponse {
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: ModelUsage;
}
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system: string;
  messages: unknown[];
  tools?: ToolDef[];
}
export interface ModelClient {
  create(request: MessagesRequest): Promise<MessagesResponse>;
}

export type ModelErrorKind = "http" | "timeout" | "network" | "refusal" | "shape";
export class ModelError extends Error {
  constructor(
    message: string,
    readonly kind: ModelErrorKind,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

export interface FetchClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** 키가 워크스페이스에 묶여 있지 않을 때 필요한 워크스페이스 ID (anthropic-workspace-id 머리글) — 비밀이 아니다 */
  workspaceId?: string;
  fetchImpl?: typeof fetch;
}

const API_VERSION = "2023-06-01";

export function createFetchClient(options: FetchClientOptions): ModelClient {
  const base = (options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/u, "");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const doFetch = options.fetchImpl ?? fetch;
  return {
    async create(request) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": options.apiKey,
            "anthropic-version": API_VERSION,
            ...(options.workspaceId ? { "anthropic-workspace-id": options.workspaceId } : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) throw new ModelError("모델 응답 시간 초과", "timeout");
        throw new ModelError(`모델 호출 네트워크 오류: ${err instanceof Error ? err.name : "unknown"}`, "network");
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        // 응답 본문(오류 설명)에는 요청 내용이 섞일 수 있어 상태 코드만 남긴다
        throw new ModelError(`모델 API 오류 ${res.status}`, "http", res.status);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        throw new ModelError("모델 응답을 읽지 못했습니다", "shape");
      }
      const parsed = body as MessagesResponse;
      if (!parsed || !Array.isArray(parsed.content)) throw new ModelError("모델 응답 모양이 틀립니다", "shape");
      if (parsed.stop_reason === "refusal") throw new ModelError("모델이 답변을 거절했습니다", "refusal");
      return parsed;
    },
  };
}
