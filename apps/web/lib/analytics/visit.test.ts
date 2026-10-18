// 방문자 ID·세션·첫 방문 시험 (GROW-01 — "29분 뒤 이동은 같은 세션, 31분 뒤 이동은 새 세션이고 first_visit=false")
import { describe, expect, test } from "vitest";
import {
  REFUSAL_MAX_AGE_SECONDS,
  forgetVisitCookies,
  isUuid,
  parseCookies,
  parseSession,
  resolveVisit,
  serializeSession,
  setCookie,
  visitCookies,
  type SessionState,
} from "./visit";

const VID = "3f1c2b9a-6d4e-4f8a-9b2c-1e0d5a7c8b6f";
const SID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const T0 = Date.UTC(2026, 9, 18, 1, 0, 0);
const MIN = 60_000;

function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

const session = (over: Partial<SessionState> = {}): string => serializeSession({ id: SID, lastActivityMs: T0, firstVisit: true, entry: "search", ...over });
const at = (minutesLater: number, sessionCookie: string | null = session(), visitor: string | null = VID) =>
  resolveVisit({ visitorCookie: visitor, sessionCookie, nowMs: T0 + minutesLater * MIN, idleMinutes: 30, externalEntry: null, newId: ids() });

describe("새 브라우저 — 방문자 ID가 생기고 그 세션 이벤트는 first_visit=true", () => {
  test("쿠키가 없으면 새 방문자 + 새 세션, 진입 경로는 리퍼러 분류 값(없으면 direct)", () => {
    const v = resolveVisit({ visitorCookie: undefined, sessionCookie: undefined, nowMs: T0, idleMinutes: 30, externalEntry: "naver", newId: ids() });
    expect(v).toEqual({
      visitorId: "00000000-0000-4000-8000-000000000001",
      newVisitor: true,
      newSession: true,
      session: { id: "00000000-0000-4000-8000-000000000002", lastActivityMs: T0, firstVisit: true, entry: "naver" },
    });
    expect(resolveVisit({ visitorCookie: undefined, sessionCookie: undefined, nowMs: T0, idleMinutes: 30, externalEntry: null, newId: ids() }).session.entry).toBe("direct");
  });

  test("방문자 쿠키 모양이 틀리면(위조·이메일·빈 값) 새 방문자로 본다 — 세션 쿠키가 남아 있어도", () => {
    for (const bad of ["", "hong@example.com", "123", `${VID}x`, VID.replace(/-/g, "")]) {
      const v = at(1, session(), bad);
      expect(v.newVisitor, bad).toBe(true);
      expect(v.session.firstVisit).toBe(true);
      expect(v.session.id).not.toBe(SID);
    }
  });

  test("대문자 UUID 방문자 쿠키는 소문자로 같은 방문자", () => {
    expect(at(1, session(), VID.toUpperCase()).visitorId).toBe(VID);
  });
});

describe("세션 경계 30분 무활동 (GROW-01)", () => {
  test("29분 뒤 → 같은 세션, first_visit 그대로(true), 진입 경로 그대로", () => {
    const v = at(29);
    expect(v).toMatchObject({ visitorId: VID, newVisitor: false, newSession: false });
    expect(v.session).toEqual({ id: SID, lastActivityMs: T0 + 29 * MIN, firstVisit: true, entry: "search" });
  });

  test("29분 59.999초 → 같은 세션, 정확히 30분 → 새 세션", () => {
    expect(resolveVisit({ visitorCookie: VID, sessionCookie: session(), nowMs: T0 + 30 * MIN - 1, idleMinutes: 30, externalEntry: null, newId: ids() }).newSession).toBe(false);
    expect(at(30).newSession).toBe(true);
  });

  test("31분 뒤 → 새 세션이고 first_visit=false, 진입 경로는 새로 분류(없으면 direct)", () => {
    const v = at(31);
    expect(v).toMatchObject({ visitorId: VID, newVisitor: false, newSession: true });
    expect(v.session.firstVisit).toBe(false);
    expect(v.session.id).not.toBe(SID);
    expect(v.session.entry).toBe("direct");
  });

  test("첫 방문이 아닌 세션은 이어져도 false", () => {
    expect(at(10, session({ firstVisit: false })).session.firstVisit).toBe(false);
  });

  test("세션 길이를 설정으로 바꾸면 경계도 바뀐다 (코드 상수 0)", () => {
    const v = (minutes: number) => resolveVisit({ visitorCookie: VID, sessionCookie: session(), nowMs: T0 + minutes * MIN, idleMinutes: 10, externalEntry: null, newId: ids() });
    expect(v(9).newSession).toBe(false);
    expect(v(10).newSession).toBe(true);
  });

  test("세션 쿠키가 없거나 모양이 틀리면 새 세션(first_visit=false)", () => {
    for (const bad of [null, "", "x.y.z.w", `${SID}.abc.1.search`, `${SID}.${T0}.2.search`, `${SID}.${T0}.1.travel`, `${SID}.${T0}.1`]) {
      const v = at(1, bad);
      expect(v.newSession, String(bad)).toBe(true);
      expect(v.session.firstVisit).toBe(false);
    }
  });

  test("마지막 활동이 서버 시각보다 1분 넘게 앞날이면(시계 조작) 새 세션, 1분 안 차이는 같은 세션", () => {
    expect(at(0, session({ lastActivityMs: T0 + 61_000 })).newSession).toBe(true);
    const near = at(0, session({ lastActivityMs: T0 + 30_000 }));
    expect(near.newSession).toBe(false);
    expect(near.session.lastActivityMs).toBe(T0 + 30_000);
  });

  test("이어지는 세션에 다른 사이트에서 다시 들어오면 세션 진입 경로를 바꾼다, 사이트 안 이동(null)은 그대로", () => {
    const back = resolveVisit({ visitorCookie: VID, sessionCookie: session(), nowMs: T0 + 5 * MIN, idleMinutes: 30, externalEntry: "ai_answer_engine", newId: ids() });
    expect(back.session).toMatchObject({ id: SID, entry: "ai_answer_engine" });
    expect(at(5).session.entry).toBe("search");
  });
});

