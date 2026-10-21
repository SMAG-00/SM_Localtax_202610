import { CADENCE_MAX, SERIES_SETTING_KEY, isSeriesKey, parseEpisodeAssign, parseThenNowItems, seriesTitleErrors } from "@/lib/brand/claim";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { COLUMN_OPS, DEFAULT_REVERIFY_DAYS, SIGNATURE_OPS, parseContract, parseMeta, parseVerify, verificationExpiry } from "@/lib/admin/column-rules";
import { brandRecords } from "@/lib/server/admin/brand-records";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { episodeRowErrors, loadEpisode } from "@/lib/server/articles/signature";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 칼럼 필자 체계 관리 (TX-14~17 — docs/dev/W3_설계.md 3·4장). 편집 책임자(editor)만. body.op = verify | contract | meta.
// 필자 증빙·계약·이해관계 내용은 편집국이 입력한다. 발행 조건(검증 만료 전·계약·이해관계·고지 문구)은 DB 트리거(articles_column_guard)가 마지막으로 막는다.
// 시그니처 연재 (W3 8단계 — BR-04·08): op = signature(회차 지정·빼기) | then_now(「그때와 지금」 비교 항목 한 벌) | series_title(연재 제목) | cadence(발행 주기).
//  권한 작업 column.signature(편집 책임자 — 칼럼 정렬과 같은 편집 행위). 편집국 외 역할의 시도는 403 + 감사 로그(column.manage·column.signature 모두).
//  경력 연수 표기('50년' 등)는 연재 제목에만, 경력 표시 승인 뒤에 — 회차 글·비교 항목에는 늘 거부(422 칸별 오류, DB 트리거가 다시 막는다).
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
  const [v, c, m, s, e] = await Promise.all([
    db.from("author_verifications").select("id, person_id, evidence_kind, verified_by, verified_at, expires_at").order("id", { ascending: false }),
    db.from("column_contracts").select("id, person_id, signed_on, reuse_scope, ai_index_scope, book_titles").order("id", { ascending: false }),
    db.from("column_meta").select("article_id, person_id, interest_state, contract_id, updated_at").order("article_id", { ascending: false }),
    db.from("settings").select("key, value").in("key", ["column_opinion_notice", ...Object.values(SERIES_SETTING_KEY), "column_cadence"]),
    db.from("signature_episodes").select("article_id, series_key, episode, assigned_by, updated_at").order("series_key").order("episode"),
  ]);
  for (const [r, label] of [[v, "author_verifications"], [c, "column_contracts"], [m, "column_meta"], [s, "settings"], [e, "signature_episodes"]] as const) if (r.error) throw dbError(r.error, `${label} 목록`);
  const setting = (k: string) => ((s.data ?? []) as { key: string; value: unknown }[]).find((r) => r.key === k)?.value;
  const notice = String(setting("column_opinion_notice") ?? "").trim();
  return json({
    verifications: v.data ?? [],
    contracts: c.data ?? [],
    meta: m.data ?? [],
    warnings: await expiredWarnings(db),
    noticeSet: notice !== "",
    signature: {
      titles: Object.fromEntries(Object.entries(SERIES_SETTING_KEY).map(([key, k]) => [key, setting(k) ?? null])),
      cadence: setting("column_cadence") ?? "",
      episodes: e.data ?? [],
    },
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const signatureOp = (SIGNATURE_OPS as readonly string[]).includes(op);
  const denied = await authorize(viewer, signatureOp ? "column.signature" : "column.manage", `columns:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  if (signatureOp) return signatureWrite(db, op, body, actor);

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

  return errorJson(422, `op는 ${[...COLUMN_OPS, ...SIGNATURE_OPS].join("·")} 중 하나입니다`);
}, { revalidatesPublic: true });

type Db = ReturnType<typeof serviceDb>;
const positiveInt = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null);

/** 시그니처 연재 쓰기 — 회차 지정·빼기 · 「그때와 지금」 비교 항목 · 연재 제목 · 발행 주기. 모두 감사 로그 */
async function signatureWrite(db: Db, op: string, body: Record<string, unknown>, actor: string): Promise<Response> {
  if (op === "signature") {
    const p = parseEpisodeAssign(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { articleId, seriesKey, episode } = p.value;
    const { data: art, error: ae } = await db.from("articles").select("id, slug, title, summary, body, series_title, content_type, status").eq("id", articleId).maybeSingle();
    if (ae) throw dbError(ae, "articles 조회");
    if (!art) return errorJson(404, "기사를 찾을 수 없습니다");
    const before = await loadEpisode(db, articleId);
    const target = `signature_episodes:${articleId}`;
    if (seriesKey === null) {
      if (!before) return json({ episode: null, unchanged: true });
      const { error } = await db.from("signature_episodes").delete().eq("article_id", articleId);
      if (error) throw dbError(error, "signature_episodes 빼기");
      await writeAudit(db, { actor, action: "column.signature_edit", target, before, after: null, reason: "시그니처 연재에서 빼기" });
      return json({ episode: null });
    }
    const a = art as { content_type: string | null; status: string; slug: string; title: string; summary: string | null; body: unknown; series_title: string | null };
    if (a.content_type !== "opinion") return errorJson(422, "입력값을 확인하세요", { errors: ["articleId: 시그니처 연재 회차는 칼럼(opinion) 기사만 됩니다"] });
    if (a.status === "deleted") return errorJson(409, "삭제된 기사는 연재 회차로 지정할 수 없습니다");
    const textErrors = episodeRowErrors(a);
    if (textErrors.length) return errorJson(422, "시그니처 연재 회차에 넣을 수 없는 표기가 있습니다", { errors: textErrors });
    const row = { article_id: articleId, series_key: seriesKey, episode, assigned_by: actor };
    const { data, error } = await db.from("signature_episodes").upsert(row, { onConflict: "article_id" }).select("article_id, series_key, episode").single();
    if (error?.code === "23505") return errorJson(409, "그 연재에 같은 회차가 이미 있습니다 — 다른 회차 번호를 쓰세요");
    if (error || !data) throw dbError(error ?? {}, "signature_episodes 저장");
    await writeAudit(db, { actor, action: "column.signature_edit", target, before, after: data, reason: before ? "시그니처 연재 회차 바꾸기" : "시그니처 연재 회차 지정" });
    return json({ episode: data }, before ? 200 : 201);
  }

  if (op === "then_now") {
    const articleId = positiveInt(body.articleId);
    if (!articleId) return errorJson(422, "입력값을 확인하세요", { errors: ["articleId: 기사 번호가 필요합니다"] });
    const ep = await loadEpisode(db, articleId);
    if (!ep || ep.seriesKey !== "then_now") return errorJson(422, "입력값을 확인하세요", { errors: ["articleId: 「그때와 지금」 연재 회차에만 비교 항목을 넣습니다 — 먼저 회차로 지정하세요"] });
    const year = Number(isoToKstDate(nowIso()).slice(0, 4));
    const p = parseThenNowItems(body.items, year);
    if (!p.ok) return errorJson(422, "「그때와 지금」 항목은 출처·기준연도가 둘 다 있어야 합니다", { errors: p.errors });
    const { data: art, error: ae } = await db.from("articles").select("status").eq("id", articleId).single();
    if (ae) throw dbError(ae, "articles 조회");
    if (p.value.length === 0 && ["published", "scheduled"].includes((art as { status: string }).status)) {
      return errorJson(422, "입력값을 확인하세요", { errors: ["items: 발행된 「그때와 지금」 회차는 비교 항목이 1개 이상이어야 합니다"] });
    }
    const { data: before, error: be } = await db.from("then_now_items").select("position, label, then_text, now_text, source, source_url, base_year").eq("article_id", articleId).order("position");
    if (be) throw dbError(be, "then_now_items 조회");
    const { data, error } = await db.rpc("then_now_replace", { p_article_id: articleId, p_items: p.value });
    if (error) throw dbError(error, "then_now_items 바꾸기");
    await writeAudit(db, { actor, action: "column.then_now_edit", target: `then_now_items:${articleId}`, before, after: p.value, reason: "「그때와 지금」 비교 항목 바꾸기" });
    return json({ articleId, count: Number(data) });
  }

  if (op === "series_title") {
    if (!isSeriesKey(body.seriesKey)) return errorJson(422, "입력값을 확인하세요", { errors: [`seriesKey: ${Object.keys(SERIES_SETTING_KEY).join("·")} 중 하나여야 합니다`] });
    const key = SERIES_SETTING_KEY[body.seriesKey];
    const records = await brandRecords(db);
    const errors = seriesTitleErrors(body.title, records.careerApproved);
    if (errors.length) return errorJson(422, "연재 제목을 저장할 수 없습니다", { errors });
    return writeSignatureSetting(db, key, (body.title as string).trim(), actor, "column.series_title_edit", "연재 제목 바꾸기");
  }

  // op === "cadence" — 발행 주기 [결정 안건]. 빈 글자면 화면에 주기 줄 없음
  if (typeof body.value !== "string" || body.value.trim().length > CADENCE_MAX) {
    return errorJson(422, "입력값을 확인하세요", { errors: [`value: 발행 주기는 ${CADENCE_MAX}자 이하의 글자입니다 (비우면 표시 안 함)`] });
  }
  return writeSignatureSetting(db, "column_cadence", body.value.trim(), actor, "column.cadence_edit", "발행 주기 바꾸기");
}

/** 연재 설정 한 줄 쓰기 — DB 트리거(signature_settings_guard)가 승인 없는 연수 표기를 다시 막는다(422) */
async function writeSignatureSetting(db: Db, key: string, value: string, actor: string, action: string, reason: string): Promise<Response> {
  const { data: cur, error: re } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (re) throw dbError(re, "settings 조회");
  if (!cur) return errorJson(404, "그런 설정이 없습니다 — 마이그레이션을 확인하세요");
  const before = (cur as { value: unknown }).value;
  if (before === value) return json({ key, value, unchanged: true });
  const { error } = await db.from("settings").update({ value, updated_by: actor }).eq("key", key);
  if (error?.code === "23514") return errorJson(422, "연재 설정을 저장할 수 없습니다", { errors: [`${key === "column_cadence" ? "value" : "title"}: ${error.message}`] });
  if (error) throw dbError(error, "settings 갱신");
  await writeAudit(db, { actor, action, target: `settings:${key}`, before: { value: before }, after: { value }, reason });
  return json({ key, value });
}
