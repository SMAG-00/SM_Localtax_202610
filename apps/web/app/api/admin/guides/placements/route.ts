import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { parsePlacement } from "@/lib/tax-guide/placement-input";

// 가이드 배치 관리 (W11-c c1 - TRU-01·02 · RDV-01·03 · DF-08). 권한은 guide.edit(편집 책임자·관리자).
//  · POST op=add {guide_id, surface, target_key, sort?}     화면에 가이드 붙이기. 허브·화면 종류 불일치·신탁 주제 중복·같은 배치 중복은 DB 트리거가 거부(422·409)
//  · POST op=remove {guide_id, surface, target_key}          배치 빼기 (가이드 원고는 그대로)
// 배치는 원고를 담지 않는다. 서명 전 가이드는 붙여 둬도 공개 뷰가 0행으로 낸다. DF-08(finance_tax_hub)은 기능 키 finance_tax_guide가 켜져야 보인다(자본시장법 검토 기록 필요).
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "guide.edit", "guides:placement");
  if (denied) return denied;
  const p = parsePlacement(await readJson(request));
  if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
  const db = serviceDb();
  const actor = actorOf(viewer);
  const v = p.value;
  const target = `guide_placements:${v.guideId}:${v.surface}:${v.targetKey}`;

  if (v.op === "add") {
    const { error } = await db.from("guide_placements").insert({ guide_id: v.guideId, surface: v.surface, target_key: v.targetKey, sort: v.sort, created_by: actor });
    if (error) {
      if (error.code === "23505") return errorJson(409, "같은 배치가 이미 있습니다");
      if (error.code === "23514" || error.code === "23503") return errorJson(422, "입력값을 확인하세요", { errors: [error.message] });
      throw dbError(error, "guide_placements 추가");
    }
    await writeAudit(db, { actor, action: "guide.placement.add", target, before: null, after: { surface: v.surface, target_key: v.targetKey, sort: v.sort }, reason: "가이드 배치 추가" });
    revalidatePublicData();
    return json({ added: true }, 201);
  }

  const { data, error } = await db.from("guide_placements").delete().eq("guide_id", v.guideId).eq("surface", v.surface).eq("target_key", v.targetKey).select("id");
  if (error) throw dbError(error, "guide_placements 삭제");
  if (!data || data.length === 0) return errorJson(404, "그 배치가 없습니다");
  await writeAudit(db, { actor, action: "guide.placement.remove", target, before: { surface: v.surface, target_key: v.targetKey }, after: null, reason: "가이드 배치 빼기" });
  revalidatePublicData();
  return json({ removed: true });
});
