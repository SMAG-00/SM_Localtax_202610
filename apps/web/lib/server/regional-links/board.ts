import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refKey, type LinkRef, type RegionalLinkOrigin, type RegionalLinkRelation, type RegionalLinkStatus, type RegionalLinkType } from "@/lib/admin/regional-link-rules";
import { dbError } from "../http";

// 지역 연결 편집 화면 읽기 (W4 13단계 — PRD-01B REG1-10 · docs/dev/W4_설계.md 1장 13단계 · 4장 `/api/admin/regional-links` · 12장 100번~)
//  · 대상 하나의 연결 — 판정 뷰 regional_link_status(출발·도착이 지금 공개인지 · 지역 범위 안인지)를 읽어 후보·확인·지운 연결로 나눈다
//  · 대상 없이 — 열린 후보(편집자 확인 대기) 최근 50건
// 끝마다 화면 이름(기사 제목·공식 자료 제목·프로젝트 이름·지역 이름)과 편집 화면 주소를 붙인다. 관리 API(GET)와 관리 화면이 같은 함수를 쓴다.
// 후보는 편집 화면에만 — 공개 화면은 공개 뷰 public_regional_links(확인된 연결만)를 읽는다.

export interface LinkRow {
  id: number;
  from_type: RegionalLinkType;
  from_id: string;
  to_type: RegionalLinkType;
  to_id: string;
  relation: RegionalLinkRelation;
  reason: string | null;
  origin: RegionalLinkOrigin;
  status: RegionalLinkStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  from_public: boolean;
  to_public: boolean;
  in_scope: boolean;
}

export interface RefInfo {
  /** 대상이 있다 (지운 기사·없는 번호는 false) */
  exists: boolean;
  title: string;
  /** 상태 한 줄 — 기사 상태·프로젝트 상태·지역 유효 끝 등 */
  note: string;
  /** 편집국 화면 주소 (없으면 null) */
  adminHref: string | null;
}

export interface LinkView extends LinkRow {
  from: RefInfo;
  to: RefInfo;
}

export interface LinkBoard {
  from: (LinkRef & RefInfo) | null;
  candidates: LinkView[];
  confirmed: LinkView[];
  removed: LinkView[];
}

export const LINK_COLUMNS =
  "id, from_type, from_id, to_type, to_id, relation, reason, origin, status, confirmed_by, confirmed_at, created_by, created_at, updated_at, from_public, to_public, in_scope";
const REMOVED_LIMIT = 20;
const OPEN_LIMIT = 50;

const ids = (refs: readonly LinkRef[], type: RegionalLinkType) => [...new Set(refs.filter((r) => r.type === type).map((r) => r.id))];

