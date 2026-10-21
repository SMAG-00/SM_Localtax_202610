import { parseLinkUpdate, parseManualCheck } from "@/lib/links/rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { isoWeekKey } from "@/lib/links/rules";

// 바깥 연결 관리 (TX-01·FAM-08 — docs/dev/W3_설계.md 4·6장). 편집 책임자(editor)만. body.op = update | manual_check.
// 주소·이용 조건 문구는 사람이 입력한 값만 저장한다(코드에 기본 주소 0). 주소를 바꾸면 점검 상태를 unchecked로 되돌리고 공개 화면은 바로 따라간다.
// 수동 점검은 상대 약관·robots가 자동 점검을 막는 곳에 쓴다 — 점검자(이메일 아님, 사용자 번호)와 방법 manual을 기록한다.
export const dynamic = "force-dynamic";

const COLUMNS = "id, kind, key, label, url, terms_note, status, checked_at, check_method, last_ok_at, active, sort";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "link.manage", "official_links:list");
  if (denied) return denied;
  const { data, error } = await serviceDb().from("official_links").select(COLUMNS).order("sort").order("id");
  if (error) throw dbError(error, "official_links 목록");
  return json({ links: data ?? [] });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const denied = await authorize(viewer, "link.manage", `official_links:${String(body.op)}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (body.op === "update") {
    const p = parseLinkUpdate(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const before = await db.from("official_links").select(COLUMNS).eq("id", v.id).limit(1);
    if (before.error) throw dbError(before.error, "official_links 조회");
    if (!before.data?.length) return errorJson(404, "그런 연결이 없습니다");
    const patch: Record<string, unknown> = {};
    if (v.label !== undefined) patch.label = v.label;
    if (v.termsNote !== undefined) patch.terms_note = v.termsNote;
    if (v.active !== undefined) patch.active = v.active;
    if (v.url !== undefined) {
      patch.url = v.url;
      if (v.url !== (before.data[0] as { url: string | null }).url) Object.assign(patch, { status: "unchecked", checked_at: null, check_method: null, checked_by: null });
    }
    const { data, error } = await db.from("official_links").update(patch).eq("id", v.id).select(COLUMNS).single();
    if (error || !data) throw dbError(error ?? {}, "official_links 수정");
    await writeAudit(db, { actor, action: "link.manage", target: targetOf.officialLink(v.id), before: before.data[0], after: data, reason: "바깥 연결 편집" });
    return json({ link: data });
  }

  if (body.op === "manual_check") {
    const p = parseManualCheck(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const { id, result } = p.value;
    const found = await db.from("official_links").select("id, url").eq("id", id).limit(1);
    if (found.error) throw dbError(found.error, "official_links 조회");
    if (!found.data?.length) return errorJson(404, "그런 연결이 없습니다");
    if (!(found.data[0] as { url: string | null }).url) return errorJson(409, "주소가 없는 연결은 점검할 수 없습니다");
    const at = nowIso();
    const by = actor;
    const ins = await db.from("official_link_checks").insert({ link_id: id, run_key: `manual-${at}`, result, http_status: null, method: "manual", by, at });
    if (ins.error) throw dbError(ins.error, "official_link_checks 추가");
    const patch: Record<string, unknown> = { status: result, checked_at: at, check_method: "manual", checked_by: by };
    if (result === "ok") patch.last_ok_at = at;
    const { data, error } = await db.from("official_links").update(patch).eq("id", id).select(COLUMNS).single();
    if (error || !data) throw dbError(error ?? {}, "official_links 점검 반영");
    await writeAudit(db, { actor, action: "link.manage", target: targetOf.officialLink(id), before: null, after: { result, week: isoWeekKey(new Date(at)) }, reason: "바깥 연결 수동 점검 기록" });
    return json({ link: data });
  }

  return errorJson(422, "알 수 없는 작업입니다", { errors: ["op: update | manual_check"] });
}, { revalidatesPublic: true });
