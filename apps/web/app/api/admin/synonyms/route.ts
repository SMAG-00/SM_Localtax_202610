import { parseSynonymInput } from "@/lib/admin/synonym-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { SYNONYM_COLUMNS, listSynonyms, toSynonymRow } from "@/lib/server/admin/synonyms";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 검색 동의어 사전 (W2-d 설계 5장 — search_synonyms) 목록·더하기. 편집 책임자·관리자(dictionary.edit — 다른 사전과 같은 사람들).
//  · 낱말 하나를 찾으면 동의어도 함께 찾는다(한쪽 방향). 같은 정규형 낱말은 한 줄만(409 — DB unique)
//  · 감사 로그 synonym.create(전후 값). 검색은 캐시하지 않으므로(설계 8장) 저장하면 다음 검색부터 바로 쓴다 — 공개 캐시 만료가 필요 없다
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "dictionary.edit", "search_synonyms:list");
  if (denied) return denied;
  return json({ synonyms: await listSynonyms(serviceDb()) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "dictionary.edit", "search_synonyms:new");
  if (denied) return denied;
  const parsed = parseSynonymInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const db = serviceDb();
  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("search_synonyms")
    .insert({ ...parsed.value, updated_by: actor })
    .select(SYNONYM_COLUMNS)
    .single();
  if (error || !data) throw dbError(error ?? {}, "search_synonyms 더하기");
  const row = toSynonymRow(data);
  await writeAudit(db, { actor, action: "synonym.create", target: targetOf.synonym(row.id), before: null, after: row, reason: `검색 동의어 더하기 — ${row.term}` });
  return json({ synonym: row }, 201);
});
