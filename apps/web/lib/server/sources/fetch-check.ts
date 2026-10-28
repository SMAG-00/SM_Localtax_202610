// 출처 원문 페이지 확인 (F5) — 후보 주소를 서버가 직접 받아 (a) 열리는지 (b) 공공누리 유형 (c) 이용 조건 글자를 읽는다.
//  · 받은 HTML은 저장하지 않는다 — 필요한 값(열림·공공누리 표시)만 뽑고 버린다. 원문 본문은 옮기지 않는다(PR-07).
//  · 보안(SSRF): https·기본 포트만, 사용자 정보(user:pass@) 거부, 사설·루프백·링크로컬·예약 IP로 풀리면 거부(DNS 결과 전부 확인),
//    리다이렉트는 최대 3번이고 매번 같은 검사를 다시 한다. 기본 전송은 검사한 IP로 연결을 고정해 DNS 바꿔치기(rebinding)를 막는다.
//  · 시간 8초 · 크기 2MB · text/html만. 실패하면 확인일·공공누리를 비우고 이유를 돌려준다.
//  · 시험은 외부 사이트를 부르지 않고 deps(get·resolve·now·timeoutMs·maxBytes)를 주입한다. 시험 전용 분기는 없다.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";
import { Readable } from "node:stream";
import { isoToKstDate } from "@/lib/admin/form-utils";
import type { SourceCheck } from "@/lib/admin/source-suggest";

export const FETCH_TIMEOUT_MS = 8000;
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;

// ── IP 검사 ────────────────────────────────────────────

function ipv4Bytes(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const b = m.slice(1).map(Number);
  return b.every((n) => n <= 255) ? b : null;
}

function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0]!;
  // 끝이 IPv4 꼴이면 16비트 두 칸으로 바꾼다
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (tail) {
    const v4 = ipv4Bytes(tail[1]!);
    if (!v4) return null;
    s = s.slice(0, s.length - tail[1]!.length) + ((v4[0]! << 8) | v4[1]!).toString(16) + ":" + ((v4[2]! << 8) | v4[3]!).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const fill = 8 - head.length - rest.length;
  if (fill < (halves.length === 2 ? 1 : 0)) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function blockedV4(b: number[]): boolean {
  const [a, c] = [b[0]!, b[1]!];
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 ||
    a === 127 || // 루프백
    (a === 100 && c >= 64 && c <= 127) || // 공유 주소(CGNAT)
    (a === 169 && c === 254) || // 링크로컬(클라우드 메타데이터 포함)
    (a === 172 && c >= 16 && c <= 31) ||
    (a === 192 && c === 168) ||
    (a === 192 && c === 0 && b[2] === 0) || // 192.0.0.0/24
    (a === 198 && (c === 18 || c === 19)) || // 벤치마크
    a >= 224 // 멀티캐스트·예약·브로드캐스트
  );
}

/** 사설·루프백·링크로컬·예약 주소인가. 읽을 수 없는 글자도 막는다(true) */
export function isBlockedIp(ip: string): boolean {
  const v4 = ipv4Bytes(ip);
  if (v4) return blockedV4(v4);
  const g = ipv6Groups(ip);
  if (!g) return true;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4 매핑(::ffff:a.b.c.d)·호환(::a.b.c.d) → IPv4 규칙으로
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return blockedV4([g[6]! >> 8, g[6]! & 255, g[7]! >> 8, g[7]! & 255]);
  }
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 고유 로컬
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 링크로컬
  if ((g[0]! & 0xff00) === 0xff00) return true; // 멀티캐스트
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  if (g[0] === 0x2002) return blockedV4([g[1]! >> 8, g[1]! & 255, g[2]! >> 8, g[2]! & 255]); // 6to4
  return false;
}

/** 호스트 글자 → 모든 IP를 검사. 막히면 이유 글자, 괜찮으면 연결할 주소 */
type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<readonly string[]>;

const defaultResolve: Resolver = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((r) => r.address);