describe("세션 쿠키 값", () => {
  test("쓰고 읽으면 같다", () => {
    const s: SessionState = { id: SID, lastActivityMs: T0, firstVisit: false, entry: "tax_lens" };
    expect(serializeSession(s)).toBe(`${SID}.${T0}.0.tax_lens`);
    expect(parseSession(serializeSession(s))).toEqual(s);
  });
  test("UUID 판정", () => {
    expect(isUuid(VID)).toBe(true);
    expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid("3f1c2b9a-6d4e-4f8a-7b2c-1e0d5a7c8b6f")).toBe(false); // 변형 자리 7
    expect(isUuid(1)).toBe(false);
  });
});

describe("쿠키", () => {
  test("Cookie 머리글 읽기 — 공백·따옴표·같은 이름(앞의 것)·= 없는 조각", () => {
    const m = parseCookies(` ltr_vid=${VID}; a="b"; junk; ltr_vid=other; sb-x-auth-token=t=1`);
    expect(m.get("ltr_vid")).toBe(VID);
    expect(m.get("a")).toBe("b");
    expect(m.get("sb-x-auth-token")).toBe("t=1");
    expect(m.has("junk")).toBe(false);
    expect(parseCookies(null).size).toBe(0);
  });

  test("방문자 쿠키는 새 방문자일 때만 HttpOnly로 365일(설정), 세션 쿠키는 이벤트마다 30분(설정)", () => {
    const fresh = resolveVisit({ visitorCookie: undefined, sessionCookie: undefined, nowMs: T0, idleMinutes: 30, externalEntry: null, newId: ids() });
    const out = visitCookies(fresh, { visitorDays: 365, idleMinutes: 30, secure: true });
    expect(out).toEqual([
      "ltr_vid=00000000-0000-4000-8000-000000000001; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure",
      `ltr_sid=00000000-0000-4000-8000-000000000002.${T0}.1.direct; Path=/; Max-Age=1800; SameSite=Lax; HttpOnly; Secure`,
    ]);
    const again = visitCookies(at(5), { visitorDays: 365, idleMinutes: 30, secure: false });
    expect(again).toEqual([`ltr_sid=${SID}.${T0 + 5 * MIN}.1.search; Path=/; Max-Age=1800; SameSite=Lax; HttpOnly`]);
  });

  test("측정 거부 — 방문자·세션 쿠키를 지운다 (Max-Age=0)", () => {
    expect(forgetVisitCookies(false)).toEqual(["ltr_vid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly", "ltr_sid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly"]);
  });

  test("거부 쿠키 수명은 브라우저 상한 400일 — 음수 수명은 0", () => {
    expect(REFUSAL_MAX_AGE_SECONDS).toBe(400 * 24 * 3600);
    expect(setCookie("x", "1", { maxAgeSeconds: -5, httpOnly: false, secure: false })).toBe("x=1; Path=/; Max-Age=0; SameSite=Lax");
  });
});
