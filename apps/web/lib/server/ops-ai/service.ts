import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetLevel, costOf, createOpsModel, draftBriefItem, kstDate, parseBudget, suggestRulesetImpact, type OpsBudget, type OpsModel, type TokenUsage } from "@ltr/workflows/ops";
import { opsAiEnv } from "../env";
import { assembleDraft } from "../brief/issues";
import { ACTION_TRIGGER_WORDS } from "@ltr/editorial";
import { featureOn, readBriefPolicy, readSetting } from "../brief/policy";

// 운영 AI 작업 (W10-e - AIOPS-01·02·03·04). AI는 켜져 있을 때만 쓰고, 꺼진 상태(키·모델·예산 설정 없음, 기능 키 꺼짐, 예산 초과)에서도 감지·초안 틀·발행은 그대로 돈다.
//  · AI 결과는 review_items(kind ai_draft)에만 쓴다 - 공개 표에는 쓰지 않고, 승인 전 공개 0
//  · 실행마다 모델·토큰·비용을 detail._usage로 돌려주면 작업 경로가 agent_runs 비용 칸에 적는다
//  · 월 예산 80% 이상이면 검수 큐에 경보 항목(달마다 1건), 100% 이상이면 AI 호출 0

type Db = SupabaseClient;
const DRAFT_CORNER_KEYS: readonly string[] = ["laws", "amendments", "admrul", "interpretations", "tribunal"];
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

export interface OpsGate {
  run: boolean;
  reason?: "flag_off" | "no_key" | "no_budget" | "budget_exceeded";
  model?: OpsModel;
  budget?: OpsBudget;
}

/** 이번 달(한국) 지출을 합쳐 경보 항목을 만들고 수준을 돌려준다 */
export async function evaluateBudget(db: Db, now: Date, budget: OpsBudget): Promise<{ level: "ok" | "warn" | "exceeded"; spent: number }> {
  const r = await db.rpc("ops_ai_month_cost", { p_at: now.toISOString() });
  if (r.error) throw fail("ops_ai_month_cost", r.error);
  const row = ((r.data ?? []) as { cost_unit: string; total: number | string }[]).find((x) => x.cost_unit === budget.unit);
  const spent = row ? Number(row.total) : 0;
  const level = budgetLevel(spent, budget.limit, budget.warnRatio);
  const month = kstDate(now).slice(0, 7);
  for (const lv of level === "exceeded" ? (["warn", "exceeded"] as const) : level === "warn" ? (["warn"] as const) : []) {
    const ins = await db.from("review_items").insert({
      kind: "pipeline_failure", source_key: `ops_ai_budget:${month}:${lv}`, title: lv === "warn" ? `운영 AI 월 예산 ${Math.round(budget.warnRatio * 100)}% 도달 (${month})` : `운영 AI 월 예산 초과 (${month})`,
      payload: { month, level: lv, unit: budget.unit, limit: budget.limit, spent }, created_by: "job:ops-ai-budget",
    });
    if (ins.error && ins.error.code !== "23505") throw fail("review_items 경보", ins.error);
  }
  return { level, spent };
}

export async function opsGate(db: Db, now: Date): Promise<OpsGate> {
  if (!(await featureOn(db, "ai_ops"))) return { run: false, reason: "flag_off" };
  const env = opsAiEnv();
  const model = createOpsModel({ apiKey: env.apiKey, model: env.model, baseUrl: env.baseUrl });
  if (!model) return { run: false, reason: "no_key" };
  const budget = parseBudget(await readSetting(db, "ops_ai_budget"));
  if (!budget) return { run: false, reason: "no_budget" };
  const { level } = await evaluateBudget(db, now, budget);
  if (level === "exceeded") return { run: false, reason: "budget_exceeded" };
  return { run: true, model, budget };
}

export const usageOf = (gate: OpsGate, used: TokenUsage) => {
  const model = gate.model!.name;
  const cost = costOf(used, model, gate.budget!);
  return { model, inputTokens: used.inputTokens, outputTokens: used.outputTokens, ...(cost === null ? {} : { cost, costUnit: gate.budget!.unit }) };
};
export const sum = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

/** 예산 점검 작업 (하루 한 번) */
export async function checkOpsBudget(db: Db, now: Date): Promise<Record<string, unknown>> {
  const budget = parseBudget(await readSetting(db, "ops_ai_budget"));
  if (!budget) return { skipped: "no_budget" };
  const { level, spent } = await evaluateBudget(db, now, budget);
  return { level, spentRatioPercent: Math.round((spent / budget.limit) * 1000) / 10 };
}

