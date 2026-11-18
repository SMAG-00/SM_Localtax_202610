import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/access";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_COUNT, attachmentName, type EditorialRequestInput, type RequestStatus } from "@/lib/editorial/request-input";
import { packageFileGroups, type PackageFile } from "@/lib/editorial/package-files";
import { HttpError, dbError } from "../http";

// 편집위원 데스크 저장소 (PO 2026-11-18) — 요청 대기열(editorial_requests)·결과물 묶음(editorial_packages)·비공개 버킷(editorial-desk).
// 서버(service_role)만 읽고 쓴다. 접근 판정(editorial_desk.request·read)은 부르는 쪽(API·화면)이 먼저 한다.
// 실제 제작은 작업기(scripts/editorial-desk/worker.mjs — 지금은 PO PC, 서버 이전 뒤 서버)가 queued 요청을 가져가 처리한다.

export const DESK_BUCKET = "editorial-desk";
/** 작업기가 이 시간 안에 확인 기록을 남겼으면 '켜짐' */
export const WORKER_ONLINE_MS = 3 * 60_000;
/** 서명 주소 유효 시간(초) — 문의 첨부와 같은 5분 */
const SIGNED_URL_SECONDS = 300;

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime: string;
}

export interface DeskRequest {
  id: string;
  requester_label: string;
  requested_by: string | null;
  status: RequestStatus;
  input: EditorialRequestInput;
  attachments: Attachment[];
  package_id: string | null;
  progress: string | null;
  error: string | null;
  created_at: string;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface DeskPackage {
  id: string;
  folder: string;
  work_date: string;
  title: string;
  source: "web" | "cowork";
  files: PackageFile[];
  report: string | null;
  created_at: string;
  updated_at: string;
}

const REQUEST_COLUMNS = "id, requester_label, requested_by, status, input, attachments, package_id, progress, error, created_at, queued_at, started_at, finished_at";
const PACKAGE_COLUMNS = "id, folder, work_date, title, source, files, report, created_at, updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function deskId(raw: string): string {
  if (!UUID.test(raw)) throw new HttpError(404, "그런 요청이 없습니다");
  return raw.toLowerCase();
}

/** 요청을 고칠 수 있는 사람 — 요청한 본인 또는 관리자 */
function ownsOrAdmin(viewer: Viewer, row: Pick<DeskRequest, "requested_by">): boolean {
  return viewer.isAdmin || row.requested_by === viewer.userId;
}

export async function listRequests(db: SupabaseClient, limit = 50): Promise<DeskRequest[]> {
  const { data, error } = await db.from("editorial_requests").select(REQUEST_COLUMNS).neq("status", "draft").order("created_at", { ascending: false }).limit(limit);
  if (error) throw dbError(error, "editorial_requests 읽기");
  return (data ?? []) as DeskRequest[];
}

export async function getRequest(db: SupabaseClient, id: string): Promise<DeskRequest> {
  const { data, error } = await db.from("editorial_requests").select(REQUEST_COLUMNS).eq("id", deskId(id)).maybeSingle();
  if (error) throw dbError(error, "editorial_requests 읽기");
  if (!data) throw new HttpError(404, "그런 요청이 없습니다");
  return data as DeskRequest;
}

export async function createRequest(db: SupabaseClient, viewer: Viewer, input: EditorialRequestInput): Promise<DeskRequest> {
  const { data, error } = await db
    .from("editorial_requests")
    .insert({ requested_by: viewer.userId, requester_label: viewer.email ?? `user:${viewer.userId}`, status: "draft", input })
    .select(REQUEST_COLUMNS)
    .single();
  if (error) throw dbError(error, "editorial_requests 추가");
  return data as DeskRequest;
}

/** 첨부 하나 올리기 — 작성 중(draft) 요청에만, 본인·관리자만, 파일당 4MB·5개까지 */
export async function addAttachment(db: SupabaseClient, viewer: Viewer, id: string, file: File): Promise<DeskRequest> {
  const row = await getRequest(db, id);
  if (!ownsOrAdmin(viewer, row)) throw new HttpError(403, "요청한 본인과 관리자만 첨부를 더할 수 있습니다");
  if (row.status !== "draft") throw new HttpError(409, "이미 제출한 요청에는 첨부를 더할 수 없습니다");
  if (row.attachments.length >= ATTACHMENT_MAX_COUNT) throw new HttpError(422, `첨부는 ${ATTACHMENT_MAX_COUNT}개까지입니다 — 큰 자료는 링크로 적어 주세요`);
  const name = attachmentName(file.name);
  if (!name.ok) throw new HttpError(422, name.error);
  if (file.size === 0) throw new HttpError(422, "빈 파일입니다");
  if (file.size > ATTACHMENT_MAX_BYTES) throw new HttpError(413, `파일이 너무 큽니다 — 한 파일 ${(ATTACHMENT_MAX_BYTES / 1_000_000).toFixed(0)}MB까지, 큰 자료는 링크로 적어 주세요`);
  // 저장 키는 번호 + 확장자 — 저장소가 한글 키를 받지 않는다. 원래 이름은 name에 두고 내려받을 때 그 이름을 붙인다
  const path = `requests/${row.id}/${row.attachments.length + 1}.${name.ext}`;
  const mime = file.type || "application/octet-stream";
  const up = await db.storage.from(DESK_BUCKET).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: mime, upsert: false });
  if (up.error) throw new HttpError(503, "첨부를 저장하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  const attachments = [...row.attachments, { name: name.safe, path, size: file.size, mime }];
  const { data, error } = await db.from("editorial_requests").update({ attachments }).eq("id", row.id).eq("status", "draft").select(REQUEST_COLUMNS).maybeSingle();
  if (error || !data) {
    await db.storage.from(DESK_BUCKET).remove([path]);
    if (error) throw dbError(error, "editorial_requests 첨부 기록");
    throw new HttpError(409, "요청 상태가 바뀌어 첨부를 더하지 못했습니다 — 새로고침해 주세요");
  }
  return data as DeskRequest;
}

