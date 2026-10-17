import { glossaryConsistency, parseGlossaryInput } from "@/lib/admin/glossary-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { glossaryColumns, type GlossaryRow } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 쉬운 말 사전 용어 더하기 (UX-01 ①, glossary_terms) — 편집 책임자·관리자(dictionary.edit).
// 전문 용어(jargon)로 표시한 용어는 쉬운 풀이(60자 이하)가 있어야 한다 — 발행 판정의 '풀이 없는 전문 용어 첫 등장' 경고가 다음 점검부터 쓴다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "dictionary.edit", "glossary_terms:new");
  if (denied) return denied;
  const parsed = parseGlossaryInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = { jargon: true, ...parsed.value };
  const problem = glossaryConsistency(columns);
  if (problem) return errorJson(422, problem, { errors: [`glossary.plain: ${problem}`] });

  const db = serviceDb();
  const { data, error } = await db.from("glossary_terms").insert(columns).select(glossaryColumns).single();
  if (error || !data) throw dbError(error ?? {}, "glossary_terms 추가");
  const row = data as GlossaryRow;
  await writeAudit(db, { actor: actorOf(viewer), action: "glossary.create", target: targetOf.glossary(row.id), before: null, after: row, reason: `용어 더하기 — ${row.term}` });
  return json({ term: row }, 201);
});