async function guardUrl(url: URL, resolve: Resolver): Promise<{ ok: true; target: Resolved } | { ok: false; reason: string }> {
  if (url.protocol !== "https:") return { ok: false, reason: "https 주소만 확인합니다" };
  if (url.username || url.password) return { ok: false, reason: "사용자 정보가 든 주소는 확인하지 않습니다" };
  if (url.port && url.port !== "443") return { ok: false, reason: "기본 포트(443)가 아닌 주소는 확인하지 않습니다" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return { ok: false, reason: "주소에 호스트가 없습니다" };
  if (host.toLowerCase() === "localhost" || host.toLowerCase().endsWith(".localhost")) return { ok: false, reason: "내부 주소는 확인하지 않습니다" };
  let addresses: readonly string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = await resolve(host);
    } catch {
      return { ok: false, reason: "주소를 찾을 수 없습니다(DNS)" };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: "주소를 찾을 수 없습니다(DNS)" };
  if (addresses.some(isBlockedIp)) return { ok: false, reason: "내부망·사설 주소로 연결되는 주소는 확인하지 않습니다" };
  const address = addresses[0]!;
  return { ok: true, target: { address, family: isIP(address) === 6 ? 6 : 4 } };
}

// ── 전송 ──────────────────────────────────────────────

export type HttpGet = (url: URL, o: { signal: AbortSignal; target: Resolved; headers: Record<string, string> }) => Promise<Response>;

/** 검사한 IP로 연결을 고정한 https GET — 리다이렉트는 따르지 않고 그대로 돌려준다 */
const pinnedGet: HttpGet = (url, { signal, target, headers }) =>
  new Promise<Response>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers,
        signal,
        lookup: (_host, options, cb) => {
          const entry = { address: target.address, family: target.family };
          if ((options as { all?: boolean }).all) (cb as unknown as (e: null, a: unknown[]) => void)(null, [entry]);
          else cb(null, entry.address, entry.family);
        },
      },
      (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode ?? 0;
        const hasBody = status !== 204 && status !== 304 && !(status >= 100 && status < 200);
        resolve(new Response(hasBody ? (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>) : null, { status, headers: h }));
      },
    );
    req.on("error", reject);
    req.end();
  });

export interface FetchCheckDeps {
  get?: HttpGet;
  resolve?: Resolver;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
}

class Fail extends Error {}

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Fail("시간 제한(8초)을 넘었습니다"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(res: Response, max: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new Fail(`페이지가 ${Math.round(max / 1024 / 1024)}MB를 넘습니다`);
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new Fail(`페이지가 ${Math.round(max / 1024 / 1024)}MB를 넘습니다`);
      chunks.push(value);
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

const failure = (reason: string): SourceCheck => ({ ok: false, reason, verified_on: null, license_type: null, license_status: null, license_basis: null, auto_verified: false });

/** 후보 주소를 받아 확인한다. 어떤 실패도 던지지 않고 SourceCheck(ok=false + 이유)로 돌려준다 */
export async function fetchCheck(rawUrl: string, deps: FetchCheckDeps = {}): Promise<SourceCheck> {
  const get = deps.get ?? pinnedGet;
  const resolve = deps.resolve ?? defaultResolve;
  const max = deps.maxBytes ?? FETCH_MAX_BYTES;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return failure("주소 형식이 올바르지 않습니다");
    }
    for (let hop = 0; ; hop++) {
      const guard = await guardUrl(url, resolve);
      if (!guard.ok) return failure(hop === 0 ? guard.reason : `리다이렉트 대상 거부: ${guard.reason}`);
      const res = await raceAbort(
        get(url, { signal: ac.signal, target: guard.target, headers: { accept: "text/html", "user-agent": "LocalTaxResearch-SourceCheck/1.0" } }),
        ac.signal,
      );
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        res.body?.cancel().catch(() => undefined);
        const loc = res.headers.get("location");
        if (!loc) return failure(`HTTP ${res.status} 이동 주소가 없습니다`);
        if (hop >= MAX_REDIRECTS) return failure(`리다이렉트가 ${MAX_REDIRECTS}번을 넘습니다`);
        try {
          url = new URL(loc, url);
        } catch {
          return failure("이동 주소 형식이 올바르지 않습니다");
        }
        continue;
      }
      if (res.status !== 200) {
        res.body?.cancel().catch(() => undefined);
        return failure(`원문이 열리지 않습니다 (HTTP ${res.status})`);
      }
      const type = res.headers.get("content-type") ?? "";
      if (!/^text\/html\b/i.test(type)) {
        res.body?.cancel().catch(() => undefined);
        return failure(`HTML 페이지가 아닙니다 (${type.split(";")[0] || "형식 없음"})`);
      }
      const html = decodeHtml(await readCapped(res, max, ac.signal), type);
      const kogl = readKogl(html);
      return {
        ok: true,
        reason: null,
        verified_on: isoToKstDate((deps.now?.() ?? new Date()).toISOString()),
        license_type: kogl?.type ?? null,
        license_status: kogl?.label ?? null,
        license_basis: kogl?.basis ?? null,
        auto_verified: true,
      };
    }
  } catch (e) {
    if (e instanceof Fail) return failure(e.message);
    if (ac.signal.aborted) return failure("시간 제한(8초)을 넘었습니다");
    return failure("원문을 받지 못했습니다");
  } finally {
    clearTimeout(timer);
  }
}

