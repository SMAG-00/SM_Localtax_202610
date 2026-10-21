import { brandReviewValue, careerClaimValue, parseBio, parseConsent, parseEvidence } from "@/lib/admin/brand-rules";
import { featureEnableErrors } from "@/lib/policy/feature-open";
import { brandRecords } from "@/lib/server/admin/brand-records";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { publishedDocKeys } from "@/lib/server/auth-guard";
import { authorize, requireViewer } from "@/lib/server/dal";
import { mailEnv } from "@/lib/server/env";
import { dbError, errorJson, handle, HttpError, json, readJson } from "@/lib/server/http";
import { mailConfigured } from "@/lib/server/mail/config";
import { CLOSED_FEATURES } from "@/lib/server/public/settings";
import type { Features } from "@/lib/server/public/constants";

// 브랜드 증빙·약력·동의서·공개 승인 (W3 7단계 — BR-01·07·10, docs/dev/W3_설계.md 4·6장). 모든 변경은 감사 로그에 남는다.
//  · brand.manage(브랜드 관리 담당·관리자): GET 목록 · op = evidence(증빙 위치 등록, 미승인) · bio(약력 항목과 증빙 번호 연결)
//  · brand.approve(관리자·PO만 — 거부도 감사): op = evidence_approve · evidence_revoke · consent(동의서 버전 기록) · consent_withdraw
//    · career_claim(경력 표시 증빙 승인/철회) · brand_review(광고 규정 감수 기록/철회) · brand_copy(브랜드 문구 공개 켜기/끄기)
// 증빙·동의서 내용 자체는 저장소 밖(위치만 받는다). 약력 문구·경력 연수·동의서 문구는 이 API가 만들지 않는다.
export const dynamic = "force-dynamic";

const MANAGE_OPS = ["evidence", "bio"] as const;
const APPROVE_OPS = ["evidence_approve", "evidence_revoke", "consent", "consent_withdraw", "career_claim", "brand_review", "brand_copy"] as const;
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
type Db = ReturnType<typeof serviceDb>;

async function readFlags(db: Db): Promise<{ raw: Record<string, unknown>; features: Features }> {
  const { data, error } = await db.from("settings").select("value").eq("key", "feature_flags").limit(1);
  if (error) throw dbError(error, "feature_flags 조회");
  const raw = ((data?.[0] as { value?: unknown } | undefined)?.value ?? {}) as Record<string, unknown>;
  const features = Object.fromEntries(Object.keys(CLOSED_FEATURES).map((k) => [k, raw[k] === true])) as unknown as Features;
  return { raw, features };
}

/** brand_copy를 끈다 (근거 기록을 거두면 함께 — 다음 요청부터 브랜드 문구 0). 이미 꺼져 있으면 아무것도 안 한다 */
async function turnOffBrandCopy(db: Db, actor: string, reason: string): Promise<boolean> {
  const { raw } = await readFlags(db);
  if (raw.brand_copy !== true) return false;
  const next = { ...raw, brand_copy: false };
  const { error } = await db.from("settings").update({ value: next, updated_by: actor }).eq("key", "feature_flags");
  if (error) throw dbError(error, "feature_flags 갱신");
  await writeAudit(db, { actor, action: "brand_copy.toggle", target: "settings:feature_flags", before: { brand_copy: true }, after: { brand_copy: false }, reason });
  return true;
}

