import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AD_PREFIX, BRIEF_CORNERS, REQUIRED_CORNER_KEYS, calendarOccurrences, issueSlug, issueSubject, kstDate, nextPublishAt, renderIssueText, runBriefChecks, STAGE_LABELS, isConfirmedStage, type AmendmentStage, type BriefCorner, type BriefDoc, type CollectedCorners } from "@ltr/workflows/ops";
import { ACTION_TRIGGER_WORDS } from "@ltr/editorial";
import { hashToken, newToken } from "@/lib/brief/input";
import { deriveToken, selectPremiumRecipients } from "@/lib/brief/subscribe";
import { guardSecret, mailEnv, siteUrl } from "../env";
import { hasEntitlementKey } from "../billing/service";
import { sendMail } from "../mail";
import { mailConfigured } from "../mail/config";
import { featureOn, readBriefPolicy, type BriefPolicy } from "./policy";

// 브리핑 호 운영 (W10-e - BRIEF-01~04 · HOME-09). 초안 만들기 -> 검사기 8종 -> 승인(DB 함수) -> 정시 발행 -> 발송.
//  · 상태 전이와 발행 시각 판정은 DB 함수가 한다(승인 전 발행 0, 발행 시각 전 발행 0). 여기는 호출·조립·발송이다
//  · 발송은 alert_deliveries 자리 잡기(유일)를 거쳐서 작업을 다시 돌려도 수신자당 1통이다
//  · 메일 설정·열쇠·사이트 주소 중 하나라도 없으면 발송 0 (웹 아카이브만)

export const EMPTY_NOTE = "이번 호에는 해당 소식이 없습니다";
// 코너 구성은 SM 호 구조를 옮긴 workflows/src/ops/sm-brief.ts 한 곳에서 정한다
export const CORNER_DEFS = BRIEF_CORNERS;

type Db = SupabaseClient;
export interface IssueRow {
  id: number;
  issue_no: number;
  kind: "regular" | "premium";
  title: string;
  publish_at: string;
  corners: BriefCorner[];
  source_excerpts: Record<string, string>;
  has_ad: boolean;
  status: "draft" | "approved" | "published" | "withdrawn";
  check_report: { blocking: number; warnings: number; findings: unknown[]; checked_at: string } | null;
  published_at: string | null;
}
const COLS = "id, issue_no, kind, title, publish_at, corners, source_excerpts, has_ad, status, check_report, published_at";
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

/** 달력 표(brief_calendar_items)에서 발행일 기준 30일 안에 걸리는 날짜를 "알아둘 날짜" 항목으로 - 표가 없거나 비어 있으면 빈 목록 */
async function calendarItemsOf(db: Db, publishAt: Date, excerpts: Record<string, string>): Promise<BriefCorner["items"]> {
  const r = await db.from("brief_calendar_items").select("id, text, is_always, is_yearly, start_md, end_md, start_on, end_on").eq("active", true);
  if (r.error) return [];
  const rows = (r.data ?? []) as { id: number; text: string; is_always: boolean; is_yearly: boolean; start_md: string | null; end_md: string | null; start_on: string | null; end_on: string | null }[];
  const from = kstDate(publishAt);
  const to = kstDate(new Date(publishAt.getTime() + 30 * 86_400_000));
  const occ = calendarOccurrences(rows.map((x) => ({ id: x.id, text: x.text, isAlways: x.is_always, isYearly: x.is_yearly, startMd: x.start_md, endMd: x.end_md, startOn: x.start_on, endOn: x.end_on })), from, to);
  return occ.map((o) => {
    const id = `cal-${o.id}`;
    const dates = [o.start, o.end].filter((d): d is string => !!d);
    if (dates.length > 0) excerpts[id] = dates.join(" ");
    return { id, origin: "human" as const, reviewed: true, text: dates.length > 0 ? `${dates.join(" ~ ")} ${o.text}` : o.text, ...(o.start ? { sourceDate: o.start } : {}) };
  });
}

