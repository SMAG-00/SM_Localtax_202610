import { isoToKstDate } from "@/lib/admin/form-utils";
import { idOf } from "@/lib/admin/project-rules";
import { parseSupplyInput, parseSupplyPublish, supplyPublishErrors, type SupplyInput } from "@/lib/admin/supply-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { SUPPLY_COLUMNS, listSupply, loadSupply, type SupplyRow } from "@/lib/server/supply/board";

// 분양 정보 관리 (W4 17단계 — PRD-01B PR-04 · PR-05 · PR-07, docs/dev/W4_설계.md 1장 17단계 · 4장 `/api/admin/supply` · 6장 · 12장 140번~).
// 모두 편집 책임자·관리자(PO)만(supply.manage — 기자·감수위원·광고·협찬·브랜드 담당 등은 입력을 보기 전에 403 + 거부 감사).
// 칸 이름은 DB 칸 이름(snake_case)과 같고, 규칙 위반은 칸마다 "칸: 문장"(422 errors). 서비스를 건너뛴 쓰기는 DB 제약·트리거가 막는다(설계 8장).
// 가격·분양가·분담금·수익률·시세는 받는 칸이 없다 — 그런 이름의 칸을 보내면 422, 사업명·공급 규모·공고 기관 글자의 금액·가격 표현도 422(PR-05 · 12장 #11).
//  · GET — 목록(최근 고친 순) / GET ?id=N — 하나(공개 조건 미달 사유 포함)
//  · POST op=create { name, region_code, project_id?, supply_scale?, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, license_type, verified? } — 초안. 감사 supply_notice.edit
//  · POST op=update { id, (바꿀 칸), verified? } — 공개 중이면 고친 값도 공개 조건을 지켜야 한다. 감사 supply_notice.edit
//  · POST op=publish { id, status(public·hidden), verified? } — 공개(확인일 + 공급 규모)·내리기. 감사 supply_notice.publish
// verified = 참이면 지금 공식 공고와 대조해 확인했다는 표시 — 확인일(verified_at)을 지금으로 적는다.
// 공개 전환·공개 항목 고치기는 공개 뷰(public_supply_notices)에 바로 반영되므로 공개 데이터 캐시를 만료한다.
export const dynamic = "force-dynamic";

const todayKst = () => isoToKstDate(nowIso());

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = new URL(request.url).searchParams.get("id");
  const denied = await authorize(viewer, "supply.manage", raw ? targetOf.supplyNotice(raw.slice(0, 20)) : "supply_notices:list");
  if (denied) return denied;
  const db = serviceDb();
  if (raw !== null) {
    const id = idOf(raw);
    const item = id === null ? null : await loadSupply(db, id);
    return item ? json({ notice: item }) : errorJson(404, "분양 정보를 찾을 수 없습니다");
  }
  return json({ notices: await listSupply(db) });
});

type Db = ReturnType<typeof serviceDb>;

async function contextOf(db: Db, body: Record<string, unknown>, base: Partial<SupplyInput>) {
  const codeRaw = body.region_code !== undefined ? body.region_code : base.region_code;
  const code = typeof codeRaw === "string" && /^[0-9]{10}$/.test(codeRaw.trim()) ? codeRaw.trim() : null;
  let region: { valid_from: string | null; valid_to: string | null } | null = null;
  if (code) {
    const { data, error } = await db.from("regions").select("valid_from, valid_to").eq("code", code).maybeSingle();
    if (error) throw dbError(error, "regions 하나");
    region = data as typeof region;
  }
  const projectRaw = body.project_id !== undefined ? body.project_id : base.project_id;
  const projectId = idOf(projectRaw);
  let projectExists = false;
  if (projectId !== null) {
    const { data, error } = await db.from("projects").select("id").eq("id", projectId).limit(1);
    if (error) throw dbError(error, "projects 조회");
    projectExists = (data ?? []).length > 0;
  }
  return { today: todayKst(), region, projectExists };
}

const baseOf = (r: SupplyRow): Partial<SupplyInput> => ({
  name: r.name,
  region_code: r.region_code,
  project_id: r.project_id,
  supply_scale: r.supply_scale,
  apply_start: r.apply_start,
  apply_end: r.apply_end,
  notice_date: r.notice_date,
  notice_issuer: r.notice_issuer,
  official_notice_url: r.official_notice_url,
  license_type: r.license_type as SupplyInput["license_type"],
});

