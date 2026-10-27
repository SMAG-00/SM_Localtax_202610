import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { DOCX_MIME, buildDocx } from "@/lib/server/workspace/docx";
import { canReadOwn, countCitations, seoulDate, toCsv, totalExcerptChars } from "@/lib/server/workspace/logic";
import { EXPORT_TARGETS, buildExportItems, loadAccess, readExcerptLimit, recordExport, type ExportTarget } from "@/lib/server/workspace/store";

// 내보내기 (W13-b, WS-05) - 메모·스크랩·저장 검색·코파일럿 결과를 .docx / .csv로. 로그인한 본인 것만.
// 발췌 한도(settings export_excerpt_limit)가 비어 있으면 내보내기 전체 403. 권한이 끝난 회원은 인용·본인 메모만 나가고 발췌는 0. 응답은 비공유 캐시.
export const dynamic = "force-dynamic";
const H = { "cache-control": "private, no-store", "x-robots-tag": "noindex" } as const;
const err = (status: number, code: string) => Response.json({ error: code }, { status, headers: H });

export async function GET(request: Request) {
  const db = adminClient();
  if (!db) return err(503, "server_config");
  const viewer = await getViewer(request).catch(() => null);
  const access = await loadAccess(db, viewer?.userId ?? null);
  if (access.view === "closed") return err(404, "not_found");
  if (!viewer) return err(401, "unauthorized");
  if (!canReadOwn(access.view)) return err(403, "forbidden");
  const url = new URL(request.url);
  const format = url.searchParams.get("format");
  const target = url.searchParams.get("target") as ExportTarget | null;
  if ((format !== "docx" && format !== "csv") || !target || !EXPORT_TARGETS.includes(target)) return err(400, "bad_request");
  const folderRaw = url.searchParams.get("folder");
  const folderId = folderRaw !== null && /^[0-9]{1,18}$/.test(folderRaw) ? Number(folderRaw) : undefined;

  const limit = await readExcerptLimit(db);
  if (limit === null) return err(403, "export_closed");

  const now = new Date();
  const items = await buildExportItems(db, viewer.userId, target, { limit, entitled: access.entitled, folderId });
  const exportedOn = seoulDate(now);
  const citations = countCitations(items);
  await recordExport(db, viewer.userId, { format, target, items: items.length, citations, excerptChars: totalExcerptChars(items) });

  const name = `workspace-${target}-${exportedOn.replaceAll("-", "")}.${format}`;
  const headers = { ...H, "content-disposition": `attachment; filename="${name}"`, "x-content-type-options": "nosniff" };
  if (format === "csv") return new Response(toCsv(items, exportedOn), { status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
  const title = { notes: "메모", scraps: "스크랩", saved_searches: "저장 검색", copilot_result: "코파일럿 결과" }[target];
  return new Response(new Uint8Array(buildDocx({ title: `워크스페이스 ${title}`, exportedOn, items }, now)), { status: 200, headers: { ...headers, "content-type": DOCX_MIME } });
}
