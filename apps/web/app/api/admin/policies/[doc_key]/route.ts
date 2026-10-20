import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { canEditPolicy, isPolicyDocKey, parsePolicyBody, POLICY_BODY_MAX_CHARS } from "@/lib/policy/docs";
import { saveDraft } from "@/lib/server/admin/policies";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 정책 초안 저장 (PUT) — 편집 책임자·광고·협찬 담당(광고·제휴 안내만)·관리자. 본문은 줄 표기 글(text) → 서버가 조각으로 바꿔 저장한다(HTML 직접 입력 0).
// 감사 로그 policy.draft — 문서·버전만, 본문 0
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ doc_key: string }> };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const PUT = handle(async (request: Request, { params }: Ctx) => {
  const docKey = (await params).doc_key;
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "policy.edit", `policy_versions:${isPolicyDocKey(docKey) ? docKey : "invalid"}`);
  if (denied) return denied;
  if (!isPolicyDocKey(docKey)) return errorJson(404, "그런 정책 문서가 없습니다");
  if (!canEditPolicy(docKey, viewer)) return errorJson(403, "이 문서를 고칠 권한이 없습니다");
  const raw = await readJson(request);
  const extra = Object.keys(raw).filter((k) => !["text", "effectiveOn"].includes(k));
  const errors = extra.map((k) => `${k}: 모르는 칸입니다`);
  if (typeof raw.text !== "string") errors.push("text: 본문 글이 필요합니다");
  else if (raw.text.length > POLICY_BODY_MAX_CHARS) errors.push(`text: ${POLICY_BODY_MAX_CHARS}자 이하여야 합니다`);
  const eff = raw.effectiveOn === undefined || raw.effectiveOn === null || raw.effectiveOn === "" ? null : raw.effectiveOn;
  if (eff !== null && (typeof eff !== "string" || !DATE.test(eff) || Number.isNaN(Date.parse(eff)))) errors.push("effectiveOn: YYYY-MM-DD 날짜여야 합니다");
  if (errors.length) return errorJson(422, "입력값을 확인하세요", { errors });
  const db = serviceDb();
  const draft = await saveDraft(db, docKey, parsePolicyBody(raw.text as string), eff as string | null, actorOf(viewer));
  await writeAudit(db, { actor: actorOf(viewer), action: "policy.draft", target: targetOf.policy(docKey, draft.version), reason: `정책 초안 저장 — ${docKey} v${draft.version}` });
  return json({ draft: { docKey, version: draft.version, status: draft.status } });
});
