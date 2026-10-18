// 수집 판정 한 곳 (POST /api/events — docs/dev/W2-c_설계.md 5장 표의 순서). 바깥 일(설정 읽기·로그인 확인·저장·시계·ID)은 deps로 받는다 —
// 경로 처리기(app/api/events/route.ts)는 요청을 이 함수에 넘기고 결과를 응답으로 바꾸기만 한다. 잘못된 입력은 언제나 4xx(500 0).
import { hasAuthCookie } from "@/lib/admin/proxy-rules";
import { isBotUserAgent } from "./bots";
import { dntSignal, refusalSignal } from "./consent";
import { classifyReferrer } from "./entry";
import { validateEvent, type Entry, type EventName, type Mode, type Tier } from "./events";
import { TokenBuckets, type Take } from "./rate-limit";
import { MAX_EVENT_BYTES, clientIp, isSameSite, mediaType, type BodyRead } from "./request";
import type { CollectSettings } from "./settings";
import { SESSION_COOKIE, VISITOR_COOKIE, forgetVisitCookies, parseCookies, resolveVisit, visitCookies } from "./visit";

/** analytics_events 한 행 — PRD-01A 6.1 칸 그대로 (id는 DB가 만든다) */
export interface EventRow {
  name: EventName;
  occurred_at: string;
  session_id: string;
  visitor_id: string;
  first_visit: boolean;
  stage: number;
  mode: Mode;
  tier: Tier;
  entry: Entry;
  section: string | null;
  props: Record<string, string | number | boolean>;
  is_bot: boolean;
  is_staff: boolean;
}

export interface IngestRequest {
  headers: { get(name: string): string | null };
  /** 본문을 상한까지 읽는다 (request.ts readLimited) */
  readBody: (maxBytes: number) => Promise<BodyRead>;
  /** 같은 사이트로 보는 호스트 — 요청 주소·Host 머리글·사이트 주소 */
  hosts: readonly (string | null | undefined)[];
  /** https 요청 (쿠키 Secure) */
  secure: boolean;
}

export interface IngestDeps {
  now: () => number;
  newId: () => string;
  /** 수집 설정 — 읽지 못하거나 모양이 틀리면 null */
  settings: () => Promise<CollectSettings | null>;
  limiter: TokenBuckets;
  /** IP → 속도 제한 열쇠 (해시) */
  ipKey: (ip: string) => string;
  /** 로그인 쿠키가 있을 때만 부른다 — 편집국·관리자면 true. 확인하지 못하면 던진다(→ 503) */
  isStaff: () => Promise<boolean>;
  /** 저장 — 실패하면 false */
  store: (row: EventRow) => Promise<boolean>;
}

export interface IngestResult {
  status: 202 | 204 | 400 | 403 | 413 | 415 | 429 | 503;
  body: Record<string, unknown> | null;
  cookies: string[];
  headers: Record<string, string>;
}

const reply = (status: IngestResult["status"], body: IngestResult["body"], cookies: string[] = [], headers: Record<string, string> = {}): IngestResult => ({
  status,
  body,
  cookies,
  headers,
});
const tooMany = (t: Extract<Take, { ok: false }>) => reply(429, { error: "요청이 너무 잦습니다 — 잠시 뒤 다시 보내 주세요" }, [], { "retry-after": String(t.retryAfterSeconds) });

/** 1단계 회원 등급 — 회원 기능(W2-e) 전에는 모두 비회원. 로그인 회원의 등급은 그때 서버가 정한다 */
const TIER: Tier = "guest";

