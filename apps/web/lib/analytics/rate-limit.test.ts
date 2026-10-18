// 속도 제한 시험 — 1분 상한만큼 담기고 초마다 상한/60씩 찬다, 열쇠 상한, IP는 해시 열쇠만
import { describe, expect, test } from "vitest";
import { TokenBuckets, ipKey } from "./rate-limit";

describe("토큰 통", () => {
  test("1분 상한 120 — 같은 순간 120번은 통과, 121번째는 429와 다시 보낼 때까지 초", () => {
    const b = new TokenBuckets();
    for (let i = 0; i < 120; i++) expect(b.take("v", 120, 0).ok).toBe(true);
    expect(b.take("v", 120, 0)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  test("초마다 상한/60씩 찬다 — 500ms 뒤 1개(120/분), 상한보다 많이 차지 않는다", () => {
    const b = new TokenBuckets();
    for (let i = 0; i < 120; i++) b.take("v", 120, 0);
    expect(b.take("v", 120, 499).ok).toBe(false);
    expect(b.take("v", 120, 1000).ok).toBe(true); // 499ms의 거의 1개 + 501ms = 1개 이상
    const fresh = new TokenBuckets();
    fresh.take("w", 60, 0);
    // 한 시간 쉬어도 60개까지만
    let ok = 0;
    for (let i = 0; i < 100; i++) if (fresh.take("w", 60, 3_600_000).ok) ok++;
    expect(ok).toBe(60);
  });

  test("상한 10/분 — 다 쓰면 6초 뒤에 1개", () => {
    const b = new TokenBuckets();
    for (let i = 0; i < 10; i++) b.take("ip", 10, 0);
    expect(b.take("ip", 10, 0)).toEqual({ ok: false, retryAfterSeconds: 6 });
    expect(b.take("ip", 10, 5_999).ok).toBe(false);
    expect(b.take("ip", 10, 12_000).ok).toBe(true);
  });

  test("열쇠마다 따로 — 한 방문자가 다 써도 다른 방문자는 통과", () => {
    const b = new TokenBuckets();
    for (let i = 0; i < 10; i++) b.take("a", 10, 0);
    expect(b.take("a", 10, 0).ok).toBe(false);
    expect(b.take("b", 10, 0).ok).toBe(true);
  });

  test("열쇠가 상한을 넘으면 가장 오래 안 쓴 것부터 버린다 (메모리 상한)", () => {
    const b = new TokenBuckets(3);
    for (const k of ["a", "b", "c"]) b.take(k, 1, 0);
    b.take("a", 1, 0); // a를 최근으로 — 이미 다 써서 거부
    b.take("d", 1, 0); // b가 버려진다
    expect(b.size).toBe(3);
    expect(b.take("b", 1, 0).ok).toBe(true); // 버려졌던 b는 새 통 (c가 버려진다)
    expect(b.take("a", 1, 0).ok).toBe(false); // a는 남아 있다
  });
});

describe("IP 열쇠", () => {
  test("IP 원문이 열쇠에 없고, 소금이 다르면 열쇠도 다르다, 같은 소금·같은 IP는 같다", () => {
    const k = ipKey("203.0.113.77", "salt-a");
    expect(k).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(k).not.toContain("203.0.113.77");
    expect(ipKey("203.0.113.77", "salt-a")).toBe(k);
    expect(ipKey("203.0.113.77", "salt-b")).not.toBe(k);
    expect(ipKey("203.0.113.78", "salt-a")).not.toBe(k);
  });
});
