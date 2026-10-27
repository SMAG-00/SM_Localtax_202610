import "server-only";
import { headers } from "next/headers";
import { trustedClientIp } from "@/lib/analytics/request";
import { getViewer } from "@/lib/server/dal";
import { HttpError } from "@/lib/server/http";
import { adminClient, anonClient } from "@/lib/server/supabase";
import { rateKeyOf, visibleText, type LibraryReadResult } from "./logic";

// 지식창고 읽기 (W13-a a3, LIB-04·05·06). 요청마다 그린다(공유 캐시·캐시 태그 0 - 구독자 응답이 공유 저장소에 남지 않게 한다).
//  · 회원 번호는 서버 쿠키 세션에서만 정한다 (클라이언트가 보낸 등급·모드 값은 읽지 않는다).
//  · 미리보기·전문 절단은 DB 함수 library_read 하나가 한다. 이 모듈은 절단 로직을 복사하지 않는다.
//  · 열람 속도 제한은 library_rate_hit (계정 또는 IP 해시). 한도를 넘으면 본문 없이 limited.
//  · AI·학습 경로 0: 이 폴더에서 모델을 부르지 않는다 (NT9 경계 목록).

export type ReadOutcome =
  | { status: "ok"; title: string; tier: "public" | "premium"; full: boolean; text: string; reason: NonNullable<LibraryReadResult["reason"]> | null }
  | { status: "limited" }
  | { status: "closed" }
  | { status: "not_found" };

async function viewerId(): Promise<string | null> {
  try {
    return (await getViewer())?.userId ?? null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err; // 세션을 못 읽으면 비로그인 - 전문은 열지 않는다
    return null;
  }
}

/** 한 페이지 열람에 속도 제한을 한 번 센다 - ok 아니면 본문을 읽지 않는다 */
export async function rateGate(userId: string | null): Promise<"ok" | "limited" | "closed"> {
  const db = adminClient();
  if (!db) return "closed";
  const ip = trustedClientIp(await headers());
  const { data, error } = await db.rpc("library_rate_hit", { p_key: await rateKeyOf(userId, ip) });
  if (error) {
    console.error("[library] 속도 제한 확인 실패:", error.code);
    return "closed"; // 모르면 열지 않는다
  }
  const code = (data as { code?: string } | null)?.code;
  return code === "ok" ? "ok" : code === "limited" ? "limited" : "closed";
}

export async function readItem(kind: "node" | "issue_article", id: number, userId: string | null): Promise<ReadOutcome> {
  const db = adminClient();
  if (!db) return { status: "closed" };
  const { data, error } = await db.rpc("library_read", { p_user: userId, p_kind: kind, p_id: id });
  if (error) {
    console.error("[library] library_read 실패:", error.code);
    return { status: "closed" };
  }
  const r = data as LibraryReadResult;
  if (!r.ok) return { status: "not_found" };
  const text = visibleText(r);
  if (text === null || r.title === undefined || r.tier === undefined) return { status: "not_found" };
  return { status: "ok", title: r.title, tier: r.tier, full: r.full === true, text, reason: r.reason ?? null };
}

export async function currentUserId(): Promise<string | null> {
  return viewerId();
}

// ── 공개 뷰 읽기 (본문 칸 없음) ──
export interface NodeRow {
  id: number;
  edition_id: number;
  parent_id: number | null;
  depth: number;
  ordinal: number;
  title: string;
  access_tier: "public" | "premium";
  edition_label: string;
  as_of: string;
  publication_slug: string;
  publication_title: string;
  is_latest: boolean;
}
export interface IssueRow {
  id: number;
  issue_no: string;
  issued_on: string;
  as_of: string;
  title: string | null;
  publication_slug: string;
  publication_title: string;
  pdf_available: boolean;
}
export interface IssueArticleRow {
  id: number;
  issue_id: number;
  ordinal: number;
  title: string;
  author_person_id: number | null;
  access_tier: "public" | "premium";
}