export async function ingest(req: IngestRequest, deps: IngestDeps): Promise<IngestResult> {
  // 1 같은 사이트 · 2 본문 형식
  if (!isSameSite(req.headers, req.hosts)) return reply(403, { error: "다른 사이트에서 온 요청은 받지 않습니다" });
  if (mediaType(req.headers) !== "application/json") return reply(415, { error: "본문은 application/json이어야 합니다" });

  // 3 측정 거부·GPC — 본문을 읽지 않고, 방문자 ID를 만들지 않고, 남은 쿠키를 지운다
  const cookies = parseCookies(req.headers.get("cookie"));
  const forget = cookies.has(VISITOR_COOKIE) || cookies.has(SESSION_COOKIE) ? forgetVisitCookies(req.secure) : [];
  if (refusalSignal(cookies, req.headers)) return reply(204, null, forget);

  // 4 수집 설정 · 5 DNT(설정이 켰을 때만)
  const settings = await deps.settings();
  if (!settings) return reply(503, { error: "측정 설정을 읽지 못했습니다 — 잠시 뒤 다시 보내 주세요" });
  const { analytics } = settings;
  if (analytics.respect_dnt && dntSignal(req.headers)) return reply(204, null, forget);

  // 6 IP별 속도 제한 (IP는 해시 열쇠로만 — 저장·기록 0)
  const now = deps.now();
  const byIp = deps.limiter.take(deps.ipKey(clientIp(req.headers)), analytics.rate_limits.ip_per_minute, now);
  if (!byIp.ok) return tooMany(byIp);

  // 7 크기 · 8 형식
  const read = await req.readBody(MAX_EVENT_BYTES);
  if (!read.ok) return reply(413, { error: `본문이 너무 큽니다 (${MAX_EVENT_BYTES}바이트 이하)` });
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return reply(400, { error: "본문이 JSON 형식이 아닙니다" });
  }
  const checked = validateEvent(parsed);
  if (!checked.ok) return reply(400, { error: "이벤트 형식이 맞지 않습니다", errors: checked.errors });
  const event = checked.event;

  // 9 방문자·세션 · 방문자별 속도 제한
  const external = classifyReferrer(event.referrer, req.hosts.filter((h): h is string => typeof h === "string"), settings.referrers);
  const visit = resolveVisit({
    visitorCookie: cookies.get(VISITOR_COOKIE),
    sessionCookie: cookies.get(SESSION_COOKIE),
    nowMs: now,
    idleMinutes: analytics.session_idle_minutes,
    externalEntry: external,
    newId: deps.newId,
  });
  if (!visit.newVisitor) {
    const byVisitor = deps.limiter.take(`vid:${visit.visitorId}`, analytics.rate_limits.visitor_per_minute, now);
    if (!byVisitor.ok) return tooMany(byVisitor);
  }

  // 10 봇 · 편집국
  const isBot = isBotUserAgent(req.headers.get("user-agent"), settings.bots.patterns);
  let isStaff = false;
  if (hasAuthCookie([...cookies.keys()]) || req.headers.get("authorization") !== null) {
    try {
      isStaff = await deps.isStaff();
    } catch {
      return reply(503, { error: "로그인 정보를 확인하지 못했습니다 — 잠시 뒤 다시 보내 주세요" });
    }
  }

  // 11 저장
  const row: EventRow = {
    name: event.name,
    occurred_at: new Date(now).toISOString(),
    session_id: visit.session.id,
    visitor_id: visit.visitorId,
    first_visit: visit.session.firstVisit,
    stage: analytics.stage,
    mode: event.mode,
    tier: TIER,
    entry: event.entry ?? visit.session.entry,
    section: event.section,
    props: event.props,
    is_bot: isBot,
    is_staff: isStaff,
  };
  if (!(await deps.store(row))) return reply(503, { error: "이벤트를 저장하지 못했습니다 — 잠시 뒤 다시 보내 주세요" });
  // 받음 — 본문 없음 (브라우저는 읽지 않은 응답 본문이 남아 있으면 요청이 끝나지 않은 것으로 둔다)
  return reply(202, null, visitCookies(visit, { visitorDays: analytics.visitor_id_days, idleMinutes: analytics.session_idle_minutes, secure: req.secure }));
}
