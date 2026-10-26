import { describe, expect, it } from "vitest";
import { encodeEvent, EVENT_NAMES, eventStream, parseSse, SSE_HEADERS, type AgentEvent } from "./sse";
import { parseAskRequest } from "./request";

describe("SSE (ASK-01 · 6.13)", () => {
  it("이벤트 이름 9종 고정", () => {
    expect([...EVENT_NAMES]).toEqual(["status", "clarify", "paragraph", "calc", "benefits", "determination", "fallback", "done", "error"]);
  });
  it("표준 SSE 형식으로 인코딩·파싱이 왕복된다", () => {
    const e: AgentEvent = { event: "paragraph", data: { index: 0, text: "줄바꿈\n포함 글" } };
    const s = encodeEvent(e);
    expect(s.startsWith("event: paragraph\ndata: ")).toBe(true);
    expect(s.endsWith("\n\n")).toBe(true);
    expect(parseSse(s)).toEqual([e]);
    expect(parseSse("event: unknown\ndata: {}\n\n")).toEqual([]);
  });
  it("버퍼링 방지·캐시 금지 머리글", () => {
    expect(SSE_HEADERS["x-accel-buffering"]).toBe("no");
    expect(SSE_HEADERS["content-type"]).toContain("text/event-stream");
    expect(SSE_HEADERS["cache-control"]).toContain("no-store");
  });
  it("스트림은 순서대로 내보내고 반환값을 onFinish로 넘긴다", async () => {
    async function* g(): AsyncGenerator<AgentEvent, string> {
      yield { event: "status", data: { phase: "searching" } };
      yield { event: "done", data: {} };
      return "record";
    }
    let got: string | null = null;
    const text = await new Response(eventStream(g(), (r) => void (got = r))).text();
    expect(parseSse(text).map((e) => e.event)).toEqual(["status", "done"]);
    expect(got).toBe("record");
  });
  it("제너레이터가 던지면 error 이벤트 한 줄로 닫고 원문·스택을 싣지 않는다", async () => {
    async function* g(): AsyncGenerator<AgentEvent, string> {
      yield { event: "status", data: {} };
      throw new Error("비밀 내부 문구");
    }
    let finished = false;
    const text = await new Response(eventStream(g(), () => void (finished = true))).text();
    const evs = parseSse(text);
    expect(evs.at(-1)).toEqual({ event: "error", data: { code: "internal", retryable: true } });
    expect(text).not.toContain("비밀 내부 문구");
    expect(finished).toBe(true);
  });
});

describe("요청 스키마", () => {
  it("정상 요청", () => {
    const r = parseAskRequest({ message: " 시험용 질문 ", mode: "expert", entry: "law", clarifyAnswers: [{ slot: "slot_a", value: "a1" }] });
    expect(r).toEqual({ ok: true, value: { message: "시험용 질문", sessionId: null, mode: "expert", entry: "law", clarifyAnswers: { slot_a: "a1" } } });
  });
  it("모르는 칸·잘못된 값은 거부", () => {
    expect(parseAskRequest({ message: "q", calcInput: {} }).ok).toBe(false);
    expect(parseAskRequest({ message: "" }).ok).toBe(false);
    expect(parseAskRequest({ message: "q", mode: "x" }).ok).toBe(false);
    expect(parseAskRequest({ message: "q", entry: "x" }).ok).toBe(false);
    expect(parseAskRequest({ message: "q", sessionId: "nope" }).ok).toBe(false);
    expect(parseAskRequest({ message: "q", clarifyAnswers: [{ slot: "A B", value: "x" }] }).ok).toBe(false);
    expect(parseAskRequest({ message: "q".repeat(501) }).ok).toBe(false);
  });
});