export async function getNode(id: number): Promise<NodeRow | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db.from("public_library_nodes").select("*").eq("id", id).limit(1);
  if (error) return null;
  return ((data ?? []) as NodeRow[])[0] ?? null;
}
/** 같은 서명의 다른 판 (구판 연혁) - 같은 위치(깊이·제목)의 노드를 연혁으로 */
export async function getNodeSiblings(node: NodeRow): Promise<NodeRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_nodes").select("*").eq("edition_id", node.edition_id).eq("parent_id", node.id).order("ordinal");
  return (data ?? []) as NodeRow[];
}
export async function getEditionsOf(node: NodeRow): Promise<NodeRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_nodes").select("*").eq("publication_slug", node.publication_slug).eq("title", node.title).eq("depth", node.depth).order("as_of", { ascending: false });
  return (data ?? []) as NodeRow[];
}
export async function getIssue(id: number): Promise<IssueRow | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db.from("public_library_issues").select("*").eq("id", id).limit(1);
  if (error) return null;
  return ((data ?? []) as IssueRow[])[0] ?? null;
}
export async function getIssueArticles(issueId: number): Promise<IssueArticleRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_issue_articles").select("*").eq("issue_id", issueId).order("ordinal");
  return (data ?? []) as IssueArticleRow[];
}

/** 노드 상호참조 - 제목만 (공개 뷰 public_library_node_refs, 양쪽 모두 공개 조건을 통과한 것만) */
export async function getNodeRefs(nodeId: number): Promise<{ ref_id: number; ref_title: string }[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_node_refs").select("ref_id, ref_title").eq("node_id", nodeId).order("ref_id");
  return (data ?? []) as { ref_id: number; ref_title: string }[];
}

// ── 프리미엄 칼럼 (194) ──
export interface ColumnRow {
  id: number;
  slug: string;
  title: string;
  author_person_id: number | null;
  series_id: number | null;
  series_title: string | null;
  series_no: number | null;
  first_published_at: string | null;
}
export async function getColumns(): Promise<ColumnRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_columns").select("*").order("first_published_at", { ascending: false }).limit(200);
  return (data ?? []) as ColumnRow[];
}
export async function getColumn(id: number): Promise<ColumnRow | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db.from("public_library_columns").select("*").eq("id", id).limit(1);
  if (error) return null;
  return ((data ?? []) as ColumnRow[])[0] ?? null;
}
/** 칼럼 본문 - 서버 함수 column_read가 구독자에게만 전문, 나머지는 미리보기 */
export async function readColumn(id: number, userId: string | null): Promise<ReadOutcome> {
  const db = adminClient();
  if (!db) return { status: "closed" };
  const { data, error } = await db.rpc("column_read", { p_user: userId, p_article: id });
  if (error) {
    console.error("[library] column_read 실패:", error.code);
    return { status: "closed" };
  }
  const r = data as LibraryReadResult;
  if (!r.ok) return { status: "not_found" };
  const text = visibleText(r);
  if (text === null || r.title === undefined || r.tier === undefined) return { status: "not_found" };
  return { status: "ok", title: r.title, tier: r.tier, full: r.full === true, text, reason: r.reason ?? null };
}

// ── 필자 페이지 연결 (196) ──
export interface AuthorItem {
  kind: "issue_article" | "column";
  id: number;
  title: string;
  author_slug: string;
  parent_id: number | null;
  published_on: string | null;
}
export async function getAuthorItems(slug: string): Promise<AuthorItem[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_author_items").select("*").eq("author_slug", slug).order("published_on", { ascending: false }).limit(100);
  return (data ?? []) as AuthorItem[];
}

// ── 허브 (/library) · 링크 표시 ──
/** 기능 키 library 켜짐 여부 - 공개 함수 library_feature_on(boolean 하나). 모르면 false */
export async function libraryFeatureOn(): Promise<boolean> {
  const db = anonClient();
  if (!db) return false;
  const { data, error } = await db.rpc("library_feature_on");
  return !error && data === true;
}
export async function listIssues(): Promise<IssueRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_issues").select("*").order("issued_on", { ascending: false }).limit(200);
  return (data ?? []) as IssueRow[];
}
/** 단행본 최신판의 장(깊이 1) 목록 - 제목·판차·기준일만 */
export async function listTopNodes(): Promise<NodeRow[]> {
  const db = anonClient();
  if (!db) return [];
  const { data } = await db.from("public_library_nodes").select("*").eq("depth", 1).eq("is_latest", true).order("publication_slug").order("ordinal").limit(200);
  return (data ?? []) as NodeRow[];
}
