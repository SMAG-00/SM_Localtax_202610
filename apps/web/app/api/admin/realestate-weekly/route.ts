import { WEEKLY_MAX_ITEMS, weeklyDraftProblems } from "@/lib/server/public/realestate-weekly-logic";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import type { SupabaseClient } from "@supabase/supabase-js";

// 금주 부동산 재테크 관리 (/admin/realestate-weekly, PR-15). create_issue·set_items = weekly_point.edit / publish = weekly_point.publish.
// 항목 글(세금 관점 한 줄)은 사람이 쓴다 - AI 초안 0. 금지 표현·세액·60자는 저장 때, 3~7건은 발행 때 확인하고 DB 발행 함수가 공개 기사·분야·주를 한 번 더 확인한다.
export const dynamic = "force-dynamic";

type Item = { articleId: number; taxItems: string[]; point: string };

async function forbiddenPhrases(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("settings").select("value").eq("key", "forbidden_phrases").maybeSingle();
  return Array.isArray(data?.value) ? (data!.value as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

function parseItems(raw: unknown): { items: Item[]; errors: string[] } {
  if (!Array.isArray(raw)) return { items: [], errors: ["items: 목록이어야 합니다"] };
  const errors: string[] = [];
  const items = raw.map((r, i): Item => {
    const o = (r ?? {}) as Record<string, unknown>;
    const articleId = Number(o.articleId);
    if (!Number.isSafeInteger(articleId) || articleId <= 0) errors.push(`${i + 1}번 항목: 기사 번호를 확인하세요`);
    const taxItems = Array.isArray(o.taxItems) ? o.taxItems.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
    return { articleId, taxItems, point: typeof o.point === "string" ? o.point.trim() : "" };
  });
  if (new Set(items.map((i) => i.articleId)).size !== items.length) errors.push("items: 같은 기사를 두 번 넣을 수 없습니다");
  return { items, errors };
}

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, op === "publish" ? "weekly_point.publish" : "weekly_point.edit", `realestate_weekly:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create_issue") {
    const week = typeof body.week === "string" ? body.week : "";
    if (!/^\d{4}-\d{2}$/.test(week)) return errorJson(422, "입력값을 확인하세요", { errors: ["week: yyyy-ww 모양이어야 합니다"] });
    const ins = await db.from("realestate_weekly_issues").insert({ week, edited_by: actor }).select("id").single();
    if (ins.error || !ins.data) return errorJson(409, "만들지 못했습니다 (그 주의 호가 이미 있을 수 있습니다)");
    return json({ id: ins.data.id });
  }

  const issueId = Number(body.issueId);
  if (!Number.isSafeInteger(issueId) || issueId <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["issueId: 확인하세요"] });

  if (op === "set_items") {
    const parsed = parseItems(body.items);
    if (parsed.errors.length) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    if (parsed.items.length > WEEKLY_MAX_ITEMS) return errorJson(422, "입력값을 확인하세요", { errors: [`항목은 ${WEEKLY_MAX_ITEMS}건 이하여야 합니다`] });
    // 건수 문제는 발행 때 보므로 저장 때는 글 문제만 거른다
    const textProblems = weeklyDraftProblems(parsed.items.length >= 3 ? parsed.items : [...parsed.items, ...Array(3 - parsed.items.length).fill({ point: "확인", taxItems: ["확인"] })], await forbiddenPhrases(db)).filter((m) => !m.includes("건 이상") && !m.includes("건 이하"));
    if (textProblems.length) return errorJson(422, "문구를 고쳐 주세요", { errors: textProblems });
    const del = await db.from("realestate_weekly_items").delete().eq("issue_id", issueId);
    if (del.error) return errorJson(409, "고치지 못했습니다 (발행된 호는 고칠 수 없습니다)");
    if (parsed.items.length) {
      const ins = await db.from("realestate_weekly_items").insert(parsed.items.map((it, i) => ({ issue_id: issueId, article_id: it.articleId, rank: i + 1, tax_items: it.taxItems, point: it.point })));
      if (ins.error) return errorJson(409, "저장하지 못했습니다 (기사 번호를 확인하세요)");
    }
    return json({ saved: parsed.items.length });
  }

  if (op === "publish") {
    const rows = await db.from("realestate_weekly_items").select("article_id, tax_items, point").eq("issue_id", issueId).order("rank");
    if (rows.error) throw dbError(rows.error, "realestate_weekly_items 조회");
    const items = (rows.data ?? []).map((r: { article_id: number; tax_items: string[]; point: string }) => ({ articleId: r.article_id, taxItems: r.tax_items, point: r.point }));
    const problems = weeklyDraftProblems(items, await forbiddenPhrases(db));
    if (problems.length) return errorJson(422, "발행 전에 고쳐 주세요", { errors: problems });
    const r = await db.rpc("publish_realestate_weekly", { p_issue_id: issueId, p_actor: actor });
    if (r.error) throw dbError(r.error, "publish_realestate_weekly");
    const d = r.data as { ok: boolean; code: string; message: string };
    return d.ok ? json(d) : errorJson(409, d.message, { code: d.code });
  }
  return errorJson(400, "알 수 없는 요청입니다");
});
