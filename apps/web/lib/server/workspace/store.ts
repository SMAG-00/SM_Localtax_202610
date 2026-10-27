import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { featureOn, readSetting } from "@/lib/server/brief/policy";
import { hasEntitlementKey } from "@/lib/server/billing/service";
import {
  UNVERSIONED,
  decideWorkspaceAccess,
  excerptFromRead,
  isRevised,
  isValidTargetId,
  parseExcerptLimit,
  parseMode,
  type ExportItem,
  type Mode,
  type TargetKind,
  type WorkspaceView,
} from "./logic";

// 워크스페이스 데이터 접근 (W13-b) - 서비스 역할로 읽고 쓰되 user_id는 서버가 세션에서 정한 값만 쓴다. 프리미엄 본문은 저장하지 않고,
// 내보내기 때 권한·승인·권리를 확인해 한도 안에서만 읽는다. 로그에는 글·검색어를 남기지 않는다.

type Db = SupabaseClient;
type Row = Record<string, unknown>;
const fail = (what: string, code: string | undefined): never => {
  console.error(`[workspace] ${what} 실패:`, code);
  throw new Error(`${what} 실패`);
};

export interface Access {
  view: WorkspaceView;
  entitled: boolean;
}

/** 기능 키 · 로그인 · 권한(결제 모듈의 hasEntitlementKey) 세 가지로만 정한다. 요청의 모드 값은 받지 않는다 */
export async function loadAccess(db: Db, userId: string | null): Promise<Access> {
  const on = await featureOn(db, "workspace").catch(() => false);
  const entitled = on && userId !== null ? await hasEntitlementKey(db, userId, "workspace") : false;
  return { view: decideWorkspaceAccess({ featureOn: on, loggedIn: userId !== null, entitled }), entitled };
}

// ── 대상 읽기 (서버가 제목·버전을 정한다) ─────────────────────
export interface TargetInfo {
  label: string;
  version: string;
}

async function one(db: Db, table: string, cols: string, id: string): Promise<Row | null> {
  const { data, error } = await db.from(table).select(cols).eq("id", id).limit(1);
  if (error) fail(`${table} 읽기`, error.code);
  return ((data ?? [])[0] as unknown as Row | undefined) ?? null;
}

/** 승인·공개 권리 확인·발행된 대상만 돌려준다 (그 밖은 null - 존재 여부도 알리지 않는다) */
export async function readTarget(db: Db, kind: TargetKind, id: string): Promise<TargetInfo | null> {
  if (!isValidTargetId(kind, id)) return null;
  switch (kind) {
    case "node":
    case "issue_article": {
      const table = kind === "node" ? "pub_nodes" : "magazine_articles";
      const r = await one(db, table, "title, status, rights_public", id);
      if (!r || r.status !== "approved" || r.rights_public !== "confirmed") return null;
      const { data } = await db.from("library_bodies").select("body_hash").eq("kind", kind).eq("ref_id", id).limit(1);
      const hash = (data?.[0] as { body_hash?: string } | undefined)?.body_hash;
      const updated = hash ?? (await one(db, table, "updated_at", id))?.updated_at;
      return { label: String(r.title), version: String(updated ?? UNVERSIONED) };
    }
    case "issue": {
      const r = await one(db, "magazine_issues", "title, issue_no, status, rights_public, updated_at", id);
      if (!r || r.status !== "approved" || r.rights_public !== "confirmed") return null;
      return { label: String(r.title ?? `${String(r.issue_no)} 권호`), version: String(r.updated_at) };
    }
    case "article":
    case "column": {
      const r = await one(db, "articles", "title, status, version", id);
      if (!r || r.status !== "published") return null;
      return { label: String(r.title), version: String(r.version ?? UNVERSIONED) };
    }
    case "law_article": {
      const r = await one(db, "law_articles", "article_no, branch_no, title, version_id", id);
      if (!r) return null;
      const no = Number(r.branch_no) > 0 ? `${String(r.article_no)}조의${String(r.branch_no)}` : `${String(r.article_no)}조`;
      return { label: r.title ? `${no} ${String(r.title)}` : no, version: String(r.version_id) };
    }
    case "legal_doc": {
      const r = await one(db, "legal_docs", "issuer, doc_no, content_hash, rights_status", id);
      if (!r || r.rights_status !== "confirmed") return null;
      return { label: `${String(r.issuer)} ${String(r.doc_no)}`, version: String(r.content_hash) };
    }
    default:
      return { label: "", version: UNVERSIONED };
  }
}

