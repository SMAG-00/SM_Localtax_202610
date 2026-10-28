import { describe, expect, test } from "vitest";
import { fetchCheck, isBlockedIp, readKogl, type HttpGet } from "./fetch-check";

const PUBLIC = async () => ["93.184.216.34"];
const html = (body: string, status = 200, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...extra } });
const NOW = () => new Date("2026-10-28T03:00:00Z");

// 기사 1번 원문(행안부) 페이지에서 잘라 온 공공누리 부분
const MOIS_SNIPPET = `<a href="http://www.kogl.or.kr/open/info/license_info/by.do" target="_blank"><img src="/i.gif" alt="공공누리 제 1유형"></a>
<a href="http://www.kogl.or.kr/open/info/license_info/by.do" title="새창">공공누리 1유형(출처표시)</a>`;

describe("readKogl", () => {
  test("제 1유형 alt + 1유형(출처표시) 글자 + by.do 링크 → kogl_1, 이용 조건은 괄호 있는 표시", () => {
    expect(readKogl(MOIS_SNIPPET)).toMatchObject({ type: "kogl_1", label: "공공누리 1유형(출처표시)" });
  });
  test("by_nc 링크만 있으면 kogl_2", () => {
    expect(readKogl('<a href="https://www.kogl.or.kr/open/info/license_info/by_nc.do">x</a>')).toMatchObject({ type: "kogl_2", label: "공공누리 2유형" });
  });
  test("by_nd·by_nc_nd 링크는 3·4유형 (by_nc로 오인하지 않음)", () => {
    expect(readKogl('<a href="//kogl.or.kr/open/info/license_info/by_nd.do">')?.type).toBe("kogl_3");
    expect(readKogl('<a href="//kogl.or.kr/open/info/license_info/by_nc_nd.do">')?.type).toBe("kogl_4");
  });
  test("태그로 쪼개진 글자(공공누리 <b>제3유형</b>)도 읽는다", () => {
    expect(readKogl("공공누리 <b>제3유형</b>(출처표시-변경금지)")).toMatchObject({ type: "kogl_3", label: "공공누리 3유형(출처표시-변경금지)" });
  });
  test("표시가 없으면 null", () => {
    expect(readKogl("<html><body>공공누리 안내 없음</body></html>")).toBeNull();
  });
  test("서로 다른 유형이 함께 보이면 추측하지 않고 null", () => {
    expect(readKogl("공공누리 1유형 공공누리 4유형")).toBeNull();
  });
});

