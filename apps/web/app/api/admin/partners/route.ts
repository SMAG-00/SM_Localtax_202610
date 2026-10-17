import { parsePartnerInput, partnerDatesError, partnerStatus } from "@/lib/admin/partner-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { PARTNER_COLUMNS, listPartnerRows, partnerArticleCounts, type PartnerRow } from "@/lib/server/admin/backoffice";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 제휴사 관리 (ART-10 · ADM-01) — 목록은 편집 책임자·광고·협찬 담당·관리자(partner.read), 등록은 광고·협찬 담당·관리자(sponsored.manage).
// 계약 상태(계약 중·계약 종료·시작 전)는 한국 날짜 기준으로 계산해 함께 준다 — 계약 종료 제휴사는 새 기사에 지정할 수 없다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "partner.read", "partners:list");
  if (denied) return denied;
  const db = serviceDb();
  const today = kstDate(nowIso());
  const [rows, counts] = await Promise.all([listPartnerRows(db), partnerArticleCounts(db)]);
  return json({ today, partners: rows.map((p) => ({ ...p, status: partnerStatus(p, today), articleCount: counts[p.id] ?? 0 })) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "sponsored.manage", "partners:new");
  if (denied) return denied;
  const parsed = parsePartnerInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;
  const dates = partnerDatesError(columns.contract_from as string | null | undefined, columns.contract_to as string | null | undefined);
  if (dates) return errorJson(422, dates, { errors: [`partner.contractTo: ${dates}`] });

  const db = serviceDb();
  const { data, error } = await db.from("partners").insert(columns).select(PARTNER_COLUMNS).single();
  if (error || !data) throw dbError(error ?? {}, "partners 추가");
  const row = data as PartnerRow;
  await writeAudit(db, { actor: actorOf(viewer), action: "partner.create", target: targetOf.partner(row.id), before: null, after: row, reason: `제휴사 등록 — ${row.name}` });
  return json({ partner: { ...row, status: partnerStatus(row, kstDate(nowIso())) } }, 201);
});
