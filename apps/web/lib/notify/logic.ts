import { createHmac, timingSafeEqual } from "node:crypto";

// 알림·브리핑 순수 규칙 (W13-d) - 주차, 수신 거부 토큰, 묶음 글. 서버 전용 코드를 부르지 않는다.

export const NOTI_KINDS = ["law", "saved_search", "region", "calendar"] as const;
export type NotiKind = (typeof NOTI_KINDS)[number];
/** 화면에 내놓는 종류 - calendar는 수집기가 생길 때까지 내놓지 않는다 (준비 중 표시 0) */
export const NOTI_UI_KINDS = ["law", "saved_search", "region"] as const;
export const NOTI_KIND_LABEL: Record<NotiKind, string> = { law: "관심 조문 개정", saved_search: "저장 검색 새 결과", region: "관심 지역 소식", calendar: "지방세 달력 기한" };
export const NOTI_FREQUENCIES = ["instant", "daily", "weekly"] as const;
// 화면에 보이는 선택지 - 발송이 하루 한 번(08:15 KST)뿐이라 "즉시"는 보이지 않는다. instant는 이미 저장된 값 호환용으로만 받는다
export const NOTI_UI_FREQUENCIES = ["daily", "weekly"] as const;
export type NotiFrequency = (typeof NOTI_FREQUENCIES)[number];
export const NOTI_FREQ_LABEL: Record<NotiFrequency, string> = { instant: "즉시", daily: "하루 한 번", weekly: "주 한 번" };
export const BRIEFING_MODES = ["off", "web", "mail"] as const;
export type BriefingMode = (typeof BRIEFING_MODES)[number];

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** 한국 날짜 YYYY-MM-DD */
export function kstDay(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국 시각 기준 월요일인가 */
export function isKstMonday(now: Date): boolean {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCDay() === 1;
}

/** 한국 날짜 기준 ISO 주차 'YYYY-Www' (목요일이 속한 해) */
export function weekPeriod(now: Date): string {
  const d = new Date(Date.parse(`${kstDay(now)}T00:00:00Z`));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** 수신 거부 토큰 `<userId>.<hmac>` - 버튼 한 번으로 거부할 때 쓴다 */
export function notifyToken(secret: string, userId: string): string {
  return `${userId}.${createHmac("sha256", secret).update(`noti-unsub:${userId}`).digest("base64url")}`;
}
export function verifyNotifyToken(secret: string, token: string): string | null {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m || !secret) return null;
  const want = Buffer.from(notifyToken(secret, m[1]));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

export interface DueRow {
  id: number;
  user_id: string;
  kind: NotiKind;
  label: string;
  link: string;
  mail: boolean;
}
export function groupDueByUser(rows: readonly DueRow[]): Map<string, DueRow[]> {
  const out = new Map<string, DueRow[]>();
  for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r]);
  return out;
}

const SERVICE = "선명 지방세·부동산";

/** 알림 묶음 메일 - 제목·링크만, 본문 사본·해석 문장 0. 끝에 수신 거부 링크 */
export function renderDigest(rows: readonly Pick<DueRow, "kind" | "label" | "link">[], base: string, unsubscribeUrl: string): { subject: string; text: string } {
  const lines = rows.map((r) => `- [${NOTI_KIND_LABEL[r.kind]}] ${r.label}\n  ${base}${r.link}`);
  return {
    subject: `[${SERVICE}] 새 알림 ${rows.length}건`,
    text: [...lines, "", `알림함: ${base}/my/notifications`, `수신 거부: ${unsubscribeUrl}`].join("\n"),
  };
}

export interface BriefingMailItem {
  title: string;
  link: string;
  basisOn: string;
}
export function renderBriefingMail(period: string, items: readonly BriefingMailItem[], base: string, unsubscribeUrl: string): { subject: string; text: string } {
  const lines = items.map((i) => `- ${i.title} (기준일 ${i.basisOn})\n  ${base}${i.link}`);
  return {
    subject: `[${SERVICE}] 맞춤 브리핑 ${period}`,
    text: [...lines, "", `웹에서 보기: ${base}/my/briefings`, `수신 거부: ${unsubscribeUrl}`].join("\n"),
  };
}
