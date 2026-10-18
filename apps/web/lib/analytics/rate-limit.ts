// 수집 API 속도 제한 (docs/dev/W2-c_설계.md 5장) — 서버 메모리의 토큰 통. 시계는 입력으로 받는다(시험 가능).
//  · 1분 상한만큼 담기고 1밀리초마다 상한/60,000씩 찬다 — 짧은 몰림은 받고, 오래 이어지는 빠른 요청은 429
//  · 서버(함수 인스턴스·컨테이너)마다 따로다 — 남용을 늦추는 장치이지 정확한 상한이 아니다
//  · 열쇠가 너무 많아지면 가장 오래 안 쓴 것부터 버린다(메모리 상한). IP는 해시한 열쇠만 들고 있다 (ipKey)
import { createHash } from "node:crypto";

export type Take = { ok: true } | { ok: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  at: number;
}

export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxKeys = 20_000) {}

  take(key: string, perMinute: number, nowMs: number): Take {
    const capacity = Math.max(1, perMinute);
    const perMs = capacity / 60_000;
    const prev = this.buckets.get(key);
    let tokens = capacity;
    if (prev) {
      this.buckets.delete(key); // 맨 뒤로 다시 넣어 '최근에 쓴 열쇠'로
      tokens = Math.min(capacity, prev.tokens + Math.max(0, nowMs - prev.at) * perMs);
    } else if (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    if (tokens >= 1) {
      this.buckets.set(key, { tokens: tokens - 1, at: nowMs });
      return { ok: true };
    }
    this.buckets.set(key, { tokens, at: nowMs });
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / perMs / 1000)) };
  }

  get size(): number {
    return this.buckets.size;
  }
}

/** IP → 열쇠 — 프로세스마다 다른 소금으로 해시한 앞 16자. IP 원문은 메모리에도 들고 있지 않는다 */
export function ipKey(ip: string, salt: string): string {
  return `ip:${createHash("sha256").update(salt).update("\u0000").update(ip).digest("hex").slice(0, 16)}`;
}
