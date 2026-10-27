import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseBriefingMax, selectBriefingItems, type BriefingCandidate, type BriefingItem } from "@/lib/briefing/select";
import { BRIEFING_MODES, NOTI_FREQUENCIES, NOTI_KINDS, groupDueByUser, isKstMonday, kstDay, notifyToken, renderBriefingMail, renderDigest, weekPeriod, type BriefingMode, type DueRow, type NotiFrequency, type NotiKind } from "@/lib/notify/logic";
import { featureOn, readSetting } from "../brief/policy";
import { guardSecret, mailEnv, siteUrl } from "../env";
import { sendMail } from "../mail";
import { mailConfigured } from "../mail/config";
import { currentVersion } from "../workspace/store";
import { isRevised } from "../workspace/logic";

// 알림·맞춤 브리핑 서버 (W13-d) - 수집은 DB 함수, 선정은 순수 규칙, 여기는 조립·발송이다. AI를 부르지 않는다.
// 메일은 설정·열쇠·사이트 주소가 모두 있을 때만 보낸다(없으면 웹 알림함만). 기록에는 건수만 남기고 주소·본문은 남기지 않는다.

type Db = SupabaseClient;
const fail = (what: string, code: string | undefined): never => {
  console.error(`[notify] ${what} 실패:`, code);
  throw new Error(`${what} 실패`);
};

function mailContext(): { secret: string; base: string } | null {
  const secret = guardSecret();
  const base = siteUrl();
  return secret && base && mailConfigured(mailEnv()) ? { secret, base: base.replace(/\/+$/, "") } : null;
}
const unsubscribeUrl = (ctx: { secret: string; base: string }, userId: string): string => `${ctx.base}/notifications/unsubscribe?token=${encodeURIComponent(notifyToken(ctx.secret, userId))}`;

async function emailOf(db: Db, userId: string): Promise<string | null> {
  const u = await db.auth.admin.getUserById(userId);
  return u.data.user?.email ?? null;
}

// ── 설정 ──────────────────────────────────────────────────
export interface Prefs {
  kinds: NotiKind[];
  frequency: NotiFrequency;
  briefing: BriefingMode;
}
export async function readNotiPrefs(db: Db, userId: string): Promise<Prefs> {
  const { data, error } = await db.from("notification_prefs").select("kinds, frequency, briefing").eq("user_id", userId).maybeSingle();
  if (error) fail("알림 설정 읽기", error.code);
  const d = data as { kinds?: string[]; frequency?: string; briefing?: string } | null;
  return {
    kinds: (d?.kinds ?? []).filter((k): k is NotiKind => (NOTI_KINDS as readonly string[]).includes(k)),
    frequency: (NOTI_FREQUENCIES as readonly string[]).includes(d?.frequency ?? "") ? (d!.frequency as NotiFrequency) : "daily",
    briefing: (BRIEFING_MODES as readonly string[]).includes(d?.briefing ?? "") ? (d!.briefing as BriefingMode) : "off",
  };
}
export async function saveNotiPrefs(db: Db, userId: string, p: Prefs): Promise<{ ok: boolean; code?: string }> {
  const { data, error } = await db.rpc("noti_prefs_set", { p_user: userId, p_kinds: p.kinds, p_frequency: p.frequency, p_briefing: p.briefing });
  if (error) fail("알림 설정 저장", error.code);
  const d = (data ?? {}) as { ok?: boolean; code?: string };
  return { ok: d.ok === true, code: d.code };
}
export async function unsubscribeUser(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db.rpc("noti_unsubscribe", { p_user: userId });
  if (error) fail("알림 거부", error.code);
  return data === true;
}

/** 지자체 허브 버튼 - 관심 지역에 담고(한도는 DB 트리거) 지역 알림을 켠다 */
export async function followRegion(db: Db, userId: string, regionCode: string): Promise<{ ok: boolean; code?: string }> {
  if (!/^[0-9]{10}$/.test(regionCode)) return { ok: false, code: "invalid" };
  const { data, error } = await db.from("profiles").select("interest_region_codes").eq("id", userId).maybeSingle();
  if (error) fail("관심 지역 읽기", error.code);
  const cur = ((data as { interest_region_codes?: string[] } | null)?.interest_region_codes ?? []) as string[];
  if (!cur.includes(regionCode)) {
    const up = await db.from("profiles").update({ interest_region_codes: [...cur, regionCode] }).eq("id", userId);
    if (up.error) return { ok: false, code: up.error.code === "check_violation" ? "region_limit" : "region_invalid" };
  }
  const p = await readNotiPrefs(db, userId);
  return saveNotiPrefs(db, userId, { ...p, kinds: p.kinds.includes("region") ? p.kinds : [...p.kinds, "region"] });
}