/** 지금 원문 버전 - 조문은 같은 법령의 가장 최근 개정판 번호, 나머지는 읽은 버전 */
export async function currentVersion(db: Db, kind: TargetKind, id: string): Promise<string | null> {
  if (kind === "agent_answer" || kind === "copilot_result") return null;
  if (kind === "law_article") {
    const a = await one(db, "law_articles", "version_id", id);
    if (!a) return null;
    const v = await one(db, "law_versions", "law_id", String(a.version_id));
    if (!v) return null;
    const { data } = await db.from("law_versions").select("id").eq("law_id", v.law_id as number).order("effective_on", { ascending: false }).order("id", { ascending: false }).limit(1);
    const latest = (data?.[0] as { id?: number } | undefined)?.id;
    return latest === undefined ? null : String(latest);
  }
  return (await readTarget(db, kind, id))?.version ?? null;
}

// ── 폴더·메모·스크랩 ──────────────────────────────────────
export async function listFolders(db: Db, userId: string): Promise<{ id: number; name: string }[]> {
  const { data, error } = await db.from("folders").select("id, name").eq("user_id", userId).order("name");
  if (error) fail("폴더 읽기", error.code);
  return (data ?? []) as { id: number; name: string }[];
}

export async function createFolder(db: Db, userId: string, name: string): Promise<boolean> {
  const { error } = await db.from("folders").insert({ user_id: userId, name: name.trim() });
  if (error && error.code !== "23505" && error.code !== "23514") fail("폴더 만들기", error.code);
  return !error;
}

export async function deleteFolder(db: Db, userId: string, id: number): Promise<void> {
  const { error } = await db.from("folders").delete().eq("user_id", userId).eq("id", id);
  if (error) fail("폴더 지우기", error.code);
}

export interface NoteRow {
  id: number;
  folder_id: number | null;
  title: string | null;
  body: string;
  target_kind: TargetKind | null;
  target_id: string | null;
  ai_draft: boolean;
  updated_at: string;
}

export async function listNotes(db: Db, userId: string, limit = 200, folderId?: number): Promise<NoteRow[]> {
  let q = db.from("notes").select("id, folder_id, title, body, target_kind, target_id, ai_draft, updated_at").eq("user_id", userId);
  if (folderId !== undefined) q = q.eq("folder_id", folderId);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(limit);
  if (error) fail("메모 읽기", error.code);
  return (data ?? []) as NoteRow[];
}

export interface NoteInput {
  id?: number;
  folderId: number | null;
  title: string | null;
  body: string;
  targetKind: TargetKind | null;
  targetId: string | null;
  aiDraft: boolean;
}

export async function saveNote(db: Db, userId: string, n: NoteInput): Promise<boolean> {
  const row = { folder_id: n.folderId, title: n.title?.trim() || null, body: n.body, target_kind: n.targetKind, target_id: n.targetId, ai_draft: n.aiDraft };
  const res = n.id === undefined ? await db.from("notes").insert({ user_id: userId, ...row }) : await db.from("notes").update(row).eq("user_id", userId).eq("id", n.id);
  if (res.error && !["23514", "23503", "22001"].includes(res.error.code ?? "")) fail("메모 저장", res.error.code);
  return !res.error;
}

export async function deleteNote(db: Db, userId: string, id: number): Promise<void> {
  const { error } = await db.from("notes").delete().eq("user_id", userId).eq("id", id);
  if (error) fail("메모 지우기", error.code);
}

export interface ScrapRow {
  id: number;
  folder_id: number | null;
  target_kind: TargetKind;
  target_id: string;
  label: string;
  source_version: string;
  checked_on: string;
  created_at: string;
  revised?: boolean;
}