async function setSetting(db: Db, key: string, value: unknown, actor: string): Promise<unknown> {
  const { data: cur, error: re } = await db.from("settings").select("value").eq("key", key).limit(1);
  if (re) throw dbError(re, "settings 조회");
  const { error } = await db.from("settings").update({ value, updated_by: actor }).eq("key", key);
  if (error?.code === "23514") throw new HttpError(422, "승인 기록의 조건이 맞지 않습니다 — 근거 증빙·승인자·기록 위치를 확인하세요");
  if (error) throw dbError(error, "settings 갱신");
  return (cur?.[0] as { value?: unknown } | undefined)?.value ?? null;
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "brand.manage", "brand:list");
  if (denied) return denied;
  const db = serviceDb();
  const [people, evidence, consents, settings, queue] = await Promise.all([
    db.from("people").select("id, slug, name, roles, visibility, bio_items").order("id"),
    db.from("people_evidence").select("id, person_id, kind, doc_ref, recorded_by, verified_by, verified_at, approved, created_at").order("id"),
    db.from("name_consent_docs").select("id, person_id, version, scope, doc_ref, recorded_by, recorded_at, valid_from, valid_to, withdrawn_at, withdrawn_by, status, is_current").order("id"),
    db.from("settings").select("key, value").in("key", ["career_claim_approved", "brand_copy_review", "feature_flags"]),
    db.from("tax_rereview_queue").select("article_id, reviewer_person_id, reviewed_at, reviewed_version, current_version, title").order("article_id"),
  ]);
  for (const [r, what] of [[people, "people"], [evidence, "people_evidence"], [consents, "name_consent_docs"], [settings, "settings"], [queue, "tax_rereview_queue"]] as const) {
    if (r.error) throw dbError(r.error, `${what} 목록`);
  }
  const by = (k: string) => ((settings.data ?? []) as { key: string; value: Record<string, unknown> }[]).find((s) => s.key === k)?.value ?? null;
  const flags = by("feature_flags");
  return json({
    people: people.data,
    evidence: evidence.data,
    consents: consents.data,
    careerClaim: by("career_claim_approved"),
    brandReview: by("brand_copy_review"),
    flags: { people_pages: flags?.people_pages === true, brand_copy: flags?.brand_copy === true },
    rereviewQueue: queue.data,
  });
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    const isManage = (MANAGE_OPS as readonly string[]).includes(op);
    const isApprove = (APPROVE_OPS as readonly string[]).includes(op);
    if (!isManage && !isApprove) return errorJson(422, `op는 ${[...MANAGE_OPS, ...APPROVE_OPS].join("·")} 중 하나입니다`);
    const denied = await authorize(viewer, isApprove ? "brand.approve" : "brand.manage", `brand:${op}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);
    const now = nowIso();

    if (op === "evidence") {
      const p = parseEvidence(body);
      if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
      const { data, error } = await db
        .from("people_evidence")
        .insert({ person_id: p.value.personId, kind: p.value.kind, doc_ref: p.value.docRef, recorded_by: actor })
        .select("id, person_id, kind, approved")
        .single();
      if (error?.code === "23503") return errorJson(422, "인물 번호를 확인하세요");
      if (error || !data) throw dbError(error ?? {}, "people_evidence 추가");
      await writeAudit(db, { actor, action: "people_evidence.record", target: `people_evidence:${(data as { id: number }).id}`, after: data, reason: "증빙 위치 등록(승인 전)" });
      return json({ evidence: data }, 201);
    }

    if (op === "bio") {
      const personId = int(body.personId);
      if (!personId) return errorJson(422, "입력값을 확인하세요", { errors: ["personId(인물 번호)가 필요합니다"] });
      const [person, ev] = await Promise.all([
        db.from("people").select("id, bio_items").eq("id", personId).maybeSingle(),
        db.from("people_evidence").select("id").eq("person_id", personId),
      ]);
      if (person.error) throw dbError(person.error, "people 조회");
      if (ev.error) throw dbError(ev.error, "people_evidence 조회");
      if (!person.data) return errorJson(404, "인물을 찾을 수 없습니다");
      const p = parseBio(body, new Set(((ev.data ?? []) as { id: number }[]).map((e) => Number(e.id))));
      if (!p.ok) return errorJson(422, "증빙 없는 약력은 저장하지 않습니다", { errors: p.errors });
      const { error } = await db.from("people").update({ bio_items: p.value.items }).eq("id", personId);
      if (error) throw dbError(error, "people 약력 갱신");
      await writeAudit(db, { actor, action: "people.bio_edit", target: `people:${personId}`, before: (person.data as { bio_items: unknown }).bio_items, after: p.value.items, reason: "약력 항목과 증빙 연결" });
      return json({ personId, bioItems: p.value.items });
    }

    if (op === "evidence_approve" || op === "evidence_revoke") {
      const id = int(body.id);
      const approve = op === "evidence_approve";
      if (!id) return errorJson(422, "입력값을 확인하세요", { errors: ["id(증빙 번호)가 필요합니다"] });
      const patch = approve ? { approved: true, verified_by: actor, verified_at: now } : { approved: false };
      const { data, error } = await db.from("people_evidence").update(patch).eq("id", id).select("id, person_id, kind, approved, verified_by, verified_at").maybeSingle();
      if (error) throw dbError(error, "people_evidence 승인");
      if (!data) return errorJson(404, "증빙을 찾을 수 없습니다");
      await writeAudit(db, {
        actor,
        action: approve ? "people_evidence.approve" : "people_evidence.revoke",
        target: `people_evidence:${id}`,
        before: { approved: !approve },
        after: data,
        reason: approve ? "증빙 확인·승인" : text(body.reason) ?? "증빙 승인 거둠",
      });
      // 경력 표시의 근거 증빙 승인을 거두면 브랜드 문구도 함께 내린다 (근거 없는 표시 0)
      if (!approve) {
        const rec = await brandRecords(db);
        if (!rec.careerApproved) await turnOffBrandCopy(db, actor, "경력 표시 근거 증빙 승인을 거둬 브랜드 문구를 내림");
      }
      return json({ evidence: data });
    }

    if (op === "consent") {
      const p = parseConsent(body, new Date(now));
      if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
      const row = { person_id: p.value.personId, version: p.value.version, scope: p.value.scope, doc_ref: p.value.docRef, recorded_by: actor, ...(p.value.validFrom ? { valid_from: p.value.validFrom } : {}), valid_to: p.value.validTo };
      const { data, error } = await db.from("name_likeness_consents").insert(row).select("id, person_id, version, scope, valid_from, valid_to").single();
      if (error?.code === "23503") return errorJson(422, "인물 번호를 확인하세요");
      if (error?.code === "23505") return errorJson(409, "이 인물에게 같은 버전의 동의서가 이미 있습니다 — 새 버전 이름을 쓰세요");
      if (error?.code === "23514") return errorJson(422, "유효 기간이 올바르지 않습니다");
      if (error || !data) throw dbError(error ?? {}, "name_likeness_consents 추가");
      await writeAudit(db, { actor, action: "consent_doc.record", target: `name_likeness_consents:${(data as { id: number }).id}`, after: data, reason: "이름·초상 동의서 버전 기록" });
      return json({ consent: data }, 201);
    }

    if (op === "consent_withdraw") {
      const id = int(body.id);
      if (!id) return errorJson(422, "입력값을 확인하세요", { errors: ["id(동의서 번호)가 필요합니다"] });
      const { data, error } = await db
        .from("name_likeness_consents")
        .update({ withdrawn_at: now, withdrawn_by: actor })
        .eq("id", id)
        .is("withdrawn_at", null)
        .select("id, person_id, version, withdrawn_at")
        .maybeSingle();
      if (error) throw dbError(error, "name_likeness_consents 철회");
      if (!data) return errorJson(404, "철회할 동의서가 없습니다 (이미 철회했거나 번호가 다릅니다)");
      await writeAudit(db, { actor, action: "consent_doc.withdraw", target: `name_likeness_consents:${id}`, before: { withdrawn_at: null }, after: data, reason: text(body.reason) ?? "동의 철회" });
      return json({ consent: data });
    }

    if (op === "career_claim") {
      const on = body.value === true;
      const basis = int(body.basisEvidenceId);
      if (on && !basis) return errorJson(422, "입력값을 확인하세요", { errors: ["승인에는 basisEvidenceId(근거 증빙 번호)가 필요합니다"] });
      if (on) {
        const { data, error } = await db.from("people_evidence").select("id").eq("id", basis!).eq("approved", true).maybeSingle();
        if (error) throw dbError(error, "people_evidence 조회");
        if (!data) return errorJson(422, "근거 증빙이 승인되지 않았습니다 — 먼저 증빙을 승인하세요");
      }
      const next = careerClaimValue(on, basis, actor, now);
      const before = await setSetting(db, "career_claim_approved", next, actor);
      await writeAudit(db, { actor, action: "career_claim.approve", target: "settings:career_claim_approved", before, after: next, reason: on ? "경력 표시 증빙 승인" : "경력 표시 승인 철회" });
      const off = on ? false : await turnOffBrandCopy(db, actor, "경력 표시 승인을 거둬 브랜드 문구를 내림");
      return json({ careerClaim: next, brandCopyTurnedOff: off });
    }

    if (op === "brand_review") {
      const on = body.value === true;
      const recordRef = text(body.recordRef);
      if (on && !recordRef) return errorJson(422, "입력값을 확인하세요", { errors: ["감수 기록에는 recordRef(감수 기록 위치)가 필요합니다"] });
      const next = brandReviewValue(on, recordRef);
      const before = await setSetting(db, "brand_copy_review", next, actor);
      await writeAudit(db, { actor, action: "brand_copy.review", target: "settings:brand_copy_review", before, after: next, reason: on ? "경력 표시 광고 규정 감수 기록" : "광고 규정 감수 기록 철회" });
      const off = on ? false : await turnOffBrandCopy(db, actor, "광고 규정 감수 기록을 거둬 브랜드 문구를 내림");
      return json({ brandReview: next, brandCopyTurnedOff: off });
    }

    // op === "brand_copy" — 켜기는 감수 기록 + 경력 승인 뒤에만 (서버가 사유를 보이고 DB 트리거가 다시 막는다)
    const on = body.value === true;
    const { raw, features } = await readFlags(db);
    if (on) {
      const errors = featureEnableErrors(features, { ...features, brand_copy: true }, await publishedDocKeys(db), mailConfigured(mailEnv()), await brandRecords(db));
      if (errors.length) return errorJson(422, "브랜드 문구를 켤 수 없습니다 — 먼저 필요한 기록을 갖추세요", { errors });
    }
    if ((raw.brand_copy === true) === on) return json({ brandCopy: on, unchanged: true });
    const { error } = await db.from("settings").update({ value: { ...raw, brand_copy: on }, updated_by: actor }).eq("key", "feature_flags");
    if (error?.code === "23514") return errorJson(422, "브랜드 문구를 켤 수 없습니다 — 감수 기록·경력 승인이 필요합니다");
    if (error) throw dbError(error, "feature_flags 갱신");
    await writeAudit(db, { actor, action: "brand_copy.toggle", target: "settings:feature_flags", before: { brand_copy: !on }, after: { brand_copy: on }, reason: on ? "브랜드 문구 공개 켜기" : "브랜드 문구 공개 끄기" });
    return json({ brandCopy: on });
  },
  { revalidatesPublic: true },
);
