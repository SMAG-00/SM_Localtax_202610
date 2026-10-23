import {
  LOCAL_NEWS_OPS,
  parseCandidate,
  parseCandidateStatus,
  parseDigestId,
  parseEvent,
  parseEventLink,
  parseEventPublish,
  parseEventStatus,
  parseItem,
  parseItemId,
  parseSelect,
} from "@/lib/admin/local-news-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadLocalNewsBoard } from "@/lib/server/local-news/board";
import { digestSimilarity, internalRules, summaryHash } from "@/lib/server/local-news/similarity";
import { kstDate } from "@/lib/server/public/local-news-logic";
import { isoWeekKey } from "@/lib/site/iso-week";

// 지자체뉴스 관리 (W6 - PRD-01B LG-01~06 · LG-09 · LG-11~14, docs/dev/W6_설계.md 1장 3단계). 편집 책임자·관리자(local_news.manage).
// 칸 모양은 lib/admin/local-news-rules.ts가 보고, 요약 길이 상한·공식 주소 규칙·영리 주최·취소 출처·기간·발행 검사는 DB 트리거가 정본이다
// (check_violation은 422로 문장 그대로). 모든 쓰기는 감사 로그와 공개 캐시 만료.
//  · GET - 보드(시·도별 연속 발행 주 수·후보·주간 페이지·항목·행사·재확인 대상·설정)
//  · POST op=candidate {...} 후보 직접 넣기(허용 근거가 있는 출처만) / candidate_status {id, status}
//  · POST op=select {candidate_id, summary} 후보 선정 -> 발표일이 속한 주의 초안 페이지에 항목 만들기
//  · POST op=item {id, summary?, ...} 고치기 / item_remove {id} / similarity {id} 유사도 검사(결과를 항목에 기록) / convert {id} 기획 전환
//  · POST op=publish {digest_id} 주간 페이지 발행(DB 검사 통과 시)
//  · POST op=event / event_status / event_publish / event_link / event_unlink - 행사
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const dbProblem = (error: { code?: string; message?: string }) => (error.code === "23514" ? invalid([error.message ?? "저장 규칙에 맞지 않습니다"]) : null);
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  const p = dbProblem(error);
  if (p) return p;
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (지역 코드·번호를 확인하세요)"]);
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "local_news.manage", "local_news:list");
  if (denied) return denied;
  return json(await loadLocalNewsBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(LOCAL_NEWS_OPS as readonly string[]).includes(op)) return invalid([`op: ${LOCAL_NEWS_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "local_news.manage", `local_news:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "candidate") {
    const p = parseCandidate(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("hot_news_candidates").insert({ ...p.value, created_by: actor }).select("id, status").single();
    if (error || !data) return error ? (error.code === "23505" ? errorJson(409, "같은 원문 주소의 후보가 이미 있습니다") : fail(error, "hot_news_candidates 추가")) : errorJson(500, "후보를 저장하지 못했습니다");
    await writeAudit(db, { actor, action: "local_news.candidate.add", target: targetOf.localNews("hot_news_candidates", (data as { id: number }).id), before: null, after: data, reason: "핫뉴스 후보 직접 넣기" });
    return json({ candidate: data }, 201);
  }

  if (op === "candidate_status") {
    const p = parseCandidateStatus(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("hot_news_candidates").update({ status: p.value.status }).eq("id", p.value.id).neq("status", "selected").select("id, status").maybeSingle();
    if (error) return fail(error, "hot_news_candidates 수정");
    if (!data) return errorJson(404, "그런 후보가 없거나 이미 항목으로 선정됐습니다");
    await writeAudit(db, { actor, action: "local_news.candidate.status", target: targetOf.localNews("hot_news_candidates", p.value.id), before: null, after: data, reason: "핫뉴스 후보 상태 바꾸기" });
    return json({ candidate: data });
  }

  if (op === "select") {
    const p = parseSelect(body);
    if (!p.ok) return invalid(p.errors);
    const { data: cand, error: ce } = await db.from("hot_news_candidates").select("*").eq("id", p.value.candidate_id).maybeSingle();
    if (ce) throw dbError(ce, "hot_news_candidates 조회");
    if (!cand) return errorJson(404, "그런 후보가 없습니다");
    const c = cand as Record<string, string | null>;
    if (c.status === "selected") return errorJson(409, "이미 항목으로 선정된 후보입니다");
    const announcedOn = kstDate(String(c.announced_at));
    const weekKey = isoWeekKey(announcedOn);
    const findDigest = async () => {
      const { data, error } = await db.from("weekly_digests").select("id, status, week_key, sido_code").eq("sido_code", c.sido_code).eq("week_key", weekKey).maybeSingle();
      if (error) throw dbError(error, "weekly_digests 조회");
      return data as { id: number; status: string; week_key: string; sido_code: string } | null;
    };
    let digest = await findDigest();
    if (!digest) {
      const { error } = await db.from("weekly_digests").insert({ sido_code: c.sido_code, week_key: weekKey });
      if (error && error.code !== "23505") return fail(error, "weekly_digests 추가");
      digest = await findDigest();
    }
    if (!digest) throw new Error("주간 페이지를 만들지 못했습니다");
    if (digest.status === "published") return errorJson(409, `${weekKey} 주는 이미 발행되어 항목을 더할 수 없습니다`);
    const { data: item, error: ie } = await db
      .from("digest_items")
      .insert({
        digest_id: digest.id,
        candidate_id: p.value.candidate_id,
        region_code: c.region_code,
        title: c.title,
        source_url: c.source_url,
        press_org: c.press_org,
        announced_on: announcedOn,
        license_type: c.license_type,
        summary: p.value.summary,
        figures_checked: p.value.figures_checked,
        original_text: c.original_text,
        created_by: actor,
      })
      .select("id, digest_id")
      .single();
    if (ie || !item) return ie ? fail(ie, "digest_items 추가") : errorJson(500, "항목을 저장하지 못했습니다");
    await db.from("hot_news_candidates").update({ status: "selected" }).eq("id", p.value.candidate_id);
    await writeAudit(db, { actor, action: "local_news.item.select", target: targetOf.localNews("digest_items", (item as { id: number }).id), before: null, after: { ...item, week_key: weekKey }, reason: "핫뉴스 후보 선정 - 항목 만들기" });
    return json({ item, digest: { id: digest.id, week_key: weekKey } }, 201);
  }

  if (op === "item" || op === "item_remove" || op === "similarity" || op === "convert") {
    const parsedItem = op === "item" ? parseItem(body) : null;
    const p = parsedItem ?? parseItemId(body);
    if (!p.ok) return invalid(p.errors);
    const id = p.value.id;
    const { data: before, error: be } = await db.from("digest_items").select("*").eq("id", id).maybeSingle();
    if (be) throw dbError(be, "digest_items 조회");
    if (!before) return errorJson(404, "그런 항목이 없습니다");
    const row = before as { id: number; digest_id: number; candidate_id: number | null; summary: string; original_text: string | null };

    if (op === "item") {
      const { data, error } = await db.from("digest_items").update(parsedItem && parsedItem.ok ? parsedItem.value.patch : {}).eq("id", id).select("id, summary, figures_checked, sim_status").single();
      if (error || !data) return error ? fail(error, "digest_items 수정") : errorJson(500, "항목을 고치지 못했습니다");
      await writeAudit(db, { actor, action: "local_news.item.edit", target: targetOf.localNews("digest_items", id), before: { summary: row.summary }, after: data, reason: "핫뉴스 항목 고치기 - 요약을 고치면 유사도 기록이 지워집니다" });
      return json({ item: data });
    }

    if (op === "item_remove") {
      const { error } = await db.from("digest_items").delete().eq("id", id);
      if (error) return fail(error, "digest_items 삭제");
      if (row.candidate_id) await db.from("hot_news_candidates").update({ status: "new" }).eq("id", row.candidate_id);
      await writeAudit(db, { actor, action: "local_news.item.remove", target: targetOf.localNews("digest_items", id), before: { summary: row.summary }, after: null, reason: "핫뉴스 항목 빼기 (초안 주만)" });
      return json({ removed: id });
    }

    if (op === "similarity") {
      const [{ data: siblings, error: se }, { data: rules, error: re }] = await Promise.all([
        db.from("digest_items").select("id, summary").eq("digest_id", row.digest_id).neq("id", id),
        db.from("settings").select("value").eq("key", "similarity_internal").maybeSingle(),
      ]);
      if (se) throw dbError(se, "digest_items 조회");
      if (re) throw dbError(re, "settings 조회");
      const result = digestSimilarity({ summary: row.summary, originalText: row.original_text, siblings: (siblings ?? []) as { id: number; summary: string }[], rules: internalRules((rules as { value: unknown } | null)?.value) });
      const { data, error } = await db
        .from("digest_items")
        .update({ sim_status: result.status, sim_max: result.max, sim_ratio: result.ratio, sim_matches: result.matches, sim_rules_version: result.rulesVersion, sim_checked_hash: summaryHash(row.summary), sim_checked_at: new Date().toISOString() })
        .eq("id", id)
        .eq("summary", row.summary)
        .select("id")
        .maybeSingle();
      if (error) return fail(error, "digest_items 유사도 기록");
      if (!data) return errorJson(409, "검사하는 사이에 요약이 바뀌었습니다 - 다시 검사하세요");
      await writeAudit(db, { actor, action: "local_news.item.similarity", target: targetOf.localNews("digest_items", id), before: null, after: { status: result.status, max: result.max, ratio: result.ratio, rules: result.rulesVersion }, reason: "핫뉴스 요약 유사도 검사 (LG-03)" });
      return json({ similarity: result, blocked: result.status !== "pass" });
    }

    // convert - 기획 전환 (LG-06): 이미 전환했으면 기존 카드
    const { data, error } = await db.rpc("digest_item_to_assignment", { p_item: id, p_actor: actor });
    if (error) return fail(error, "digest_item_to_assignment");
    const alreadyLinked = (before as { assignment_id: number | null }).assignment_id !== null;
    await writeAudit(db, { actor, action: "local_news.item.convert", target: targetOf.localNews("digest_items", id), before: null, after: { assignment_id: data }, reason: alreadyLinked ? "이미 전환된 항목 - 기존 기획 카드 열기" : "핫뉴스 항목을 기사 기획 카드(idea)로 전환" });
    return json({ assignment_id: data, existing: alreadyLinked }, alreadyLinked ? 200 : 201);
  }

  if (op === "publish") {
    const p = parseDigestId(body);
    if (!p.ok) return invalid(p.errors);
    const { data: before, error: be } = await db.from("weekly_digests").select("id, sido_code, week_key, status").eq("id", p.value.digest_id).maybeSingle();
    if (be) throw dbError(be, "weekly_digests 조회");
    if (!before) return errorJson(404, "그런 주간 페이지가 없습니다");
    if ((before as { status: string }).status === "published") return errorJson(409, "이미 발행된 주간 페이지입니다");
    const { data, error } = await db.from("weekly_digests").update({ status: "published", published_by: actor }).eq("id", p.value.digest_id).select("id, sido_code, week_key, status, published_at").single();
    if (error || !data) return error ? fail(error, "weekly_digests 발행") : errorJson(500, "발행하지 못했습니다");
    await writeAudit(db, { actor, action: "local_news.digest.publish", target: targetOf.localNews("weekly_digests", p.value.digest_id), before, after: data, reason: "금주 핫뉴스 주간 페이지 발행 (유사도·수치 확인 검사 통과)" });
    return json({ digest: data }, 200);
  }

  if (op === "event") {
    const p = parseEvent(body);
    if (!p.ok) return invalid(p.errors);
    const { data: before, error: be } = await db.from("local_events").select("*").eq("slug", p.value.slug).maybeSingle();
    if (be) throw dbError(be, "local_events 조회");
    const write = before ? db.from("local_events").update({ ...p.value, edited_by: actor }).eq("slug", p.value.slug) : db.from("local_events").insert({ ...p.value, edited_by: actor });
    const { data, error } = await write.select("id, slug, published").single();
    if (error || !data) return error ? fail(error, "local_events 쓰기") : errorJson(500, "행사를 저장하지 못했습니다");
    await writeAudit(db, { actor, action: before ? "local_news.event.edit" : "local_news.event.add", target: targetOf.localNews("local_events", (data as { id: number }).id), before, after: data, reason: before ? "행사 회차 고치기" : "행사 회차 추가 (공개는 따로)" });
    return json({ event: data }, before ? 200 : 201);
  }

  if (op === "event_status") {
    const p = parseEventStatus(body);
    if (!p.ok) return invalid(p.errors);
    const { data: before, error: be } = await db.from("local_events").select("id, slug, status_override, status_source_url").eq("slug", p.value.slug).maybeSingle();
    if (be) throw dbError(be, "local_events 조회");
    if (!before) return errorJson(404, "그런 행사가 없습니다");
    const next = p.value.state === "normal" ? null : p.value.state;
    const { data, error } = await db
      .from("local_events")
      .update({ status_override: next, status_source_url: p.value.source_url, status_confirmed_at: next !== null || p.value.source_url !== null ? new Date().toISOString() : null, edited_by: actor })
      .eq("slug", p.value.slug)
      .select("id, slug, status_override")
      .single();
    if (error || !data) return error ? fail(error, "local_events 상태 바꾸기") : errorJson(500, "상태를 바꾸지 못했습니다");
    await writeAudit(db, { actor, action: "local_news.event.status", target: targetOf.localNews("local_events", (data as { id: number }).id), before, after: data, reason: "행사 지정 상태 바꾸기 (이력 1행이 남습니다)" });
    return json({ event: data });
  }

  if (op === "event_publish") {
    const p = parseEventPublish(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("local_events").update({ published: p.value.published, edited_by: actor }).eq("slug", p.value.slug).select("id, slug, published").maybeSingle();
    if (error) return fail(error, "local_events 공개 전환");
    if (!data) return errorJson(404, "그런 행사가 없습니다");
    await writeAudit(db, { actor, action: p.value.published ? "local_news.event.publish" : "local_news.event.unpublish", target: targetOf.localNews("local_events", (data as { id: number }).id), before: null, after: data, reason: p.value.published ? "행사 공개" : "행사 내리기" });
    return json({ event: data });
  }

  if (op === "event_link") {
    const p = parseEventLink(body);
    if (!p.ok) return invalid(p.errors);
    const { data: ev, error: ee } = await db.from("local_events").select("id").eq("slug", p.value.slug).maybeSingle();
    if (ee) throw dbError(ee, "local_events 조회");
    if (!ev) return errorJson(404, "그런 행사가 없습니다");
    const { data, error } = await db.from("event_links").insert({ event_id: (ev as { id: number }).id, target_kind: p.value.target_kind, target_id: p.value.target_id, reason: p.value.reason, confirmed_by: actor }).select("id, event_id, target_kind, target_id").single();
    if (error || !data) return error ? (error.code === "23505" ? errorJson(409, "이미 같은 연결이 있습니다") : fail(error, "event_links 추가")) : errorJson(500, "연결을 저장하지 못했습니다");
    await writeAudit(db, { actor, action: "local_news.event.link", target: targetOf.localNews("event_links", (data as { id: number }).id), before: null, after: data, reason: "행사 연결 확인 (프로젝트·기사)" });
    return json({ link: data }, 201);
  }

  // event_unlink
  const id = typeof body.id === "number" ? body.id : Number(body.id);
  if (!Number.isInteger(id) || id <= 0) return invalid(["id: 1 이상의 번호여야 합니다"]);
  const { data, error } = await db.from("event_links").delete().eq("id", id).select("id, event_id, target_kind, target_id").maybeSingle();
  if (error) return fail(error, "event_links 삭제");
  if (!data) return errorJson(404, "그런 연결이 없습니다");
  await writeAudit(db, { actor, action: "local_news.event.unlink", target: targetOf.localNews("event_links", id), before: data, after: null, reason: "행사 연결 지우기" });
  return json({ removed: id });
}, { revalidatesPublic: true });
