// 대화 보존·저장 끄기 순수 규칙 (W12-d d5, ASK-12 · COMPLY-03). 기간 값은 설정 ask_retention(회원)·도우미 보존일(비회원)에서만 온다 - 결정 전에는 글 저장 0.
export type RetentionKind = "guest" | "member";

/** 회원 보존일 읽기: 양의 정수만. 없으면 null(회원 대화 글 저장 0) */
export function memberRetentionDays(retention: unknown): number | null {
  if (typeof retention !== "object" || retention === null) return null;
  const v = (retention as Record<string, unknown>).member_days;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : null;
}

/** 이 세션의 글을 서버에 저장하는가: 저장 끔이면 0, 회원인데 보존일이 비어 있으면 0 */
export function shouldStoreText(p: { kind: RetentionKind; saveEnabled: boolean; memberDays: number | null }): boolean {
  if (!p.saveEnabled) return false;
  return p.kind === "guest" ? true : p.memberDays !== null;
}

/** 기한이 지났는가 - 기한 시각 정각 포함(retain_until <= now). 두 기한(비회원·회원)을 각자 값으로 따로 판정한다 */
export function isExpired(retainUntil: Date, now: Date): boolean {
  return retainUntil.getTime() <= now.getTime();
}

export function retainUntil(createdAt: Date, days: number): Date {
  return new Date(createdAt.getTime() + days * 86_400_000);
}

export interface PurgeRow {
  kind: RetentionKind;
  retainUntil: Date;
}

/** 파기 대상 분류 (DB 함수 agent_purge와 같은 규칙의 기준 구현 - 단위 시험이 경계를 고정) */
export function purgeTargets(rows: PurgeRow[], now: Date): { guest: number; member: number } {
  const out = { guest: 0, member: 0 };
  for (const r of rows) if (isExpired(r.retainUntil, now)) out[r.kind] += 1;
  return out;
}
