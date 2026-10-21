import { COLUMN_OPS, DEFAULT_REVERIFY_DAYS, parseContract, parseMeta, parseVerify, verificationExpiry } from "@/lib/admin/column-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 칼럼 필자 체계 관리 (TX-14~17 — docs/dev/W3_설계.md 3·4장). 편집 책임자(editor)만. body.op = verify | contract | meta.
// 필자 증빙·계약·이해관계 내용은 편집국이 입력한다. 발행 조건(검증 만료 전·계약·이해관계·고지 문구)은 DB 트리거(articles_column_guard)가 마지막으로 막는다.
export const dynamic = "force-dynamic";

/** 검증 만료 경고 — 가장 최근 검증이 만료된 필자 (공개된 칼럼은 그대로, 새 발행만 막힌다) */
async function expiredWarnings(db: ReturnType<typeof serviceDb>) {
  const { data, error } = await db.from("author_verifications").select("person_id, expires_at").order("verified_at", { ascending: false });
  if (error) throw dbError(error, "author_verifications 조회");
  const latest = new Map<number, string>();
  for (const r of (data ?? []) as { person_id: number; expires_at: string }[]) if (!latest.has(Number(r.person_id))) latest.set(Number(r.person_id), r.expires_at);
  const now = Date.now();
  return [...latest.entries()].filter(([, exp]) => Date.parse(exp) <= now).map(([personId, expiresAt]) => ({ personId, expiresAt }));
}

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "column.manage", "columns:list");
  if (denied) return denied;
  const db = serviceDb();
  const [v, c, m, s] = await Promise.all([
    db.from("author_verifications").select("id, person_id, evidence_kind, verified_by, verified_at, expires_at").order("id", { ascending: false }),
    db.from("column_contracts").select("id, person_id, signed_on, reuse_scope, ai_index_scope, book_titles").order("id", { ascending: false }),
    db.from("column_meta").select("article_id, person_id, interest_state, contract_id, updated_at").order("article_id", { ascending: false }),
    db.from("settings").select("key, value").in("key", ["column_opinion_notice"]),
  ]);
  for (const [r, label] of [[v, "author_verifications"], [c, "column_contracts"], [m, "column_meta"], [s, "settings"]] as const) if (r.error) throw dbError(r.error, `${label} 목록`);
  const notice = String(((s.data ?? [])[0] as { value?: unknown } | undefined)?.value ?? "").trim();
  return json({ verifications: v.data ?? [], contracts: c.data ?? [], meta: m.data ?? [], warnings: await expiredWarnings(db), noticeSet: notice !== "" });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "column.manage", `columns:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "verify") {
    const p = parseVerify(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { data: st, error: se } = await db.from("settings").select("value").eq("key", "column_reverify_days").limit(1);
    if (se) throw dbError(se, "settings 조회");
    const days = Number((st?.[0] as { value?: unknown } | undefined)?.value);
    const verifiedAt = new Date(nowIso());
    const expires = verificationExpiry(verifiedAt, Number.isFinite(days) && days > 0 ? days : DEFAULT_REVERIFY_DAYS, p.value.expiresAt);
    const { data, error } = await db
      .from("author_verifications")
      .insert({ person_id: p.value.personId, evidence_kind: p.value.evidenceKind, evidence_ref: p.value.evidenceRef, verified_by: actor, verified_at: verifiedAt.toISOString(), expires_at: expires.toISOString() })
      .select("id, person_id, evidence_kind, verified_by, verified_at, expires_at")
      .single();
    if (error?.code === "23503") return errorJson(422, "필자 번호를 확인하세요");
    if (error?.code === "23514") return errorJson(422, "만료일은 검증 시각보다 뒤여야 합니다");
    if (error || !data) throw dbError(error ?? {}, "author_verifications 추가");
    await writeAudit(db, { actor, action: "author.verify", target: `author_verifications:${(data as { id: number }).id}`, before: null, after: data, reason: "필자 검증 기록" });
    return json({ verification: data }, 201);
  }

  if (op === "contract") {
    const p = parseContract(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const { data, error } = await db
      .from("column_contracts")
      .insert({ person_id: v.personId, doc_ref: v.docRef, signed_on: v.signedOn, reuse_scope: v.reuseScope, ai_index_scope: v.aiIndexScope, book_titles: v.bookTitles })
      .select("id, person_id, signed_on, reuse_scope, ai_index_scope, book_titles")
      .single();
    if (error?.code === "23503") return errorJson(422, "필자 번호를 확인하세요");
    if (error || !data) throw dbError(error ?? {}, "column_contracts 추가");
    await writeAudit(db, { actor, action: "column.contract_edit", target: `column_contracts:${(data as { id: number }).id}`, before: null, after: data, reason: "기고 계약 기록" });
    return json({ contract: data }, 201);
  }

  if (op === "meta") {
    const p = parseMeta(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const row = {
      article_id: v.articleId,
      person_id: v.personId,
      contract_id: v.contractId,
      interest_state: v.interestState,
      interest_text: v.interestText,
      interest_confirmed_by: v.confirmedBy,
      interest_confirmed_at: v.interestState === "none_confirmed" ? nowIso() : null,
    };
    const { data, error } = await db.from("column_meta").upsert(row, { onConflict: "article_id" }).select("article_id, person_id, interest_state, interest_text, contract_id").single();
    if (error?.code === "23503") return errorJson(422, "기사·필자·계약 번호를 확인하세요");
    if (error?.code === "23514") return errorJson(422, error.message);
    if (error || !data) throw dbError(error ?? {}, "column_meta 저장");
    await writeAudit(db, { actor, action: "column.contract_edit", target: `column_meta:${v.articleId}`, before: null, after: data, reason: "칼럼 이해관계·계약 연결" });
    return json({ meta: data });
  }

  return errorJson(422, `op는 ${COLUMN_OPS.join("·")} 중 하나입니다`);
}, { revalidatesPublic: true });
