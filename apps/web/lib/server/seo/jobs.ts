import "server-only";
import { createSign } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDate } from "@/lib/analytics/metrics";
import { datesToCollect, indexnowDecision, readServiceAccount, toTermRows, type ServiceAccount } from "@/lib/seo/search-console";
import { lastmodOf } from "@/lib/seo/sitemap";
import { indexingGate, loadPublicArticles } from "./load";

// 서치 콘솔 수집·IndexNow 전송 배치 (W7 · OPT-01) — 하루 1회. 외부 호출은 주입한 fetch로 하므로 시험은 가짜 응답으로 돈다.
//  · 자격 증명(SEARCH_CONSOLE_CREDENTIALS)·사이트(SEARCH_CONSOLE_SITE)가 없으면 실패가 아니라 'skipped'로 끝난다(실행 기록에 사유)
//  · 수집이 실패하면 오류를 던져 실행 기록이 failed가 되고, 다음 실행이 최근 3일을 다시 채운다 — 한 날은 덮어쓰기로 저장해 멱등이다
//  · SITE_INDEXING=off 동안 IndexNow 전송 0 (네트워크 요청 0)
type Fetch = typeof fetch;

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");

async function accessToken(account: ServiceAccount, fetchImpl: Fetch, nowSec: number): Promise<string> {
  const uri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const claim = { iss: account.client_email, scope: SCOPE, aud: uri, iat: nowSec, exp: nowSec + 3000 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key);
  const res = await fetchImpl(uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`서치 콘솔 토큰 요청 실패 (${res.status})`);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== "string") throw new Error("서치 콘솔 토큰 응답 모양이 틀립니다");
  return body.access_token;
}

export interface CollectDeps {
  fetchImpl?: Fetch;
  env?: { SEARCH_CONSOLE_SITE?: string; SEARCH_CONSOLE_CREDENTIALS?: string };
}

export async function collectSearchConsole(db: SupabaseClient, now: Date, deps: CollectDeps = {}): Promise<Record<string, unknown>> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const site = env.SEARCH_CONSOLE_SITE?.trim();
  const account = readServiceAccount(env.SEARCH_CONSOLE_CREDENTIALS);
  if (!site || !account) return { status: "skipped", reason: "서치 콘솔 설정(SEARCH_CONSOLE_SITE·SEARCH_CONSOLE_CREDENTIALS)이 없습니다" };
  const gate = await indexingGate();
  if (!gate.open) return { status: "skipped", reason: "색인 관문이 닫혀 있어 수집하지 않습니다" };

  const token = await accessToken(account, fetchImpl, Math.floor(now.getTime() / 1000));
  const days: Record<string, number> = {};
  for (const date of datesToCollect(kstDate(now.getTime()))) {
    const res = await fetchImpl(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ startDate: date, endDate: date, dimensions: ["query"], rowLimit: 1000, type: "web" }),
    });
    if (!res.ok) throw new Error(`서치 콘솔 질의 요청 실패 (${res.status}, ${date})`);
    const rows = toTermRows(((await res.json()) as { rows?: unknown }).rows);
    if (rows.length > 0) {
      const at = now.toISOString();
      const { error } = await db
        .from("query_terms")
        .upsert(
          rows.map((r) => ({ source: "search_console", term_masked: r.term, normalized: r.normalized, period: date, count: r.count, first_seen: at, last_seen: at })),
          { onConflict: "normalized,source,period" },
        );
      if (error) throw new Error(`서치 콘솔 질의 저장 실패 (${error.code ?? "응답 없음"})`);
    }
    days[date] = rows.length;
  }
  return { status: "ok", days };
}

export interface IndexNowDeps {
  fetchImpl?: Fetch;
  env?: { INDEXNOW_KEY?: string };
}

/** 최근 하루 안 발행·실질 수정된 공개 기사 주소를 IndexNow로 보낸다 — 꺼짐·색인 관문 닫힘·열쇠 없음이면 요청 0 */
export async function submitIndexNow(now: Date, deps: IndexNowDeps = {}): Promise<Record<string, unknown>> {
  const env = deps.env ?? process.env;
  const gate = await indexingGate();
  const key = env.INDEXNOW_KEY?.trim();
  const decision = indexnowDecision({ indexingOpen: gate.open, enabled: gate.settings?.indexnow === true, keyPresent: !!key });
  if (!decision.send || !gate.site || !key) return { status: "skipped", reason: decision.reason };
  const since = now.getTime() - 24 * 3600_000;
  const urls = (await loadPublicArticles()).filter((a) => Date.parse(lastmodOf(a)) >= since).map((a) => `${gate.site}/news/${a.slug}`);
  if (urls.length === 0) return { status: "ok", sent: 0 };
  const res = await (deps.fetchImpl ?? fetch)("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(gate.site).host, key, keyLocation: `${gate.site}/indexnow-key.txt`, urlList: urls }),
  });
  if (!res.ok) throw new Error(`IndexNow 전송 실패 (${res.status})`);
  return { status: "ok", sent: urls.length };
}
