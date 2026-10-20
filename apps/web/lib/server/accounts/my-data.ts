import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// 회원 화면(/my)·가입 화면이 쓰는 읽기·쓰기 (W2-e 설계 3.2 · 3.3 · 5.1) — service_role로 쓰되 호출하는 쪽이 넘긴 userId(= viewer.userId)의 행만 건드린다.

export const CONSENT_KINDS = ["receive", "marketing", "brief_prereg"] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];
export const isConsentKind = (v: unknown): v is ConsentKind => typeof v === "string" && (CONSENT_KINDS as readonly string[]).includes(v);

export interface RegionOption {
  code: string;
  name: string;
  level: "sido" | "sigungu";
  parentCode: string | null;
}
export interface CategoryOption {
  section: string;
  slug: string;
  name: string;
}
export interface PickerOptions {
  regions: RegionOption[];
  categories: CategoryOption[];
}

/** 오늘(한국 날짜) 유효한 시·도·시·군·구와 공개 하위 분야 — 고르기 칸의 선택지. 시각은 여기서 읽는다(화면 컴포넌트 밖) */
export async function loadPickerOptions(db: SupabaseClient): Promise<PickerOptions> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const [regions, categories] = await Promise.all([
    db.from("regions").select("code, name, level, parent_code, valid_from, valid_to").order("code"),
    db.from("categories").select("section, slug, name").eq("visible", true).order("section").order("sort"),
  ]);
  if (regions.error || categories.error) throw new Error("선택지를 읽지 못했습니다");
  return {
    regions: (regions.data ?? [])
      .filter((r) => (!r.valid_from || r.valid_from <= today) && (!r.valid_to || r.valid_to >= today))
      .map((r) => ({ code: String(r.code), name: String(r.name), level: r.level as "sido" | "sigungu", parentCode: (r.parent_code as string | null) ?? null })),
    categories: (categories.data ?? []).map((c) => ({ section: String(c.section), slug: String(c.slug), name: String(c.name) })).filter((c) => c.section !== "local"),
  };
}

export interface MyProfile {
  displayName: string | null;
  interests: string[];
  regionCodes: string[];
  consents: ConsentKind[];
}

/** 본인 프로필·켜 둔 수신 동의. 프로필 행이 없으면 빈 행을 만든다 (설계 3.2) */
export async function loadMyProfile(db: SupabaseClient, userId: string): Promise<MyProfile> {
  let p = await db.from("profiles").select("display_name, interests, interest_region_codes").eq("id", userId).maybeSingle();
  if (p.error) throw new Error("프로필을 읽지 못했습니다");
  if (!p.data) {
    const made = await db.from("profiles").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
    if (made.error) throw new Error("프로필을 만들지 못했습니다");
    p = await db.from("profiles").select("display_name, interests, interest_region_codes").eq("id", userId).maybeSingle();
    if (p.error) throw new Error("프로필을 읽지 못했습니다");
  }
  const c = await db.from("consents").select("kind").eq("user_id", userId).in("kind", [...CONSENT_KINDS]).is("revoked_at", null);
  if (c.error) throw new Error("동의 내역을 읽지 못했습니다");
  return {
    displayName: (p.data?.display_name as string | null) ?? null,
    interests: (p.data?.interests as string[] | null) ?? [],
    regionCodes: (p.data?.interest_region_codes as string[] | null) ?? [],
    consents: (c.data ?? []).map((r) => r.kind as ConsentKind),
  };
}

/** 프로필 저장 — DB 트리거가 없는·폐지 코드와 상한을 막는다. 동의 행은 만들지 않는다. 막히면 false */
export async function saveMyProfile(db: SupabaseClient, userId: string, v: { displayName: string | null; interests: string[]; regionCodes: string[] }): Promise<boolean> {
  const res = await db.from("profiles").upsert({ id: userId, display_name: v.displayName, interests: v.interests, interest_region_codes: v.regionCodes }, { onConflict: "id" });
  if (!res.error) return true;
  if (["22023", "23514", "P0001"].includes(res.error.code)) return false;
  throw new Error("프로필을 저장하지 못했습니다");
}

/** 수신 동의 켜기(철회되지 않은 행이 없을 때만 행 생성) · 끄기(철회되지 않은 행에 revoked_at) */
export async function setConsent(db: SupabaseClient, userId: string, kind: ConsentKind, on: boolean): Promise<void> {
  if (on) {
    const open = await db.from("consents").select("id").eq("user_id", userId).eq("kind", kind).is("revoked_at", null).limit(1);
    if (open.error) throw new Error("동의 내역을 읽지 못했습니다");
    if ((open.data ?? []).length > 0) return;
    const ins = await db.from("consents").insert({ user_id: userId, kind, channel: "web_my" });
    if (ins.error && ins.error.code !== "23505") throw new Error("동의를 저장하지 못했습니다");
    return;
  }
  const off = await db.from("consents").update({ revoked_at: new Date().toISOString() }).eq("user_id", userId).eq("kind", kind).is("revoked_at", null);
  if (off.error) throw new Error("동의를 철회하지 못했습니다");
}
