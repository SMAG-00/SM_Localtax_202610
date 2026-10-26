// 지방세봇 스트림(SSE) - 순수 (W12-b b6, PRD-04 6.13). 이벤트 9종, 표준 SSE 형식이라 Vercel과 사내 서버 Docker에서 같은 코드로 돈다.
// 사내 프록시 버퍼링을 끄는 머리글(X-Accel-Buffering: no)을 응답마다 붙인다.

export const EVENT_NAMES = ["status", "clarify", "paragraph", "calc", "benefits", "determination", "fallback", "done", "error"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface AgentEvent {
  event: EventName;
  data: Record<string, unknown>;
}

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-accel-buffering": "no",
  "x-robots-tag": "noindex",
  connection: "keep-alive",
};

export function encodeEvent(e: AgentEvent): string {
  // data는 한 줄 JSON - 줄바꿈이 없어 SSE 필드가 깨지지 않는다
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

/** 받은 글 → 이벤트 목록 (시험·E2E 클라이언트용). 모르는 이벤트 이름은 버린다 */
export function parseSse(text: string): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const block of text.split(/\n\n/u)) {
    const ev = /^event: (.+)$/mu.exec(block)?.[1];
    const data = /^data: (.+)$/mu.exec(block)?.[1];
    if (!ev || data === undefined || !(EVENT_NAMES as readonly string[]).includes(ev)) continue;
    try {
      out.push({ event: ev as EventName, data: JSON.parse(data) as Record<string, unknown> });
    } catch {
      /* 깨진 줄은 버린다 */
    }
  }
  return out;
}

/** 이벤트 제너레이터 → ReadableStream. 제너레이터가 던지면 `error` 이벤트 한 줄로 닫는다(원문·스택 0). 반환값은 onFinish로 넘긴다 */
export function eventStream<R>(gen: AsyncGenerator<AgentEvent, R>, onFinish?: (result: R | null) => Promise<void> | void): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let result: R | null = null;
      try {
        for (;;) {
          const n = await gen.next();
          if (n.done) {
            result = n.value;
            break;
          }
          controller.enqueue(enc.encode(encodeEvent(n.value)));
        }
      } catch {
        controller.enqueue(enc.encode(encodeEvent({ event: "error", data: { code: "internal", retryable: true } })));
      }
      try {
        await onFinish?.(result);
      } catch {
        /* 기록 실패가 응답을 깨지 않는다 */
      }
      controller.close();
    },
  });
}