export interface InboxRow {
  id: number;
  kind: NotiKind;
  label: string;
  link: string;
  created_at: string;
  read_at: string | null;
}
export async function listInbox(db: Db, userId: string, limit = 50): Promise<InboxRow[]> {
  const { data, error } = await db.from("notifications").select("id, kind, label, link, created_at, read_at").eq("user_id", userId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
  if (error) fail("알림함 읽기", error.code);
  return (data ?? []) as InboxRow[];
}
export async function markRead(db: Db, userId: string, id: number, now: Date): Promise<NotiKind | null> {
  const { data, error } = await db.rpc("noti_read", { p_user: userId, p_id: id, p_now: now.toISOString() });
  if (error) fail("알림 읽음", error.code);
  return typeof data === "string" && (NOTI_KINDS as readonly string[]).includes(data) ? (data as NotiKind) : null;
}

// ── 수집·발송 ─────────────────────────────────────────────
async function collectLaw(db: Db, now: Date): Promise<number> {
  const prefs = await db.from("notification_prefs").select("user_id").contains("kinds", ["law"]);
  if (prefs.error) fail("조문 알림 대상 읽기", prefs.error.code);
  let added = 0;
  for (const p of (prefs.data ?? []) as { user_id: string }[]) {
    const scraps = await db.from("scraps").select("target_id, label, source_version").eq("user_id", p.user_id).eq("target_kind", "law_article").limit(200);
    for (const s of (scraps.data ?? []) as { target_id: string; label: string; source_version: string }[]) {
      const cur = await currentVersion(db, "law_article", s.target_id).catch(() => null);
      if (!isRevised(s.source_version, cur)) continue;
      const r = await db.rpc("noti_add_law", { p_user: p.user_id, p_target: `scrap:${s.target_id}`, p_content_id: `law:${s.target_id}@${cur}`, p_label: s.label, p_link: "/workspace/scraps", p_now: now.toISOString() });
      if (r.data === true) added += 1;
    }
  }
  return added;
}

export async function sendDueNotifications(db: Db, now: Date): Promise<{ mailed: number; web: number; failed: number }> {
  const due = await db.rpc("noti_due", { p_now: now.toISOString() });
  if (due.error) fail("보낼 알림 읽기", due.error.code);
  const ctx = mailContext();
  let mailed = 0;
  let web = 0;
  let failed = 0;
  for (const [userId, rows] of groupDueByUser((due.data ?? []) as DueRow[])) {
    const ids = rows.map((r) => Number(r.id));
    if (!rows.every((r) => r.mail)) {
      await db.rpc("noti_mark", { p_ids: ids, p_channel: "web", p_ok: true, p_now: now.toISOString() });
      web += ids.length;
      continue;
    }
    if (!ctx) continue; // 메일을 보낼 수 없으면 시도 횟수를 쓰지 않고 다음 실행을 기다린다
    const to = await emailOf(db, userId);
    let ok = false;
    if (to) {
      const m = renderDigest(rows, ctx.base, unsubscribeUrl(ctx, userId));
      ok = (await sendMail({ to, template: "amendment_alert", vars: { subjectTitle: m.subject, bodyText: m.text } })).ok;
    }
    await db.rpc("noti_mark", { p_ids: ids, p_channel: "mail", p_ok: ok, p_now: now.toISOString() });
    if (ok) mailed += ids.length;
    else failed += ids.length;
  }
  return { mailed, web, failed };
}

// ── 맞춤 브리핑 ───────────────────────────────────────────
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 한 회원의 후보 모으기 - 공개 기사(관심 분야·지역 / 저장 검색 제목 일치)와 승인·공개된 결정례 요지. 읽기뿐 */
export async function collectCandidates(db: Db, userId: string, now: Date): Promise<BriefingCandidate[]> {
  const out: BriefingCandidate[] = [];
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const prof = await db.from("profiles").select("interests, interest_region_codes").eq("id", userId).maybeSingle();
  const interests = ((prof.data as { interests?: string[] } | null)?.interests ?? []) as string[];
  const regions = ((prof.data as { interest_region_codes?: string[] } | null)?.interest_region_codes ?? []) as string[];
  if (interests.length > 0 || regions.length > 0) {
    const feed = await db.rpc("member_feed", { p_interests: interests, p_region_codes: regions, p_days: 7, p_limit: 50 });
    if (feed.error) fail("브리핑 후보(관심)", feed.error.code);
    for (const r of (feed.data ?? []) as { id: number; first_published_at: string; region_codes: string[] | null }[]) {
      const regional = (r.region_codes ?? []).some((rc) => regions.some((w) => rc === w || (w.endsWith("00000000") && rc.slice(0, 2) === w.slice(0, 2))));
      out.push({ type: "article", id: Number(r.id), reason: regional ? "region" : "interest", basisOn: kstDay(new Date(r.first_published_at)) });
    }
  }
  const ss = await db.from("saved_searches").select("conditions").eq("user_id", userId).limit(100);
  for (const s of (ss.data ?? []) as { conditions: { q?: string } }[]) {
    const q = typeof s.conditions?.q === "string" ? s.conditions.q.trim() : "";
    if (!q) continue;
    const hit = await db.from("public_articles").select("id, first_published_at").ilike("title", `%${likeEscape(q)}%`).gte("first_published_at", since).order("first_published_at", { ascending: false }).limit(20);
    for (const r of (hit.data ?? []) as { id: number; first_published_at: string }[]) out.push({ type: "article", id: Number(r.id), reason: "saved_search", basisOn: kstDay(new Date(r.first_published_at)) });
  }
  if (interests.some((i) => i === "tax" || i.startsWith("tax:"))) {
    const cs = await db.from("public_case_summaries").select("case_id, approved_on").gte("approved_on", kstDay(new Date(now.getTime() - 7 * 86400000)));
    for (const r of (cs.data ?? []) as { case_id: number; approved_on: string }[]) out.push({ type: "case_summary", id: Number(r.case_id), reason: "case_summary", basisOn: r.approved_on });
  }
  return out;
}

export interface BriefingViewItem {
  type: "article" | "case_summary";
  id: number;
  title: string;
  link: string;
  basisOn: string;
  reason: string;
  /** 승인된 요지 줄(결정례 요지) - 새로 만든 문장이 아니다 */
  lines: string[];
}
/** 저장된 항목을 지금의 공개 상태로 다시 읽는다 - 내려간 항목은 빠진다 */
export async function resolveItems(db: Db, items: readonly BriefingItem[]): Promise<BriefingViewItem[]> {
  const artIds = items.filter((i) => i.type === "article").map((i) => Number(i.id));
  const csIds = items.filter((i) => i.type === "case_summary").map((i) => Number(i.id));
  const [arts, sums, docs] = await Promise.all([
    artIds.length ? db.from("public_articles").select("id, slug, title").in("id", artIds) : Promise.resolve({ data: [] }),
    csIds.length ? db.from("public_case_summaries").select("case_id, summary_lines").in("case_id", csIds) : Promise.resolve({ data: [] }),
    csIds.length ? db.from("public_legal_docs").select("id, doc_type, issuer, doc_no").in("id", csIds) : Promise.resolve({ data: [] }),
  ]);
  const a = new Map(((arts.data ?? []) as { id: number; slug: string; title: string }[]).map((r) => [Number(r.id), r]));
  const s = new Map(((sums.data ?? []) as { case_id: number; summary_lines: string[] }[]).map((r) => [Number(r.case_id), r]));
  const d = new Map(((docs.data ?? []) as { id: number; doc_type: string; issuer: string; doc_no: string }[]).map((r) => [Number(r.id), r]));
  const out: BriefingViewItem[] = [];
  for (const i of items) {
    if (i.type === "article") {
      const r = a.get(Number(i.id));
      if (r) out.push({ type: "article", id: i.id, title: r.title, link: `/news/${r.slug}`, basisOn: i.basis_on, reason: i.reason, lines: [] });
    } else {
      const r = s.get(Number(i.id));
      const doc = d.get(Number(i.id));
      if (r && doc) out.push({ type: "case_summary", id: i.id, title: `${doc.issuer} ${doc.doc_no}`, link: `/cases/${doc.doc_type}/${doc.id}`, basisOn: i.basis_on, reason: i.reason, lines: r.summary_lines });
    }
  }
  return out;
}

export async function runBriefings(db: Db, now: Date): Promise<{ created: number; mailed: number; skipped: number }> {
  const max = parseBriefingMax(await readSetting(db, "briefing_policy"));
  if (max === 0) return { created: 0, mailed: 0, skipped: 0 };
  const period = weekPeriod(now);
  const users = await db.from("notification_prefs").select("user_id").neq("briefing", "off");
  if (users.error) fail("브리핑 대상 읽기", users.error.code);
  const ctx = mailContext();
  let created = 0;
  let mailed = 0;
  let skipped = 0;
  for (const u of (users.data ?? []) as { user_id: string }[]) {
    const items = selectBriefingItems(await collectCandidates(db, u.user_id, now), max);
    if (items.length === 0) {
      skipped += 1;
      continue;
    }
    const r = await db.rpc("briefing_create", { p_user: u.user_id, p_period: period, p_items: items, p_now: now.toISOString() });
    const d = (r.data ?? {}) as { ok?: boolean; created?: boolean; id?: number };
    if (r.error || !d.ok || !d.created || d.id === undefined) {
      if (!d.created) skipped += 1;
      continue;
    }
    created += 1;
    const row = await db.from("briefings").select("channel").eq("id", d.id).maybeSingle();
    if ((row.data as { channel?: string } | null)?.channel !== "mail" || !ctx) continue;
    const to = await emailOf(db, u.user_id);
    const view = await resolveItems(db, items);
    if (!to || view.length === 0) continue;
    const m = renderBriefingMail(period, view.map((v) => ({ title: v.title, link: v.link, basisOn: v.basisOn })), ctx.base, unsubscribeUrl(ctx, u.user_id));
    if ((await sendMail({ to, template: "amendment_alert", vars: { subjectTitle: m.subject, bodyText: m.text } })).ok) {
      await db.rpc("briefing_mark_sent", { p_id: d.id, p_now: now.toISOString() });
      mailed += 1;
    }
  }
  return { created, mailed, skipped };
}

export async function listBriefings(db: Db, userId: string, limit = 12): Promise<{ id: number; period: string; items: BriefingItem[]; opened_at: string | null }[]> {
  const { data, error } = await db.from("briefings").select("id, period, items, opened_at").eq("user_id", userId).order("period", { ascending: false }).limit(limit);
  if (error) fail("브리핑 읽기", error.code);
  return (data ?? []) as { id: number; period: string; items: BriefingItem[]; opened_at: string | null }[];
}
export async function openBriefing(db: Db, userId: string, id: number, now: Date): Promise<"web" | "mail" | null> {
  const { data, error } = await db.rpc("briefing_open", { p_user: userId, p_id: id, p_now: now.toISOString() });
  if (error) fail("브리핑 열람", error.code);
  return data === "web" || data === "mail" ? data : null;
}

/** 매일 작업(한국 08:15) - 수집 -> 발송 -> 월요일이면 브리핑. 기능 키가 꺼지면 해당 부분은 아무것도 하지 않는다 */
export async function runNotifyDaily(db: Db, now: Date): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  if (await featureOn(db, "my_notifications")) {
    const c = await db.rpc("noti_collect", { p_now: now.toISOString() });
    if (c.error) fail("알림 수집", c.error.code);
    out.collected = c.data;
    out.law = await collectLaw(db, now);
    out.sent = await sendDueNotifications(db, now);
  } else out.notifications = "flag_off";
  if (await featureOn(db, "my_briefings")) {
    out.briefings = isKstMonday(now) ? await runBriefings(db, now) : "not_monday";
  } else out.briefings = "flag_off";
  return out;
}
