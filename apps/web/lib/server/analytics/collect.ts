import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { ingest, type EventRow, type IngestDeps, type IngestRequest } from "@/lib/analytics/ingest";
import { TokenBuckets, ipKey } from "@/lib/analytics/rate-limit";
import { readLimited, sameSiteHosts } from "@/lib/analytics/request";
import { COLLECT_SETTING_KEYS, parseCollectSettings, type CollectSettings } from "@/lib/analytics/settings";
import { isHttps } from "../cookie-options";
import { getViewer } from "../dal";
import { siteUrl } from "../env";
import { adminClient } from "../supabase";

// 수집 API의 바깥 일 (docs/dev/W2-c_설계.md 5장) — 설정 읽기(60초 메모리)·편집국 판정·저장. 판정 순서는 lib/analytics/ingest.ts 한 곳.
//  · service_role로만 쓴다 — 브라우저 역할(anon·authenticated)에는 analytics_events 권한이 없다 (RLS 기본 거부)
//  · 기록(로그)에는 오류 코드만 — User-Agent·IP·쿠키·본문은 찍지 않는다

/** 설정을 메모리에 두는 시간 — 바꾸면 늦어도 1분 뒤 적용 (설계 2.5) */
const SETTINGS_TTL_MS = 60_000;
let cached: { at: number; value: CollectSettings } | null = null;

async function collectSettings(): Promise<CollectSettings | null> {
  const now = Date.now();
  if (cached && now - cached.at < SETTINGS_TTL_MS) return cached.value;
  const db = adminClient();
  if (!db) {
    console.error("[analytics] 서버 설정 없음 (SUPABASE_SERVICE_ROLE_KEY) — 수집 503");
    return null;
  }
  const { data, error } = await db.from("settings").select("key, value").in("key", [...COLLECT_SETTING_KEYS]);
  if (error) {
    console.error("[analytics] 수집 설정 읽기 실패:", error.code);
    return null;
  }
  const parsed = parseCollectSettings((data ?? []) as { key: string; value: unknown }[]);
  if (!parsed.ok) {
    console.error("[analytics] 수집 설정 문제 —", parsed.problems.join(" / "));
    return null;
  }
  cached = { at: now, value: parsed.settings };
  return parsed.settings;
}

async function storeEvent(row: EventRow): Promise<boolean> {
  const db = adminClient();
  if (!db) return false;
  const { error } = await db.from("analytics_events").insert(row);
  if (error) {
    console.error("[analytics] 이벤트 저장 실패:", error.code);
    return false;
  }
  return true;
}

/** 서버(프로세스)마다 하나 — 속도 제한 통 · IP 해시 소금 (설계 5장). 소금은 저장하지 않아 다시 띄우면 바뀐다 */
const limiter = new TokenBuckets();
const salt = randomBytes(16).toString("hex");

export function collectDeps(request: Request): IngestDeps {
  return {
    now: () => Date.now(),
    newId: () => randomUUID(),
    settings: collectSettings,
    limiter,
    ipKey: (ip) => ipKey(ip, salt),
    // 편집국·관리자 — 역할이 하나라도 있거나 관리자(ADMIN_EMAILS). 회원 ID는 쓰지 않는다
    isStaff: async () => {
      const viewer = await getViewer(request);
      return viewer !== null && (viewer.isAdmin || viewer.roles.length > 0);
    },
    store: storeEvent,
  };
}

export function collectRequest(request: Request): IngestRequest {
  return {
    headers: request.headers,
    readBody: (max) => readLimited(request, max),
    hosts: sameSiteHosts(request, siteUrl()),
    secure: isHttps(request.headers, request.url),
  };
}

export async function collect(request: Request) {
  return ingest(collectRequest(request), collectDeps(request));
}
