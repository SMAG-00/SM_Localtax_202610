import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDate, STAGE_LABELS, isConfirmedStage, type AmendmentStage } from "@ltr/workflows/ops";
import { hashToken, newToken } from "@/lib/brief/input";
import { deriveToken } from "@/lib/brief/subscribe";
import { guardSecret, mailEnv, siteUrl } from "../env";
import { sendMail } from "../mail";
import { mailConfigured } from "../mail/config";
import { featureOn } from "../brief/policy";

// 알림 메일 발송 (W10-e - BRIEF-02 재확인 · TX-12 개정·새 해석 문서 알림). 주간 브리핑 호(초안·검사·발행·발송)는 PO 2026-11-01 결정으로 지웠다 —
// 최신법령·유권해석은 일반 기사(하위 분야 tax/law-updates)로 올린다. 구독·확인·해지(/brief/subscribe·confirm·unsubscribe)와 이 발송은 그대로 둔다.
//  · 발송은 alert_deliveries 자리 잡기(유일)를 거쳐서 작업을 다시 돌려도 수신자당 1통이다
//  · 메일 설정·열쇠·사이트 주소 중 하나라도 없으면 발송 0

type Db = SupabaseClient;
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

function sendContext(): { secret: string; base: string } | null {
  const secret = guardSecret();
  const base = siteUrl();
  return secret && base && mailConfigured(mailEnv()) ? { secret, base: base.replace(/\/+$/, "") } : null;
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
