import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { loadStatsBoard } from "@/lib/server/stats/board";

// 지방세 통계 시계열 관리 (W12-h h4 - DATA-01, docs/dev/W12-h_설계.md). 권한 stats.approve (편집 책임자·관리자).
//  · GET - 시계열·기사 연결(새 기준연도 표시)·감사
//  · POST op=approve {id} / op=withdraw {id, reason}  승인·철회 (DB 함수가 조건을 다시 검사, 거부 409 + 감사 1행)
//  · POST op=attach {series_id, article_id, caption?} / op=detach {id}  기사 차트 연결 (승인된 시계열만, 기준연도는 시계열 값으로 고정)
// 이 경로에 AI는 없다. 시계열 값은 수집 배치만 쓰고 이 경로는 값을 고치지 못한다.
export const dynamic = "force-dynamic";

const OPS = ["approve", "withdraw", "attach", "detach"] as const;
const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "stats.approve", "stats:list");
  if (denied) return denied;
  return json(await loadStatsBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op) as (typeof OPS)[number];
  if (!(OPS as readonly string[]).includes(op)) return invalid([`op: ${OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "stats.approve", `stats:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "attach") {
    const seriesId = posInt(body.series_id);
    const articleId = posInt(body.article_id);
    const caption = typeof body.caption === "string" && body.caption.trim() !== "" ? body.caption.trim() : null;
    const errors: string[] = [];
    if (seriesId === null) errors.push("series_id: 시계열 번호(1 이상 정수)입니다");
    if (articleId === null) errors.push("article_id: 기사 번호(1 이상 정수)입니다");
    if (caption !== null && caption.length > 120) errors.push("caption: 120자 이하입니다");
    if (errors.length > 0) return invalid(errors);
    // base_year 칸은 필수라 자리값을 넣고, 연결 트리거가 시계열의 기준연도로 덮어쓴다
    const { data, error } = await db.from("article_data_charts").insert({ series_id: seriesId, article_id: articleId, caption, base_year: 2000, created_by: actor }).select("id, article_id, series_id, base_year").single();
    if (error) {
      if (error.code === "23514" || error.code === "23505" || error.code === "23503") return errorJson(409, error.message);
      throw dbError(error, "article_data_charts 추가");
    }
    await writeAudit(db, { actor, action: "stats_chart.attach", target: `article_data_charts:${(data as { id: number }).id}`, before: null, after: data as Record<string, unknown>, reason: "기사에 데이터 차트 연결(승인된 시계열만)" });
    revalidatePublicData();
    return json({ created: data }, 201);
  }

  const id = posInt(body.id);
  if (id === null) return invalid(["id: 번호(1 이상 정수)입니다"]);
  if (op === "detach") {
    const { error } = await db.from("article_data_charts").delete().eq("id", id);
    if (error) throw dbError(error, "article_data_charts 삭제");
    await writeAudit(db, { actor, action: "stats_chart.detach", target: `article_data_charts:${id}`, before: null, after: null, reason: "기사 데이터 차트 연결 해제" });
    revalidatePublicData();
    return json({ done: op });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const { data, error } =
    op === "approve"
      ? await db.rpc("stats_series_approve", { p_id: id, p_actor: actor })
      : await db.rpc("stats_series_withdraw", { p_id: id, p_actor: actor, p_reason: reason });
  if (error) throw dbError(error, `통계 시계열 ${op}`);
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ done: op });
});
