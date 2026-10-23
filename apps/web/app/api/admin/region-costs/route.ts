import { parseCostInput } from "@/lib/admin/region-metrics-view";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 지역 편집비 입력 (REG1-15 · W4 25단계 — docs/dev/W4_설계.md 6장) — 관리자(region_cost.edit)만. 지역×달 한 줄: 없으면 만들고 있으면 금액을 고친다.
//  · 입력·변경 사유(reason)는 필수, 모든 변경은 감사 로그(전·후 금액·사유). 권한 밖은 403 + 감사
//  · 금액은 사람이 적는다(기본값 0 없음) — 입력하지 않은 달은 화면에 '편집비 미입력'
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "region_cost.edit", "region_editorial_costs:set");
  if (denied) return denied;
  const parsed = parseCostInput(await readJson(request));
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const { regionCode, month, amountKrw, reason } = parsed.value;

  const db = serviceDb();
  const actor = actorOf(viewer);
  const { data: region, error: regionError } = await db.from("regions").select("code").eq("code", regionCode).limit(1);
  if (regionError) return errorJson(500, "지역을 확인하지 못했습니다");
  if (!region?.length) return errorJson(422, "입력값을 확인하세요", { errors: ["regionCode: 없는 지역입니다"] });

  const monthDate = `${month}-01`;
  const { data: current, error: readError } = await db.from("region_editorial_costs").select("id, amount_krw").eq("region_code", regionCode).eq("month", monthDate).limit(1);
  if (readError) return errorJson(500, "편집비를 읽지 못했습니다");
  const before = current?.[0] ? Number(current[0].amount_krw) : null;
  if (before === amountKrw) return json({ regionCode, month, amountKrw, unchanged: true });

  if (current?.[0]) {
    const { error } = await db.from("region_editorial_costs").update({ amount_krw: amountKrw, updated_by: actor, updated_at: nowIso() }).eq("id", current[0].id);
    if (error) return errorJson(500, "편집비를 고치지 못했습니다");
  } else {
    const { error } = await db.from("region_editorial_costs").insert({ region_code: regionCode, month: monthDate, amount_krw: amountKrw, entered_by: actor });
    if (error) return errorJson(error.code === "23505" ? 409 : 500, error.code === "23505" ? "다른 사람이 먼저 입력했습니다 — 새로 불러온 뒤 다시 저장하세요" : "편집비를 저장하지 못했습니다");
  }
  await writeAudit(db, {
    actor,
    action: "region_cost.set",
    target: `region_editorial_costs:${regionCode}:${month}`,
    before: before === null ? null : { amountKrw: before },
    after: { amountKrw },
    reason,
  });
  return json({ regionCode, month, amountKrw, unchanged: false });
});
