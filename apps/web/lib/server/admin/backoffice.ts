import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, dbError } from "../http";

// 4-2 운영 화면 데이터 — 분야(categories)·운영 설정(settings)·쉬운 말 사전(glossary_terms)·제휴사(partners).
// service_role로 읽고 쓴다. 부르는 쪽(API·화면)이 접근 판정을 먼저 통과해야 한다.

type Db = SupabaseClient;

async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, context: string): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw dbError(error, context);
  return (data ?? []) as T[];
}

// ── 분야 ─────────────────────────────────────────────

export interface CategoryRow {
  id: number;
  section: string;
  slug: string;
  name: string;
  intro: string | null;
  sort: number;
  visible: boolean;
  needs_disclaimer: boolean;
  needs_tax_lens: boolean;
}

const CATEGORY_COLUMNS = "id, section, slug, name, intro, sort, visible, needs_disclaimer, needs_tax_lens";

export async function listCategoryRows(db: Db, section?: string): Promise<CategoryRow[]> {
  let q = db.from("categories").select(CATEGORY_COLUMNS).order("section").order("sort").order("id");
  if (section) q = q.eq("section", section);
  return rows<CategoryRow>(q, "categories 목록");
}

export async function loadCategory(db: Db, id: number): Promise<CategoryRow> {
  const list = await rows<CategoryRow>(db.from("categories").select(CATEGORY_COLUMNS).eq("id", id), "categories 읽기");
  if (!list[0]) throw new HttpError(404, "하위 분야를 찾을 수 없습니다");
  return list[0];
}

export async function updateCategory(db: Db, id: number, columns: Record<string, unknown>): Promise<CategoryRow> {
  const { data, error } = await db.from("categories").update(columns).eq("id", id).select(CATEGORY_COLUMNS).maybeSingle();
  if (error) throw dbError(error, "categories 수정");
  if (!data) throw new HttpError(404, "하위 분야를 찾을 수 없습니다");
  return data as CategoryRow;
}

// ── 운영 설정 ─────────────────────────────────────────

export interface SettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

const SETTING_COLUMNS = "key, value, description, updated_by, updated_at";

export async function listSettings(db: Db): Promise<SettingRow[]> {
  return rows<SettingRow>(db.from("settings").select(SETTING_COLUMNS).order("key"), "settings 목록");
}

export async function readSetting(db: Db, key: string): Promise<SettingRow | null> {
  const list = await rows<SettingRow>(db.from("settings").select(SETTING_COLUMNS).eq("key", key), "settings 읽기");
  return list[0] ?? null;
}

/**
 * 설정 값 쓰기 — 읽은 뒤 다른 사람이 먼저 고쳤으면(updated_at이 다르면) null. PostgREST에는 트랜잭션이 없어
 * '읽은 값 그대로일 때만 고친다'로 동시 수정을 막는다.
 */
export async function writeSetting(db: Db, current: SettingRow, value: unknown, actor: string): Promise<SettingRow | null> {
  const { data, error } = await db
    .from("settings")
    .update({ value, updated_by: actor })
    .eq("key", current.key)
    .eq("updated_at", current.updated_at)
    .select(SETTING_COLUMNS);
  if (error) throw dbError(error, "settings 수정");
  return ((data ?? []) as SettingRow[])[0] ?? null;
}

// ── 쉬운 말 사전 ───────────────────────────────────────

export interface GlossaryRow {
  id: number;
  term: string;
  reading: string | null;
  definition: string | null;
  plain: string | null;
  jargon: boolean;
  related: string[];
  section: string[];
  source: string | null;
  /** 공개 상태 (W2-d 3단계) — 새 용어는 false */
  visible: boolean;
  updated_at: string;
}

const GLOSSARY_COLUMNS = "id, term, reading, definition, plain, jargon, related, section, source, visible, updated_at";

export async function listGlossary(db: Db): Promise<GlossaryRow[]> {
  return rows<GlossaryRow>(db.from("glossary_terms").select(GLOSSARY_COLUMNS).order("term").limit(1000), "glossary_terms 목록");
}

export async function loadGlossary(db: Db, id: number): Promise<GlossaryRow> {
  const list = await rows<GlossaryRow>(db.from("glossary_terms").select(GLOSSARY_COLUMNS).eq("id", id), "glossary_terms 읽기");
  if (!list[0]) throw new HttpError(404, "용어를 찾을 수 없습니다");
  return list[0];
}

export const glossaryColumns = GLOSSARY_COLUMNS;

// ── 제휴사 ───────────────────────────────────────────

export interface PartnerRow {
  id: number;
  name: string;
  kind: string;
  intro: string | null;
  url: string | null;
  contract_from: string | null;
  contract_to: string | null;
  visible: boolean;
  created_at: string;
}

export const PARTNER_COLUMNS = "id, name, kind, intro, url, contract_from, contract_to, visible, created_at";

export async function listPartnerRows(db: Db): Promise<PartnerRow[]> {
  return rows<PartnerRow>(db.from("partners").select(PARTNER_COLUMNS).order("name").order("id"), "partners 목록");
}

export async function loadPartner(db: Db, id: number): Promise<PartnerRow> {
  const list = await rows<PartnerRow>(db.from("partners").select(PARTNER_COLUMNS).eq("id", id), "partners 읽기");
  if (!list[0]) throw new HttpError(404, "제휴사를 찾을 수 없습니다");
  return list[0];
}

/** 제휴사 기사 수 (제휴사 화면 — 배지가 남은 기사) */
export async function partnerArticleCounts(db: Db): Promise<Record<number, number>> {
  const list = await rows<{ partner_id: number }>(db.from("articles").select("partner_id").not("partner_id", "is", null).neq("status", "deleted").limit(5000), "제휴 기사 세기");
  const out: Record<number, number> = {};
  for (const r of list) out[r.partner_id] = (out[r.partner_id] ?? 0) + 1;
  return out;
}
