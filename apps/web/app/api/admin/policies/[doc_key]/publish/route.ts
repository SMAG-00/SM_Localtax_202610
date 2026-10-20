import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { isPolicyDocKey } from "@/lib/policy/docs";
import { listVersions, publishDraft } from "@/lib/server/admin/policies";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 정책 게시 — 관리자만(policy.publish, 거부는 403 + 감사 로그). 법률 검토·게시 승인 기록 3칸(검토자·검토일·메모)이 없으면 거부하고 사유를 보인다.
// 버전 2부터는 개정 사유 필수. 감사 로그 policy.publish — 문서·버전만, 본문 0
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ doc_key: string }> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: unknown): v is string => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const docKey = (await params).doc_key;
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "policy.publish", `policy_versions:${isPolicyDocKey(docKey) ? docKey : "invalid"}`);
  if (denied) return denied;
  if (!isPolicyDocKey(docKey)) return errorJson(404, "그런 정책 문서가 없습니다");
  const raw = await readJson(request);
  const extra = Object.keys(raw).filter((k) => !["version", "approvedBy", "approvedOn", "approvalNote", "changeSummary", "effectiveOn"].includes(k));
  const errors = extra.map((k) => `${k}: 모르는 칸입니다`);
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) errors.push("version: 게시할 초안 버전 번호가 필요합니다");
  if (text(raw.approvedBy) === "") errors.push("approvedBy: 법률 검토자(사람 또는 기관 이름)가 필요합니다 — 승인 기록이 없으면 게시할 수 없습니다");
  if (!isDate(raw.approvedOn)) errors.push("approvedOn: 검토일(YYYY-MM-DD)이 필요합니다 — 승인 기록이 없으면 게시할 수 없습니다");
  if (text(raw.approvalNote) === "") errors.push("approvalNote: 승인 근거 메모가 필요합니다 — 승인 기록이 없으면 게시할 수 없습니다");
  const eff = raw.effectiveOn === undefined || raw.effectiveOn === null || raw.effectiveOn === "" ? null : raw.effectiveOn;
  if (eff !== null && !isDate(eff)) errors.push("effectiveOn: YYYY-MM-DD 날짜여야 합니다");
  const summary = text(raw.changeSummary) || null;
  const db = serviceDb();
  const rows = await listVersions(db, docKey);
  if (typeof raw.version === "number" && !rows.some((r) => r.version === raw.version && r.status === "draft")) errors.push("version: 그 번호의 초안이 없습니다");
  if (typeof raw.version === "number" && raw.version > 1 && summary === null) errors.push("changeSummary: 버전 2부터는 개정 사유가 필요합니다");
  if (errors.length) return errorJson(422, "게시할 수 없습니다", { errors });
  const r = await publishDraft(
    db,
    docKey,
    { version: raw.version as number, approvedBy: text(raw.approvedBy), approvedOn: raw.approvedOn as string, approvalNote: text(raw.approvalNote), changeSummary: summary, effectiveOn: eff as string | null },
    actorOf(viewer),
  );
  if (!r.ok) return errorJson(422, "게시할 수 없습니다", { errors: [`게시 조건을 채우지 못했습니다 (${r.code})`] });
  await writeAudit(db, { actor: actorOf(viewer), action: "policy.publish", target: targetOf.policy(docKey, raw.version as number), after: { doc_key: docKey, version: raw.version }, reason: `정책 게시 — ${docKey} v${raw.version}` });
  return json({ published: { docKey, version: raw.version } }, 200);
}, { revalidatesPublic: true });