/** O1 개정 감지 작업 - 후보를 검수 큐에 올린다(AI 없음). 켜져 있으면 공포·시행 단계 기록에 룰셋 영향 제안 초안을 같은 큐에 올린다 */
export async function detectAmendments(db: Db, now: Date): Promise<Record<string, unknown>> {
  if (!(await featureOn(db, "amendment_auto"))) return { skipped: "flag_off" };
  const d = await db.rpc("amendment_candidates_detect", { p_today: kstDate(now) });
  if (d.error) throw fail("amendment_candidates_detect", d.error);
  const row = ((d.data ?? []) as { created: number; existing: number }[])[0] ?? { created: 0, existing: 0 };
  const out: Record<string, unknown> = { candidatesCreated: row.created, candidatesExisting: row.existing };
  const gate = await opsGate(db, now);
  if (!gate.run) return { ...out, impact: { skipped: gate.reason } };

  // 최근 7일 안에 반영된 공포·시행 단계 기록 중 자동 감지 출처(조문 글자가 DB에 있는 것)만
  const events = await db.from("amendment_events").select("id, stage, review_item_id").in("stage", ["promulgated", "effective"]).eq("origin", "auto").gt("recorded_at", new Date(now.getTime() - 7 * 86_400_000).toISOString());
  if (events.error) throw fail("amendment_events 조회", events.error);
  let used: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let proposed = 0;
  let none = 0;
  for (const e of (events.data ?? []) as { id: number; stage: string; review_item_id: number }[]) {
    const key = `ruleset_impact:${e.id}`;
    const have = await db.from("review_items").select("id").eq("kind", "ai_draft").eq("source_key", key).limit(1);
    if (have.error) throw fail("review_items 조회", have.error);
    if (have.data?.length) continue;
    const item = await db.from("review_items").select("payload").eq("id", e.review_item_id).limit(1);
    const lawEventId = Number((item.data?.[0] as { payload?: { lawEventId?: number } } | undefined)?.payload?.lawEventId);
    const ev = await db.from("law_events").select("version_id").eq("id", lawEventId).limit(1);
    const versionId = (ev.data?.[0] as { version_id: number | null } | undefined)?.version_id;
    if (!versionId) continue;
    const arts = await db.from("law_articles").select("body").eq("version_id", versionId).order("article_no").limit(400);
    const text = ((arts.data ?? []) as { body: string }[]).map((a) => a.body).join("\n").slice(0, 12_000);
    const r = await suggestRulesetImpact(gate.model!, { stage: e.stage, articleText: text });
    if (r.status === "proposed") {
      used = sum(used, r.usage);
      proposed += 1;
      const ins = await db.from("review_items").insert({ kind: "ai_draft", source_key: key, title: "룰셋 영향 제안 (감수위원 확인용 초안)", payload: { amendmentEventId: e.id, stage: e.stage, proposals: r.proposals, dropped: r.dropped, model: gate.model!.name }, created_by: "job:amendment-detect" });
      if (ins.error && ins.error.code !== "23505") throw fail("review_items 저장", ins.error);
    } else if (r.status === "none") {
      used = sum(used, r.usage);
      none += 1;
    }
  }
  return { ...out, impact: { proposed, none }, _usage: usageOf(gate, used) };
}