/** 진행 중 개정안 표(brief_ongoing_items) -> 개정 코너 항목. 확정 전 단계로 보고 "확정 아님"을 붙인다(편집자가 공포·시행 단계로 고치면 그때 사라진다) */
async function ongoingItemsOf(db: Db, excerpts: Record<string, string>): Promise<BriefCorner["items"]> {
  const r = await db.from("brief_ongoing_items").select("id, name, stage, as_of, source_url, points").eq("active", true).order("id");
  if (r.error) return [];
  return ((r.data ?? []) as { id: number; name: string; stage: string; as_of: string; source_url: string | null; points: string[] }[]).map((x) => {
    const id = `on-${x.id}`;
    if (x.points.length > 0) excerpts[id] = x.points.join("\n");
    return {
      id, origin: "human" as const, reviewed: true, sourceDate: x.as_of, ...(x.source_url ? { sourceUrl: x.source_url } : {}),
      text: `${x.name} - ${x.stage} 확정 아님 (기준일 ${x.as_of})`,
      amendment: { stageLabel: x.stage, confirmed: false },
    };
  });
}

/** 다음 정기 발행 시각의 초안 호를 만든다(같은 발행 시각의 호가 있으면 그대로). 개정 코너는 지난 호 이후 공개된 단계 기록으로 채운다 - 문장은 단계 이름·제목·일자뿐 */
export async function assembleDraft(db: Db, now: Date, actor: string, collected?: Pick<CollectedCorners, "items" | "excerpts">): Promise<{ id: number; created: boolean }> {
  const policy = await readBriefPolicy(db);
  const publishAt = nextPublishAt(now, policy.publish);
  const dup = await db.from("brief_issues").select("id").eq("kind", "regular").eq("publish_at", publishAt.toISOString()).limit(1);
  if (dup.error) throw fail("brief_issues 조회", dup.error);
  if (dup.data?.[0]) return { id: Number((dup.data[0] as { id: number }).id), created: false };

  const last = await db.from("brief_issues").select("issue_no, published_at").order("issue_no", { ascending: false }).limit(1);
  if (last.error) throw fail("brief_issues 조회", last.error);
  const lastRow = last.data?.[0] as { issue_no: number; published_at: string | null } | undefined;
  const since = lastRow?.published_at ?? new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const events = await db
    .from("amendment_events")
    .select("id, stage, occurred_on, source_url, snapshot_id, amendments!inner(title, status)")
    .eq("amendments.status", "public").eq("skipped", false).is("correction_of", null).gt("recorded_at", since).order("id");
  if (events.error) throw fail("amendment_events 조회", events.error);

  const excerpts: Record<string, string> = {};
  const items: BriefCorner["items"] = [];
  for (const e of (events.data ?? []) as unknown as { id: number; stage: AmendmentStage; occurred_on: string; source_url: string; snapshot_id: number; amendments: { title: string } }[]) {
    const id = `am-${e.id}`;
    const confirmed = isConfirmedStage(e.stage);
    items.push({
      id, origin: "system", reviewed: true, sourceUrl: e.source_url, sourceDate: e.occurred_on,
      text: `${e.amendments.title} - ${STAGE_LABELS[e.stage]} 단계 (${e.occurred_on})${confirmed ? "" : " 확정 아님"}`,
      amendment: { stageLabel: STAGE_LABELS[e.stage], confirmed },
    });
    const snap = await db.from("raw_snapshots").select("payload").eq("id", e.snapshot_id).limit(1);
    if (!snap.error && snap.data?.[0]) excerpts[id] = String((snap.data[0] as { payload: string }).payload).slice(0, 20_000);
  }
  const issueNo = lastRow ? lastRow.issue_no + 1 : 0;
  // 사람이 관리하는 표(달력·진행 중 개정안) - 표가 아직 없으면 빈 코너로 둔다
  Object.assign(excerpts, collected?.excerpts ?? {});
  const bodyOf: Record<string, BriefCorner["items"]> = { ...(collected?.items ?? {}), amendments: [...items, ...(await ongoingItemsOf(db, excerpts))], dates: await calendarItemsOf(db, publishAt, excerpts) };
  const corners: BriefCorner[] = CORNER_DEFS.map((c) => ({ key: c.key, title: c.title, items: bodyOf[c.key] ?? [], emptyNote: EMPTY_NOTE }));
  const ins = await db.from("brief_issues").insert({
    issue_no: issueNo, kind: "regular", title: `브리핑 ${issueNo}호 (${issueSlug(publishAt)})`, publish_at: publishAt.toISOString(), corners, source_excerpts: excerpts, created_by: actor,
  }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") return { id: -1, created: false }; // 동시에 만든 호 - 다음 실행이 이어 본다
    throw fail("brief_issues 저장", ins.error);
  }
  return { id: Number((ins.data as { id: number }).id), created: true };
}

