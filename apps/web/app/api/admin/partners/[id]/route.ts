import { parsePartnerInput, partnerDatesError, partnerStatus } from "@/lib/admin/partner-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { PARTNER_COLUMNS, loadPartner, type PartnerRow } from "@/lib/server/admin/backoffice";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 제휴사 고치기 (ART-10) — 광고·협찬 담당·관리자(sponsored.manage). 편집 책임자는 403(읽기만).
// 계약 종료일을 앞당겨도 이미 지정된 기사의 배지는 남는다 — 새 기사 지정만 막힌다(기사 저장·발행 판정).
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "제휴사");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.partner(id);
  const denied = await authorize(viewer, "sponsored.manage", target);
  if (denied) return denied;
  const parsed = parsePartnerInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;

  const db = serviceDb();
  const before = await loadPartner(db, id);
  const merged = { ...before, ...columns } as PartnerRow;
  const dates = partnerDatesError(merged.contract_from, merged.contract_to);
  if (dates) return errorJson(422, dates, { errors: [`partner.contractTo: ${dates}`] });
  const { data, error } = await db.from("partners").update(columns).eq("id", id).select(PARTNER_COLUMNS).maybeSingle();
  if (error) throw dbError(error, "partners 수정");
  if (!data) throw new HttpError(404, "제휴사를 찾을 수 없습니다");
  const after = data as PartnerRow;
  const changed = Object.keys(columns);
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "partner.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k as keyof PartnerRow] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k as keyof PartnerRow] ?? null])),
    reason: `제휴사 고치기 — ${after.name}`,
  });
  return json({ partner: { ...after, status: partnerStatus(after, kstDate(nowIso())) } });
}, { revalidatesPublic: true });
