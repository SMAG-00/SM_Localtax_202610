import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { canCreate, canReadOwn, isTargetKind, isValidTargetId, type TargetKind } from "@/lib/server/workspace/logic";
import { addScrap, createFolder, createSearch, deleteFolder, deleteNote, deleteSearch, loadAccess, removeScrap, saveNote, writeWidgets } from "@/lib/server/workspace/store";

// 워크스페이스 쓰기 API (W13-b) - 폴더·메모·스크랩·저장 검색·위젯. 로그인한 본인 것만, 기능 키가 꺼지면 404.
// 새로 만들기는 권한(workspace)이 있어야 하고, 지우기는 권한이 끝난 뒤에도 본인 자료에 한해 허용한다 (구독 종료 후 보존).
export const dynamic = "force-dynamic";
const H = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: H });

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const bool = (v: unknown): boolean => v === true || v === "true" || v === "on" || v === "1";

async function readBody(request: Request): Promise<{ body: Record<string, unknown>; form: boolean } | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const fd = await request.formData();
      const body: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) if (typeof v === "string") body[k] = v;
      return { body, form: true };
    }
    const j = (await request.json()) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? { body: j as Record<string, unknown>, form: false } : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const db = adminClient();
  if (!db) return reply({ error: "server_config" }, 503);
  if (!isSameSiteRequest(request)) return reply({ error: "cross_site" }, 403);
  const viewer = await getViewer(request).catch(() => null);
  const access = await loadAccess(db, viewer?.userId ?? null);
  if (access.view === "closed") return reply({ error: "not_found" }, 404);
  if (!viewer) return reply({ error: "unauthorized" }, 401);
  const parsed = await readBody(request);
  if (!parsed) return reply({ error: "bad_request" }, 400);
  const { body: b, form } = parsed;
  const uid = viewer.userId;
  const action = typeof b.action === "string" ? b.action : "";

  const creating = ["folder_create", "note_save", "scrap_add", "search_create", "widgets_set"];
  const deleting = ["folder_delete", "note_delete", "scrap_remove", "search_delete"];
  if (!creating.includes(action) && !deleting.includes(action)) return reply({ error: "bad_request" }, 400);
  if (creating.includes(action) ? !canCreate(access.view) : !canReadOwn(access.view)) return reply({ ok: false, code: "no_entitlement" }, 403);

  let result: { ok: boolean; code?: string; limit?: number } = { ok: true };
  const id = num(b.id);
  const folderId = num(b.folderId);
  switch (action) {
    case "folder_create":
      result = { ok: await createFolder(db, uid, text(b.name, 60)), code: "invalid" };
      break;
    case "folder_delete":
      if (id) await deleteFolder(db, uid, id);
      break;
    case "note_save": {
      const kind = b.targetKind;
      const tid = b.targetId;
      const hasTarget = isTargetKind(kind) && isValidTargetId(kind, tid);
      if ((kind || tid) && !hasTarget) return reply({ ok: false, code: "invalid" }, 422);
      const ok = await saveNote(db, uid, {
        id: id ?? undefined,
        folderId,
        title: text(b.title, 120) || null,
        body: text(b.body, 20000),
        targetKind: hasTarget ? (kind as TargetKind) : null,
        targetId: hasTarget ? (tid as string) : null,
        aiDraft: bool(b.aiDraft),
      });
      result = { ok, code: ok ? undefined : "invalid" };
      break;
    }
    case "note_delete":
      if (id) await deleteNote(db, uid, id);
      break;
    case "scrap_add": {
      if (!isTargetKind(b.targetKind)) return reply({ ok: false, code: "invalid" }, 422);
      const r = await addScrap(db, uid, { kind: b.targetKind, id: text(b.targetId, 64), label: text(b.label, 200), folderId });
      result = r.ok ? { ok: true } : { ok: false, code: r.code };
      break;
    }
    case "scrap_remove":
      if (id) await removeScrap(db, uid, id);
      break;
    case "search_create": {
      const r = await createSearch(db, uid, { name: text(b.name, 80), q: text(b.q, 200), kind: text(b.kind, 40) || null, notify: bool(b.notify) });
      result = r.ok ? { ok: true } : { ok: false, code: r.code, limit: r.limit };
      break;
    }
    case "search_delete":
      if (id) await deleteSearch(db, uid, id);
      break;
    case "widgets_set":
      await writeWidgets(db, uid, b.order, b.hidden);
      break;
  }

  const back = typeof b.return === "string" && /^\/workspace(\/[a-z]+)?$/.test(b.return) ? b.return : null;
  if (form && back) return new Response(null, { status: 303, headers: { ...H, location: result.ok ? back : `${back}?e=${encodeURIComponent(result.code ?? "invalid")}` } });
  return reply(result, result.ok ? 200 : result.code === "limit" || result.code === "duplicate" ? 409 : 422);
}
