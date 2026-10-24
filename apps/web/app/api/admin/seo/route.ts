import {
  SEO_OPS,
  parseFreshnessResolve,
  parseQuestionsActivate,
  parseQuestionsSave,
  parseSampleInput,
  parseSamplesInit,
} from "@/lib/admin/seo-rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { loadSeoOverview } from "@/lib/server/seo/admin";

// 검색 최적화 (W7 - OPT-01·07·08·09, docs/dev/W7_설계.md 1장 4단계). 편집 책임자·관리자(seo.read / seo.write).
//  · GET ?month=YYYY-MM - 전환 점검(색인 관문)·신선도 검수 큐·핵심 질문 목록·월 표본과 인용률·최근 배치 실행
//  · POST op=freshness_resolve {id,resolution,note} - 신선도 검수 처리(기사 실질 수정일은 건드리지 않는다)
//  · POST op=questions_save {text,activate?} - 새 버전 질문 목록(정확히 50문항) / questions_activate {version}
//  · POST op=samples_init {month,version,engines} - 한 달 표본 만들기(50 x 엔진, 모두 미확인) / sample_set {id,cited,cited_url?,...} - 한 칸 입력
// 질문과 인용 여부는 사람이 확인해 입력한다 - 외부 AI 서비스를 부르는 코드는 없다. 모든 쓰기는 감사 로그.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "seo.read", "seo:overview");
  if (denied) return denied;
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  return json(await loadSeoOverview(serviceDb(), new Date(), { month }));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(SEO_OPS as readonly string[]).includes(op)) return invalid([`op: ${SEO_OPS.join("·")} 중 하나입니다`]);
  const denied = await authorize(viewer, "seo.write", `seo:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const audit = (action: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action, target, before, after, reason });
  const now = new Date().toISOString();

  if (op === "freshness_resolve") {
    const p = parseFreshnessResolve(body);
    if (!p.ok) return invalid(p.errors);
    const { data: cur, error: ce } = await db.from("freshness_review_queue").select("id, article_id, resolved_at").eq("id", p.value.id).maybeSingle();
    if (ce) throw dbError(ce, "freshness_review_queue 조회");
    if (!cur) return errorJson(404, "없는 검수 항목입니다");
    if (cur.resolved_at) return errorJson(409, "이미 처리한 항목입니다");
    const { data, error } = await db
      .from("freshness_review_queue")
      .update({ resolved_at: now, resolved_by: actor, resolution: p.value.resolution, note: p.value.note })
      .eq("id", p.value.id)
      .is("resolved_at", null)
      .select("id, article_id, resolution")
      .single();
    if (error) return fail(error, "freshness_review_queue 처리");
    await audit("freshness.resolve", `freshness_review_queue:${p.value.id}`, { resolved: false }, data, p.value.note);
    revalidatePublicData();
    return json({ item: data });
  }

  if (op === "questions_save") {
    const p = parseQuestionsSave(body);
    if (!p.ok) return invalid(p.errors);
    const { data: last, error: le } = await db.from("ai_question_sets").select("version").order("version", { ascending: false }).limit(1);
    if (le) throw dbError(le, "ai_question_sets 조회");
    const version = ((last?.[0] as { version: number } | undefined)?.version ?? 0) + 1;
    const { error: se } = await db.from("ai_question_sets").insert({ version, created_by: actor });
    if (se) return fail(se, "ai_question_sets 저장");
    const { error: qe } = await db.from("ai_core_questions").insert(p.value.questions.map((text, i) => ({ version, question_no: i + 1, text })));
    if (qe) {
      await db.from("ai_question_sets").delete().eq("version", version);
      return fail(qe, "ai_core_questions 저장");
    }
    if (p.value.activate) {
      const { error: ae } = await db.from("ai_question_sets").update({ activated_at: now }).eq("version", version);
      if (ae) return fail(ae, "ai_question_sets 활성화");
    }
    await audit("ai_questions.save", `ai_question_sets:${version}`, null, { version, count: p.value.questions.length, activated: p.value.activate }, "핵심 질문 목록 저장");
    return json({ version, activated: p.value.activate }, 201);
  }

  if (op === "questions_activate") {
    const p = parseQuestionsActivate(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.from("ai_question_sets").update({ activated_at: now }).eq("version", p.value.version).is("activated_at", null).select("version").maybeSingle();
    if (error) return fail(error, "ai_question_sets 활성화");
    if (!data) return errorJson(409, "없는 버전이거나 이미 활성화된 버전입니다");
    await audit("ai_questions.activate", `ai_question_sets:${p.value.version}`, { activated: false }, { activated: true }, "핵심 질문 목록 활성화");
    return json({ version: p.value.version });
  }

  if (op === "samples_init") {
    const p = parseSamplesInit(body);
    if (!p.ok) return invalid(p.errors);
    const { data, error } = await db.rpc("ai_citation_month_init", { p_month: `${p.value.month}-01`, p_version: p.value.version, p_engines: p.value.engines });
    if (error) return fail(error, "ai_citation_month_init");
    await audit("ai_samples.init", `ai_citation_samples:${p.value.month}`, null, { version: p.value.version, engines: p.value.engines, created: data }, "월 표본 만들기");
    return json({ created: data }, 201);
  }

  // sample_set
  const p = parseSampleInput(body);
  if (!p.ok) return invalid(p.errors);
  const checked = p.value.cited !== "unknown";
  const { data: cur, error: ce } = await db.from("ai_citation_samples").select("id, cited, cited_url").eq("id", p.value.id).maybeSingle();
  if (ce) throw dbError(ce, "ai_citation_samples 조회");
  if (!cur) return errorJson(404, "없는 표본입니다");
  const { data, error } = await db
    .from("ai_citation_samples")
    .update({
      cited: p.value.cited,
      cited_url: p.value.cited_url,
      expected_page: p.value.expected_page,
      note: p.value.note,
      checker_id: checked ? actor : null,
      checked_at: checked ? now : null,
    })
    .eq("id", p.value.id)
    .select("id, cited, cited_url")
    .single();
  if (error) return fail(error, "ai_citation_samples 저장");
  await audit("ai_samples.set", `ai_citation_samples:${p.value.id}`, cur, data, "AI 검색 인용 표본 입력");
  return json({ sample: data });
});
