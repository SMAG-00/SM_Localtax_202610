import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUIREMENT_COLUMNS, type RequirementRow } from "@/lib/readiness/requirements";
import { HttpError, dbError } from "../http";

// 제휴 규정 버전 읽기 (NAV-13 — docs/dev/W2-c_설계.md 8.5). service_role로만 읽는다(anon·authenticated 0행 — RLS 정책 없음).
// 이 함수를 부르기 전에 접근 판정(readiness.read·readiness.requirements)을 한다.

const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
const toRow = (r: Record<string, unknown>): RequirementRow =>
  ({ ...r, id: num(r.id), version: num(r.version), supersedes_id: r.supersedes_id === null ? null : num(r.supersedes_id) }) as RequirementRow;

/** 모든 버전 — 플랫폼·버전 번호 순 (규정 버전은 플랫폼마다 많지 않다) */
export async function listRequirementRows(db: SupabaseClient): Promise<RequirementRow[]> {
  const { data, error } = await db.from("news_partner_requirements").select(REQUIREMENT_COLUMNS).order("platform").order("version");
  if (error) throw dbError(error, "news_partner_requirements 읽기");
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

export async function loadRequirement(db: SupabaseClient, id: number): Promise<RequirementRow> {
  const { data, error } = await db.from("news_partner_requirements").select(REQUIREMENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "news_partner_requirements 읽기");
  if (!data) throw new HttpError(404, "규정 버전을 찾을 수 없습니다");
  return toRow(data as Record<string, unknown>);
}

/** 감사 행위자 글자(user:<uuid>) → 화면 이름 — 편집국 인물(people.staff_user_id)이면 그 이름, 아니면 '계정 앞 8자리' (이메일은 보이지 않는다) */
export async function actorNames(db: SupabaseClient, actors: readonly (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(actors.flatMap((a) => (a && /^user:[0-9a-f-]{36}$/i.test(a) ? [a.slice(5)] : [])))];
  const out = new Map<string, string>();
  if (ids.length) {
    const { data, error } = await db.from("people").select("name, staff_user_id").in("staff_user_id", ids);
    if (error) throw dbError(error, "people 읽기");
    for (const p of data ?? []) out.set(`user:${p.staff_user_id as string}`, p.name as string);
  }
  for (const a of actors) if (a && !out.has(a)) out.set(a, a.startsWith("user:") ? `계정 ${a.slice(5, 13)}` : a);
  return out;
}

export const rowFromDb = toRow;

/** 경로의 규정 버전 번호(id) — 숫자가 아니면 404 */
export function requirementId(raw: string): number {
  if (!/^[1-9]\d{0,15}$/.test(raw)) throw new HttpError(404, "규정 버전을 찾을 수 없습니다");
  return Number(raw);
}
