import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAuthCookie } from "@/lib/admin/proxy-rules";
import { isBotUserAgent } from "@/lib/analytics/bots";
import { dntSignal, refusalSignal } from "@/lib/analytics/consent";
import { addDays, kstDate } from "@/lib/analytics/metrics";
import {
  QUERY_TERMS,
  QUERY_TERMS_SETTING_KEY,
  RecentSearches,
  isPrefetch,
  isSameSearch,
  maskQuery,
  periodOf,
  readQueryTermsSettings,
  resolveTermsPeriod,
  skipReason,
  storable,
  type SkipReason,
  type TermsPeriod,
} from "@/lib/analytics/query-terms";
import { ipKey } from "@/lib/analytics/rate-limit";
import { clientIp, sameSiteHosts } from "@/lib/analytics/request";
import { VISITOR_COOKIE, isUuid, parseCookies } from "@/lib/analytics/visit";
import { squash } from "@/lib/server/public/search-normalize";
import { getViewer } from "../dal";
import { siteUrl } from "../env";
import { adminClient } from "../supabase";
import { isStaffViewer, readCollectSettings } from "./collect";

// 검색어 집계의 바깥 일 (SRCH-03 — docs/dev/W2-d_설계.md 8.3) — 규칙은 lib/analytics/query-terms.ts(순수) 한 곳.
//  · 검색 화면(/search)과 검색 API(/api/search)가 검색을 마친 뒤 countSiteSearch를 부른다. 세는 검색이면 응답을 보낸 뒤(after) 가린 값만
//    query_terms_add(service_role)로 더한다 — 검색 응답은 기다리지 않고, 실패해도 검색은 그대로 된다
//  · 검색어 원문은 저장·기록하지 않는다 — 기록(로그)에는 오류 이름·DB 오류 코드만. 측정 이벤트(search_submitted)에도 검색어 칸이 없다(W2-c 2.2)
//  · 봇(설정 bot_user_agents)·편집국·관리자·측정 거부·GPC(설정이 켜면 DNT)·미리 받기·2쪽 이상·같은 검색 안 이동·30분 안 다시 찾기는 세지 않는다
//  · 편집국 화면(/admin/query-terms)은 기간을 고른 보고(query_terms_report)를 읽고, 보존 기한 정리는 analytics-retention 배치가 한다

/**
 * 서버(프로세스)마다 하나 — 30분 안 다시 찾기 열쇠 · IP 해시 소금 (저장하지 않아 다시 띄우면 바뀐다).
 * Next는 검색 화면(서버 컴포넌트)과 검색 API(라우트 처리기)에서 이 모듈을 따로 불러오므로, 모듈 변수 대신 프로세스 전역 하나에 둔다 —
 * 같은 방문자가 화면과 API로 번갈아 찾아도 한 번. 서버가 여러 대(서버리스 인스턴스)면 인스턴스마다 따로다 (설계 12장 #46)
 */
const SHARED = Symbol.for("ltr.query-terms.recent");
type Shared = { recent: RecentSearches; salt: string };
const holder = globalThis as unknown as Record<symbol, Shared | undefined>;
const shared: Shared = (holder[SHARED] ??= { recent: new RecentSearches(), salt: randomBytes(16).toString("hex") });

export interface SiteSearchRequest {
  headers: { get(name: string): string | null };
  /** 같은 사이트로 보는 호스트 — Referer가 같은 검색 화면인지 볼 때 */
  hosts: readonly (string | null | undefined)[];
  /** 로그인 쿠키·Authorization 머리글이 있을 때만 부른다 — 편집국·관리자면 true. 확인하지 못하면 던진다(→ 세지 않는다) */
  isStaff: () => Promise<boolean>;
}

export type CountOutcome = "counted" | SkipReason | "unavailable";

export interface StoredTerm {
  term: string;
  normalized: string;
  period: string;
  at: string;
}

