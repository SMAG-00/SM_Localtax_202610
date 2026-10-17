import { glossaryConsistency, parseGlossaryInput } from "@/lib/admin/glossary-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { glossaryColumns, loadGlossary, type GlossaryRow } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 쉬운 말 사전 용어 고치기·지우기 (UX-01 ①) — 편집 책임자·관리자. 감사 로그에 전후 값(지우기는 지운 행 전체)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "용어");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.glossary(id);
  const denied = await authorize(viewer, "dictionary.edit", target);
  if (denied) return denied;
  const parsed = parseGlossaryInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });

  const db = serviceDb();
  const before = await loadGlossary(db, id);
  const columns = parsed.value;
  const problem = glossaryConsistency({ ...before, ...columns });
  if (problem) return errorJson(422, problem, { errors: [`glossary.plain: ${problem}`] });
  const { data, error } = await db.from("glossary_terms").update(columns).eq("id", id).select(glossaryColumns).maybeSingle();
  if (error) throw dbError(error, "glossary_terms 수정");
  if (!data) throw new HttpError(404, "용어를 찾을 수 없습니다");
  const after = data as GlossaryRow;
  const changed = Object.keys(columns);
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "glossary.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k as keyof GlossaryRow] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k as keyof GlossaryRow] ?? null])),
    reason: `용어 고치기 — ${after.term}`,
  });
  return json({ term: after });
}, { revalidatesPublic: true });

export const DELETE = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "용어");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.glossary(id);
  const denied = await authorize(viewer, "dictionary.edit", target);
  if (denied) return denied;
  const raw = await readJson(request);
  const reason = typeof raw.reason === "string" && raw.reason.trim() ? raw.reason.trim() : "용어 지우기";

  const db = serviceDb();
  const before = await loadGlossary(db, id);
  const { data, error } = await db.from("glossary_terms").delete().eq("id", id).select("id");
  if (error) throw dbError(error, "glossary_terms 삭제");
  if (!data || data.length === 0) throw new HttpError(404, "용어를 찾을 수 없습니다");
  await writeAudit(db, { actor: actorOf(viewer), action: "glossary.delete", target, before, after: null, reason: `${reason} — ${before.term}` });
  return json({ deleted: id });
}, { revalidatesPublic: true });
