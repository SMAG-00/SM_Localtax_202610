import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseAssistantRequest, usableContextPath } from "./request";

// 모듈 경계 검사 (CHAT-08 · CHAT-11 · CHAT-12) - 소스 글자를 직접 읽는다.
const WEB = path.join(__dirname, "..", "..");
const DIRS = [path.join(WEB, "lib", "assistant"), path.join(WEB, "lib", "server", "assistant")];
const files = DIRS.flatMap((d) => fs.readdirSync(d).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => path.join(d, f)));
const read = (f: string) => fs.readFileSync(f, "utf8");
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("모듈 경계", () => {
  test("도우미 코드가 service role 키를 읽지 않는다 (CHAT-11)", () => {
    for (const f of files) {
      expect(code(f), f).not.toMatch(/SERVICE_ROLE|supabaseServiceRoleKey|adminClient/);
    }
  });
  test("코드에 모델 ID 문자열이 없다 (CHAT-12)", () => {
    for (const f of files) expect(code(f), f).not.toMatch(/claude-(sonnet|haiku|opus)/);
  });
  test("모델 호출은 마스킹을 거친 파이프라인 한 곳 - fetch는 anthropic.ts에만 있다 (CHAT-08)", () => {
    for (const f of files) {
      if (path.basename(f) === "anthropic.ts") continue;
      expect(code(f), f).not.toMatch(/api\.anthropic\.com/);
      // store.ts의 fetch는 Supabase 클라이언트에 no-store를 붙이는 래퍼일 뿐이다
      if (path.basename(f) !== "store.ts") expect(code(f), f).not.toMatch(/\bfetch\(/);
    }
    const pipeline = code(path.join(DIRS[0]!, "pipeline.ts"));
    expect(pipeline).toMatch(/maskText\(input\.message\)/);
    // models.create는 파이프라인에서만 부른다
    for (const f of files) if (path.basename(f) !== "pipeline.ts") expect(code(f), f).not.toMatch(/models\.create\(|\.create\(\{\s*model/);
  });
  test("도구 상자에 쓰기 동작이 없다 (CHAT-07)", () => {
    const tb = code(path.join(DIRS[1]!, "toolbox.ts"));
    expect(tb).not.toMatch(/\.(insert|update|delete|upsert)\(|\.rpc\(/);
  });
  test("서버 기록은 공개 키 클라이언트로만 (DB 함수 호출)", () => {
    const store = code(path.join(DIRS[1]!, "store.ts"));
    expect(store).toMatch(/anonClient/);
    expect(store).not.toMatch(/\.from\(/);
  });
});

describe("요청 스키마 (CHAT-06)", () => {
  const ok = { message: "구독은 어디서 해요?", noticeVersion: "draft-1" };
  test("정상 요청과 맥락 3칸", () => {
    const r = parseAssistantRequest({ ...ok, context: { path: "/news/a", title: "제목", field: "tax" } });
    expect(r).toEqual({ ok: true, value: { message: "구독은 어디서 해요?", sessionId: null, context: { path: "/news/a", title: "제목", field: "tax" }, noticeVersion: "draft-1" } });
  });
  test.each([
    [{ ...ok, body: "본문" }, "알 수 없는 칸"],
    [{ ...ok, context: { path: "/a", text: "본문" } }, "맥락에 알 수 없는 칸"],
    [{ ...ok, context: { path: "/a", field: "calc" } }, "분야 코드"],
    [{ ...ok, message: "" }, "질문"],
    [{ ...ok, message: "가".repeat(501) }, "질문"],
    [{ message: "x" }, "고지"],
    [{ ...ok, sessionId: "abc" }, "세션"],
    ["문자열", "요청 모양"],
  ])("거부: %j", (body, fragment) => {
    const r = parseAssistantRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
  test("쿼리·조각·관리 경로는 맥락에서 빠진다(요청은 통과)", () => {
    for (const p of ["/calc?price=700000000", "/news/a#top", "/admin/articles", "/api/assistant", "//evil.example.com"]) {
      const r = parseAssistantRequest({ ...ok, context: { path: p, title: "t" } });
      expect(r.ok && r.value.context).toBeUndefined();
    }
    expect(usableContextPath("/news/한글-경로")).toBe(true);
  });
});

describe("모델 클라이언트 요청 (fetch 주입)", () => {
  test("헤더·본문·워크스페이스 ID, 오류는 상태 코드만", async () => {
    const { createFetchClient, ModelError } = await import("./anthropic");
    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const mk = (status: number, json: unknown): typeof fetch =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
        return new Response(JSON.stringify(json), { status });
      }) as typeof fetch;
    const c = createFetchClient({ apiKey: "k-test", workspaceId: "wrkspc_test", fetchImpl: mk(200, { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }) });
    const r = await c.create({ model: "m-test", max_tokens: 5, system: "s", messages: [] });
    expect(r.content).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.headers["x-api-key"]).toBe("k-test");
    expect(seen[0]!.headers["anthropic-workspace-id"]).toBe("wrkspc_test");
    expect(JSON.parse(seen[0]!.body).model).toBe("m-test");
    const failing = createFetchClient({ apiKey: "k", fetchImpl: mk(503, { error: { message: "질문 원문이 들어간 설명" } }) });
    await expect(failing.create({ model: "m", max_tokens: 5, system: "s", messages: [] })).rejects.toMatchObject({ kind: "http", status: 503, message: "모델 API 오류 503" });
    const refusing = createFetchClient({ apiKey: "k", fetchImpl: mk(200, { content: [], stop_reason: "refusal" }) });
    await expect(refusing.create({ model: "m", max_tokens: 5, system: "s", messages: [] })).rejects.toBeInstanceOf(ModelError);
    const noWs = createFetchClient({ apiKey: "k", fetchImpl: mk(200, { content: [] }) });
    await noWs.create({ model: "m", max_tokens: 5, system: "s", messages: [] });
    expect(seen.at(-1)!.headers["anthropic-workspace-id"]).toBeUndefined();
  });
});