/** 링크 열림 확인 - https만, 사설 주소 거부, 5초 */
export async function probeLinks(urls: readonly string[]): Promise<Record<string, "ok" | "broken">> {
  const out: Record<string, "ok" | "broken"> = {};
  for (const u of new Set(urls)) {
    try {
      const url = new URL(u);
      if (url.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
        out[u] = "broken";
        continue;
      }
      let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(5000) });
      if (res.status === 405) res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(5000) });
      out[u] = res.status < 400 ? "ok" : "broken";
    } catch {
      out[u] = "broken";
    }
  }
  return out;
}

export function docOf(issue: IssueRow, policy: BriefPolicy, linkStatus: BriefDoc["linkStatus"]): BriefDoc {
  return {
    title: issue.title, subject: issueSubject(issue.title, issue.has_ad), hasAd: issue.has_ad, corners: issue.corners, requiredCorners: REQUIRED_CORNER_KEYS,
    footer: policy.footer, excerpts: issue.source_excerpts, linkStatus,
    forbiddenWords: [...ACTION_TRIGGER_WORDS, ...policy.forbiddenWords], reviewLabelAllowed: policy.reviewLabelAllowed,
  };
}

export async function loadIssue(db: Db, id: number): Promise<IssueRow> {
  const r = await db.from("brief_issues").select(COLS).eq("id", id).limit(1);
  if (r.error) throw fail("brief_issues 조회", r.error);
  const row = r.data?.[0] as unknown as IssueRow | undefined;
  if (!row) throw new Error("그런 브리핑 호가 없습니다");
  return row;
}

/** 검사기 8종을 돌려 보고서를 호에 남긴다(본문이 바뀌면 DB가 보고서를 비운다) */
export async function checkIssue(db: Db, id: number, now: Date, probe: typeof probeLinks = probeLinks) {
  const [issue, policy] = [await loadIssue(db, id), await readBriefPolicy(db)];
  if (issue.status !== "draft") throw new Error("초안만 검사할 수 있습니다");
  const urls = issue.corners.flatMap((c) => c.items.flatMap((i) => [i.sourceUrl, ...(i.links ?? [])].filter((u): u is string => !!u)));
  const report = runBriefChecks(docOf(issue, policy, await probe(urls)));
  const upd = await db.from("brief_issues").update({ check_report: { blocking: report.blocking, warnings: report.warnings, findings: report.findings, checked_at: now.toISOString() } }).eq("id", id);
  if (upd.error) throw fail("검사 보고서 저장", upd.error);
  return report;
}

// ── 발행·발송 ─────────────────────────────────────────────

function sendContext(): { secret: string; base: string } | null {
  const secret = guardSecret();
  const base = siteUrl();
  return secret && base && mailConfigured(mailEnv()) ? { secret, base: base.replace(/\/+$/, "") } : null;
}

async function recipientsOf(db: Db, issue: IssueRow, today: string, policy: BriefPolicy): Promise<{ consent_id: number; email: string }[]> {
  if (issue.kind === "regular") {
    const r = await db.rpc("brief_recipients", { p_issue_id: issue.id, p_today: today });
    if (r.error) throw fail("brief_recipients", r.error);
    return (r.data ?? []) as { consent_id: number; email: string }[];
  }
  // 프리미엄(BRIEF-05) - 수신 동의 + 디지털 구독 권한이 둘 다 있을 때만. 권한 키 설정이 비어 있으면 0
  if (policy.premiumEntitlementKey === "") return [];
  const c = await db.from("consents").select("id, user_id, confirmed_at, revoked_at, reconfirm_due").eq("kind", "brief").not("user_id", "is", null);
  if (c.error) throw fail("consents 조회", c.error);
  const rows = ((c.data ?? []) as { id: number; user_id: string; confirmed_at: string | null; revoked_at: string | null; reconfirm_due: string | null }[]).filter((x) => x.reconfirm_due === null || x.reconfirm_due >= today);
  const entitled = new Set<string>();
  for (const x of rows) {
    if (await hasEntitlementKey(db, x.user_id, policy.premiumEntitlementKey)) entitled.add(x.user_id);
  }
  const out: { consent_id: number; email: string }[] = [];
  for (const p of selectPremiumRecipients(rows.map((x) => ({ consentId: x.id, userId: x.user_id, confirmed: !!x.confirmed_at, revoked: !!x.revoked_at })), entitled)) {
    const u = await db.auth.admin.getUserById(p.userId);
    if (u.data.user?.email) out.push({ consent_id: p.consentId, email: u.data.user.email });
  }
  return out;
}

