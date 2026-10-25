import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { assembleDraft, checkIssue, loadIssue } from "@/lib/server/brief/issues";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { applyAiDraft } from "@/lib/server/ops-ai/service";
import type { SupabaseClient } from "@supabase/supabase-js";

// 브리핑 호 관리 (W10-e - BRIEF-01~04 · AIOPS-01·02). 편집 책임자·관리자만(review_item.decide).
//  · GET - 최근 호 30개 + 승인된 AI 초안·개정 단계 후보(반영 대기) + 개정안 목록
//  · POST op=assemble 다음 호 초안 틀 / update 본문 고치기(초안만) / check 검사기 8종 / approve 승인(DB 함수 - 차단 0·경고 확인·AI 항목 검수) / unapprove 승인 취소
//    / apply_ai_draft 승인된 AI 초안을 초안 호에 넣기 / apply_amendment 승인된 개정 단계 후보를 개정 트래커에 반영
// 승인·발행 판정은 DB 함수가 하고, 이 API는 호출·입력 모양 검사·감사 기록만 한다. 발행은 정시 작업(brief-publish)만 한다.
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLS = "id, issue_no, kind, title, publish_at, corners, has_ad, status, check_report, approved_by, approved_at, published_at";

function sanitizeCorners(value: unknown): { ok: true; corners: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length > 10) return { ok: false, error: "corners: 코너는 10개 이하의 배열이어야 합니다" };
  const out: unknown[] = [];
  for (const c of value as Record<string, unknown>[]) {
    if (!c || typeof c.key !== "string" || !SLUG.test(c.key.replace(/_/g, "-")) || typeof c.title !== "string" || c.title.trim() === "" || c.title.length > 60 || !Array.isArray(c.items) || c.items.length > 30) return { ok: false, error: "corners: 코너 모양이 맞지 않습니다" };
    const items: unknown[] = [];
    for (const it of c.items as Record<string, unknown>[]) {
      if (!it || typeof it.id !== "string" || it.id.length > 40 || typeof it.text !== "string" || it.text.trim() === "" || it.text.length > 500 || !["human", "ai", "system"].includes(String(it.origin)) || typeof it.reviewed !== "boolean") return { ok: false, error: "corners: 항목 모양이 맞지 않습니다" };
      const url = (v: unknown) => (typeof v === "string" && /^https:\/\/\S{1,290}$/.test(v) ? v : undefined);
      const amendment = it.amendment && typeof it.amendment === "object" ? { stageLabel: String((it.amendment as Record<string, unknown>).stageLabel ?? "").slice(0, 20), confirmed: (it.amendment as Record<string, unknown>).confirmed === true } : undefined;
      const BADGES = ["live", "plan", "expc", "win", "lose"];
      const strList = (v: unknown, n: number, m: number): string[] | undefined => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, m)).slice(0, n) : undefined);
      items.push({
        id: it.id, text: it.text.trim(), origin: it.origin, reviewed: it.reviewed, sourceUrl: url(it.sourceUrl),
        sourceNo: typeof it.sourceNo === "string" ? it.sourceNo.slice(0, 60) : undefined, sourceDate: typeof it.sourceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(it.sourceDate) ? it.sourceDate : undefined,
        links: Array.isArray(it.links) ? (it.links as unknown[]).map(url).filter((u): u is string => !!u).slice(0, 5) : undefined, amendment,
        badge: BADGES.includes(String(it.badge)) ? it.badge : undefined, badgeLabel: typeof it.badgeLabel === "string" ? it.badgeLabel.slice(0, 30) : undefined, tags: strList(it.tags, 6, 30), meta: strList(it.meta, 6, 80),
      });
    }
    out.push({ key: c.key, title: c.title.trim(), items, emptyNote: typeof c.emptyNote === "string" ? c.emptyNote.slice(0, 120) : undefined });
  }
  return { ok: true, corners: out };
}

function rpcFail(error: { code?: string; message: string }): Response {
  if (error.code === "23514" || error.code === "42501" || error.code === "P0002") return errorJson(422, "입력값을 확인하세요", { errors: [error.message] });
  console.error("[brief-admin] DB 함수 오류:", error.code, error.message);
  return errorJson(500, "서버 오류가 났습니다 - 잠시 뒤 다시 시도하세요");
}

