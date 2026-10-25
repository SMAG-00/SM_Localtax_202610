import { parseSourceUpdate } from "@/lib/review/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 수집 원천 등록부 (W10-c — PIPE 이용 조건 관문). 관리자만(pipeline.manage — 거부도 감사).
//  · GET — 원천 목록(이용 조건·견본 계약 확인 상태)
//  · POST op=terms { key, terms, note? } — 이용 조건 기록(unchecked·allowed·link_only·denied). allowed는 근거 필수. 감사 pipeline.source_terms
//  · POST op=contract { key } — 실응답 견본 계약 시험을 통과했음을 기록. 이용 조건이 허용이어야 수집기가 돈다. 감사 pipeline.source_contract
// 인증키·원문 글자는 다루지 않는다.
export const dynamic = "force-dynamic";

const COLUMNS = "key, name, kind, api_target, priority, terms_status, terms_note, terms_checked_by, terms_checked_at, contract_verified_by, contract_verified_at";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "pipeline.manage", "data_sources:list");
  if (denied) return denied;
  const r = await serviceDb().from("data_sources").select(COLUMNS).order("priority").order("key");
  if (r.error) throw dbError(r.error, "data_sources 조회");
  return json({ sources: r.data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const denied = await authorize(viewer, "pipeline.manage", `data_sources:${String(body.op)}`);
  if (denied) return denied;
  const p = parseSourceUpdate(body);
  if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
  const db = serviceDb();
  const actor = actorOf(viewer);
  const found = await db.from("data_sources").select(COLUMNS).eq("key", p.value.key).limit(1);
  if (found.error) throw dbError(found.error, "data_sources 조회");
  const before = found.data?.[0];
  if (!before) return errorJson(404, "그런 수집 원천이 없습니다");
  const at = nowIso();
  const patch =
    p.value.op === "terms"
      ? p.value.terms === "unchecked"
        ? { terms_status: "unchecked", terms_note: p.value.note, terms_checked_by: null, terms_checked_at: null }
        : { terms_status: p.value.terms, terms_note: p.value.note, terms_checked_by: actor, terms_checked_at: at }
      : { contract_verified_by: actor, contract_verified_at: at };
  const upd = await db.from("data_sources").update(patch).eq("key", p.value.key).select(COLUMNS);
  if (upd.error) throw dbError(upd.error, "data_sources 갱신");
  const after = upd.data?.[0];
  await writeAudit(db, {
    actor,
    action: p.value.op === "terms" ? "pipeline.source_terms" : "pipeline.source_contract",
    target: `data_sources:${p.value.key}`,
    before,
    after,
    reason: p.value.note ?? (p.value.op === "contract" ? "실응답 견본 계약 시험 통과 기록" : "원천 이용 조건 기록"),
  });
  return json({ source: after });
});