/** 가린 값 한 번 더하기 (service_role) — 실패하면 false (기록에는 DB 오류 코드만) */
export async function storeSiteSearch(row: StoredTerm, db: SupabaseClient | null = adminClient()): Promise<boolean> {
  if (!db) return false;
  const { error } = await db.rpc("query_terms_add", { p_source: "site_search", p_term_masked: row.term, p_normalized: row.normalized, p_period: row.period, p_at: row.at, p_count: 1 });
  if (error) {
    console.error("[search] 검색어 집계 저장 실패:", error.code ?? "응답 없음");
    return false;
  }
  return true;
}

/**
 * 검색 한 번 — 세는 검색이면 응답 뒤에 가린 값을 더한다. 결과(세었는지·왜 아닌지)는 시험·진단용이고 검색 응답에는 쓰지 않는다.
 * 어떤 오류도 던지지 않는다(검색이 먼저다)
 */
export async function countSiteSearch(req: SiteSearchRequest, search: { q: string; page: number }, nowMs: number = Date.now()): Promise<CountOutcome> {
  try {
    const m = maskQuery(search.q);
    const cookies = parseCookies(req.headers.get("cookie"));
    const signals = {
      storable: storable(m),
      page: search.page,
      prefetch: isPrefetch(req.headers),
      refused: refusalSignal(cookies, req.headers) !== null,
      bot: false,
      staff: false,
      sameSearch: false,
    };
    const early = skipReason(signals);
    if (early) return early;
    const settings = await readCollectSettings();
    if (!settings) return "unavailable";
    signals.refused = settings.analytics.respect_dnt && dntSignal(req.headers);
    signals.bot = isBotUserAgent(req.headers.get("user-agent"), settings.bots.patterns);
    if (!signals.bot && !signals.refused && (hasAuthCookie([...cookies.keys()]) || req.headers.get("authorization") !== null)) {
      try {
        signals.staff = await req.isStaff();
      } catch {
        return "unavailable";
      }
    }
    signals.sameSearch = isSameSearch(req.headers.get("referer"), req.hosts, m.normalized);
    const reason = skipReason(signals);
    if (reason) return reason;
    const visitor = cookies.get(VISITOR_COOKIE);
    const who = isUuid(visitor) ? `v:${visitor}` : `ip:${ipKey(clientIp(req.headers), shared.salt)}`;
    if (shared.recent.seen(`${who}|${m.normalized}`, nowMs)) return "repeat";
    const row: StoredTerm = { term: m.text, normalized: m.normalized, period: periodOf(nowMs), at: new Date(nowMs).toISOString() };
    after(async () => {
      await storeSiteSearch(row);
    });
    return "counted";
  } catch (err) {
    console.error("[search] 검색어 집계 판정 실패:", err instanceof Error ? err.name : "오류");
    return "unavailable";
  }
}

// ── 편집국 화면 (/admin/query-terms) ─────────────────────────

export interface QueryTermRow {
  normalized: string;
  termMasked: string;
  count: number;
  days: number;
  firstSeen: string;
  lastSeen: string;
  /** 동의어 사전에 같은 열쇠(정규형을 붙인 낱말)의 줄이 있으면 그 줄 */
  synonym: { id: number; enabled: boolean } | null;
}

export interface QueryTermsReport {
  period: TermsPeriod;
  periodError: string | null;
  retentionDays: number;
  minCount: number;
  /** 기간 안 정규형 수 · 최소 횟수 이상인 정규형 수 · 검색 합계 */
  terms: number;
  shown: number;
  searches: number;
  rows: QueryTermRow[];
  computedAt: string;
}

const fail = (what: string, error: { code?: string } | null | undefined) => new Error(`${what} 실패 (${error?.code ?? "응답 없음"})`);

async function readSettingsRow(db: SupabaseClient) {
  const { data, error } = await db.from("settings").select("value").eq("key", QUERY_TERMS_SETTING_KEY).maybeSingle();
  if (error) throw fail("검색어 집계 설정 읽기", error);
  const settings = readQueryTermsSettings(data?.value);
  if (!settings) throw new Error(`설정 ${QUERY_TERMS_SETTING_KEY}이 없거나 모양이 틀립니다`);
  return settings;
}

interface ReportPayload {
  terms: number;
  shown: number;
  searches: number;
  rows: { normalized: string; term_masked: string; count: number; days: number; first_seen: string; last_seen: string }[];
}