describe("isBlockedIp", () => {
  test.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.0.1", "0.0.0.0", "100.64.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "ff02::1"])("막음 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  test.each(["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1:248:1893:25c8:1946"])("통과 %s", (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe("fetchCheck", () => {
  test("열리면 확인일=오늘(KST)·공공누리 유형·이용 조건을 돌려준다", async () => {
    const get: HttpGet = async () => html(MOIS_SNIPPET);
    const r = await fetchCheck("https://www.mois.go.kr/a", { get, resolve: PUBLIC, now: NOW });
    expect(r).toMatchObject({ ok: true, verified_on: "2026-10-28", license_type: "kogl_1", license_status: "공공누리 1유형(출처표시)", auto_verified: true });
  });

  test("열리지만 공공누리 표시가 없으면 확인일만 채운다", async () => {
    const r = await fetchCheck("https://a.go.kr/", { get: async () => html("<p>안내</p>"), resolve: PUBLIC, now: NOW });
    expect(r).toMatchObject({ ok: true, verified_on: "2026-10-28", license_type: null, license_status: null });
  });

  test("http 주소는 받지 않는다 (요청도 하지 않음)", async () => {
    let called = 0;
    const r = await fetchCheck("http://www.mois.go.kr/a", { get: async () => (called++, html("")), resolve: PUBLIC });
    expect(r).toMatchObject({ ok: false, verified_on: null, license_type: null });
    expect(r.reason).toContain("https");
    expect(called).toBe(0);
  });

  test.each(["https://10.0.0.5/a", "https://127.0.0.1/a", "https://169.254.169.254/latest", "https://[::1]/a", "https://localhost/a"])("사설·루프백·링크로컬 주소 %s 거부", async (u) => {
    let called = 0;
    const r = await fetchCheck(u, { get: async () => (called++, html("")), resolve: PUBLIC });
    expect(r.ok).toBe(false);
    expect(called).toBe(0);
  });

  test("도메인이 사설 IP로 풀리면 거부 (DNS 결과 하나라도 사설이면)", async () => {
    let called = 0;
    const r = await fetchCheck("https://evil.example/a", { get: async () => (called++, html("")), resolve: async () => ["93.184.216.34", "10.0.0.8"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("사설");
    expect(called).toBe(0);
  });

  test("포트·사용자 정보가 든 주소는 거부", async () => {
    expect((await fetchCheck("https://a.go.kr:8443/x", { get: async () => html(""), resolve: PUBLIC })).ok).toBe(false);
    expect((await fetchCheck("https://user:pw@a.go.kr/x", { get: async () => html(""), resolve: PUBLIC })).ok).toBe(false);
  });

  test("리다이렉트 대상이 사설 주소면 거부하고 거기로는 요청하지 않는다", async () => {
    const seen: string[] = [];
    const get: HttpGet = async (url) => {
      seen.push(url.href);
      return new Response(null, { status: 302, headers: { location: "https://internal.example/admin" } });
    };
    const resolve = async (h: string) => (h === "internal.example" ? ["10.0.0.9"] : ["93.184.216.34"]);
    const r = await fetchCheck("https://a.go.kr/x", { get, resolve });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("리다이렉트 대상 거부");
    expect(seen).toEqual(["https://a.go.kr/x"]);
  });

  test("리다이렉트 http 대상도 거부, 상대 경로 이동은 따라간다", async () => {
    const get: HttpGet = async (url) =>
      url.pathname === "/x" ? new Response(null, { status: 301, headers: { location: "/y" } }) : html(MOIS_SNIPPET);
    expect((await fetchCheck("https://a.go.kr/x", { get, resolve: PUBLIC, now: NOW })).license_type).toBe("kogl_1");
    const toHttp: HttpGet = async () => new Response(null, { status: 302, headers: { location: "http://a.go.kr/z" } });
    expect((await fetchCheck("https://a.go.kr/x", { get: toHttp, resolve: PUBLIC })).ok).toBe(false);
  });

  test("리다이렉트 3번까지 따르고 4번째는 실패", async () => {
    let n = 0;
    const get: HttpGet = async () => (n++ < 3 ? new Response(null, { status: 302, headers: { location: `/p${n}` } }) : html("<p>ok</p>"));
    expect((await fetchCheck("https://a.go.kr/x", { get, resolve: PUBLIC, now: NOW })).ok).toBe(true);
    const always: HttpGet = async () => new Response(null, { status: 302, headers: { location: "/loop" } });
    const r = await fetchCheck("https://a.go.kr/x", { get: always, resolve: PUBLIC });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("3번");
  });

  test("404는 실패 이유와 함께 확인일·공공누리를 비운다", async () => {
    const r = await fetchCheck("https://a.go.kr/x", { get: async () => html(MOIS_SNIPPET, 404), resolve: PUBLIC });
    expect(r).toMatchObject({ ok: false, verified_on: null, license_type: null, license_status: null });
    expect(r.reason).toContain("404");
  });

  test("text/html이 아니면 실패 (PDF)", async () => {
    const r = await fetchCheck("https://a.go.kr/x.pdf", { get: async () => html("%PDF", 200, "application/pdf"), resolve: PUBLIC });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("application/pdf");
  });

  test("크기 제한: content-length가 넘거나 받는 중 넘으면 실패, 제한 안이면 통과", async () => {
    const big = "가".repeat(400);
    const declared = await fetchCheck("https://a.go.kr/x", { get: async () => html("x", 200, "text/html", { "content-length": "5000" }), resolve: PUBLIC, maxBytes: 1000 });
    expect(declared.ok).toBe(false);
    const streamed = await fetchCheck("https://a.go.kr/x", { get: async () => html(big), resolve: PUBLIC, maxBytes: 1000 });
    expect(streamed.ok).toBe(false);
    expect(streamed.reason).toContain("MB");
    expect((await fetchCheck("https://a.go.kr/x", { get: async () => html("작은 페이지"), resolve: PUBLIC, maxBytes: 1000, now: NOW })).ok).toBe(true);
  });

  test("시간 제한: 응답이 오지 않으면 실패", async () => {
    const hang: HttpGet = (_u, { signal }) => new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const r = await fetchCheck("https://a.go.kr/x", { get: hang, resolve: PUBLIC, timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, verified_on: null });
    expect(r.reason).toContain("시간 제한");
  });

  test("본문을 받는 중 멈춰도 시간 제한으로 실패", async () => {
    const stall: HttpGet = async () => new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/html" } });
    const r = await fetchCheck("https://a.go.kr/x", { get: stall, resolve: PUBLIC, timeoutMs: 30 });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("시간 제한");
  });

  test("DNS 실패·전송 오류는 던지지 않고 이유를 돌려준다", async () => {
    expect((await fetchCheck("https://a.go.kr/x", { get: async () => html(""), resolve: async () => { throw new Error("ENOTFOUND"); } })).reason).toContain("DNS");
    expect((await fetchCheck("https://a.go.kr/x", { get: async () => { throw new Error("ECONNRESET"); }, resolve: PUBLIC })).ok).toBe(false);
    expect((await fetchCheck("not a url")).ok).toBe(false);
  });
});
