import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashToken, newToken } from "@/lib/brief/input";
import { deriveToken, type SubscribeInput } from "@/lib/brief/subscribe";
import { sendMail } from "../mail";

// 브리핑·개정 알림 구독 (W10-e - BRIEF-02 · TX-12). 이중 확인: 신청 -> 확인 메일 -> 링크의 버튼 -> 구독 확정(consents.confirmed_at).
//  · 브리핑(kind brief)과 알림(kind amendment_alert)은 따로 동의 행을 둔다 - 한쪽 해지가 다른 쪽에 영향 0
//  · 이미 확정된 구독은 건드리지 않는다(이메일만 아는 사람이 남의 관심 설정을 바꿀 수 없게). 확인 전 신청은 토큰을 새로 만들어 다시 보낸다
//  · 평문 이메일은 consents 칸에만 두고, 수신 거부 토큰은 서버 열쇠에서 만든 값이라 해시만 저장한다

type Kind = "brief" | "amendment_alert";
const LABEL: Record<Kind, string> = { brief: "주간 브리핑", amendment_alert: "개정 알림" };

export type SubscribeOutcome = "sent" | "already" | "mail_down";

export async function subscribe(db: SupabaseClient, input: SubscribeInput, ctx: { secret: string; base: string }): Promise<SubscribeOutcome> {
  const kinds: Kind[] = [...(input.brief ? (["brief"] as const) : []), ...(input.alert ? (["amendment_alert"] as const) : [])];
  const outcomes: SubscribeOutcome[] = [];
  for (const kind of kinds) outcomes.push(await subscribeOne(db, kind, input, ctx));
  if (outcomes.includes("mail_down")) return "mail_down";
  return outcomes.every((o) => o === "already") ? "already" : "sent";
}

async function subscribeOne(db: SupabaseClient, kind: Kind, input: SubscribeInput, ctx: { secret: string; base: string }): Promise<SubscribeOutcome> {
  const existing = await db.from("consents").select("id, confirmed_at").eq("kind", kind).eq("email", input.email).is("revoked_at", null).maybeSingle();
  if (existing.error) return "mail_down";
  if (existing.data?.confirmed_at) return "already";

  const confirmToken = newToken();
  let consentId: number;
  let created = false;
  if (existing.data) {
    consentId = Number(existing.data.id);
    const upd = await db.from("consents").update({ confirm_token_hash: hashToken(confirmToken) }).eq("id", consentId);
    if (upd.error) return "mail_down";
  } else {
    const versions = await db.from("policy_versions").select("id").eq("doc_key", "privacy").eq("status", "published");
    const versionRef = (versions.data ?? []).map((v: { id: number }) => v.id);
    const ins = await db.from("consents").insert({ email: input.email, kind, channel: "web_brief", version_ref: versionRef, confirm_token_hash: hashToken(confirmToken) }).select("id").single();
    if (ins.error) return ins.error.code === "23505" ? "sent" : "mail_down"; // 동시에 들어온 같은 신청 - 먼저 들어온 쪽이 메일을 보낸다
    consentId = Number(ins.data.id);
    created = true;
    const rev = await db.from("consents").update({ revoke_token_hash: hashToken(deriveToken(ctx.secret, "revoke", consentId)) }).eq("id", consentId);
    if (rev.error) {
      await db.from("consents").delete().eq("id", consentId);
      return "mail_down";
    }
  }
  if (kind === "amendment_alert") {
    const prefs = await db.from("subscriber_prefs").upsert({ consent_id: consentId, tax_kinds: input.taxKinds, amendment_ids: input.amendmentIds, include_docs: input.includeDocs }, { onConflict: "consent_id" });
    if (prefs.error) {
      if (created) await db.from("consents").delete().eq("id", consentId);
      return "mail_down";
    }
  }
  const sent = await sendMail({
    to: input.email,
    template: "brief_subscribe_confirm",
    vars: { link: `${ctx.base}/brief/confirm?token=${confirmToken}`, unsubscribeLink: `${ctx.base}/brief/unsubscribe?token=${deriveToken(ctx.secret, "revoke", consentId)}`, kindLabel2: LABEL[kind] },
  });
  if (!sent.ok) {
    if (created) await db.from("consents").delete().eq("id", consentId);
    return "mail_down";
  }
  return "sent";
}
