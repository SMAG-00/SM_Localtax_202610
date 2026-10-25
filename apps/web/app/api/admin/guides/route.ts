import { can, type Action } from "@/lib/access";
import { GUIDE_OPS, parseGuideDraft, parseGuidePublish, parseGuideSign } from "@/lib/guides/input";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { loadGuidesBoard } from "@/lib/server/guides/board";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";

// 감수 가이드 관리 (W11-a a6 - PRD-03 5장·7장 guides, docs/dev/W11-a_설계.md 5장). 경로는 하나: 초안 -> 감수 서명 -> 관리자 공개.
//  · GET - 목록과 최근 감사 (guide.edit·guide.sign·guide.publish 중 하나). 본문은 싣지 않는다.
//  · POST op=create {hub, topic, slug?, title, sections?, facts?, tax_scope, as_of?, region_codes?, sources?, import_origin?}  초안 만들기 (guide.edit - 편집 책임자·관리자). 항상 새 버전 초안이다
//  · POST op=sign {id, sheet_ref}  감수 서명 (guide.sign - 세무 감수위원만, 관리자도 403 + 거부 감사)
//  · POST op=publish {id}          공개 (guide.publish - 관리자만, 403 + 거부 감사). 서명 없음은 409 + guides_audit 거부 1행
// 스크립트로 공개하는 경로는 없다 - 공개는 DB 함수 guide_publish()만 한다 (service_role도 직접 UPDATE 권한 없음).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const LIST_ACTIONS: Action[] = ["guide.edit", "guide.sign", "guide.publish"];

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const action = LIST_ACTIONS.find((a) => can(viewer, a)) ?? "guide.publish";
  const denied = await authorize(viewer, action, "guides:list");
  if (denied) return denied;
  return json(await loadGuidesBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(GUIDE_OPS as readonly string[]).includes(op)) return invalid([`op: ${GUIDE_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, op === "create" ? "guide.edit" : op === "sign" ? "guide.sign" : "guide.publish", `guides:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const p = parseGuideDraft(body);
    if (!p.ok) return invalid(p.errors);
    const found = await db.from("guides").select("id").eq("hub", p.value.hub).eq("topic", p.value.topic).maybeSingle();
    if (found.error) throw dbError(found.error, "guides 조회");
    let guideId = (found.data as { id: number } | null)?.id;
    if (guideId === undefined) {
      if (p.value.slug === null) return invalid(["slug: 새 주제는 주소(slug)가 필요합니다"]);
      const made = await db.from("guides").insert({ hub: p.value.hub, topic: p.value.topic, slug: p.value.slug, created_by: actor }).select("id").single();
      if (made.error) {
        if (made.error.code === "23505") return errorJson(409, "같은 주소(slug)나 주제가 이미 있습니다");
        throw dbError(made.error, "guides 추가");
      }
      guideId = (made.data as { id: number }).id;
    }
    const { data, error } = await db.from("guide_versions").insert({ guide_id: guideId, ...p.value.version, created_by: actor }).select("id, version, status").single();
    if (error) {
      if (error.code === "23514" || error.code === "P0001") return invalid([error.message]);
      throw dbError(error, "guide_versions 추가");
    }
    await writeAudit(db, { actor, action: "guide.draft.create", target: `guide_versions:${(data as { id: number }).id}`, before: null, after: { hub: p.value.hub, topic: p.value.topic, version: (data as { version: number }).version }, reason: "가이드 초안 만들기(서명 전 비공개)" });
    return json({ created: data }, 201);
  }

  if (op === "sign") {
    const p = parseGuideSign(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("guide_sign", { p_version_id: p.value.id, p_signer: actor, p_sheet_ref: p.value.sheetRef });
    if (error) throw dbError(error, "가이드 감수 서명");
    const r = data as { ok: boolean; code: string; message: string };
    return r.ok ? json({ signed: true }) : errorJson(409, r.message, { code: r.code });
  }

  const p = parseGuidePublish(body);
  if (!p.ok) return invalid(p.errors);
  const { data, error } = await db.rpc("guide_publish", { p_version_id: p.value.id, p_publisher: actor });
  if (error) throw dbError(error, "가이드 공개");
  const r = data as { ok: boolean; code: string; message: string };
  if (!r.ok) return errorJson(409, r.message, { code: r.code });
  revalidatePublicData();
  return json({ published: true });
});