/** 발행된 호를 수신자에게 보낸다 - 자리 잡기(claim)가 유일이라 재실행해도 1통, 실패는 3회까지 다시 시도 */
export async function sendIssue(db: Db, issue: IssueRow, now: Date): Promise<{ sent: number; failed: number; skipped?: string }> {
  const ctx = sendContext();
  if (!ctx) return { sent: 0, failed: 0, skipped: "mail_not_ready" };
  const policy = await readBriefPolicy(db);
  const today = kstDate(now);
  let sent = 0;
  let failed = 0;
  for (const r of await recipientsOf(db, issue, today, policy)) {
    const claim = await db.rpc("alert_delivery_claim", { p_consent_id: r.consent_id, p_kind: "brief_issue", p_ref: String(issue.id) });
    if (claim.error || claim.data !== true) continue;
    const text = renderIssueText({
      title: issue.title, corners: issue.corners, footer: policy.footer,
      webUrl: `${ctx.base}/brief/${issueSlug(new Date(issue.publish_at))}`, unsubscribeUrl: `${ctx.base}/brief/unsubscribe?token=${deriveToken(ctx.secret, "revoke", r.consent_id)}`,
    });
    const ok = (await sendMail({ to: r.email, template: "brief_issue", vars: { subjectTitle: issueSubject(issue.title, issue.has_ad), bodyText: text } })).ok;
    await db.rpc("alert_delivery_mark", { p_consent_id: r.consent_id, p_kind: "brief_issue", p_ref: String(issue.id), p_ok: ok });
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 사전 알림 신청자에게 처음 발행되는 일반 호 안내를 1회 (HOME-09) - 구독 동의로 자동 전환하지 않는다 */
export async function sendPreregNotices(db: Db): Promise<{ sent: number; failed: number }> {
  const ctx = sendContext();
  if (!ctx) return { sent: 0, failed: 0 };
  const r = await db.rpc("prereg_notice_recipients");
  if (r.error) throw fail("prereg_notice_recipients", r.error);
  let sent = 0;
  let failed = 0;
  for (const p of (r.data ?? []) as { consent_id: number; email: string }[]) {
    const claim = await db.rpc("alert_delivery_claim", { p_consent_id: p.consent_id, p_kind: "prereg_notice", p_ref: "first_issue" });
    if (claim.error || claim.data !== true) continue;
    // 사전 알림 철회 토큰은 신청 때 메일로 한 번 나갔고 평문이 없다 - 새 철회 토큰을 만들어 해시를 갈아 끼운다(이전 링크는 이 안내 메일 링크로 대체)
    const revoke = newToken();
    const upd = await db.from("consents").update({ revoke_token_hash: hashToken(revoke) }).eq("id", p.consent_id);
    const ok = !upd.error && (await sendMail({ to: p.email, template: "brief_launch_notice", vars: { link: `${ctx.base}/brief/subscribe`, unsubscribeLink: `${ctx.base}/brief/unsubscribe?token=${revoke}` } })).ok;
    await db.rpc("alert_delivery_mark", { p_consent_id: p.consent_id, p_kind: "prereg_notice", p_ref: "first_issue", p_ok: ok });
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 정시 발행 작업 - 발행 시각이 지난 승인 호를 발행(DB 판정)하고, 최근 발행 호를 발송한다. 일반 호가 처음 발행되면 사전 알림 신청자에게 안내 */
export async function publishDue(db: Db, now: Date): Promise<Record<string, unknown>> {
  if (!(await featureOn(db, "brief_regular"))) return { skipped: "flag_off" };
  const due = await db.rpc("brief_issues_due", { p_now: now.toISOString() });
  if (due.error) throw fail("brief_issues_due", due.error);
  const published: number[] = [];
  for (const d of (due.data ?? []) as { id: number }[]) {
    const r = await db.rpc("brief_issue_publish", { p_id: d.id, p_now: now.toISOString() });
    if (r.error) throw fail("brief_issue_publish", r.error);
    if (r.data === "published") published.push(Number(d.id));
  }
  const recent = await db.from("brief_issues").select(COLS).eq("status", "published").gt("published_at", new Date(now.getTime() - 86_400_000).toISOString()).order("id");
  if (recent.error) throw fail("brief_issues 조회", recent.error);
  let sent = 0;
  let failed = 0;
  let prereg = { sent: 0, failed: 0 };
  for (const issue of (recent.data ?? []) as unknown as IssueRow[]) {
    const s = await sendIssue(db, issue, now);
    sent += s.sent;
    failed += s.failed;
    if (issue.kind === "regular") {
      const first = await db.from("brief_issues").select("id").eq("status", "published").eq("kind", "regular").order("issue_no").limit(1);
      if ((first.data?.[0] as { id: number } | undefined)?.id === issue.id) {
        const p = await sendPreregNotices(db);
        prereg = { sent: prereg.sent + p.sent, failed: prereg.failed + p.failed };
      }
    }
  }
  return { published: published.length, sent, failed, preregSent: prereg.sent, preregFailed: prereg.failed };
}

/** 재확인 안내 - 기한이 오늘(한국 날짜)인 구독자에게 1회. 전날 0, 다음 날 중복 0 (자리 잡기 유일) */
export async function remindReconfirm(db: Db, now: Date): Promise<Record<string, unknown>> {
  const ctx = sendContext();
  if (!ctx) return { skipped: "mail_not_ready" };
  const today = kstDate(now);
  const r = await db.rpc("reconfirm_due_today", { p_today: today });
  if (r.error) throw fail("reconfirm_due_today", r.error);
  let sent = 0;
  let failed = 0;
  for (const c of (r.data ?? []) as { consent_id: number; email: string; kind: string }[]) {
    const claim = await db.rpc("alert_delivery_claim", { p_consent_id: c.consent_id, p_kind: "reconfirm", p_ref: today });
    if (claim.error || claim.data !== true) continue;
    const token = newToken();
    const upd = await db.from("consents").update({ confirm_token_hash: hashToken(token), reconfirm_notified_at: now.toISOString() }).eq("id", c.consent_id);
    const ok = !upd.error && (await sendMail({ to: c.email, template: "brief_reconfirm", vars: { link: `${ctx.base}/brief/confirm?token=${token}`, unsubscribeLink: `${ctx.base}/brief/unsubscribe?token=${deriveToken(ctx.secret, "revoke", c.consent_id)}`, kindLabel2: c.kind === "brief" ? "주간 브리핑" : "개정 알림" } })).ok;
    await db.rpc("alert_delivery_mark", { p_consent_id: c.consent_id, p_kind: "reconfirm", p_ref: today, p_ok: ok });
    if (ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** 개정 알림 (TX-12) - 승인·공개된 단계 변경만(후보는 amendment_events에 없다), 수신자당 1통 */
export async function sendAmendmentAlerts(db: Db, now: Date): Promise<Record<string, unknown>> {
  if (!(await featureOn(db, "amendment_alerts"))) return { skipped: "flag_off" };
  const ctx = sendContext();
  if (!ctx) return { skipped: "mail_not_ready" };
  const today = kstDate(now);
  const pending = await db.rpc("amendment_alert_pending", { p_now: now.toISOString() });
  if (pending.error) throw fail("amendment_alert_pending", pending.error);
  let sent = 0;
  let failed = 0;
  for (const p of (pending.data ?? []) as { event_id: number }[]) {
    const ev = await db.from("amendment_events").select("id, stage, occurred_on, source_url, amendments!inner(title, slug)").eq("id", p.event_id).limit(1);
    const row = ev.data?.[0] as unknown as { id: number; stage: AmendmentStage; occurred_on: string; source_url: string; amendments: { title: string; slug: string } } | undefined;
    if (!row) continue;
    const rec = await db.rpc("amendment_alert_recipients", { p_event_id: p.event_id, p_today: today });
    if (rec.error) throw fail("amendment_alert_recipients", rec.error);
    for (const r of (rec.data ?? []) as { consent_id: number; email: string }[]) {
      const claim = await db.rpc("alert_delivery_claim", { p_consent_id: r.consent_id, p_kind: "amendment_alert", p_ref: String(p.event_id) });
      if (claim.error || claim.data !== true) continue;
      // 알림에는 단계 이름·원문 링크·확인일뿐 - 확정 전이면 '확정 아님', 세율·금액·해석 문장 0
      const body = [`${row.amendments.title}`, `단계: ${STAGE_LABELS[row.stage]}${isConfirmedStage(row.stage) ? "" : " (확정 아님)"}`, `확인일: ${row.occurred_on}`, `원문: ${row.source_url}`, `트래커: ${ctx.base}/tax/amendments/${row.amendments.slug}`, "", `수신 거부: ${ctx.base}/brief/unsubscribe?token=${deriveToken(ctx.secret, "revoke", r.consent_id)}`].join("\n");
      const ok = (await sendMail({ to: r.email, template: "amendment_alert", vars: { subjectTitle: `[개정 알림] ${row.amendments.title} - ${STAGE_LABELS[row.stage]}`, bodyText: body } })).ok;
      await db.rpc("alert_delivery_mark", { p_consent_id: r.consent_id, p_kind: "amendment_alert", p_ref: String(p.event_id), p_ok: ok });
      if (ok) sent += 1;
      else failed += 1;
    }
  }
  const docs = await sendLegalDocAlerts(db, now, ctx, today);
  return { events: (pending.data ?? []).length, sent, failed, docAlertsSent: docs.sent, docAlertsFailed: docs.failed };
}

/** 새 해석 문서 알림 (TX-12) - W10-d 공개 뷰(public_legal_docs)를 통과한 문서만. 알림에는 문서 종류·기관·번호·결정일·원문 링크뿐이고 해석 문장은 없다 */
async function sendLegalDocAlerts(db: Db, now: Date, ctx: { secret: string; base: string }, today: string): Promise<{ sent: number; failed: number }> {
  const pending = await db.rpc("legal_doc_alert_pending", { p_today: today });
  if (pending.error) throw fail("legal_doc_alert_pending", pending.error);
  let sent = 0;
  let failed = 0;
  for (const p of (pending.data ?? []) as { doc_id: number }[]) {
    const doc = await db.from("public_legal_docs").select("id, doc_type, issuer, doc_no, decided_on, source_url").eq("id", p.doc_id).limit(1);
    const d = doc.data?.[0] as { id: number; doc_type: string; issuer: string; doc_no: string; decided_on: string | null; source_url: string | null } | undefined;
    if (!d) continue;
    const rec = await db.rpc("legal_doc_alert_recipients", { p_doc_id: p.doc_id, p_today: today });
    if (rec.error) throw fail("legal_doc_alert_recipients", rec.error);
    for (const r of (rec.data ?? []) as { consent_id: number; email: string }[]) {
      const claim = await db.rpc("alert_delivery_claim", { p_consent_id: r.consent_id, p_kind: "legal_doc_alert", p_ref: String(p.doc_id) });
      if (claim.error || claim.data !== true) continue;
      const body = [`${d.issuer} ${d.doc_no}`, d.decided_on ? `결정일: ${d.decided_on}` : "", d.source_url ? `원문: ${d.source_url}` : "", `보기: ${ctx.base}/cases/${d.doc_type}/${d.id}`, "", `수신 거부: ${ctx.base}/brief/unsubscribe?token=${deriveToken(ctx.secret, "revoke", r.consent_id)}`].filter((l) => l !== "").join(String.fromCharCode(10));
      const ok = (await sendMail({ to: r.email, template: "amendment_alert", vars: { subjectTitle: `[새 해석 문서] ${d.issuer} ${d.doc_no}`, bodyText: body } })).ok;
      await db.rpc("alert_delivery_mark", { p_consent_id: r.consent_id, p_kind: "legal_doc_alert", p_ref: String(p.doc_id), p_ok: ok });
      if (ok) sent += 1;
      else failed += 1;
    }
  }
  void now;
  return { sent, failed };
}

export { AD_PREFIX };
