// 수집 요청 검사 시험 — 같은 사이트·본문 형식·IP·본문 크기 상한
import { describe, expect, test } from "vitest";
import { MAX_EVENT_BYTES, clientIp, isSameSite, mediaType, readLimited } from "./request";

const H = (h: Record<string, string>) => new Headers(h);
const HOSTS = ["127.0.0.1:3001", "e2e.example.test"];

describe("같은 사이트", () => {
  test.each([
    [{}, true, "브라우저가 아닌 요청(머리글 없음)"],
    [{ origin: "http://127.0.0.1:3001" }, true, "요청 주소와 같은 Origin"],
    [{ origin: "https://e2e.example.test" }, true, "사이트 주소와 같은 Origin"],
    [{ origin: "https://E2E.example.test" }, true, "대소문자"],
    [{ origin: "https://evil.example" }, false, "다른 사이트 Origin"],
    [{ origin: "http://127.0.0.1:3002" }, false, "포트가 다르면 다른 출처"],
    [{ origin: "null" }, false, "Origin null (샌드박스 iframe·파일)"],
    [{ "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3001" }, true, "same-origin"],
    [{ "sec-fetch-site": "cross-site" }, false, "cross-site"],
    [{ "sec-fetch-site": "same-site", origin: "https://e2e.example.test" }, false, "same-site(다른 하위 도메인)도 받지 않는다"],
    [{ "sec-fetch-site": "none" }, false, "주소창 직접 입력"],
  ] as [Record<string, string>, boolean, string][])("%j → %s (%s)", (h, expected) => {
    expect(isSameSite(H(h), HOSTS)).toBe(expected);
  });
});

describe("본문 형식·IP", () => {
  test("본문 형식은 매개변수를 떼고 소문자로", () => {
    expect(mediaType(H({ "content-type": "Application/JSON; charset=utf-8" }))).toBe("application/json");
    expect(mediaType(H({}))).toBe("");
  });
  test("IP — x-real-ip → x-forwarded-for 첫 값 → unknown", () => {
    expect(clientIp(H({ "x-real-ip": "198.51.100.1", "x-forwarded-for": "203.0.113.9" }))).toBe("198.51.100.1");
    expect(clientIp(H({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(H({}))).toBe("unknown");
  });
});

const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("http://127.0.0.1:3001/api/events", { method: "POST", body, headers, duplex: "half" } as RequestInit);

describe("본문 크기 상한", () => {
  test("상한(4,096바이트)과 같으면 읽고, 1바이트 넘으면 413 — 한글은 바이트로 센다", async () => {
    expect(await readLimited(req("a".repeat(MAX_EVENT_BYTES)), MAX_EVENT_BYTES)).toEqual({ ok: true, text: "a".repeat(MAX_EVENT_BYTES) });
    expect(await readLimited(req("a".repeat(MAX_EVENT_BYTES + 1)), MAX_EVENT_BYTES)).toEqual({ ok: false, tooLarge: true });
    const korean = "가".repeat(1366); // 3바이트 × 1366 = 4,098바이트 > 4,096
    expect(korean.length).toBeLessThan(MAX_EVENT_BYTES);
    expect(await readLimited(req(korean), MAX_EVENT_BYTES)).toEqual({ ok: false, tooLarge: true });
  });

  test("content-length가 상한보다 크면 읽지 않고 413, 실제 몸이 적어도 마찬가지 · 흘려보내는 몸도 상한에서 멈춘다", async () => {
    expect(await readLimited(req("{}", { "content-length": String(MAX_EVENT_BYTES + 1) }), MAX_EVENT_BYTES)).toEqual({ ok: false, tooLarge: true });
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024).fill(97));
        if (pulled > 100) controller.close();
      },
    });
    expect(await readLimited(req(stream), MAX_EVENT_BYTES)).toEqual({ ok: false, tooLarge: true });
    expect(pulled).toBeLessThan(10);
  });

  test("빈 본문은 빈 글자", async () => {
    expect(await readLimited(req(null), MAX_EVENT_BYTES)).toEqual({ ok: true, text: "" });
  });
});