export async function listScraps(db: Db, userId: string, limit = 200, withRevised = true): Promise<ScrapRow[]> {
  const { data, error } = await db.from("scraps").select("id, folder_id, target_kind, target_id, label, source_version, checked_on, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) fail("스크랩 읽기", error.code);
  const rows = (data ?? []) as ScrapRow[];
  if (!withRevised) return rows;
  return Promise.all(
    rows.map(async (r) => {
      const cur = await currentVersion(db, r.target_kind, r.target_id).catch(() => null);
      return { ...r, revised: isRevised(r.source_version, cur) };
    }),
  );
}

export type AddScrapResult = { ok: true } | { ok: false; code: "target_not_found" | "duplicate" | "invalid" };

/** 스크랩 - 제목·원문 버전은 서버가 읽은 값을 쓴다 (대화·코파일럿 결과만 클라이언트 제목 사용) */
export async function addScrap(db: Db, userId: string, p: { kind: TargetKind; id: string; label: string; folderId: number | null }): Promise<AddScrapResult> {
  if (!isValidTargetId(p.kind, p.id)) return { ok: false, code: "invalid" };
  const info = await readTarget(db, p.kind, p.id);
  if (!info) return { ok: false, code: "target_not_found" };
  const label = (info.label || p.label).trim().slice(0, 200);
  if (!label) return { ok: false, code: "invalid" };
  const { error } = await db.from("scraps").insert({ user_id: userId, folder_id: p.folderId, target_kind: p.kind, target_id: p.id, label, source_version: info.version });
  if (error?.code === "23505") return { ok: false, code: "duplicate" };
  if (error?.code === "23514" || error?.code === "23503") return { ok: false, code: "invalid" };
  if (error) fail("스크랩 저장", error.code);
  return { ok: true };
}

export async function removeScrap(db: Db, userId: string, id: number): Promise<void> {
  const { error } = await db.from("scraps").delete().eq("user_id", userId).eq("id", id);
  if (error) fail("스크랩 지우기", error.code);
}

// ── 저장 검색 ─────────────────────────────────────────────
export interface SavedSearchRow {
  id: number;
  name: string;
  conditions: { q?: string };
  notify: boolean;
  last_checked_at: string | null;
  created_at: string;
  newCount?: number;
}

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** 새 결과 수 - 공개 기사(발행·무료)만, 마지막 확인(없으면 저장) 이후 제목에 검색어가 든 것 */
export async function newResultCount(db: Db, s: SavedSearchRow): Promise<number> {
  const q = typeof s.conditions?.q === "string" ? s.conditions.q.trim() : "";
  if (!q) return 0;
  const { count, error } = await db
    .from("public_articles")
    .select("id", { count: "exact", head: true })
    .ilike("title", `%${likeEscape(q)}%`)
    .gt("first_published_at", s.last_checked_at ?? s.created_at);
  if (error) fail("새 결과 세기", error.code);
  return count ?? 0;
}

export async function listSearches(db: Db, userId: string, withCounts = false): Promise<SavedSearchRow[]> {
  const { data, error } = await db.from("saved_searches").select("id, name, conditions, notify, last_checked_at, created_at").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) fail("저장 검색 읽기", error.code);
  const rows = (data ?? []) as SavedSearchRow[];
  if (!withCounts) return rows;
  return Promise.all(rows.map(async (r) => ({ ...r, newCount: await newResultCount(db, r).catch(() => 0) })));
}

export type CreateSearchResult = { ok: true } | { ok: false; code: "invalid" | "no_entitlement" | "limit" | "duplicate"; limit?: number };

export async function createSearch(db: Db, userId: string, p: { name: string; q: string; kind: string | null; notify: boolean }): Promise<CreateSearchResult> {
  const conditions: Record<string, string> = { q: p.q.trim().slice(0, 200) };
  if (p.kind) conditions.kind = p.kind.slice(0, 40);
  const { data, error } = await db.rpc("ws_saved_search_create", { p_user: userId, p_name: p.name, p_conditions: conditions, p_notify: p.notify });
  if (error) fail("저장 검색 만들기", error.code);
  const d = (data ?? {}) as { ok?: boolean; code?: string; limit?: number };
  if (d.ok) return { ok: true };
  const code = d.code === "no_entitlement" || d.code === "limit" || d.code === "duplicate" ? d.code : "invalid";
  return { ok: false, code, limit: d.limit };
}

export async function deleteSearch(db: Db, userId: string, id: number): Promise<void> {
  const { error } = await db.from("saved_searches").delete().eq("user_id", userId).eq("id", id);
  if (error) fail("저장 검색 지우기", error.code);
}

// ── 개인 설정 (모드·위젯) ─────────────────────────────────
export const WIDGET_KEYS = ["law_changes", "search_news", "recent_notes", "recent_chats", "briefing"] as const;
export interface Prefs {
  mode: Mode;
  order: string[];
  hidden: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && (WIDGET_KEYS as readonly string[]).includes(x)) : []);

