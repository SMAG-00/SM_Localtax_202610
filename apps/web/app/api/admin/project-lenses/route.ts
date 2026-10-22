import { can } from "@/lib/access";
import { LENS_COLUMNS, LENS_OPS, lensBoard, lensState, lensWarnings, parseLensDraft, parseLensReview, sameLensContent, type StageLensRow } from "@/lib/admin/project-lens-rules";
import { readSetting } from "@/lib/server/admin/backoffice";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadProjectSettings } from "@/lib/server/projects/board";
import { loadLensRow, loadLensRows } from "@/lib/server/projects/lenses";

// 단계별 「지방세로 읽기」 템플릿 (W4 16단계 — PRD-01B PR-08 · CORE-01, docs/dev/W4_설계.md 1장 16단계 · 4장 `/api/admin/project-lenses` · 6장 · 7장 4 · 12장 129번~).
// 사업 유형 × 단계 하나 — 그 유형을 쓰는 모든 프로젝트의 그 단계에 같은 박스가 붙는다(project_stage_lenses).
//  · GET [?type=] — 사업 유형별 단계와 템플릿·상태(템플릿 없음·감수 전 초안·감수 서명됨·재감수 필요). 편집 책임자·관리자(project.manage)와 세무 감수위원(review.tax_review)
//  · POST op=draft { project_type, stage, topics, points, links, base_date } — 초안 저장(project.manage). 저장하면 서명은 지워진다(DB 트리거 — 서명된 적이 있으면 재감수 필요).
//      세목 1~5 · 포인트 1~3줄(0·4줄 422) · 링크 1~3(해설·도서·전문가, 사이트 안 주소 — 계산기 422) · 기준일 · 세액 표현·금지 표현 422 · 숫자 + %는 저장 + warnings. 감사 project_lens.edit
//  · POST op=review { project_type, stage, drafted_at } — 세무 감수 서명(review.tax_review — 아니면 403 + 감사 review.tax_review.denied). 읽은 초안 그대로일 때만(아니면 409). 감사 project_lens.review
// 쓰기는 공개 데이터 캐시를 바로 만료한다 — 다음 렌더부터 그 템플릿을 쓰는 모든 프로젝트 화면이 바뀐다(서명 전·재감수 필요 → 박스 0).
export const dynamic = "force-dynamic";

type Db = ReturnType<typeof serviceDb>;

/** 금지 표현 사전 — 없으면 null(닫힌 쪽: 초안을 저장하지 않는다) */
async function forbiddenPhrases(db: Db): Promise<string[] | null> {
  const row = await readSetting(db, "forbidden_phrases");
  const v = row?.value as { phrases?: unknown } | undefined;
  return v && Array.isArray(v.phrases) ? v.phrases.filter((p): p is string => typeof p === "string" && p.trim() !== "") : null;
}

const target = (type: string, stage: string) => `project_stage_lenses:${type}:${stage}`;
const view = (row: StageLensRow) => ({ ...row, state: lensState(row) });

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  // 편집 책임자(초안)와 세무 감수위원(서명) 모두 본다 — 둘 다 아니면 403 + 감사
  if (!can(viewer, "project.manage") && !can(viewer, "review.tax_review")) {
    const denied = await authorize(viewer, "project.manage", "project_stage_lenses:list");
    if (denied) return denied;
  }
  const db = serviceDb();
  const type = new URL(request.url).searchParams.get("type")?.trim() || undefined;
  const settings = await loadProjectSettings(db);
  return json({ types: lensBoard(settings.types, settings.lists, await loadLensRows(db, type), type) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(LENS_OPS as readonly string[]).includes(op)) return errorJson(422, `op는 ${LENS_OPS.join("·")} 중 하나입니다`);
  const where = `${typeof body.project_type === "string" ? body.project_type.slice(0, 40) : "invalid"}:${typeof body.stage === "string" ? body.stage.slice(0, 40) : "invalid"}`;
  const denied = await authorize(viewer, op === "review" ? "review.tax_review" : "project.manage", `project_stage_lenses:${op}:${where}`);
  if (denied) return denied;

  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "draft") {
    const [settings, phrases] = await Promise.all([loadProjectSettings(db), forbiddenPhrases(db)]);
    if (!phrases) return errorJson(503, "금지 표현 사전(forbidden_phrases)이 없어 저장하지 않습니다");
    const p = parseLensDraft(body, { types: settings.types, lists: settings.lists, forbiddenPhrases: phrases });
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { projectType, stage, lens } = p.value;
    const before = await loadLensRow(db, projectType, stage);
    const warnings = lensWarnings(lens);
    if (before && sameLensContent(before.lens, lens)) return json({ lens: view(before), warnings, unchanged: true });
    const write = before
      ? db.from("project_stage_lenses").update({ lens, drafted_by: actor }).eq("project_type", projectType).eq("stage", stage).select(LENS_COLUMNS).single()
      : db.from("project_stage_lenses").insert({ project_type: projectType, stage, lens, drafted_by: actor }).select(LENS_COLUMNS).single();
    const { data, error } = await write;
    if (error) throw dbError(error, "project_stage_lenses 쓰기");
    const after = data as StageLensRow;
    await writeAudit(db, {
      actor,
      action: "project_lens.edit",
      target: target(projectType, stage),
      before,
      after,
      reason: before?.reviewed_by ? "단계별 「지방세로 읽기」 고침 — 감수 서명 지움(재감수 필요)" : "단계별 「지방세로 읽기」 초안 저장",
    });
    return json({ lens: view(after), warnings }, before ? 200 : 201);
  }

  // op === "review"
  const r = parseLensReview(body);
  if (!r.ok) return errorJson(422, "입력값을 확인하세요", { errors: r.errors });
  const { projectType, stage, draftedAt } = r.value;
  const before = await loadLensRow(db, projectType, stage);
  if (!before) return errorJson(422, "입력값을 확인하세요", { errors: ["stage: 저장된 초안이 없습니다 — 편집국이 초안을 먼저 저장해야 서명합니다"] });
  if (before.review_status === "reviewed") return json({ lens: view(before), unchanged: true });
  const { data, error } = await db
    .from("project_stage_lenses")
    .update({ reviewed_by: actor })
    .eq("project_type", projectType)
    .eq("stage", stage)
    .eq("drafted_at", draftedAt)
    .neq("review_status", "reviewed")
    .select(LENS_COLUMNS);
  if (error) throw dbError(error, "project_stage_lenses 서명");
  const after = ((data ?? []) as StageLensRow[])[0];
  if (!after) return errorJson(409, "초안이 그 사이 바뀌었습니다 — 새로 불러와 바뀐 문구를 읽은 뒤 서명하세요");
  await writeAudit(db, { actor, action: "project_lens.review", target: target(projectType, stage), before, after, reason: "단계별 「지방세로 읽기」 세무 감수 서명" });
  return json({ lens: view(after) });
}, { revalidatesPublic: true });
