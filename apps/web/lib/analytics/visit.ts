// 익명 방문자 ID·세션·첫 방문 (GROW-01 — docs/dev/W2-c_설계.md 2.4·5장). 순수 모듈 — 시계와 ID 만들기는 입력으로 받는다.
//  · 방문자 ID: 무작위 UUID 하나(개인정보·회원 ID·시각 없음). 측정이 허용된 첫 이벤트 때 서버가 만든다 — 쿠키 ltr_vid(HttpOnly)
//  · 세션: 마지막 활동에서 session_idle_minutes분(설정 — 씨앗 30분) 미만이면 같은 세션. 29분 → 같은 세션 · 30분·31분 → 새 세션
//  · 첫 방문: 새 방문자 ID로 시작한 세션의 이벤트는 모두 first_visit=true, 방문자 ID가 있는데 새로 시작한 세션은 false
import type { Entry } from "./events";
import { ENTRIES } from "./events";

export const VISITOR_COOKIE = "ltr_vid";
export const SESSION_COOKIE = "ltr_sid";
export const REFUSAL_COOKIE = "ltr_optout";
/** 측정 거부 쿠키 수명 — 브라우저 상한 400일. 거부는 설정값으로 약해지지 않게 코드에 둔다 (설계 2.4) */
export const REFUSAL_MAX_AGE_SECONDS = 400 * 86_400;
/** 서버끼리 시계가 조금 다를 때 받아 주는 앞날 — 이보다 앞선 마지막 활동은 조작된 값으로 보고 새 세션 */
const CLOCK_SKEW_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(\d{1,15})\.([01])\.([a-z_]{1,24})$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export interface SessionState {
  id: string;
  lastActivityMs: number;
  firstVisit: boolean;
  /** 세션 진입 경로 */
  entry: Entry;
}

/** 세션 쿠키 값 → 상태. 모양이 틀리면 null (새 세션) */
export function parseSession(raw: string | undefined | null): SessionState | null {
  const m = raw ? SESSION.exec(raw) : null;
  if (!m) return null;
  const entry = m[4] as Entry;
  if (!(ENTRIES as readonly string[]).includes(entry)) return null;
  return { id: m[1]!, lastActivityMs: Number(m[2]), firstVisit: m[3] === "1", entry };
}

export function serializeSession(s: SessionState): string {
  return `${s.id}.${Math.trunc(s.lastActivityMs)}.${s.firstVisit ? "1" : "0"}.${s.entry}`;
}

export interface VisitInput {
  visitorCookie: string | undefined | null;
  sessionCookie: string | undefined | null;
  nowMs: number;
  idleMinutes: number;
  /** 이번 요청의 바깥 리퍼러가 정한 진입 경로 — 리퍼러가 없거나 이 사이트면 null */
  externalEntry: Entry | null;
  newId: () => string;
}

export interface Visit {
  visitorId: string;
  /** 이번 요청에서 방문자 ID를 새로 만들었다 → 쿠키를 쓴다 */
  newVisitor: boolean;
  newSession: boolean;
  /** 쿠키에 다시 쓸 세션 (마지막 활동 = 지금) */
  session: SessionState;
}

/** 방문자·세션 정하기 (설계 5장) */
export function resolveVisit(input: VisitInput): Visit {
  const idleMs = input.idleMinutes * 60_000;
  const now = input.nowMs;
  const vid = input.visitorCookie?.toLowerCase();
  if (!isUuid(vid)) {
    return {
      visitorId: input.newId(),
      newVisitor: true,
      newSession: true,
      session: { id: input.newId(), lastActivityMs: now, firstVisit: true, entry: input.externalEntry ?? "direct" },
    };
  }
  const prev = parseSession(input.sessionCookie);
  const alive = prev !== null && prev.lastActivityMs <= now + CLOCK_SKEW_MS && now - prev.lastActivityMs < idleMs;
  if (!alive) {
    return {
      visitorId: vid,
      newVisitor: false,
      newSession: true,
      session: { id: input.newId(), lastActivityMs: now, firstVisit: false, entry: input.externalEntry ?? "direct" },
    };
  }
  // 이어지는 세션 — 다른 사이트에서 다시 들어왔으면 세션 진입 경로를 그 값으로 바꾼다
  return {
    visitorId: vid,
    newVisitor: false,
    newSession: false,
    session: { id: prev.id, lastActivityMs: Math.max(now, prev.lastActivityMs), firstVisit: prev.firstVisit, entry: input.externalEntry ?? prev.entry },
  };
}

// ── 쿠키 ─────────────────────────────────────────────────

/** Cookie 머리글 → 이름별 값 (같은 이름이 여럿이면 앞의 것) */
export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    if (!name || out.has(name)) continue;
    let value = part.slice(i + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    out.set(name, value);
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  httpOnly: boolean;
  secure: boolean;
}

/** Set-Cookie 한 줄 — Path=/ · SameSite=Lax 고정 (설계 2.4) */
export function setCookie(name: string, value: string, o: CookieOptions): string {
  const parts = [`${name}=${value}`, "Path=/", `Max-Age=${Math.max(0, Math.trunc(o.maxAgeSeconds))}`, "SameSite=Lax"];
  if (o.httpOnly) parts.push("HttpOnly");
  if (o.secure) parts.push("Secure");
  return parts.join("; ");
}

export const clearCookie = (name: string, secure: boolean, httpOnly = true): string => setCookie(name, "", { maxAgeSeconds: 0, httpOnly, secure });

/** 방문자·세션 쿠키 쓰기 — 방문자 ID는 만들 때 한 번만(수명이 방문마다 늘지 않는다 — 설계 9장 #8) */
export function visitCookies(visit: Visit, o: { visitorDays: number; idleMinutes: number; secure: boolean }): string[] {
  const out: string[] = [];
  if (visit.newVisitor) out.push(setCookie(VISITOR_COOKIE, visit.visitorId, { maxAgeSeconds: o.visitorDays * 86_400, httpOnly: true, secure: o.secure }));
  out.push(setCookie(SESSION_COOKIE, serializeSession(visit.session), { maxAgeSeconds: o.idleMinutes * 60, httpOnly: true, secure: o.secure }));
  return out;
}

/** 측정 거부 — 방문자·세션 쿠키를 지운다 */
export const forgetVisitCookies = (secure: boolean): string[] => [clearCookie(VISITOR_COOKIE, secure), clearCookie(SESSION_COOKIE, secure)];