/** 화면 값 — 기간(?days=·?from=&to=)을 고르고, 기간 안 날 행을 정규형마다 더한 보고. 화면을 열 때마다 다시 센다 */
export async function loadQueryTermsReport(db: SupabaseClient, query: { days?: string; from?: string; to?: string }, now: Date): Promise<QueryTermsReport> {
  const settings = await readSettingsRow(db);
  const { period, error: periodError } = resolveTermsPeriod(query, now.getTime(), settings.retention_days);
  const { data, error } = await db.rpc("query_terms_report", {
    p_source: "site_search",
    p_from: period.from,
    p_to: period.to,
    p_min_count: settings.display_min_count,
    p_limit: QUERY_TERMS.listSize,
  });
  if (error) throw fail("검색어 집계 읽기", error);
  const r = data as ReportPayload;
  const keys = [...new Set(r.rows.map((x) => squash(x.normalized)))];
  const synonyms = new Map<string, { id: number; enabled: boolean }>();
  if (keys.length > 0) {
    const s = await db.from("search_synonyms").select("id, term_key, enabled").in("term_key", keys);
    if (s.error) throw fail("동의어 사전 읽기", s.error);
    for (const row of (s.data ?? []) as { id: number; term_key: string; enabled: boolean }[]) synonyms.set(row.term_key, { id: Number(row.id), enabled: row.enabled });
  }
  return {
    period,
    periodError,
    retentionDays: settings.retention_days,
    minCount: settings.display_min_count,
    terms: Number(r.terms),
    shown: Number(r.shown),
    searches: Number(r.searches),
    rows: r.rows.map((x) => ({
      normalized: x.normalized,
      termMasked: x.term_masked,
      count: Number(x.count),
      days: Number(x.days),
      firstSeen: new Date(x.first_seen).toISOString(),
      lastSeen: new Date(x.last_seen).toISOString(),
      synonym: synonyms.get(squash(x.normalized)) ?? null,
    })),
    computedAt: now.toISOString(),
  };
}

// ── 보존 기한 정리 (analytics-retention 배치) ─────────────────

const PURGE_BATCH = 5000;
const PURGE_ROUNDS = 20;

/** 보존 일수(설정 query_terms.retention_days)보다 오래된 날 행을 나눠 지운다 — 오늘(한국 날짜)에서 보존 일수를 뺀 날보다 앞선 날. 다 못 지우면 done=false */
export async function purgeQueryTerms(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const settings = await readSettingsRow(db);
  const before = addDays(kstDate(now.getTime()), -settings.retention_days);
  let removed = 0;
  for (let round = 0; round < PURGE_ROUNDS; round++) {
    const { data, error } = await db.rpc("query_terms_purge", { p_before: before, p_limit: PURGE_BATCH });
    if (error) throw fail("검색어 집계 보존 기한 정리", error);
    removed += Number(data);
    if (Number(data) < PURGE_BATCH) return { retentionDays: settings.retention_days, before, removed, done: true };
  }
  return { retentionDays: settings.retention_days, before, removed, done: false };
}

// ── 부르는 곳 두 군데 ─────────────────────────────────────

const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
};

/** 검색 화면(/search — 서버 컴포넌트) — 요청 머리글과 쿠키 세션으로. q는 주소의 검색어 그대로(자르기 전 — 경계에 걸친 번호도 통째로 가린다) */
export async function countPageSearch(q: string, page: number): Promise<CountOutcome> {
  const h = await headers();
  return countSiteSearch({ headers: h, hosts: [h.get("host"), hostOf(siteUrl())], isStaff: async () => isStaffViewer(await getViewer()) }, { q, page });
}

/** 검색 API(/api/search — 라우트 처리기) — Bearer 머리글도 로그인으로 본다 */
export async function countApiSearch(request: Request, q: string, page: number): Promise<CountOutcome> {
  return countSiteSearch({ headers: request.headers, hosts: sameSiteHosts(request, siteUrl()), isStaff: async () => isStaffViewer(await getViewer(request)) }, { q, page });
}
