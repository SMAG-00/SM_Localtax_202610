import { glossaryConsistency, glossaryWarnings, parseGlossaryInput } from "@/lib/admin/glossary-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { glossaryColumns, loadGlossary, type GlossaryRow } from "@/lib/server/admin/backoffice";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 쉬운 말 사전 용어 고치기·공개·숨김·지우기 (UX-01 ① · GLO-01) — 편집 책임자·관리자.
//  · 감사 로그 — 내용 칸 고치기는 glossary.update(바뀐 칸 전후), 공개 상태를 바꾸면 glossary.publish·glossary.unpublish(전후 visible), 지우기는 지운 행 전체
//  · 저장 경고(warnings) — 저장된 행의 쉬운 풀이 60자 초과·숫자 + 단위 (W2-d 설계 2.5). 저장은 된다(200)
//  · 공개 화면(용어사전·용어 칩·본문 툴팁)에 바로 반영 — 공개 데이터 캐시를 바로 만료한다. 검색은 캐시하지 않아 다음 검색부터 바로
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
  const actor = actorOf(viewer);
  const content = Object.keys(columns).filter((k) => k !== "visible");
  if (content.length > 0) {
    await writeAudit(db, {
      actor,
      action: "glossary.update",
      target,
      before: Object.fromEntries(content.map((k) => [k, before[k as keyof GlossaryRow] ?? null])),
      after: Object.fromEntries(content.map((k) => [k, after[k as keyof GlossaryRow] ?? null])),
      reason: `용어 고치기 — ${after.term}`,
    });
  }
  if ("visible" in columns && before.visible !== after.visible) {
    await writeAudit(db, {
      actor,
      action: after.visible ? "glossary.publish" : "glossary.unpublish",
      target,
      before: { visible: before.visible },
      after: { visible: after.visible },
      reason: `${after.visible ? "용어 공개" : "용어 숨김"} — ${after.term}`,
    });
  }
  return json({ term: after, warnings: glossaryWarnings(after) });
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
