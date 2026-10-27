import { buildManuscript } from "@/lib/naver/series";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { siteUrl } from "@/lib/server/env";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 라이선스 계약·네이버 연재 원고 (W13-i BIZ-11 · CH-02). 권한 licenses.edit (관리자만). 외부 호출 0.
//  · POST op=contract / terminate / prepare / post
//  · GET ?manuscript=<번호> -> 연재 원고 텍스트 내려받기 (권리·계약이 유효할 때만, '네이버 제휴 언론사' 표현이 있으면 거부)
// 계약 조건(범위·정산)·이중 결제 안내 문구는 PO 입력이다. 코드에 문구·가격은 없다.
export const dynamic = "force-dynamic";

const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const url = new URL(request.url);
  const id = posInt(url.searchParams.get("manuscript"));
  const denied = await authorize(viewer, "licenses.edit", `licenses:manuscript:${id ?? "list"}`);
  if (denied) return denied;
  if (id === null) return invalid(["manuscript: 원고 번호(1 이상 정수)입니다"]);
  const db = serviceDb();
  const { data, error } = await db.rpc("naver_manuscript_text", { p_id: id, p_actor: actorOf(viewer) });
  if (error) throw dbError(error, "연재 원고 내려받기");
  const r = data as { ok: boolean; code: string; title?: string; text?: string; article_id?: number };
  if (!r.ok) return errorJson(409, "원고를 내려받을 수 없습니다", { code: r.code });
  const a = await db.from("articles").select("slug").eq("id", r.article_id as number).limit(1);
  if (a.error) throw dbError(a.error, "기사 조회");
  const slug = (a.data?.[0] as { slug?: string } | undefined)?.slug ?? "";
  const m = buildManuscript({ title: r.title ?? "", text: r.text ?? "", articleUrl: `${siteUrl() ?? ""}/${slug}` });
  if (!m.ok) return errorJson(409, m.code === "affiliate_claim" ? "원고에 '네이버 제휴' 표현이 있어 내려받을 수 없습니다" : "원고 본문이 비어 있습니다", { code: m.code });
  return new Response(m.file, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="naver-series-${id}.txt"`, "cache-control": "no-store" } });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!["contract", "terminate", "prepare", "post"].includes(op)) return invalid(["op: contract · terminate · prepare · post 중 하나입니다"]);
  const denied = await authorize(viewer, "licenses.edit", `licenses:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  let result: { data: unknown; error: { message: string; code?: string } | null };
  if (op === "contract") {
    const errors: string[] = [];
    if (!str(body.counterparty)) errors.push("counterparty: 상대방 이름을 적습니다");
    if (!str(body.scope)) errors.push("scope: 범위를 적습니다 (PO 입력)");
    if (!["naver_series", "data_license"].includes(String(body.kind))) errors.push("kind: naver_series 또는 data_license 입니다");
    if (!date(body.period_start)) errors.push("period_start: YYYY-MM-DD 형식입니다");
    if (!date(body.period_end)) errors.push("period_end: YYYY-MM-DD 형식입니다");
    if (body.partner_id !== undefined && posInt(body.partner_id) === null) errors.push("partner_id: 제휴사 번호(1 이상 정수)입니다");
    if (errors.length > 0) return invalid(errors);
    result = await db.rpc("license_contract_record", {
      p_counterparty: str(body.counterparty), p_partner_id: body.partner_id === undefined ? null : posInt(body.partner_id), p_kind: body.kind, p_scope: str(body.scope),
      p_start: date(body.period_start), p_end: date(body.period_end), p_settlement: str(body.settlement_terms), p_rights_ref: str(body.rights_ref), p_allows_full: body.allows_full === true, p_actor: actor,
    });
  } else if (op === "terminate") {
    const id = posInt(body.contract_id);
    if (id === null) return invalid(["contract_id: 계약 번호(1 이상 정수)입니다"]);
    result = await db.rpc("license_contract_terminate", { p_contract: id, p_actor: actor });
  } else if (op === "prepare") {
    const a = posInt(body.article_id);
    const c = posInt(body.contract_id);
    if (a === null || c === null) return invalid(["article_id·contract_id: 1 이상 정수입니다"]);
    result = await db.rpc("naver_manuscript_prepare", { p_article: a, p_contract: c, p_actor: actor });
  } else {
    const id = posInt(body.manuscript_id);
    if (id === null) return invalid(["manuscript_id: 원고 번호(1 이상 정수)입니다"]);
    result = await db.rpc("naver_manuscript_post", { p_id: id, p_url: str(body.posted_url), p_double_pay_ok: body.double_pay_notice_ok === true, p_actor: actor });
  }
  if (result.error) throw dbError(result.error, `라이선스 ${op}`);
  const r = result.data as { ok: boolean; code: string; id?: number };
  if (!r.ok) return errorJson(409, "처리할 수 없습니다", { code: r.code });
  return json({ created: { id: r.id ?? null } }, op === "contract" || op === "prepare" ? 201 : 200);
});
