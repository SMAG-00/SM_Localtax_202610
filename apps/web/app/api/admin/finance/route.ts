import { can } from "@/lib/access";
import {
  FINANCE_OPS,
  parseCase,
  parseIndicator,
  parseInterestItems,
  parseLegalCheck,
  parseLegalReview,
  parseRegulation,
  parseSign,
  parseStructure,
} from "@/lib/admin/finance-rules";
import { snapshotHash } from "@/lib/source-review/fetch";
import { readSetting, writeSetting } from "@/lib/server/admin/backoffice";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { loadFinanceBoard, loadStructure } from "@/lib/server/finance/board";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 개발금융 관리 (W5 — PRD-01B DF-01~05 · DF-09, docs/dev/W5_설계.md 1장 3단계). 입력은 편집 책임자·관리자(finance.manage), 세무 서명은 감수위원(review.tax_review),
// 법률 검토 기록은 설정 권한(settings.edit). 칸 규칙은 lib/admin/finance-rules.ts가 모양을 보고, 금지 표현·자리 채움·세액·차단 도메인·반론·근거 규칙은 DB 트리거가
// 정본이다(check_violation은 422로 문장 그대로). 모든 쓰기는 감사 로그와 공개 캐시 만료.
//  · GET — 보드(구조 해설·통계·규제·기사 사례/칼럼 항목·설정)
//  · POST op=structure { slug, structure_type, title, summary?, diagram?, notes?, lens?, lens_omit_reason? } — 초안 만들기/고치기(고치면 법률 확인 지움)
//  · POST op=legal_check { slug, checked_by, checked_on? } — 법률 확인 기록(저장된 내용에만)
//  · POST op=sign { slug, updated_at } — 세무 감수 서명 = 승인본 추가(읽은 초안 그대로일 때만, 아니면 409)
//  · POST op=indicator / regulation { …, snapshot_id | snapshot_payload } — 추가만 시계열
//  · POST op=case { article_id, … } / interest_items { article_id, items[] } — 사례 구조·칼럼 소속 항목
//  · POST op=legal_review { reviewer, reviewed_on, conclusion } — 설정 finance_legal_review 기록
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const dbProblem = (error: { code?: string; message?: string }) => (error.code === "23514" ? invalid([error.message ?? "저장 규칙에 맞지 않습니다"]) : null);
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  if (!can(viewer, "finance.manage") && !can(viewer, "review.tax_review")) {
    const denied = await authorize(viewer, "finance.manage", "finance:list");
    if (denied) return denied;
  }
  return json(await loadFinanceBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(FINANCE_OPS as readonly string[]).includes(op)) return invalid([`op: ${FINANCE_OPS.join("·")} 중 하나입니다`]);
  const action = op === "sign" ? "review.tax_review" : op === "legal_review" ? "settings.edit" : "finance.manage";
  const denied = await authorize(viewer, action, `finance:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "structure") {
    const p = parseStructure(body);
    if (!p.ok) return invalid(p.errors);
    const v = p.value;
    const before = await loadStructure(db, v.slug);
    const content = { structure_type: v.structure_type, title: v.title, summary: v.summary, diagram: v.diagram, notes: v.notes, lens: v.lens, lens_omit_reason: v.lens_omit_reason, drafted_by: actor };
    const write = before ? db.from("finance_structures").update(content).eq("slug", v.slug) : db.from("finance_structures").insert({ slug: v.slug, ...content });
    const { error } = await write;
    if (error) return dbProblem(error) ?? (error.code === "23505" ? errorJson(409, "같은 주소 이름이 이미 있습니다") : (() => { throw dbError(error, "finance_structures 쓰기"); })());
    const after = await loadStructure(db, v.slug);
    await writeAudit(db, { actor, action: "finance.structure.edit", target: targetOf.financeStructure(v.slug), before, after, reason: before ? "개발금융 구조 해설 고침 - 법률 확인 지움(재감수 필요)" : "개발금융 구조 해설 초안 저장" });
    return json({ structure: after }, before ? 200 : 201);
  }

  if (op === "legal_check") {
    const p = parseLegalCheck(body);
    if (!p.ok) return invalid(p.errors);
    const before = await loadStructure(db, p.value.slug);
    if (!before) return errorJson(404, "그런 구조 해설이 없습니다");
    const { error } = await db.from("finance_structures").update({ legal_checked_by: p.value.checked_by, legal_checked_at: p.value.checked_on ?? kstToday() }).eq("slug", p.value.slug);
    if (error) return dbProblem(error) ?? (() => { throw dbError(error, "finance_structures 법률 확인"); })();
    const after = await loadStructure(db, p.value.slug);
    await writeAudit(db, { actor, action: "finance.structure.legal_check", target: targetOf.financeStructure(p.value.slug), before, after, reason: "개발금융 구조 해설 법률 확인 기록" });
    return json({ structure: after });
  }

  if (op === "sign") {
    const p = parseSign(body);
    if (!p.ok) return invalid(p.errors);
    const before = await loadStructure(db, p.value.slug);
    if (!before) return errorJson(404, "그런 구조 해설이 없습니다");
    if (new Date(before.updated_at).getTime() !== new Date(p.value.updated_at).getTime()) {
      return errorJson(409, "초안이 그 사이 바뀌었습니다 - 새로 불러와 바뀐 내용을 읽은 뒤 서명하세요");
    }
    if (before.review_status === "approved") return json({ structure: before, unchanged: true });
    const { error } = await db.from("finance_structure_versions").insert({ structure_id: before.id, tax_signed_by: actor });
    if (error) return dbProblem(error) ?? (() => { throw dbError(error, "finance_structure_versions 서명"); })();
    const after = await loadStructure(db, p.value.slug);
    await writeAudit(db, { actor, action: "finance.structure.sign", target: targetOf.financeStructure(p.value.slug), before, after, reason: "개발금융 구조 해설 세무 감수 서명(승인본 추가)" });
    return json({ structure: after }, 201);
  }

  if (op === "indicator" || op === "regulation") {
    const p = op === "indicator" ? parseIndicator(body) : parseRegulation(body);
    if (!p.ok) return invalid(p.errors);
    const v = p.value;
    let snapshotId = v.snapshot_id;
    let made: number | null = null;
    if (snapshotId !== null) {
      const { data, error } = await db.from("raw_snapshots").select("id").eq("id", snapshotId).limit(1);
      if (error) throw dbError(error, "raw_snapshots 조회");
      if (!data?.length) return invalid(["snapshot_id: 그런 원본 스냅샷이 없습니다 - 번호를 확인하거나 원문 글자를 붙여 넣으세요"]);
    } else if (v.snapshot_payload !== null) {
      const hash = snapshotHash(new TextEncoder().encode(v.snapshot_payload));
      const { data, error } = await db.from("raw_snapshots").insert({ source: "개발금융 근거 원문", url: v.source_url, content_hash: hash, payload: v.snapshot_payload }).select("id").single();
      if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
      snapshotId = made = Number((data as { id: number }).id);
    }
    const { snapshot_payload: _payload, snapshot_id: _id, ...rest } = v;
    void _payload;
    void _id;
    const table = op === "indicator" ? "finance_indicators" : "finance_regulations";
    const { data, error } = await db.from(table).insert({ ...rest, snapshot_id: snapshotId, recorded_by: actor }).select("*").single();
    if (error || !data) {
      if (made !== null) await db.from("raw_snapshots").delete().eq("id", made);
      return (error && dbProblem(error)) || (() => { throw dbError(error ?? {}, `${table} 추가`); })();
    }
    await writeAudit(db, { actor, action: `finance.${op}.add`, target: targetOf.financeRecord(table, (data as { id: number }).id), before: null, after: data, reason: op === "indicator" ? "개발금융 통계 지표 새 값(추가만)" : "개발금융 규제 항목 새 단계(추가만)" });
    return json({ [op]: data }, 201);
  }

  if (op === "case") {
    const p = parseCase(body);
    if (!p.ok) return invalid(p.errors);
    const v = p.value;
    const { data: before, error: be } = await db.from("finance_cases").select("*").eq("article_id", v.article_id).maybeSingle();
    if (be) throw dbError(be, "finance_cases 조회");
    const { data, error } = await db.from("finance_cases").upsert({ ...v, updated_by: actor }, { onConflict: "article_id" }).select("*").single();
    if (error || !data) {
      if (error?.code === "23503") return invalid(["article_id: 그런 기사가 없습니다"]);
      return (error && dbProblem(error)) || (() => { throw dbError(error ?? {}, "finance_cases 저장"); })();
    }
    await writeAudit(db, { actor, action: "finance.case.edit", target: targetOf.financeRecord("finance_cases", v.article_id), before, after: data, reason: "개발금융 사례 구조·반론 기록" });
    return json({ case: data }, before ? 200 : 201);
  }

  if (op === "interest_items") {
    const p = parseInterestItems(body);
    if (!p.ok) return invalid(p.errors);
    const { article_id, items } = p.value;
    const { data: before, error: be } = await db.from("finance_column_interest_items").select("item, state, interest_text, confirmed_by").eq("article_id", article_id).order("item");
    if (be) throw dbError(be, "finance_column_interest_items 조회");
    const rows = items.map((i) => ({ article_id, ...i, confirmed_at: i.state === "none_confirmed" ? new Date().toISOString() : null }));
    const { data, error } = await db.from("finance_column_interest_items").upsert(rows, { onConflict: "article_id,item" }).select("item, state, interest_text, confirmed_by");
    if (error || !data) {
      if (error?.code === "23503") return invalid(["article_id: 그런 기사가 없습니다"]);
      return (error && dbProblem(error)) || (() => { throw dbError(error ?? {}, "finance_column_interest_items 저장"); })();
    }
    await writeAudit(db, { actor, action: "finance.interest.edit", target: targetOf.financeRecord("finance_column_interest_items", article_id), before, after: data, reason: "개발금융 칼럼 소속 항목(금융사·신탁사)" });
    return json({ article_id, items: data });
  }

  // op === "legal_review"
  const p = parseLegalReview(body);
  if (!p.ok) return invalid(p.errors);
  const current = await readSetting(db, "finance_legal_review");
  if (!current) return errorJson(503, "설정 finance_legal_review가 없습니다 - 마이그레이션을 확인하세요");
  const saved = await writeSetting(db, current, p.value, actor);
  if (!saved) return errorJson(409, "다른 사람이 먼저 고쳤습니다 - 새로 불러온 뒤 다시 저장하세요");
  await writeAudit(db, { actor, action: "settings.update", target: targetOf.setting("finance_legal_review"), before: { value: current.value }, after: { value: saved.value }, reason: "개발금융 법률 검토 기록" });
  return json({ legalReview: saved.value });
}, { revalidatesPublic: true });

