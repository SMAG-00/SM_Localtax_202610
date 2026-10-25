import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PUBLISH_POLICY, parsePublishPolicy, parseReconfirmMonths, type PublishPolicy } from "@ltr/workflows/ops";

// 브리핑 설정 읽기 (W10-e) - 문구 칸은 PO가 settings.brief_publish_policy에 넣는다. 이 파일과 코드에 면책·발행인·감수 문구는 없다.
// 칸이 비어 있으면 빈 문자열이고, 발행 검사기가 막는다.

export interface BriefPolicy {
  publish: PublishPolicy;
  reconfirmMonths: number;
  footer: { disclaimer: string; noHarvestNotice: string; adInfoUrl: string };
  publisherNotice: string;
  reviewLabelAllowed: boolean;
  forbiddenWords: string[];
  /** 프리미엄 브리핑 수신 권한 키 (W10-f 권한 표) - 비어 있으면 프리미엄 발송 0 */
  premiumEntitlementKey: string;
}

export async function readSetting(db: SupabaseClient, key: string): Promise<unknown> {
  const r = await db.from("settings").select("value").eq("key", key).limit(1);
  if (r.error) throw new Error(`settings 읽기 실패(${key}): ${r.error.code ?? ""} ${r.error.message}`.trim());
  return (r.data?.[0] as { value?: unknown } | undefined)?.value;
}

/** 기능 키가 켜져 있나 - 키가 없거나 설정을 못 읽으면 닫힘 */
export async function featureOn(db: SupabaseClient, key: string): Promise<boolean> {
  const value = await readSetting(db, "feature_flags");
  return !!value && typeof value === "object" && (value as Record<string, unknown>)[key] === true;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export async function readBriefPolicy(db: SupabaseClient): Promise<BriefPolicy> {
  const [publish, reconfirm] = await Promise.all([readSetting(db, "brief_publish_policy"), readSetting(db, "brief_reconfirm_policy")]);
  const o = publish && typeof publish === "object" ? (publish as Record<string, unknown>) : {};
  return {
    publish: parsePublishPolicy(o),
    reconfirmMonths: parseReconfirmMonths(reconfirm),
    footer: { disclaimer: str(o.disclaimer), noHarvestNotice: str(o.no_harvest_notice), adInfoUrl: str(o.ad_info_url) },
    publisherNotice: str(o.publisher_notice),
    reviewLabelAllowed: o.review_label_allowed === true,
    forbiddenWords: Array.isArray(o.forbidden_words) ? (o.forbidden_words as unknown[]).filter((w): w is string => typeof w === "string") : [],
    premiumEntitlementKey: str(o.premium_entitlement_key),
  };
}

export { DEFAULT_PUBLISH_POLICY };
