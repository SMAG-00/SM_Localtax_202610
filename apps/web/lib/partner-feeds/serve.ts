import { bearerKey, hashSecret, parseKey, PepperMissingError } from "./keys";
import { toJsonFeed, toRss, type FeedItem } from "./render";

// 제휴 피드 요청 처리 (W13-i PART-01). 키 해시를 만들고 DB 함수 partner_feed_serve를 부른 뒤 RSS/JSON으로 바꾼다.
// 판정(폐기·계약 기간·기능 키·분당 한도·내용 선택)은 모두 DB 함수가 한다 - 여기서는 형식 검사와 응답 변환뿐이다.

export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

export interface ServeInput {
  authorization: string | null;
  format: string | null;
  limit: string | null;
  pepper: string | undefined;
  siteUrl: string | undefined;
  siteName: string;
  now?: Date;
}

export interface ServeOutput {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const baseHeaders = { "cache-control": "no-store", "x-robots-tag": "noindex" };
const jsonOut = (status: number, obj: unknown, extra: Record<string, string> = {}): ServeOutput => ({
  status,
  headers: { ...baseHeaders, "content-type": "application/json; charset=utf-8", ...extra },
  body: JSON.stringify(obj),
});

export function parseLimit(raw: string | null): number {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return 20;
  return Math.min(Math.max(Number(raw), 1), 50);
}

interface ServeResult {
  ok: boolean;
  status: number;
  code: string;
  scope?: "summary" | "full";
  retry_after?: number;
  items?: FeedItem[];
}

export async function serveFeed(db: RpcClient, input: ServeInput): Promise<ServeOutput> {
  const format = input.format === "json" ? "json" : "rss";
  if (input.format !== null && input.format !== "json" && input.format !== "rss") return jsonOut(400, { error: "format은 rss 또는 json입니다" });
  const raw = bearerKey(input.authorization);
  const parsed = raw ? parseKey(raw) : null;
  if (!parsed) return jsonOut(401, { error: "인증이 필요합니다", code: "unauthorized" }, { "www-authenticate": "Bearer" });
  let hash: string;
  try {
    hash = hashSecret(parsed.secret, input.pepper ?? "");
  } catch (err) {
    if (err instanceof PepperMissingError) return jsonOut(503, { error: "피드가 닫혀 있습니다", code: "closed" });
    throw err;
  }
  const now = input.now ?? new Date();
  const { data, error } = await db.rpc("partner_feed_serve", { p_feed_id: parsed.feedId, p_key_hash: hash, p_limit: parseLimit(input.limit), p_now: now.toISOString() });
  if (error) throw new Error(`partner_feed_serve 실패: ${error.code ?? ""} ${error.message}`);
  const r = data as ServeResult;
  if (!r.ok) {
    if (r.status === 401) return jsonOut(401, { error: "인증이 필요합니다", code: "unauthorized" }, { "www-authenticate": "Bearer" });
    if (r.status === 429) return jsonOut(429, { error: "요청이 너무 많습니다", code: "rate_limited" }, { "retry-after": String(r.retry_after ?? 60) });
    return jsonOut(503, { error: "피드가 닫혀 있습니다", code: "closed" });
  }
  const site = input.siteUrl;
  if (!site) return jsonOut(503, { error: "사이트 주소가 설정되지 않아 피드를 만들 수 없습니다", code: "closed" });
  const ctx = { siteUrl: site, siteName: input.siteName, scope: r.scope ?? "summary" } as const;
  const items = r.items ?? [];
  if (format === "json") return jsonOut(200, toJsonFeed(items, ctx));
  return { status: 200, headers: { ...baseHeaders, "content-type": "application/rss+xml; charset=utf-8" }, body: toRss(items, ctx, now.toISOString()) };
}
