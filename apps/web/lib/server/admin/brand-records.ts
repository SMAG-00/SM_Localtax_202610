import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrandRecords } from "@/lib/policy/feature-open";

// 브랜드 공개 조건 기록 읽기 (W3 7단계 — 설계 2.4 · 12장 #11·#13) — 관리 경로에서만 쓴다(service role).
// DB 트리거(brand_settings_guard)와 같은 조건: 감수 기록 · 경력 승인(근거 증빙이 지금도 승인) · 동의서+증빙 약력이 있는 공개 인물
const flag = (value: unknown, key: string): boolean => typeof value === "object" && value !== null && (value as Record<string, unknown>)[key] === true;
const field = (value: unknown, key: string): string =>
  typeof value === "object" && value !== null && (value as Record<string, unknown>)[key] !== null && (value as Record<string, unknown>)[key] !== undefined
    ? String((value as Record<string, unknown>)[key]).trim()
    : "";

export async function brandRecords(db: SupabaseClient): Promise<BrandRecords> {
  const { data, error } = await db.from("settings").select("key, value").in("key", ["brand_copy_review", "career_claim_approved"]);
  if (error) throw new Error(`브랜드 기록 조회 실패: ${error.message}`);
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const by = (k: string) => rows.find((r) => r.key === k)?.value;
  const claim = by("career_claim_approved");
  const basis = field(claim, "basis_evidence_id");
  let basisApproved = false;
  if (flag(claim, "approved") && /^\d+$/.test(basis)) {
    const ev = await db.from("people_evidence").select("id").eq("id", Number(basis)).eq("approved", true).limit(1);
    if (ev.error) throw new Error(`근거 증빙 조회 실패: ${ev.error.message}`);
    basisApproved = (ev.data ?? []).length > 0;
  }
  const pages = await db.from("public_profile_pages").select("person_id").limit(1000);
  if (pages.error) throw new Error(`인물 페이지 조회 실패: ${pages.error.message}`);
  const ids = ((pages.data ?? []) as { person_id: number }[]).map((p) => Number(p.person_id));
  let peopleReady = false;
  if (ids.length) {
    const bios = await db.from("public_person_bio").select("person_id, bio_items").in("person_id", ids);
    if (bios.error) throw new Error(`승인 약력 조회 실패: ${bios.error.message}`);
    peopleReady = ((bios.data ?? []) as { bio_items: unknown }[]).some((b) => Array.isArray(b.bio_items) && b.bio_items.length > 0);
  }
  return { reviewed: flag(by("brand_copy_review"), "reviewed"), careerApproved: basisApproved, peopleReady };
}
