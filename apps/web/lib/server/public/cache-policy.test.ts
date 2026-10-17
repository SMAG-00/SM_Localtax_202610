// 공개 데이터 캐시 규칙 (HOME-03·HOME-04 "1분 안에 홈에 반영 — 캐시 재검증", 설계 7.1)
import { describe, expect, test } from "vitest";
import { PUBLIC_DATA_REVALIDATE_SECONDS, PUBLIC_DATA_TAG, cachedRequestInit, shouldRevalidatePublic } from "./cache-policy";

describe("공개 데이터 요청의 캐시 옵션", () => {
  test("모든 요청에 같은 태그와 재검증 간격 — 1분 안 반영을 위해 간격은 60초보다 짧다", () => {
    const init = cachedRequestInit();
    expect(init).toEqual({ next: { revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: [PUBLIC_DATA_TAG] } });
    expect(PUBLIC_DATA_REVALIDATE_SECONDS).toBeGreaterThan(0);
    // 시간 기준 재검증은 '지난 값을 한 번 보이고 뒤에서 새로 읽기'라서, 간격의 두 배가 1분을 넘지 않아야 방문이 이어질 때 1분 안에 새 값이 나온다
    expect(PUBLIC_DATA_REVALIDATE_SECONDS * 2).toBeLessThanOrEqual(60);
  });

  test("요청 쪽의 방법·머리글·본문·신호는 그대로 두고, 겹치는 cache 값만 뺀다", () => {
    const headers = new Headers({ apikey: "k", accept: "application/json" });
    const signal = new AbortController().signal;
    const init = cachedRequestInit({ method: "GET", headers, cache: "no-store", signal });
    expect(init.method).toBe("GET");
    expect(init.headers).toBe(headers);
    expect(init.signal).toBe(signal);
    expect("cache" in init).toBe(false);
    expect(init.next).toEqual({ revalidate: PUBLIC_DATA_REVALIDATE_SECONDS, tags: [PUBLIC_DATA_TAG] });
  });
});

describe("편집국 API 뒤 캐시를 비울지", () => {
  test.each([
    ["POST", 201, true],
    ["PATCH", 200, true],
    ["DELETE", 200, true],
    ["post", 204, true],
    ["GET", 200, false],
    ["HEAD", 200, false],
    ["POST", 409, false],
    ["PATCH", 422, false],
    ["DELETE", 404, false],
    ["POST", 500, false],
    ["POST", 302, false],
  ] as const)("%s %d → %s", (method, status, expected) => {
    expect(shouldRevalidatePublic(method, status)).toBe(expected);
  });
});
