import { parseRefetch, parseResolve, expiryDaysOf } from "@/lib/source-review/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { refetchSource } from "@/lib/server/source-review/service";

// 원문 검수 큐 (W4 6단계 — PRD-01B REG1-13, docs/dev/W4_설계.md 1장 6단계 · 4장 · 6장). 편집 책임자·관리자만(source_review.resolve — 거부도 감사).
//  · GET — 열린 항목(출처·기사 제목·사유·옛/새 해시·확인일) + 최근 해결 20건 + 만료 기준 일수
//  · POST op=refetch { sourceId, text? } — 원문 다시 받기(주소에서 받기 또는 붙여 넣기) → 같은 주소를 쓴 공식 자료마다 해시 비교, 다르면 항목 1건. 감사 source_review.refetch
//  · POST op=resolve { id, note?, reverify? } — 열린 항목 해결. reverify는 시점 만료 항목의 출처 확인일을 지금으로 다시 적는다(원문을 다시 확인함). 감사 source_review.resolve
// 원문 글자는 응답·감사에 넣지 않는다(해시·수만). 해결하면 기사 화면 '검토 중'이 다음 요청부터 사라진다(공개 캐시 만료).
export const dynamic = "force-dynamic";

const QUEUE_COLUMNS = "id, target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, basis_on, run_key, status, opened_at, opened_by, resolved_by, resolved_at, resolution_note";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "source_review.resolve", "source_review_queue:list");
  if (denied) return denied;
  const db = serviceDb();
  const [open, done, setting] = await Promise.all([
    db.from("source_review_queue").select(QUEUE_COLUMNS).eq("status", "open").order("opened_at").order("id"),
    db.from("source_review_queue").select(QUEUE_COLUMNS).eq("status", "resolved").order("resolved_at", { ascending: false }).limit(20),
    db.from("settings").select("value").eq("key", "official_source_expiry_days").limit(1),
  ]);
  if (open.error) throw dbError(open.error, "source_review_queue 열린 항목");
  if (done.error) throw dbError(done.error, "source_review_queue 해결 항목");
  if (setting.error) throw dbError(setting.error, "settings 만료 기준");
  return json({ open: open.data ?? [], resolved: done.data ?? [], expiryDays: expiryDaysOf(setting.data?.[0]?.value) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const denied = await authorize(viewer, "source_review.resolve", `source_review_queue:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "refetch") {
    const p = parseRefetch(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const result = await refetchSource(db, p.value, actor);
    await writeAudit(db, {
      actor,
      action: "source_review.refetch",
      target: `article_sources:${result.sourceId}`,
      before: null,
      after: result,
      reason: result.method === "pasted" ? "공식 자료 원문 다시 받기 (붙여 넣기)" : "공식 자료 원문 다시 받기",
    });
    return json({ result });
  }

  if (op === "resolve") {
    const p = parseResolve(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { id, note, reverify } = p.value;
    const found = await db.from("source_review_queue").select(QUEUE_COLUMNS).eq("id", id).limit(1);
    if (found.error) throw dbError(found.error, "source_review_queue 조회");
    const item = found.data?.[0] as { id: number; status: string; reason: string; target_type: string; target_id: number; article_id: number | null } | undefined;
    if (!item) return errorJson(404, "그런 검수 항목이 없습니다");
    if (item.status !== "open") return errorJson(409, "이미 해결된 검수 항목입니다");

    let verifiedAt: string | null = null;
    if (reverify) {
      if (item.reason !== "expired" || item.target_type !== "article_source") {
        return errorJson(422, "입력값을 확인하세요", { errors: ["reverify: 확인일 다시 적기는 시점 만료(expired) 항목의 출처에만 씁니다 — 원문이 바뀐 항목은 출처를 새 버전으로 고치세요"] });
      }
      const newer = await db.from("article_sources").select("id").eq("supersedes_id", item.target_id).limit(1);
      if (newer.error) throw dbError(newer.error, "article_sources 새 버전 조회");
      if (newer.data?.length) return errorJson(409, `출처 src:${item.target_id}는 새 버전으로 대체됐습니다 — 확인일을 다시 적지 않고 해결만 하세요`);
      verifiedAt = nowIso();
      const upd = await db.from("article_sources").update({ last_verified_at: verifiedAt }).eq("id", item.target_id).select("id");
      if (upd.error) throw dbError(upd.error, "article_sources 확인일");
    }
    const at = nowIso();
    const res = await db
      .from("source_review_queue")
      .update({ status: "resolved", resolved_by: actor, resolved_at: at, resolution_note: note })
      .eq("id", id)
      .eq("status", "open")
      .select(QUEUE_COLUMNS);
    if (res.error) throw dbError(res.error, "source_review_queue 해결");
    if (!res.data?.length) return errorJson(409, "이미 해결된 검수 항목입니다");
    await writeAudit(db, {
      actor,
      action: "source_review.resolve",
      target: `source_review_queue:${id}`,
      before: item,
      after: { ...res.data[0], reverifiedAt: verifiedAt },
      reason: note ?? (verifiedAt ? "원문 다시 확인 — 확인일 다시 적음" : "원문 검수 완료"),
    });
    return json({ item: res.data[0], reverifiedAt: verifiedAt });
  }

  return errorJson(422, "op는 refetch·resolve 중 하나입니다");
}, { revalidatesPublic: true });