async function pendingApply(db: SupabaseClient) {
  const r = await db.from("review_items").select("id, kind, title, payload, status").eq("status", "approved").in("kind", ["ai_draft", "amendment_stage"]).order("id").limit(100);
  return (r.data ?? []) as { id: number; kind: string; title: string; payload: Record<string, unknown>; status: string }[];
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "review_item.decide", "brief:list");
  if (denied) return denied;
  const db = serviceDb();
  const [issues, am] = await Promise.all([db.from("brief_issues").select(COLS).order("issue_no", { ascending: false }).limit(30), db.from("amendments").select("id, slug, title, law_names").order("id", { ascending: false }).limit(200)]);
  if (issues.error) return rpcFail(issues.error);
  return json({ issues: issues.data ?? [], pending: await pendingApply(db), amendments: am.data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "review_item.decide", `brief:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const id = Number(body.id);
  const needId = () => (Number.isInteger(id) && id > 0 ? null : errorJson(422, "입력값을 확인하세요", { errors: ["id: 호 번호가 필요합니다"] }));

  try {
    if (op === "assemble") {
      const r = await assembleDraft(db, new Date(), actor);
      await writeAudit(db, { actor, action: "brief.assemble", target: `brief_issues:${r.id}`, before: null, after: r, reason: "브리핑 초안 틀 만들기" });
      return json(r, r.created ? 201 : 200);
    }
    if (op === "update") {
      const bad = needId();
      if (bad) return bad;
      const patch: Record<string, unknown> = {};
      if (typeof body.title === "string") {
        if (body.title.trim() === "" || body.title.length > 200) return errorJson(422, "입력값을 확인하세요", { errors: ["title: 1~200자로 적으세요"] });
        patch.title = body.title.trim();
      }
      if (typeof body.hasAd === "boolean") patch.has_ad = body.hasAd;
      if (body.corners !== undefined) {
        const c = sanitizeCorners(body.corners);
        if (!c.ok) return errorJson(422, "입력값을 확인하세요", { errors: [c.error] });
        patch.corners = c.corners;
      }
      if (Object.keys(patch).length === 0) return errorJson(422, "고칠 내용이 없습니다");
      const upd = await db.from("brief_issues").update(patch).eq("id", id).select(COLS).single();
      if (upd.error) return rpcFail(upd.error);
      await writeAudit(db, { actor, action: "brief.update", target: `brief_issues:${id}`, before: null, after: { fields: Object.keys(patch) }, reason: "브리핑 초안 고치기 (검사 보고서는 비워진다)" });
      return json({ issue: upd.data });
    }
    if (op === "check") {
      const bad = needId();
      if (bad) return bad;
      const report = await checkIssue(db, id, new Date());
      await writeAudit(db, { actor, action: "brief.check", target: `brief_issues:${id}`, before: null, after: { blocking: report.blocking, warnings: report.warnings }, reason: "검사기 8종 실행" });
      return json({ report });
    }
    if (op === "approve" || op === "unapprove") {
      const bad = needId();
      if (bad) return bad;
      const r = op === "approve"
        ? await db.rpc("brief_issue_approve", { p_id: id, p_actor: actor, p_ack_by: body.ackWarnings === true ? actor : null })
        : await db.rpc("brief_issue_unapprove", { p_id: id, p_actor: actor });
      if (r.error) {
        await writeAudit(db, { actor, action: `brief.${op}_denied`, target: `brief_issues:${id}`, before: null, after: { error: r.error.message.slice(0, 200) }, reason: "브리핑 승인 조건 미충족" });
        return rpcFail(r.error);
      }
      await writeAudit(db, { actor, action: `brief.${op}`, target: `brief_issues:${id}`, before: null, after: { status: (r.data as { status: string }).status }, reason: op === "approve" ? "브리핑 호 승인" : "브리핑 호 승인 취소" });
      return json({ issue: r.data });
    }
    if (op === "apply_ai_draft") {
      const itemId = Number(body.itemId);
      if (!Number.isInteger(itemId) || itemId <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["itemId: 검수 항목 번호가 필요합니다"] });
      try {
        const r = await applyAiDraft(db, itemId, actor);
        await writeAudit(db, { actor, action: "brief.apply_ai_draft", target: `review_items:${itemId}`, before: null, after: r, reason: "승인된 AI 초안을 초안 호에 넣기" });
        return json(r);
      } catch (err) {
        return errorJson(422, "입력값을 확인하세요", { errors: [err instanceof Error ? err.message : "반영할 수 없습니다"] });
      }
    }
    if (op === "apply_amendment") {
      const itemId = Number(body.itemId);
      const amendmentId = Number(body.amendmentId);
      if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(amendmentId) || amendmentId <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["itemId·amendmentId: 번호가 필요합니다"] });
      const r = await db.rpc("amendment_candidate_apply", { p_item_id: itemId, p_amendment_id: amendmentId, p_actor: actor });
      if (r.error) {
        await writeAudit(db, { actor, action: "amendment_candidate.apply_denied", target: `review_items:${itemId}`, before: null, after: { error: r.error.message.slice(0, 200) }, reason: "개정 단계 후보 반영 거부" });
        return rpcFail(r.error);
      }
      await writeAudit(db, { actor, action: "amendment_candidate.apply", target: `review_items:${itemId}`, before: null, after: { amendmentEventId: r.data, amendmentId }, reason: "승인된 개정 단계 후보를 개정 트래커에 반영 (origin=auto)" });
      return json({ amendmentEventId: r.data });
    }
    return errorJson(422, "op는 assemble·update·check·approve·unapprove·apply_ai_draft·apply_amendment 중 하나입니다");
  } finally {
    void loadIssue;
  }
});
