import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, dbError } from "@/lib/server/http";

// 기자·기고자 등록부 읽기 (F2 · NAV-19) — people 표를 service_role로 읽는다. 쓰기는 app/api/admin/people/** 가 접근 판정 뒤에 한다.
// 약력(bio_items)·동의서 칸은 읽지 않는다 — 브랜드 관리 화면의 몫이다.

export const PEOPLE_COLUMNS = "id, slug, name, roles, employment, affiliation, beat, conflicts, visibility, staff_user_id, registered_at, updated_at";

export interface PersonRegistryRow {
  id: number;
  slug: string;
  name: string;
  roles: string[];
  employment: string | null;
  affiliation: string | null;
  beat: string | null;
  conflicts: string | null;
  visibility: string;
  staff_user_id: string | null;
  registered_at: string;
  updated_at: string;
}

export const personView = (r: PersonRegistryRow): PersonRegistryRow => ({ ...r, id: Number(r.id) });

export async function listPeople(db: SupabaseClient): Promise<PersonRegistryRow[]> {
  const { data, error } = await db.from("people").select(PEOPLE_COLUMNS).order("id").limit(1000);
  if (error) throw dbError(error, "people 목록");
  return ((data ?? []) as unknown as PersonRegistryRow[]).map(personView);
}

export async function loadPersonRow(db: SupabaseClient, id: number): Promise<PersonRegistryRow> {
  const { data, error } = await db.from("people").select(PEOPLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "people 읽기");
  if (!data) throw new HttpError(404, "인물을 찾을 수 없습니다");
  return personView(data as unknown as PersonRegistryRow);
}
