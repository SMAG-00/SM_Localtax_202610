import { randomUUID } from "node:crypto";
import { MEDIA_BUCKET, MEDIA_MAX_BYTES, checkImageFile, mediaPathOf, parseMediaMeta } from "@/lib/admin/media-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { MEDIA_COLUMNS, listMediaRows, mediaView, type MediaRow } from "@/lib/server/admin/media-store";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json } from "@/lib/server/http";

// 사진 보관함 (F1) — 목록(GET)·올리기(POST). 기자·편집 책임자·관리자(media.edit).
// 올리기는 multipart/form-data: file(jpg·png·webp, 4,000,000바이트 이하) + alt(필수)·credit·photographer·license·source_url·license_type·kind.
// 올린 사진은 늘 '권리 미확인'이다 — 권리 확인은 POST /api/admin/media/[id]/rights (편집 책임자 이상). 권리 확인된 사진만 공개 화면에 나온다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "media.edit", "media:list");
  if (denied) return denied;
  const rights = new URL(request.url).searchParams.get("rights");
  if (rights !== null && !["unconfirmed", "confirmed", "rejected"].includes(rights)) return errorJson(422, "rights는 unconfirmed·confirmed·rejected 중 하나입니다");
  const rows = await listMediaRows(serviceDb(), { rights });
  return json({ media: rows.map(mediaView) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "media.edit", "media:new");
  if (denied) return denied;

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "사진 올리기는 multipart/form-data(파일 + 칸)로 보냅니다");
  }
  // 본문을 읽기 전에 크기부터 — 칸 글자 몫으로 100KB 여유
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES + 100_000) throw new HttpError(413, "파일이 너무 큽니다 — 4MB 이하 사진만 올릴 수 있습니다");
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "요청 본문을 읽지 못했습니다");
  });
  const file = form.get("file");
  if (!(file instanceof File)) return errorJson(422, "입력값을 확인하세요", { errors: ["file: 사진 파일이 필요합니다"] });
  const fields: Record<string, unknown> = {};
  for (const key of ["alt", "credit", "photographer", "license", "source_url", "license_type", "kind"]) {
    const v = form.get(key);
    if (typeof v === "string") fields[key] = v;
  }
  const meta = parseMediaMeta(fields, "create");
  const errors = meta.ok ? [] : [...meta.errors];
  if (meta.ok && !meta.value.alt) errors.push("alt: 대체 텍스트(사진 설명)가 필요합니다");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = checkImageFile(bytes);
  if (!image.ok) errors.push(...image.errors);
  if (errors.length || !meta.ok || !image.ok) return errorJson(422, "입력값을 확인하세요", { errors });

  const db = serviceDb();
  const objectName = `${randomUUID()}.${image.value.ext}`;
  const up = await db.storage.from(MEDIA_BUCKET).upload(objectName, bytes, { contentType: image.value.mime, upsert: false, cacheControl: "31536000" });
  if (up.error) {
    console.error("[media] 사진 저장 실패:", up.error.message);
    throw new HttpError(503, "사진을 저장하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const { data, error } = await db
    .from("media")
    .insert({ path: mediaPathOf(objectName), width: image.value.width, height: image.value.height, ...meta.value })
    .select(MEDIA_COLUMNS)
    .single();
  if (error || !data) {
    await db.storage.from(MEDIA_BUCKET).remove([objectName]);
    throw dbError(error ?? {}, "media 추가");
  }
  const row = data as unknown as MediaRow;
  await writeAudit(db, { actor: actorOf(viewer), action: "media.create", target: targetOf.media(row.id), before: null, after: { path: row.path, kind: row.kind, rights_status: row.rights_status }, reason: `사진 올리기 — ${row.alt ?? row.path}` });
  return json({ media: mediaView(row) }, 201);
});
