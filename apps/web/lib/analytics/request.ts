// 수집 요청 검사 도우미 (docs/dev/W2-c_설계.md 5장 1·2·6·7번) — 같은 사이트·본문 형식·IP·본문 크기. 순수 모듈(요청 객체만 읽는다).

type HeaderGetter = { get(name: string): string | null };

/** 수집 본문 상한 — 이벤트 하나(속성 2KB + 맨 위 칸)에 넉넉한 크기. 운영 조정값이 아니라 형식 상한이다 */
export const MAX_EVENT_BYTES = 4096;

/**
 * 같은 사이트에서 온 요청인가 — `Sec-Fetch-Site`가 있으면 same-origin만, `Origin`이 있으면 허용 호스트(요청 주소·Host·사이트 주소) 중 하나.
 * 둘 다 없으면(브라우저가 아닌 요청) 받는다 — 브라우저는 POST에 Origin을 붙인다. 다른 사이트 화면이 남의 쿠키로 보내거나 거부를 풀지 못하게.
 */
export function isSameSite(headers: HeaderGetter, allowedHosts: readonly (string | null | undefined)[]): boolean {
  const site = headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (site && site !== "same-origin") return false;
  const origin = headers.get("origin");
  if (origin === null) return true;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((h) => typeof h === "string" && h.toLowerCase() === host);
}

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** 같은 사이트로 보는 호스트 — 요청 주소 · Host 머리글 · 사이트 주소(NEXT_PUBLIC_SITE_URL — 사내 서버 프록시 뒤) */
export const sameSiteHosts = (request: Request, site: string | null | undefined): (string | null)[] => [hostOf(request.url), request.headers.get("host"), hostOf(site)];

/** 본문 형식 (charset 같은 매개변수는 보지 않는다) */
export const mediaType = (headers: HeaderGetter): string => (headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

/** 속도 제한에만 쓰는 IP — `x-real-ip` → `x-forwarded-for` 첫 값(Vercel·사내 Caddy가 붙인다) → 없으면 한 통. 저장·기록하지 않는다 */
export function clientIp(headers: HeaderGetter): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 64) : "unknown";
}

export type BodyRead = { ok: true; text: string } | { ok: false; tooLarge: true };

/** 본문을 상한까지만 읽는다 — `content-length`가 크면 읽지 않고, 실제로 읽은 양이 넘어도 멈춘다 */
export async function readLimited(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) return { ok: false, tooLarge: true };
  if (!request.body) return { ok: true, text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(all) };
}