/** 끝 이름·상태 — 종류마다 한 번씩 읽는다 */
export async function describeRefs(db: SupabaseClient, refs: readonly LinkRef[]): Promise<Map<string, RefInfo>> {
  const out = new Map<string, RefInfo>();
  const articleIds = ids(refs, "article").map(Number);
  const sourceIds = ids(refs, "official_source").map(Number);
  const projectIds = ids(refs, "project").map(Number);
  const regionCodes = ids(refs, "region");
  const [articles, sources, projects, regions] = await Promise.all([
    articleIds.length ? db.from("articles").select("id, title, status, region_codes").in("id", articleIds) : null,
    sourceIds.length ? db.from("article_sources").select("id, article_id, kind, title, source_name, reference_date").in("id", sourceIds) : null,
    projectIds.length ? db.from("projects").select("id, name, slug, status, region_code").in("id", projectIds) : null,
    regionCodes.length ? db.from("regions").select("code, name, level, valid_to").in("code", regionCodes) : null,
  ]);
  for (const [res, what] of [
    [articles, "articles 연결 끝"],
    [sources, "article_sources 연결 끝"],
    [projects, "projects 연결 끝"],
    [regions, "regions 연결 끝"],
  ] as const) {
    if (res?.error) throw dbError(res.error, what);
  }
  for (const a of (articles?.data ?? []) as { id: number; title: string; status: string; region_codes: string[] }[]) {
    out.set(`article:${a.id}`, { exists: a.status !== "deleted", title: a.title, note: `기사 · ${a.status}${a.region_codes?.length ? ` · 지역 ${a.region_codes.join(",")}` : ""}`, adminHref: `/admin/articles/${a.id}` });
  }
  for (const s of (sources?.data ?? []) as { id: number; article_id: number; kind: string; title: string | null; source_name: string | null; reference_date: string | null }[]) {
    out.set(`official_source:${s.id}`, {
      exists: s.kind === "official_doc" || s.kind === "dataset",
      title: s.title ?? `공식 자료 #${s.id}`,
      note: `공식 자료 · ${s.source_name ?? "발표기관 없음"} · 기준일 ${s.reference_date ?? "—"} · 기사 #${s.article_id}`,
      adminHref: `/admin/articles/${s.article_id}`,
    });
  }
  for (const p of (projects?.data ?? []) as { id: number; name: string; slug: string; status: string; region_code: string }[]) {
    out.set(`project:${p.id}`, { exists: true, title: p.name, note: `프로젝트 · ${p.status} · 지역 ${p.region_code}`, adminHref: `/admin/projects/${p.id}` });
  }
  for (const r of (regions?.data ?? []) as { code: string; name: string; level: string; valid_to: string | null }[]) {
    out.set(`region:${r.code}`, { exists: true, title: r.name, note: `지역 ${r.code} · ${r.level === "sido" ? "시·도" : "시·군·구"}${r.valid_to ? ` · 유효 끝 ${r.valid_to}` : ""}`, adminHref: null });
  }
  for (const r of refs) if (!out.has(refKey(r))) out.set(refKey(r), { exists: false, title: `${r.type}:${r.id}`, note: "없는 대상", adminHref: null });
  return out;
}

async function withRefs(db: SupabaseClient, rows: readonly LinkRow[]): Promise<LinkView[]> {
  const refs = rows.flatMap((r) => [
    { type: r.from_type, id: r.from_id },
    { type: r.to_type, id: r.to_id },
  ]);
  const info = await describeRefs(db, refs);
  return rows.map((r) => ({ ...r, id: Number(r.id), from: info.get(`${r.from_type}:${r.from_id}`)!, to: info.get(`${r.to_type}:${r.to_id}`)! }));
}

/** 대상 하나의 연결 (from = null이면 열린 후보 전체 최근 50건) */
export async function loadLinkBoard(db: SupabaseClient, from: LinkRef | null): Promise<LinkBoard> {
  if (!from) {
    const { data, error } = await db.from("regional_link_status").select(LINK_COLUMNS).eq("status", "candidate").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(OPEN_LIMIT);
    if (error) throw dbError(error, "regional_link_status 열린 후보");
    return { from: null, candidates: await withRefs(db, (data ?? []) as LinkRow[]), confirmed: [], removed: [] };
  }
  const [live, removed] = await Promise.all([
    db.from("regional_link_status").select(LINK_COLUMNS).eq("from_type", from.type).eq("from_id", from.id).neq("status", "removed").order("id"),
    db.from("regional_link_status").select(LINK_COLUMNS).eq("from_type", from.type).eq("from_id", from.id).eq("status", "removed").order("updated_at", { ascending: false }).limit(REMOVED_LIMIT),
  ]);
  if (live.error) throw dbError(live.error, "regional_link_status 대상 연결");
  if (removed.error) throw dbError(removed.error, "regional_link_status 지운 연결");
  const rows = await withRefs(db, [...((live.data ?? []) as LinkRow[]), ...((removed.data ?? []) as LinkRow[])]);
  const fromInfo = (await describeRefs(db, [from])).get(refKey(from))!;
  return {
    from: { ...from, ...fromInfo },
    candidates: rows.filter((r) => r.status === "candidate"),
    confirmed: rows.filter((r) => r.status === "confirmed"),
    removed: rows.filter((r) => r.status === "removed"),
  };
}

/** 연결 한 줄 (관리 API — 상태 판정·감사 before) */
export async function loadLink(db: SupabaseClient, id: number): Promise<LinkRow | null> {
  const { data, error } = await db.from("regional_link_status").select(LINK_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "regional_link_status 한 줄");
  return (data as LinkRow | null) ?? null;
}
