import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkScreenCopy, R8_THRESHOLDS, type Finding } from "@ltr/editorial";
import { loadGateSettings } from "../articles/repository";

/**
 * 하위 분야 이름·허브 소개 문구의 저장 검사 (UX-01 "허브 소개… 저장할 때 검사" · UX-03 공포 표현) — 발행 판정과 같은 사전·기준.
 * 금지·공포 표현은 저장을 막고(blocked), 긴 안내 문장·한 상자 문장 수·풀이 없는 용어는 경고만(warnings) 돌려준다.
 */
export async function categoryCopyChecks(db: SupabaseClient, columns: Record<string, unknown>): Promise<{ blocked: Finding[]; warnings: Finding[] }> {
  const copies = [
    ...(typeof columns.name === "string" ? [{ id: "name", kind: "guide" as const, text: columns.name }] : []),
    ...(typeof columns.intro === "string" ? [{ id: "intro", kind: "box" as const, text: columns.intro }] : []),
  ];
  if (copies.length === 0) return { blocked: [], warnings: [] };
  const settings = await loadGateSettings(db);
  const findings = checkScreenCopy(copies, { today: "1970-01-01", dictionaries: settings.dictionaries, thresholds: R8_THRESHOLDS, seoLint: null, similarity: null });
  return { blocked: findings.filter((f) => f.level === "block"), warnings: findings.filter((f) => f.level === "warn") };
}
