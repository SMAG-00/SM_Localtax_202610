import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, dbError } from "../http";

// 상황 카드 백오피스 데이터 (UX-05 · FAM-02) — service_role로 읽고 쓴다. 부르는 쪽(API·화면)이 접근 판정을 먼저 통과해야 한다.
// 공개 화면에 실제로 보이는 모습은 공개 데이터 함수(lib/server/public — anon)가 따로 계산한다(공개·감수된 상황만).

type Db = SupabaseClient;

export interface SituationAdminRow {
  id: number;
  slug: string;
  section: string;
  title: string;
  subtitle: string | null;
  pictogram: string;
  checks: unknown;
  checklist: unknown;
  mistakes: string[];
  article_ids: number[];
  solved_case_ids: number[];
  glossary_ids: number[];
  tool_links: unknown;
  region_select: boolean;
  /** 검색 별칭 (W2-d SRCH-01) */
  aliases: string[];
  hub_slot: number | null;
  sort: number;
  visible: boolean;
  reviewer_id: number | null;
  reviewed_at: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const SITUATION_ADMIN_COLUMNS =
  "id, slug, section, title, subtitle, pictogram, checks, checklist, mistakes, article_ids, solved_case_ids, glossary_ids, tool_links, region_select, aliases, hub_slot, sort, visible, reviewer_id, reviewed_at, updated_by, created_at, updated_at";

const num = (v: unknown) => Number(v);

/** bigint 칸·배열을 번호로 맞춘다 (PostgREST는 큰 수를 글자로 줄 수 있다) */
export function normalizeRow(r: SituationAdminRow): SituationAdminRow {
  return {
    ...r,
    id: num(r.id),
    hub_slot: r.hub_slot === null ? null : num(r.hub_slot),
    reviewer_id: r.reviewer_id === null ? null : num(r.reviewer_id),
    article_ids: (r.article_ids ?? []).map(num),
    solved_case_ids: (r.solved_case_ids ?? []).map(num),
    glossary_ids: (r.glossary_ids ?? []).map(num),
    aliases: r.aliases ?? [],
  };
}

export async function listSituationRows(db: Db): Promise<SituationAdminRow[]> {
  const { data, error } = await db.from("situations").select(SITUATION_ADMIN_COLUMNS).order("section").order("sort").order("id");
  if (error) throw dbError(error, "situations 목록");
  return ((data ?? []) as SituationAdminRow[]).map(normalizeRow);
}

export async function loadSituation(db: Db, id: number): Promise<SituationAdminRow> {
  const { data, error } = await db.from("situations").select(SITUATION_ADMIN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "situations 읽기");
  if (!data) throw new HttpError(404, "상황 카드를 찾을 수 없습니다");
  return normalizeRow(data as SituationAdminRow);
}

/** 허브 상황 카드 상한 — settings.hub_situation_limit (DB 트리거와 같은 해석: 1 이상 숫자면 내림, 아니면 4) */
export async function hubLimit(db: Db): Promise<number> {
  const { data, error } = await db.from("settings").select("value").eq("key", "hub_situation_limit").maybeSingle();
  if (error) throw dbError(error, "settings 허브 상한");
  const v = (data as { value: unknown } | null)?.value;
  return typeof v === "number" && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 4;
}

/** 감수자 이름 (people) — 백오피스 화면에만 보인다(공개 칸 아님) */
export async function reviewerNames(db: Db, ids: readonly number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("people").select("id, name").in("id", unique);
  if (error) throw dbError(error, "people 감수자");
  return new Map(((data ?? []) as { id: number; name: string }[]).map((p) => [num(p.id), p.name]));
}

/** 로그인한 감수위원의 인물 번호 (situations.reviewer_id → people) — 없으면 null */
export async function personOf(db: Db, userId: string): Promise<number | null> {
  const { data, error } = await db.from("people").select("id").eq("staff_user_id", userId).maybeSingle();
  if (error) throw dbError(error, "people 감수자 찾기");
  return data ? num((data as { id: number }).id) : null;
}

/**
 * 연결 번호 검사 — 기사(삭제 안 됨)·해결 사례(하위 유형 solved_case)·용어가 있어야 한다. 문제 문장 목록.
 * 공개 화면은 읽히는(발행된) 것만 지정 순서로 보이므로 초안 기사도 연결해 둘 수 있다 (발행되면 저절로 나온다)
 */
export async function linkProblems(db: Db, links: { article_ids?: number[]; solved_case_ids?: number[]; glossary_ids?: number[] }): Promise<string[]> {
  const problems: string[] = [];
  const articleIds = [...new Set([...(links.article_ids ?? []), ...(links.solved_case_ids ?? [])])];
  if (articleIds.length) {
    const { data, error } = await db.from("articles").select("id, subtype, status").in("id", articleIds);
    if (error) throw dbError(error, "articles 연결 확인");
    const byId = new Map(((data ?? []) as { id: number; subtype: string; status: string }[]).map((a) => [num(a.id), a]));
    for (const id of links.article_ids ?? []) {
      const a = byId.get(id);
      if (!a || a.status === "deleted") problems.push(`situation.articleIds: ${id}번 기사가 없습니다`);
    }
    for (const id of links.solved_case_ids ?? []) {
      const a = byId.get(id);
      if (!a || a.status === "deleted") problems.push(`situation.solvedCaseIds: ${id}번 기사가 없습니다`);
      else if (a.subtype !== "solved_case") problems.push(`situation.solvedCaseIds: ${id}번 기사는 해결 사례가 아닙니다`);
    }
  }
  if (links.glossary_ids?.length) {
    const { data, error } = await db.from("glossary_terms").select("id").in("id", links.glossary_ids);
    if (error) throw dbError(error, "glossary_terms 연결 확인");
    const found = new Set(((data ?? []) as { id: number }[]).map((g) => num(g.id)));
    for (const id of links.glossary_ids) if (!found.has(id)) problems.push(`situation.glossaryIds: ${id}번 용어가 없습니다`);
  }
  return problems;
}

export interface SituationItem {
  id: number;
  slug: string;
  section: string;
  title: string;
  subtitle: string | null;
  pictogram: string;
  visible: boolean;
  hubSlot: number | null;
  checksCount: number;
  /** 검색 별칭 수 (W2-d) */
  aliasCount: number;
  /** 세무 감수 기록 — 없으면 null (감수 대상 문장을 고치면 지워진다) */
  review: { by: string | null; at: string } | null;
  updatedAt: string;
  /** 공개 화면 주소 — 공개 중일 때만 */
  publicHref: string | null;
}

export function describeSituation(r: SituationAdminRow, names: ReadonlyMap<number, string>): SituationItem {
  return {
    id: r.id,
    slug: r.slug,
    section: r.section,
    title: r.title,
    subtitle: r.subtitle,
    pictogram: r.pictogram,
    visible: r.visible,
    hubSlot: r.hub_slot,
    checksCount: Array.isArray(r.checks) ? r.checks.length : 0,
    aliasCount: (r.aliases ?? []).length,
    review: r.reviewed_at ? { by: r.reviewer_id === null ? null : (names.get(r.reviewer_id) ?? null), at: r.reviewed_at } : null,
    updatedAt: r.updated_at,
    publicHref: r.visible ? `/situations/${r.slug}` : null,
  };
}
