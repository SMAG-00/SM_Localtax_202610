import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 설정 읽기 (W10-e) - 기능 키와 settings 값. 주간 브리핑 호(발행 정책·면책 칸·프리미엄 수신)는 PO 2026-11-01 결정으로 지웠고,
// 운영 AI 지시문이 쓰는 금지어 목록(settings.brief_publish_policy.forbidden_words)만 남는다. 이 파일과 코드에 면책·발행인·감수 문구는 없다.

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

/** 설정의 금지어 목록 - 운영 AI 지시문에 "금지 표현"으로 들어간다. 칸이 없으면 빈 목록 */
export async function readForbiddenWords(db: SupabaseClient): Promise<string[]> {
  const publish = await readSetting(db, "brief_publish_policy");
  const o = publish && typeof publish === "object" ? (publish as Record<string, unknown>) : {};
  return Array.isArray(o.forbidden_words) ? (o.forbidden_words as unknown[]).filter((w): w is string => typeof w === "string") : [];
}
