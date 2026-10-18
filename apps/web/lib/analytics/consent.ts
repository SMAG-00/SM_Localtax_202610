// 측정 거부·GPC·DNT (GROW-01 · PRD-00 13장 — docs/dev/W2-c_설계.md 4장·5.1). 순수 모듈.
//  · 거부 쿠키(ltr_optout=1) 또는 브라우저 GPC 신호(Sec-GPC: 1)가 있으면 방문자 ID를 만들지 않고 저장 0 — 브라우저 도우미는 보내지도 않는다
//  · DNT는 설정 analytics.respect_dnt가 켜졌을 때만 거부로 본다 (설계 9장 #3)
import { REFUSAL_COOKIE, REFUSAL_MAX_AGE_SECONDS, clearCookie, forgetVisitCookies, setCookie } from "./visit";

type HeaderGetter = { get(name: string): string | null };

export type RefusalSignal = "optout" | "gpc";

/** 설정 없이 알 수 있는 거부 신호 — 거부 쿠키가 먼저 */
export function refusalSignal(cookies: ReadonlyMap<string, string>, headers: HeaderGetter): RefusalSignal | null {
  if (cookies.get(REFUSAL_COOKIE) === "1") return "optout";
  if (headers.get("sec-gpc")?.trim() === "1") return "gpc";
  return null;
}

export const dntSignal = (headers: HeaderGetter): boolean => headers.get("dnt")?.trim() === "1";

// ── 측정 거부 화면·API (설계 5.1) ───────────────────────────

export type MeasurementChoice = "refuse" | "allow";
export type MeasurementState = "measuring" | "refused" | "gpc";

/** 화면에 보일 지금 상태 — 거부 쿠키가 GPC보다 먼저 (사람이 직접 고른 것) */
export function measurementState(optedOut: boolean, gpc: boolean): MeasurementState {
  if (optedOut) return "refused";
  return gpc ? "gpc" : "measuring";
}

/** 폼(`choice=refuse`) 또는 JSON(`{"choice":"refuse"}`) 본문 → 고른 값. 모르는 값·형식은 null */
export function parseChoice(contentType: string, text: string): MeasurementChoice | null {
  let raw: unknown;
  if (contentType === "application/json") {
    try {
      const v: unknown = JSON.parse(text);
      raw = typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>).choice : undefined;
    } catch {
      return null;
    }
  } else raw = new URLSearchParams(text).get("choice");
  return raw === "refuse" || raw === "allow" ? raw : null;
}

/** 고른 값 → 쿠키. 거부는 거부 쿠키(스크립트가 읽는다 — HttpOnly 아님)를 쓰고 방문자·세션 쿠키를 지운다. 허용은 거부 쿠키만 지운다 */
export function choiceCookies(choice: MeasurementChoice, secure: boolean): string[] {
  if (choice === "refuse") return [setCookie(REFUSAL_COOKIE, "1", { maxAgeSeconds: REFUSAL_MAX_AGE_SECONDS, httpOnly: false, secure }), ...forgetVisitCookies(secure)];
  return [clearCookie(REFUSAL_COOKIE, secure, false)];
}

export const MEASUREMENT_PAGE = "/about/measurement";
