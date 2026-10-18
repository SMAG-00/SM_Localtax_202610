import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, dbError } from "../http";

// 검색 동의어 사전 백오피스 데이터 (W2-d 설계 5장 — search_synonyms). service_role로 읽고 쓴다 — 부르는 쪽(API·화면)이 접근 판정(dictionary.edit)을 먼저 통과해야 한다.
// 공개 검색은 사용 중 줄의 열쇠 칸(term_key·synonym_keys)만 anon으로 읽는다(RLS) — 메모·고친 사람은 여기서만 보인다.

type Db = SupabaseClient;

export interface SynonymRow {
  id: number;
  term: string;
  /** 정규형 열쇠 (생성 칸) — 검색어 낱말이 이것과 같으면 동의어도 찾는다 */
  term_key: string;
  synonyms: string[];
  synonym_keys: string[];
  enabled: boolean;
  note: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export const SYNONYM_COLUMNS = "id, term, term_key, synonyms, synonym_keys, enabled, note, updated_by, created_at, updated_at";

const normalize = (r: SynonymRow): SynonymRow => ({ ...r, id: Number(r.id), synonyms: r.synonyms ?? [], synonym_keys: r.synonym_keys ?? [] });

/** 사전 전부 — 낱말 정규형 차례 (편집 화면은 한 쪽에 모두) */
export async function listSynonyms(db: Db): Promise<SynonymRow[]> {
  const { data, error } = await db.from("search_synonyms").select(SYNONYM_COLUMNS).order("term_key").limit(1000);
  if (error) throw dbError(error, "search_synonyms 목록");
  return ((data ?? []) as SynonymRow[]).map(normalize);
}

export async function loadSynonym(db: Db, id: number): Promise<SynonymRow> {
  const { data, error } = await db.from("search_synonyms").select(SYNONYM_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "search_synonyms 읽기");
  if (!data) throw new HttpError(404, "동의어 사전에 그 줄이 없습니다");
  return normalize(data as SynonymRow);
}

export function toSynonymRow(data: unknown): SynonymRow {
  return normalize(data as SynonymRow);
}
