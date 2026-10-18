import { parseSynonymInput, synonymConsistency } from "@/lib/admin/synonym-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { SYNONYM_COLUMNS, loadSynonym, toSynonymRow, type SynonymRow } from "@/lib/server/admin/synonyms";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 검색 동의어 사전 한 줄 고치기·지우기 (W2-d 설계 5장) — 편집 책임자·관리자(dictionary.edit).
//  · 고치기는 보낸 칸만(낱말·동의어·사용 여부·메모). 고친 뒤 줄 전체를 다시 본다 — 낱말만 바꿔 동의어와 같아지면 422
//  · 감사 로그 synonym.update(바꾼 칸의 전후) · synonym.delete(지운 줄 전체). 검색은 캐시하지 않아 다음 검색부터 바로 바뀐다
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "동의어 줄");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.synonym(id);
  const denied = await authorize(viewer, "dictionary.edit", target);
  if (denied) return denied;
  const parsed = parseSynonymInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });

  const db = serviceDb();
  const before = await loadSynonym(db, id);
  const columns = parsed.value;
  const problem = synonymConsistency({ term: columns.term ?? before.term, synonyms: columns.synonyms ?? before.synonyms });
  if (problem) return errorJson(422, problem, { errors: [`synonym.synonyms: ${problem}`] });
  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("search_synonyms")
    .update({ ...columns, updated_by: actor })
    .eq("id", id)
    .select(SYNONYM_COLUMNS)
    .maybeSingle();
  if (error) throw dbError(error, "search_synonyms 고치기");
  if (!data) throw new HttpError(404, "동의어 사전에 그 줄이 없습니다");
  const after = toSynonymRow(data);
  const changed = Object.keys(columns) as (keyof SynonymRow)[];
  await writeAudit(db, {
    actor,
    action: "synonym.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
    reason: `검색 동의어 고치기 — ${after.term}`,
  });
  return json({ synonym: after });
});

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "동의어 줄");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.synonym(id);
  const denied = await authorize(viewer, "dictionary.edit", target);
  if (denied) return denied;
  const raw = await readJson(request);
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "검색 동의어 지우기";

  const db = serviceDb();
  const before = await loadSynonym(db, id);
  const { data, error } = await db.from("search_synonyms").delete().eq("id", id).select("id");
  if (error) throw dbError(error, "search_synonyms 지우기");
  if (!data || data.length === 0) throw new HttpError(404, "동의어 사전에 그 줄이 없습니다");
  await writeAudit(db, { actor: actorOf(viewer), action: "synonym.delete", target, before, after: null, reason: `${reason} — ${before.term}` });
  return json({ deleted: id });
});