/** O4 브리핑 편집 작업 (일 23:00) - 초안 호 틀은 AI 없이 만들고, AI가 켜져 있으면 개정 항목마다 쉬운 요약 초안을 검수 큐에 올린다 */
export async function draftBrief(db: Db, now: Date): Promise<Record<string, unknown>> {
  if (!(await featureOn(db, "brief_regular"))) return { skipped: "flag_off" };
  const issue = await assembleDraft(db, now, "job:brief-draft");
  const out: Record<string, unknown> = { issueId: issue.id, created: issue.created };
  if (issue.id < 0) return out;
  const gate = await opsGate(db, now);
  if (!gate.run) return { ...out, ai: { skipped: gate.reason } };
  const row = await db.from("brief_issues").select("issue_no, status, corners, source_excerpts").eq("id", issue.id).limit(1);
  const iss = row.data?.[0] as { issue_no: number; status: string; corners: { key: string; items: { id: string; text: string; sourceNo?: string; sourceDate?: string; sourceUrl?: string }[] }[]; source_excerpts: Record<string, string> } | undefined;
  if (!iss || iss.status !== "draft") return { ...out, ai: { skipped: "not_draft" } };
  let used: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let drafted = 0;
  let failedCount = 0;
  // 설정의 금지어(+ 행동 유도어)를 지시문에 넣는다 - 검사기 3번과 같은 목록
  const forbiddenWords = [...ACTION_TRIGGER_WORDS, ...(await readBriefPolicy(db)).forbiddenWords];
  // 원문이 있는 코너(개정·법령·행정규칙·해석·결정례)의 항목마다 쉬운 요약 초안을 올린다
  const draftItems = iss.corners.filter((c) => DRAFT_CORNER_KEYS.includes(c.key)).flatMap((c) => c.items);
  for (const it of draftItems) {
    const key = `brief:${iss.issue_no}:${it.id}`;
    const have = await db.from("review_items").select("id").eq("kind", "ai_draft").eq("source_key", key).limit(1);
    if (have.error) throw fail("review_items 조회", have.error);
    if (have.data?.length) continue;
    const r = await draftBriefItem(gate.model!, { itemId: it.id, facts: { title: it.text, sourceNo: it.sourceNo, sourceDate: it.sourceDate, sourceUrl: it.sourceUrl }, excerpt: iss.source_excerpts[it.id] ?? "", forbiddenWords });
    used = sum(used, r.usage);
    const payload = r.ok ? { issueId: issue.id, itemId: it.id, draft: r.draft, model: gate.model!.name } : { issueId: issue.id, itemId: it.id, failed: true, note: r.note, reason: r.reason };
    const ins = await db.from("review_items").insert({ kind: "ai_draft", source_key: key, title: r.ok ? `브리핑 ${iss.issue_no}호 쉬운 요약 초안` : `브리핑 ${iss.issue_no}호 요약 실패 - 검수자 작성`, payload, created_by: "job:brief-draft" });
    if (ins.error && ins.error.code !== "23505") throw fail("review_items 저장", ins.error);
    if (r.ok) drafted += 1;
    else failedCount += 1;
  }
  return { ...out, ai: { drafted, failed: failedCount }, _usage: usageOf(gate, used) };
}

/** 승인된 AI 초안만 초안 호에 넣는다(승인 전 공개 0) - 쉬운 요약·편집자 3줄 코너에 origin ai, 검수 완료로 추가하고 검수 항목을 처리 완료로 */
export async function applyAiDraft(db: Db, itemId: number, actor: string): Promise<{ added: number }> {
  const it = await db.from("review_items").select("id, kind, status, payload").eq("id", itemId).limit(1);
  const item = it.data?.[0] as { kind: string; status: string; payload: { issueId?: number; itemId?: string; failed?: boolean; draft?: { title: string; summary: string; implication: string; editorLines: string[] } } } | undefined;
  if (!item || item.kind !== "ai_draft" || !item.payload.draft || item.payload.failed) throw new Error("반영할 수 있는 AI 초안이 아닙니다");
  if (item.status !== "approved") throw new Error("승인된 초안만 호에 넣을 수 있습니다");
  const issue = await db.from("brief_issues").select("status, corners").eq("id", item.payload.issueId).limit(1);
  const row = issue.data?.[0] as { status: string; corners: { key: string; items: unknown[] }[] } | undefined;
  if (!row || row.status !== "draft") throw new Error("초안 상태의 호에만 넣을 수 있습니다");
  const d = item.payload.draft;
  const base = `ai-${itemId}`;
  const mk = (suffix: string, text: string) => ({ id: `${base}-${suffix}`, text, origin: "ai", reviewed: true });
  const corners = row.corners.map((c) => {
    if (c.key === "summary") return { ...c, items: [...c.items, mk("s", `${d.title} - ${d.summary} ${d.implication}`)] };
    if (c.key === "editor_notes") return { ...c, items: [...c.items, ...d.editorLines.map((l, i) => mk(`l${i}`, l))] };
    return c;
  });
  const upd = await db.from("brief_issues").update({ corners }).eq("id", item.payload.issueId);
  if (upd.error) throw fail("brief_issues 갱신", upd.error);
  const tr = await db.rpc("review_item_transition", { p_id: itemId, p_to: "published", p_actor: actor });
  if (tr.error) throw fail("review_item_transition", tr.error);
  return { added: 1 + d.editorLines.length };
}