/** DB가 막은 쓰기 — 제약·트리거 문장을 그대로 (동시에 들어온 쓰기·서비스와 다른 값) */
function dbRejected(error: { code?: string; message?: string }) {
  if (error.code === "23514" || error.code === "23503") return errorJson(409, error.message ?? "저장할 수 없습니다");
  return null;
}

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const id = idOf(body.id);
  // 역할만으로 먼저 판정 — 편집국 외 역할은 입력을 보기 전에 거부하고 감사 로그에 남긴다
  const denied = await authorize(viewer, "supply.manage", id ? targetOf.supplyNotice(id) : "supply_notices:write");
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const parsed = parseSupplyInput(body, await contextOf(db, body, {}));
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const verified = body.verified === true;
    const { data, error } = await db
      .from("supply_notices")
      .insert({ ...parsed.value, status: "draft", verified_at: verified ? nowIso() : null, created_by: actor, updated_by: actor })
      .select(SUPPLY_COLUMNS)
      .single();
    if (error) {
      const rejected = dbRejected(error);
      if (rejected) return rejected;
      throw dbError(error, "supply_notices 만들기");
    }
    const row = data as SupplyRow;
    await writeAudit(db, { actor, action: "supply_notice.edit", target: targetOf.supplyNotice(row.id), before: null, after: row, reason: "분양 정보 만들기(초안 — 공개는 확인일·공급 규모 뒤)" });
    return json({ notice: row }, 201);
  }

  if (op === "update") {
    if (id === null) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 분양 정보 번호가 필요합니다"] });
    const current = await loadSupply(db, id);
    if (!current) return errorJson(404, "분양 정보를 찾을 수 없습니다");
    const parsed = parseSupplyInput(body, await contextOf(db, body, baseOf(current)), baseOf(current));
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const verified = body.verified === true;
    const v = parsed.value;
    const changed = (Object.keys(v) as (keyof SupplyInput)[]).filter((k) => v[k] !== current[k]);
    if (changed.length === 0 && !verified) return json({ notice: current, unchanged: true });
    if (current.status === "public") {
      const errors = supplyPublishErrors({ supply_scale: v.supply_scale, verified_at: verified ? nowIso() : current.verified_at });
      if (errors.length) return errorJson(422, "공개 중인 분양 정보는 공개 조건을 지켜야 합니다", { errors });
    }
    const columns: Record<string, unknown> = { ...Object.fromEntries(changed.map((k) => [k, v[k]])), updated_by: actor };
    if (verified) columns.verified_at = nowIso();
    const { data, error } = await db.from("supply_notices").update(columns).eq("id", id).eq("updated_at", current.updated_at).select(SUPPLY_COLUMNS).maybeSingle();
    if (error) {
      const rejected = dbRejected(error);
      if (rejected) return rejected;
      throw dbError(error, "supply_notices 고치기");
    }
    if (!data) return errorJson(409, "다른 사람이 먼저 바꿨습니다 — 화면을 새로 고치세요");
    const after = data as SupplyRow;
    const before = Object.fromEntries([...changed, ...(verified ? ["verified_at" as const] : [])].map((k) => [k, current[k]]));
    const afterPart = Object.fromEntries([...changed, ...(verified ? ["verified_at" as const] : [])].map((k) => [k, after[k]]));
    await writeAudit(db, {
      actor,
      action: "supply_notice.edit",
      target: targetOf.supplyNotice(id),
      before,
      after: afterPart,
      reason: changed.length ? `분양 정보 고치기(${changed.join("·")})` : "분양 정보 확인일 다시 적기",
    });
    return json({ notice: after });
  }

  if (op === "publish") {
    const parsed = parseSupplyPublish(body);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const v = parsed.value;
    const current = await loadSupply(db, v.id);
    if (!current) return errorJson(404, "분양 정보를 찾을 수 없습니다");
    const columns: Record<string, unknown> = { status: v.status, updated_by: actor };
    if (v.status === "public") {
      const verifiedAt = v.verified ? nowIso() : current.verified_at;
      const errors = supplyPublishErrors({ supply_scale: current.supply_scale, verified_at: verifiedAt });
      if (errors.length) return errorJson(422, "공개할 수 없습니다 — 아래 사유를 채우세요", { errors });
      if (current.status === "public" && !v.verified) return json({ notice: current, unchanged: true });
      columns.verified_at = verifiedAt;
    } else if (current.status !== "public") {
      return errorJson(409, "공개 중인 분양 정보만 내립니다");
    }
    const { data, error } = await db.from("supply_notices").update(columns).eq("id", current.id).eq("status", current.status).select(SUPPLY_COLUMNS).maybeSingle();
    if (error) {
      const rejected = dbRejected(error);
      if (rejected) return rejected;
      throw dbError(error, "supply_notices 공개 전환");
    }
    if (!data) return errorJson(409, "다른 사람이 먼저 바꿨습니다 — 화면을 새로 고치세요");
    const after = data as SupplyRow;
    await writeAudit(db, {
      actor,
      action: "supply_notice.publish",
      target: targetOf.supplyNotice(current.id),
      before: { status: current.status, verified_at: current.verified_at },
      after: { status: after.status, verified_at: after.verified_at },
      reason: v.status === "public" ? (current.status === "public" ? "공개 분양 정보 확인일 다시 적기" : "분양 정보 공개") : "분양 정보 내리기",
    });
    return json({ notice: after });
  }

  return errorJson(422, "op는 create·update·publish 중 하나입니다");
}, { revalidatesPublic: true });