export async function readPrefs(db: Db, userId: string): Promise<Prefs> {
  const { data, error } = await db.from("workspace_prefs").select("mode, widgets").eq("user_id", userId).limit(1);
  if (error) fail("설정 읽기", error.code);
  const r = data?.[0] as { mode?: unknown; widgets?: { order?: unknown; hidden?: unknown } } | undefined;
  return { mode: parseMode(r?.mode), order: strings(r?.widgets?.order), hidden: strings(r?.widgets?.hidden) };
}

export async function writeMode(db: Db, userId: string, mode: Mode): Promise<void> {
  const { error } = await db.from("workspace_prefs").upsert({ user_id: userId, mode }, { onConflict: "user_id" });
  if (error) fail("모드 저장", error.code);
}

export async function writeWidgets(db: Db, userId: string, order: unknown, hidden: unknown): Promise<void> {
  const { error } = await db.from("workspace_prefs").upsert({ user_id: userId, widgets: { order: strings(order), hidden: strings(hidden) } }, { onConflict: "user_id" });
  if (error) fail("위젯 저장", error.code);
}

// ── 내보내기 ──────────────────────────────────────────────
export type ExportTarget = "notes" | "scraps" | "saved_searches" | "copilot_result";
export const EXPORT_TARGETS: readonly ExportTarget[] = ["notes", "scraps", "saved_searches", "copilot_result"];

export async function readExcerptLimit(db: Db): Promise<number | null> {
  return parseExcerptLimit(await readSetting(db, "export_excerpt_limit"));
}

/** 지식창고 본문 발췌 - 서버 절단 함수 library_read의 결과에서만 읽는다. 전문을 받은 경우(library 권한 ∧ 판매 권리 확인, 또는 공개 등급)에만 설정 글자 수까지, 미리보기만 받으면 0 */
async function libraryExcerpt(db: Db, userId: string, kind: TargetKind, id: string, limit: number, entitled: boolean): Promise<string> {
  if (!entitled || limit <= 0 || (kind !== "node" && kind !== "issue_article")) return "";
  const { data, error } = await db.rpc("library_read", { p_user: userId, p_kind: kind, p_id: Number(id) });
  if (error) {
    console.error("[workspace] library_read 실패:", error.code);
    return "";
  }
  return excerptFromRead(data, limit, entitled);
}

export async function buildExportItems(db: Db, userId: string, target: ExportTarget, p: { limit: number; entitled: boolean; folderId?: number }): Promise<ExportItem[]> {
  if (target === "notes") {
    const notes = await listNotes(db, userId, 2000, p.folderId);
    return Promise.all(
      notes.map(async (n) => ({
        kind: n.target_kind,
        id: n.target_id,
        title: n.title ?? "메모",
        version: "-",
        checkedOn: n.updated_at.slice(0, 10),
        memo: n.body,
        aiDraft: n.ai_draft,
        excerpt: n.target_kind && n.target_id ? await libraryExcerpt(db, userId, n.target_kind, n.target_id, p.limit, p.entitled) : "",
      })),
    );
  }
  if (target === "saved_searches") {
    const rows = await listSearches(db, userId);
    return rows.map((s) => ({ kind: null, id: null, title: s.name, version: "-", checkedOn: s.created_at.slice(0, 10), memo: `검색어: ${s.conditions?.q ?? ""}`, aiDraft: false, excerpt: "" }));
  }
  let scraps = await listScraps(db, userId, 2000, false);
  if (p.folderId !== undefined) scraps = scraps.filter((s) => s.folder_id === p.folderId);
  if (target === "copilot_result") scraps = scraps.filter((s) => s.target_kind === "copilot_result");
  return Promise.all(
    scraps.map(async (s) => ({
      kind: s.target_kind,
      id: s.target_id,
      title: s.label,
      version: s.source_version,
      checkedOn: s.checked_on,
      memo: "",
      aiDraft: s.target_kind === "copilot_result",
      excerpt: await libraryExcerpt(db, userId, s.target_kind, s.target_id, p.limit, p.entitled),
    })),
  );
}

export async function recordExport(db: Db, userId: string, p: { format: "docx" | "csv"; target: ExportTarget; items: number; citations: number; excerptChars: number }): Promise<void> {
  const { error } = await db.from("workspace_exports").insert({ user_id: userId, format: p.format, target: p.target, item_count: p.items, citation_count: p.citations, excerpt_chars: p.excerptChars });
  if (error) console.error("[workspace] 내보내기 이력 실패:", error.code);
}
