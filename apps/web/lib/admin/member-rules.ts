// 회원·편집국 계정 관리 규칙 (ADM-02 조회·정지·역할 부여) — 순수 모듈. 계정 API·회원 화면·로그인 확인(DAL)이 같이 쓴다.
//  · 정지는 Supabase Auth의 ban(banned_until)으로 한다. 정지된 계정은 로그인할 수 없고(인증 서버가 거부),
//    이미 받은 토큰·쿠키 세션도 DAL(getViewer)이 banned_until을 보고 거부한다 — 토큰 만료를 기다리지 않는다.
//  · 자기 계정과 관리자 계정(ADMIN_EMAILS)은 화면에서 정지하지 않는다 — 관리자 권한은 배포 환경변수로 먼저 뺀다.

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 정지 기간 — 해제할 때까지 (Supabase Auth ban_duration 형식, 100년) */
export const SUSPEND_DURATION = "876000h";

/** banned_until이 지금보다 뒤면 정지. 읽을 수 없는 값은 정지로 본다(닫힌 쪽) */
export function isSuspended(bannedUntil: string | null | undefined, nowMs: number): boolean {
  if (bannedUntil === null || bannedUntil === undefined || bannedUntil.trim() === "") return false;
  const t = Date.parse(bannedUntil);
  return Number.isNaN(t) ? true : t > nowMs;
}

export function parseSuspensionInput(raw: Record<string, unknown>): Result<{ suspend: boolean; reason: string }> {
  const errors: string[] = [];
  for (const key of Object.keys(raw)) if (key !== "suspend" && key !== "reason") errors.push(`suspension.${key}: 모르는 칸입니다`);
  if (typeof raw.suspend !== "boolean") errors.push("suspension.suspend: true/false여야 합니다");
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (errors.length === 0 && (reason === "" || reason.length > 500)) errors.push("suspension.reason: 사유를 적어야 합니다 (감사 기록)");
  return errors.length ? { ok: false, errors } : { ok: true, value: { suspend: raw.suspend as boolean, reason } };
}

/** 정지할 수 없는 사유 — 정지할 수 있으면 null */
export function suspendBlocked(p: { targetId: string; viewerId: string; targetIsAdmin: boolean }): string | null {
  if (p.targetId === p.viewerId) return "자기 계정은 정지할 수 없습니다";
  if (p.targetIsAdmin) return "관리자 계정은 정지할 수 없습니다 — 먼저 배포 환경변수 관리자 목록(ADMIN_EMAILS)에서 빼세요";
  return null;
}

/** 이메일 검색어 — 2~100자, 공백·쉼표 없이. 이메일은 소문자로 저장되므로 소문자로 맞춘다. 쓸 수 없으면 null */
export function memberSearchQuery(raw: string | null | undefined): string | null {
  const q = (raw ?? "").trim().toLowerCase();
  if (q.length < 2 || q.length > 100 || /[\s,%*()]/.test(q)) return null;
  return q;
}