/** 상태 바꾸기 — from 상태일 때만 (동시에 두 번 눌러도 한 번만 바뀐다) */
async function transition(db: SupabaseClient, viewer: Viewer, id: string, from: readonly RequestStatus[], to: RequestStatus, extra: Record<string, unknown>, what: string): Promise<DeskRequest> {
  const row = await getRequest(db, id);
  if (!ownsOrAdmin(viewer, row)) throw new HttpError(403, `요청한 본인과 관리자만 ${what}할 수 있습니다`);
  if (!from.includes(row.status)) throw new HttpError(409, `지금 상태(${row.status})에서는 ${what}할 수 없습니다`);
  const { data, error } = await db.from("editorial_requests").update({ status: to, ...extra }).eq("id", row.id).in("status", from).select(REQUEST_COLUMNS).maybeSingle();
  if (error) throw dbError(error, `editorial_requests ${what}`);
  if (!data) throw new HttpError(409, "요청 상태가 방금 바뀌었습니다 — 새로고침해 주세요");
  return data as DeskRequest;
}

export const submitRequest = (db: SupabaseClient, viewer: Viewer, id: string) => transition(db, viewer, id, ["draft"], "queued", { queued_at: new Date().toISOString() }, "제출");
/** 취소 — 작성 중·대기만. 이미 제작 중인 요청은 작업기가 끝까지 처리한다 */
export const cancelRequest = (db: SupabaseClient, viewer: Viewer, id: string) => transition(db, viewer, id, ["draft", "queued"], "canceled", { finished_at: new Date().toISOString() }, "취소");

export async function listPackages(db: SupabaseClient, limit = 60): Promise<DeskPackage[]> {
  const { data, error } = await db.from("editorial_packages").select(PACKAGE_COLUMNS).order("work_date", { ascending: false }).order("folder", { ascending: false }).limit(limit);
  if (error) throw dbError(error, "editorial_packages 읽기");
  return (data ?? []) as DeskPackage[];
}

export async function getPackage(db: SupabaseClient, id: string): Promise<DeskPackage> {
  const { data, error } = await db.from("editorial_packages").select(PACKAGE_COLUMNS).eq("id", deskId(id)).maybeSingle();
  if (error) throw dbError(error, "editorial_packages 읽기");
  if (!data) throw new HttpError(404, "그런 결과물이 없습니다");
  return data as DeskPackage;
}

/** 작업기 상태 — 가장 최근에 확인된 작업기 */
export async function workerStatus(db: SupabaseClient, now = Date.now()): Promise<{ online: boolean; seenAt: string | null; worker: string | null }> {
  const { data, error } = await db.from("editorial_worker_status").select("worker, seen_at").order("seen_at", { ascending: false }).limit(1);
  if (error) throw dbError(error, "editorial_worker_status 읽기");
  const row = (data ?? [])[0] as { worker: string; seen_at: string } | undefined;
  if (!row) return { online: false, seenAt: null, worker: null };
  return { online: now - new Date(row.seen_at).getTime() <= WORKER_ONLINE_MS, seenAt: row.seen_at, worker: row.worker };
}

/**
 * 결과물·첨부 파일의 5분 서명 주소. 묶음의 파일 목록에 있는 경로만 — 목록 밖 경로(../ 등)는 404.
 * html·md·json 같은 글 파일은 내려받기로만 준다(저장소 도메인에서 페이지로 열리지 않게).
 */
export async function signedFileUrl(db: SupabaseClient, kind: "package" | "attachment", id: string, path: string): Promise<string> {
  let objectPath: string;
  let fileName: string;
  let inline = false;
  if (kind === "package") {
    const pkg = await getPackage(db, id);
    const file = pkg.files.find((f) => f.path === path);
    // 키는 그 묶음 폴더 아래만 — 목록이 어긋나도 다른 묶음·첨부의 객체를 열지 않는다
    if (!file || !file.key.startsWith(`packages/${pkg.folder}/`) || file.key.includes("..")) throw new HttpError(404, "그런 파일이 없습니다");
    objectPath = file.key;
    fileName = file.path.split("/").pop()!;
    inline = /^image\/(png|jpeg|webp)$/.test(file.mime) || file.mime === "application/pdf";
  } else {
    const req = await getRequest(db, id);
    const file = req.attachments.find((a) => a.path === path);
    if (!file) throw new HttpError(404, "그런 파일이 없습니다");
    objectPath = file.path;
    fileName = file.name;
  }
  const { data, error } = await db.storage.from(DESK_BUCKET).createSignedUrl(objectPath, SIGNED_URL_SECONDS, inline ? undefined : { download: fileName });
  if (error || !data?.signedUrl) throw new HttpError(404, "파일을 찾지 못했습니다 — 작업기가 아직 올리지 않았을 수 있습니다");
  return data.signedUrl;
}

export { packageFileGroups };