// ── 공공누리 읽기 ──────────────────────────────────────

export interface KoglReading {
  /** kogl_1 ~ kogl_4 */
  type: string;
  /** 이용 조건 후보 글자 — 페이지에 적힌 표시 (예: 공공누리 1유형(출처표시)) */
  label: string;
  /** 어디서 읽었는지 */
  basis: string;
}

const LINK_TYPES: Record<string, string> = { by: "kogl_1", by_nc: "kogl_2", by_nd: "kogl_3", by_nc_nd: "kogl_4" };
const TEXT_KOGL = /공공누리\s*(?:제\s*)?([1-4])\s*유형(?:\s*\(([^)<>]{1,30})\))?/g;
const LINK_KOGL = /kogl\.or\.kr\/open\/info\/license_info\/(by_nc_nd|by_nc|by_nd|by)\.do/gi;

/**
 * 페이지의 공공누리 표시 읽기 — '공공누리 제n유형'·'공공누리 n유형(…)' 글자(img alt 포함)와 kogl.or.kr …/by·by_nc·by_nd·by_nc_nd 링크.
 * 못 찾거나 서로 다른 유형이 함께 보이면 null(추측하지 않음).
 */
export function readKogl(html: string): KoglReading | null {
  const spaced = html.replace(/&nbsp;|&#160;/gi, " ");
  const texts = [spaced, spaced.replace(/<[^>]*>/g, " ")];
  const found = new Map<string, { label: string; basis: string }>();
  const put = (type: string, label: string, basis: string, better: boolean) => {
    const prev = found.get(type);
    if (!prev || (better && !/\(/.test(prev.label))) found.set(type, { label, basis });
  };
  for (const t of texts) {
    for (const m of t.matchAll(TEXT_KOGL)) {
      const paren = m[2]?.trim();
      put(`kogl_${m[1]}`, `공공누리 ${m[1]}유형${paren ? `(${paren})` : ""}`, `페이지 글자 "${m[0].replace(/\s+/g, " ").trim()}"`, paren !== undefined && paren !== "");
    }
  }
  for (const m of spaced.matchAll(LINK_KOGL)) {
    const type = LINK_TYPES[m[1]!.toLowerCase()]!;
    put(type, `공공누리 ${type.slice(-1)}유형`, `kogl.or.kr 링크 ${m[1]!.toLowerCase()}.do`, false);
  }
  if (found.size !== 1) return null;
  const [type, v] = [...found.entries()][0]!;
  return { type, label: v.label, basis: v.basis };
}
