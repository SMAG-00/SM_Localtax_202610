import { createHash } from "node:crypto";
import { REFETCH_MAX_BYTES, REFETCH_TIMEOUT_MS } from "./rules";

// 원문 다시 받기 — 한 번 받기·해시·스냅샷 글자 (W4 6단계 — REG1-13, docs/dev/W4_설계.md 1장 6단계 · 8장 '모의 객체는 외부 사이트에서만 — 로컬 가짜 서버').
// 서버 기능(lib/server/source-review/service.ts)이 쓴다. 요청에는 주소와 고정 User-Agent만 — 쿠키·Referer·인증 0(서버 fetch는 싣지 않는다). 2xx만, 크기 한도·시간 제한.
const USER_AGENT = "LTR-SourceRefetch/1.0";

export type Fetcher = (
  url: string,
  init: { signal: AbortSignal; redirect: "follow"; headers: Record<string, string> },
) => Promise<{ status: number; headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null }>;

export type FetchResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/** 원문 주소를 한 번 받는다 — 2xx만, 한도를 넘으면 중단 */
export async function fetchOriginal(url: string, opts: { fetcher?: Fetcher; timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchResult> {
  const fetcher: Fetcher = opts.fetcher ?? ((u, init) => fetch(u, init));
  const maxBytes = opts.maxBytes ?? REFETCH_MAX_BYTES;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? REFETCH_TIMEOUT_MS);
  try {
    const res = await fetcher(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": USER_AGENT } });
    if (res.status < 200 || res.status >= 300) return { ok: false, reason: `원문 주소가 ${res.status} 상태로 답했습니다` };
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: `원문이 ${Math.round(maxBytes / 1024 / 1024)}MB 한도를 넘습니다` };
    if (!res.body) return { ok: true, bytes: new Uint8Array() };
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        ctl.abort();
        return { ok: false, reason: `원문이 ${Math.round(maxBytes / 1024 / 1024)}MB 한도를 넘습니다` };
      }
      parts.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.byteLength;
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: "원문 주소에 연결하지 못했습니다(시간 초과 또는 연결 실패)" };
  } finally {
    clearTimeout(timer);
  }
}

/** 원문 해시 — 바이트의 SHA-256 (붙여 넣은 글자는 UTF-8 바이트 — 출처 API 스냅샷과 같은 값) */
export function snapshotHash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 원본 스냅샷 칸(글자)에 넣을 모양 — UTF-8 글자면 그대로, 아니면(PDF 등) base64: 머리 */
export function snapshotPayload(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return `base64:${Buffer.from(bytes).toString("base64")}`;
  }
}
