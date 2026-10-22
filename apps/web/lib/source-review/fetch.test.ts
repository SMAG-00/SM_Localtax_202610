// 원문 다시 받기 (W4 6단계 — REG1-13, docs/dev/W4_설계.md 8장 '모의 객체는 외부 사이트에서만 — 로컬 가짜 서버')
// 이 시험 프로세스 안의 가짜 원문 서버(127.0.0.1)에 실제 fetch로 붙는다. 주소·글자는 시험용.
//  · 2xx → 받은 바이트, 404·500 → 실패 이유(상태 숫자), 응답 없음 → 시간 초과 실패, 한도 넘김(선언·실제) → 실패
//  · 요청에 쿠키·Referer·인증 0, User-Agent 고정 · 3xx는 따라간 뒤 최종 응답
//  · 해시 = sha256:<바이트 SHA-256> — 붙여 넣은 글자의 UTF-8 해시와 같다(출처 API 스냅샷과 같은 값) · 스냅샷 글자 = UTF-8이면 그대로, 아니면 base64:
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { fetchOriginal, snapshotHash, snapshotPayload } from "./fetch";

const ORIGINAL = "시험용 가상구 고시 원문 — 다시 받기 시험";
let server: http.Server;
let base = "";
const seen: http.IncomingHttpHeaders[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(req.headers);
    if (req.url === "/ok") res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(ORIGINAL);
    else if (req.url === "/moved") res.writeHead(302, { location: "/ok" }).end();
    else if (req.url === "/missing") res.writeHead(404).end("no");
    else if (req.url === "/boom") res.writeHead(500).end("err");
    else if (req.url === "/big-declared") res.writeHead(200, { "content-length": "2048" }).end("x".repeat(2048));
    else if (req.url === "/big-stream") {
      res.writeHead(200);
      res.write("y".repeat(1500));
      res.end("y".repeat(1500));
    } else if (req.url === "/binary") res.writeHead(200, { "content-type": "application/pdf" }).end(Buffer.from([0x25, 0x50, 0xff, 0xfe, 0x00, 0x81]));
    // /hang — 응답하지 않는다
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe("fetchOriginal — 실제 fetch · 가짜 원문 서버", () => {
  test("200 → 받은 바이트 = 원문 UTF-8 · 요청에 쿠키·Referer·인증 0, User-Agent 고정", async () => {
    seen.length = 0;
    const r = await fetchOriginal(`${base}/ok`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Buffer.from(r.bytes).toString("utf8")).toBe(ORIGINAL);
    expect(seen).toHaveLength(1);
    expect(seen[0]!["user-agent"]).toBe("LTR-SourceRefetch/1.0");
    for (const h of ["cookie", "referer", "authorization"]) expect(seen[0]![h]).toBeUndefined();
  });
  test("302 → 따라간 뒤 최종 200", async () => {
    const r = await fetchOriginal(`${base}/moved`);
    expect(r.ok && Buffer.from(r.bytes).toString("utf8")).toBe(ORIGINAL);
  });
  test("404·500 → 실패 + 상태 숫자, 연결 실패 → 실패", async () => {
    expect(await fetchOriginal(`${base}/missing`)).toEqual({ ok: false, reason: "원문 주소가 404 상태로 답했습니다" });
    expect(await fetchOriginal(`${base}/boom`)).toEqual({ ok: false, reason: "원문 주소가 500 상태로 답했습니다" });
    const closed = await fetchOriginal("http://127.0.0.1:9/none");
    expect(closed.ok).toBe(false);
  });
  test("응답 없음 → 시간 초과 실패", async () => {
    const r = await fetchOriginal(`${base}/hang`, { timeoutMs: 300 });
    expect(r).toEqual({ ok: false, reason: "원문 주소에 연결하지 못했습니다(시간 초과 또는 연결 실패)" });
  });
  test("크기 한도 — 선언 길이가 넘으면·받다가 넘으면 실패, 한도 안이면 받는다", async () => {
    expect((await fetchOriginal(`${base}/big-declared`, { maxBytes: 1024 })).ok).toBe(false);
    expect((await fetchOriginal(`${base}/big-stream`, { maxBytes: 2000 })).ok).toBe(false);
    const fits = await fetchOriginal(`${base}/big-stream`, { maxBytes: 3000 });
    expect(fits.ok && fits.bytes.byteLength).toBe(3000);
  });
});

describe("해시·스냅샷 글자", () => {
  test("해시 = sha256:<바이트 SHA-256> = 붙여 넣은 글자의 UTF-8 해시(출처 API와 같은 계산)", () => {
    const bytes = new TextEncoder().encode(ORIGINAL);
    const expected = `sha256:${createHash("sha256").update(ORIGINAL).digest("hex")}`;
    expect(snapshotHash(bytes)).toBe(expected);
    expect(snapshotHash(new TextEncoder().encode(`${ORIGINAL} `))).not.toBe(expected);
  });
  test("UTF-8 글자는 그대로, 아닌 바이트(PDF 등)는 base64: 머리", async () => {
    expect(snapshotPayload(new TextEncoder().encode(ORIGINAL))).toBe(ORIGINAL);
    const bin = await fetchOriginal(`${base}/binary`);
    expect(bin.ok).toBe(true);
    if (bin.ok) expect(snapshotPayload(bin.bytes)).toBe(`base64:${Buffer.from([0x25, 0x50, 0xff, 0xfe, 0x00, 0x81]).toString("base64")}`);
  });
});
