// 공개 데이터 캐시 규칙 (HOME-03·HOME-04 "1분 안에 홈에 반영 — 캐시 재검증", 설계 7.1)
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { EXPIRY_LEAD_MS, PUBLIC_DATA_REVALIDATE_SECONDS, PUBLIC_DATA_TAG, cachedRequestInit, immediateExpiryProfile, shouldRevalidatePublic } from "./cache-policy";

/** Next.js 16 FileSystemCache.revalidateTag가 프로필로 적는 만료 시각 (벽시계 + expire초) */
const stampedExpiry = (wallAtStamp: number, profile: { expire: number }) => wallAtStamp + profile.expire * 1000;

describe("편집국 쓰기 뒤 즉시 만료 — Next.js가 만료를 벽시계로 적고 단조 시계로 읽는 어긋남 (W2-c 6단계에서 찾음)", () => {
  // 실제 측정: 새 Node 프로세스 8개 중 4개가 벽시계(Date.now)가 단조 시계(performance.timeOrigin + now)보다 1~8ms 앞섰고, 한 프로세스 안에서도 3ms 남짓 흔들렸다
  const AHEAD = [-13.7, -5.8, 0, 1.2, 6.8, 8, 13.3];
  const JITTER = [-3, 0, 3];

  test("{ expire: 0 }은 벽시계가 앞선 프로세스에서 쓰기 직후 읽기가 '만료 아님' — 옛 값을 한 번 보인다 (고치기 전 모습)", () => {
    const wall = 1_000_000;
    const mono = wall - 8; // 벽시계가 8ms 앞섬
    expect(stampedExpiry(wall, { expire: 0 }) <= mono).toBe(false);
  });

  test.each(AHEAD.flatMap((ahead) => JITTER.map((jitter) => [ahead, jitter] as const)))("벽시계가 %dms 앞서고 만료를 적을 때 %dms 더 흔들려도, 만료 시각은 단조 시계로 이미 지났다", (ahead, jitter) => {
    const wall = 1_000_000;
    const profile = immediateExpiryProfile(wall, wall - ahead);
    // Next.js는 처리기가 끝난 뒤 그 순간의 Date.now()로 적는다 — 그 사이 어긋남이 jitter만큼 바뀐 경우
    const wallAtStamp = wall + 2;
    const monoAtRead = wallAtStamp - (ahead + jitter);
    expect(stampedExpiry(wallAtStamp, profile)).toBeLessThanOrEqual(monoAtRead);
    expect(Number.isFinite(profile.expire) && profile.expire < 0).toBe(true);
  });

  test("앞당기는 폭은 어긋남 + 여유(EXPIRY_LEAD_MS)뿐 — 그보다 오래된 응답은 모두 만료, 쓰기 뒤에 새로 저장한 응답은 만료가 아니다", () => {
    const wall = 1_000_000;
    const expiredAt = stampedExpiry(wall, immediateExpiryProfile(wall, wall - 8));
    expect(wall - expiredAt).toBe(8 + EXPIRY_LEAD_MS);
    expect(EXPIRY_LEAD_MS).toBeGreaterThan(3);
    expect(EXPIRY_LEAD_MS).toBeLessThanOrEqual(50);
  });

  test("Next.js의 실제 태그 판정(tags-manifest)으로 — 1초 전에 저장된 응답은 바로 만료, 그 뒤 새로 저장한 응답은 만료 아님", () => {
    const require = createRequire(import.meta.url);
    const manifest = require("next/dist/server/lib/incremental-cache/tags-manifest.external.js") as {
      tagsManifest: Map<string, { stale?: number; expired?: number }>;
      areTagsExpired: (tags: string[], timestamp: number) => boolean;
    };
    const tag = "cache-policy-test";
    const profile = immediateExpiryProfile(Date.now(), performance.timeOrigin + performance.now());
    const now = Date.now();
    // FileSystemCache.revalidateTag(tags, { expire })와 같은 칸
    manifest.tagsManifest.set(tag, { stale: now, expired: now + profile.expire * 1000 });
    expect(manifest.areTagsExpired([tag], now - 1000)).toBe(true);
    expect(manifest.areTagsExpired([tag], now + 1)).toBe(false);
    manifest.tagsManifest.delete(tag);
  });
});

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
