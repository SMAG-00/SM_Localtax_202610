// 지방세봇 한 턴의 흐름 - 순수 조립 (W12-b b5, PRD-04 6.1). 네트워크·DB는 주입받은 객체로만 쓴다.
//  마스킹·범위 → 역질문 → 검색 계획 → 검색 → 재순위 → (실시간 조회는 모델의 도구 호출) → 답변(인용) → 문단 검증 V1~V6 → 재생성 1회 → 근거 목록.
// 첫 이벤트(status)는 어떤 I/O보다 먼저 낸다(ASK-01 진행 상태 ≤ 1초). 가드 앞에서 모델을 부르는 길은 없다.
// 이 파일은 상속·증여 엔진을 불러오지 않고 국세 금액을 만들지 않는다(NT9).
import { benefitsEventData, calcEventData, calcToolText, determinationEventData, determinationToolText, summaryOfBenefits, summaryOfCalc, summaryOfDetermination, type AgentResultSummary, type CalcPort } from "./calc-run";
import { EMPTY_CALC_COPY, type CalcCopy } from "./calc-copy";
import { buildCalcToolDefs, isCalcToolName, parseCalcToolInput } from "./calc-tools";
import { ModelError, type ContentBlock, type MessagesResponse, type ModelClient, type ToolUseBlock } from "../assistant/anthropic";
import { maskText } from "../assistant/mask";
import type { AgentConfig } from "./ask-config";
import { costWon, emptyAgentUsage, modelCallAllowed, type AgentUsage, type AskLimits, type AskPricing, type BudgetState, type LivePolicy, type ScopeFlags, type Tier } from "./ask-limits";
import { planClarify, searchPlan, type ClarifyState, type RequirementDictionary } from "./clarify";
import { paragraphsFromContent, renderChip, selectContext, type Chip, type EvidenceDoc } from "./evidence";
import { SCOPE_RESPONSES, type FixedCopy, type LinkSpec } from "./fixed-copy";
import { AGENT_ANSWER_PROMPT, variableBlockText } from "./instructions";
import type { LiveFetcher } from "./live";
import { buildAnswerRequest, regenerationNote } from "./model-request";
import { diversifyTop } from "./rrf";
import { guardScope, type MeasureEvent, type ScopeTag } from "./scope";
import type { AgentEvent } from "./sse";
import { buildToolDefs, parseToolInput, type ActionSpec, type AgentToolbox } from "./tools";
import { validateParagraphs, type ValidationResult, type VFailure } from "./validators";

export interface AgentDeps {
  config: AgentConfig;
  limits: AskLimits;
  live: LivePolicy;
  officialSearch: boolean;
  models: ModelClient;
  tools: AgentToolbox;
  /** null이면 실시간 조회 꺼짐 (서버 연결 전·OC 등록 요건 미확인) */
  liveFetcher: LiveFetcher | null;
  scopeFlags: ScopeFlags;
  copy: FixedCopy;
  dictionary: RequirementDictionary;
  tier: Tier;
  /** 이번 달 쓴 돈 대비 상태 (서버가 agent_runtime에서 읽음) */
  budget: BudgetState;
  pricing: AskPricing | null;
  today: string;
  forbidden: readonly string[];
  personNames: readonly string[];
  maxOutputTokens: number;
  /** W12-c 확장 자리 - 계산·감면·판정 이벤트를 만든다 (이 단위에서는 없음) */
  /** W12-c - 계산·감면·판정 포트 (없으면 계산·판정 도구 정의 0) */
  calc?: CalcPort;
  calcCopy?: CalcCopy;
  extras?: (ctx: { docs: readonly EvidenceDoc[]; masked: string }) => Promise<AgentEvent[]>;
}

export interface AgentInput {
  message: string;
  mode: "general" | "expert";
  /** 이 세션에서 지금까지 한 턴 수 (서버 값) */
  turn: number;
  clarify: ClarifyState;
}

export interface ToolCallRecord {
  name: string;
  ok: boolean;
  latencyMs: number;
  inputSummary: string;
  targetType: string | null;
  snapshotId: number | null;
}
export interface AgentTurnRecord {
  questionMasked: string;
  kind: "answer" | "clarify" | "fallback" | "error";
  answerMasked: string | null;
  fallbackReason: string | null;
  scope: ScopeTag;
  validation: "passed" | "regenerated" | "fallback" | null;
  failures: VFailure[];
  passes: Record<string, boolean>;
  regenerated: boolean;
  citations: Array<{ sourceId: string; sourceType: string; isLive: boolean; snapshotId: number | null; chunkId: number | null }>;
  toolCalls: ToolCallRecord[];
  usage: AgentUsage;
  costWon: number;
  modelCalls: number;
  clarifyRound: number;
  measure: MeasureEvent[];
  /** W12-c - 계산·감면·판정 결과 요약 (입력값 없음) */
  results: AgentResultSummary[];
}

type FallbackKind = "evidence_list" | "scope_guide";
type FallbackReason = "no_evidence" | "outage" | "budget" | "verification_failed" | "scope";
const FALLBACK_MEASURE: Record<Exclude<FallbackReason, "scope">, "insufficient_evidence" | "outage" | "budget"> = {
  no_evidence: "insufficient_evidence",
  verification_failed: "insufficient_evidence",
  outage: "outage",
  budget: "budget",
};
const COPY_FOR: Record<Exclude<FallbackReason, "scope">, "no_evidence" | "outage" | "budget" | "verification_failed"> = { no_evidence: "no_evidence", outage: "outage", budget: "budget", verification_failed: "verification_failed" };
/** 근거 목록 응답에 싣는 검색 결과 수 (PRD-04 6.6 "상위 5건") */
const EVIDENCE_LIST_SIZE = 5;
/** 근거 목록·범위 안내에 붙는 사람 연결 두 버튼 (CHAT-17) */
const PEOPLE_BUTTONS = { find: true, request: true } as const;

const keyOf = (d: EvidenceDoc) => (d.chunkId !== null ? `c${d.chunkId}` : `${d.sourceId}|${d.path}`);
const isToolUse = (b: ContentBlock): b is ToolUseBlock => b.type === "tool_use";

function addUsage(u: AgentUsage, role: "answer" | "utility", r: MessagesResponse): void {
  const x = r.usage ?? {};
  if (role === "answer") {
    u.answerIn += x.input_tokens ?? 0;
    u.answerOut += x.output_tokens ?? 0;
    u.answerCached += (x.cache_read_input_tokens ?? 0) + (x.cache_creation_input_tokens ?? 0);
  } else {
    u.utilityIn += x.input_tokens ?? 0;
    u.utilityOut += x.output_tokens ?? 0;
  }
}

function emptyRecord(): AgentTurnRecord {
  return {
    questionMasked: "", kind: "answer", answerMasked: null, fallbackReason: null, scope: "base", validation: null, failures: [], passes: {}, regenerated: false,
    citations: [], toolCalls: [], usage: emptyAgentUsage(), costWon: 0, modelCalls: 0, clarifyRound: 0, measure: [], results: [],
  };
}

export async function* runAgentTurn(input: AgentInput, deps: AgentDeps): AsyncGenerator<AgentEvent, AgentTurnRecord> {
  const rec = emptyRecord();
  // ① 첫 이벤트 - 어떤 I/O도 하기 전에
  yield { event: "status", data: { phase: "searching" } };

  const g = guardScope(input.message, deps.today, deps.scopeFlags);
  rec.questionMasked = g.masked || "(빈 질문)";
  rec.scope = g.scopeTag;

  const fallback = function* (reason: FallbackReason, kind: FallbackKind, results: readonly EvidenceDoc[], spec?: { copyKey: keyof FixedCopy; links: readonly LinkSpec[]; expertField: string | null }, extraData?: Record<string, unknown>): Generator<AgentEvent> {
    rec.kind = "fallback";
    rec.fallbackReason = reason;
    rec.validation = "fallback";
    const line = spec ? deps.copy[spec.copyKey] : deps.copy[COPY_FOR[reason as Exclude<FallbackReason, "scope">]];
    if (reason !== "scope") rec.measure.push({ name: "ask_fallback_shown", props: { reason: FALLBACK_MEASURE[reason as Exclude<FallbackReason, "scope">] } });
    yield {
      event: "fallback",
      data: {
        reason,
        kind,
        line,
        links: spec?.links ?? [],
        expertField: spec?.expertField ?? "local-tax",
        peopleButtons: PEOPLE_BUTTONS,
        results: kind === "evidence_list" ? results.slice(0, EVIDENCE_LIST_SIZE).map((d) => ({ sourceId: d.sourceId, path: d.path, chip: renderChip(d) })) : [],
        ...(extraData ?? {}),
        measurement: reason === "scope" ? null : { name: "ask_fallback_shown", props: { reason: FALLBACK_MEASURE[reason as Exclude<FallbackReason, "scope">] } },
      },
    };
  };
  const finishCost = () => {
    rec.costWon = costWon(rec.usage, deps.pricing);
  };
  const doneEvent = (extra: Record<string, unknown> = {}): AgentEvent => ({
    event: "done",
    data: {
      validation: rec.validation,
      asOf: g.asOf.date,
      asOfApprox: g.asOf.approx,
      highRisk: g.flags.highRisk,
      scope: g.scopeTag,
      rulesetVersion: rec.results.find((r) => r.ruleset_version !== null)?.ruleset_version ?? null,
      citationCount: rec.citations.length,
      liveCitationCount: rec.citations.filter((c) => c.isLive).length,
      costWon: rec.costWon,
      ...extra,
    },
  });

  // ② 범위 판단 - 막힌 것은 모델 0회, 범위 안내 응답(한 줄 + 링크 + 하단)
  if (g.block) {
    const spec = SCOPE_RESPONSES[g.block.reason];
    if (g.block.event) rec.measure.push(g.block.event);
    const igt = g.block.reason === "inherit_gift_amount" && deps.calc ? { amount: 0, cards: deps.calc.igtCards(g.masked), cardNote: (deps.calcCopy ?? EMPTY_CALC_COPY).igt_card_note } : undefined;
    for (const e of fallback("scope", "scope_guide", [], { ...spec, copyKey: g.block.copyKey }, igt)) yield e;
    yield doneEvent();
    return rec;
  }

  // 세션 턴 상한
  if (input.turn >= deps.limits.sessionTurns) {
    rec.kind = "error";
    rec.fallbackReason = "turn_limit";
    yield { event: "error", data: { code: "turn_limit", retryable: false } };
    return rec;
  }

  // ③ 역질문 - 상한은 설정, 3라운드째·한 라운드 4개 이상은 구조적으로 나오지 않는다
  const plan = planClarify(g.masked, deps.dictionary, input.clarify, deps.limits);
  if (plan.kind === "ask") {
    rec.kind = "clarify";
    rec.clarifyRound = plan.round;
    yield { event: "clarify", data: { round: plan.round, topic: plan.topicId, questions: plan.questions } };
    yield doneEvent({ clarify: true });
    return rec;
  }
  const assumptions = [...plan.unsure.map((u) => `모르겠다고 답함: ${u.question}`), ...plan.missing.map((m) => `요건 확인 필요: ${m.question}`)];

  // ④⑤ 검색 계획 → 검색 → 재순위
  const queries = searchPlan(g.masked, deps.dictionary, input.clarify.answers);
  let merged: EvidenceDoc[] = [];
  try {
    const lists = await Promise.all(queries.map((q) => deps.tools.search({ query: q, asOf: g.asOf.date, limit: 40 })));
    const byKey = new Map<string, EvidenceDoc>();
    for (const d of lists.flat()) {
      const old = byKey.get(keyOf(d));
      if (!old || d.score > old.score) byKey.set(keyOf(d), d);
    }
    merged = [...byKey.values()].sort((a, b) => b.score - a.score);
  } catch {
    // 검색 DB 장애 - 일시 중단 안내 (계산기·정적 페이지는 정상)
    rec.kind = "error";
    rec.fallbackReason = "search_down";
    yield { event: "error", data: { code: "search_down", retryable: true } };
    return rec;
  }
  const ranked = diversifyTop(merged.map((d, i) => ({ id: i, docKey: d.sourceId })), { topK: deps.limits.contextChunks, perDoc: 3, fromTop: 40 }).map((c) => merged[c.id]!);
  let docs = selectContext(ranked, deps.limits);
  yield { event: "status", data: { phase: "evidence", count: docs.length } };

  // 예산·키 - 모델 호출 0이면 검색 모드
  const modelOk = modelCallAllowed(deps.budget, deps.tier);
  if (!modelOk) {
    for (const e of fallback("budget", "evidence_list", docs)) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }
  const strong = docs.length >= deps.limits.evidenceMinDocs && docs.length > 0 && docs.some((d) => d.score >= deps.limits.evidenceMinScore);
  const liveAvailable = deps.liveFetcher !== null && deps.live.maxCalls > 0;
  if (!strong && !liveAvailable) {
    for (const e of fallback("no_evidence", "evidence_list", docs)) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }

  // ⑧ 답변 생성 (도구 호출 왕복 포함)
  yield { event: "status", data: { phase: "writing" } };
  const calcAvail = deps.calc?.availability();
  const toolDefs = [
    ...buildToolDefs({ liveAvailable, officialSearchEnabled: deps.officialSearch && !!deps.tools.webSearchOfficial }),
    ...(calcAvail ? buildCalcToolDefs({ calculatorOpen: calcAvail.calculator, determinationTypes: calcAvail.determinationTypes }) : []),
  ];
  const calcEvents: AgentEvent[] = [];
  const cc = deps.calcCopy ?? EMPTY_CALC_COPY;
  let resultSeq = 0;
  const openScopes = (Object.keys(deps.scopeFlags) as Array<keyof ScopeFlags>).filter((k) => deps.scopeFlags[k]);
  const varText = variableBlockText({
    asOf: g.asOf.date, asOfApprox: g.asOf.approx, mode: input.mode, tier: deps.tier, openScopes, tourismMixed: g.flags.tourismMixed, assumptions, impersonationRequested: g.flags.impersonation,
  });
  const effort = input.mode === "expert" ? deps.config.effortExpert : deps.config.effortGeneral;
  const baseDocs = docs;
  let model = deps.config.modelAnswer;
  const extra: unknown[] = [];

  const call = async (): Promise<MessagesResponse> => {
    const req = () => buildAnswerRequest({ model, effort, system: AGENT_ANSWER_PROMPT, tools: toolDefs, variableText: varText, question: g.masked, docs: baseDocs, extraMessages: extra, maxTokens: deps.maxOutputTokens });
    for (let attempt = 0; ; attempt++) {
      try {
        rec.modelCalls += 1;
        const r = await deps.models.create(req());
        addUsage(rec.usage, model === deps.config.modelAnswer ? "answer" : "utility", r);
        return r;
      } catch (err) {
        if (err instanceof ModelError && err.kind === "refusal") {
          // 서버 측 폴백 - 보조 모델로 1회, 없으면 던진다
          if (deps.config.modelUtility && model !== deps.config.modelUtility) {
            model = deps.config.modelUtility;
            continue;
          }
          throw err;
        }
        if (attempt >= 1) throw err; // 재시도 1회 뒤 포기
      }
    }
  };

  const yield_status: AgentEvent[] = [];
  const runTool = async (tu: ToolUseBlock): Promise<{ text: string; newDocs: EvidenceDoc[] }> => {
    const started = Date.now();
    const parsed = isCalcToolName(tu.name) ? null : parseToolInput(tu.name, tu.input);
    const record = (ok: boolean, summary: string, targetType: string | null = null, snapshotId: number | null = null) =>
      rec.toolCalls.push({ name: tu.name, ok, latencyMs: Date.now() - started, inputSummary: maskText(summary).text.slice(0, 120), targetType, snapshotId });
    if (isCalcToolName(tu.name)) {
      // 입력은 이 블록 안에서만 쓰고 기록에는 도구 이름만 남긴다 (입력 구조체 저장 0)
      const cp = deps.calc ? parseCalcToolInput(tu.name, tu.input) : null;
      if (!cp || !deps.calc) {
        record(false, "입력 모양 오류");
        return { text: "도구 입력이 올바르지 않습니다", newDocs: [] };
      }
      if (cp.name === "run_calculator") {
        const run = deps.calc.run(cp, g.asOf.date);
        calcEvents.push({ event: "calc", data: calcEventData(run.outcome, `r${++resultSeq}`, { calc: cc.calc_notice, unsupported: cc.unsupported_note }) });
        rec.results.push(summaryOfCalc(run.outcome));
        if (run.outcome.status === "calculated") {
          // 감면 점검 - 계산 답변마다 서버가 자동으로 돌린다 (모델이 빠뜨릴 수 없다)
          const bStarted = Date.now();
          const b = deps.calc.benefits(run);
          rec.results.push(summaryOfBenefits(b));
          const bd = benefitsEventData(b, `r${++resultSeq}`, cc.benefits_notice);
          if (bd) calcEvents.push({ event: "benefits", data: bd });
          rec.toolCalls.push({ name: "check_benefits", ok: true, latencyMs: Date.now() - bStarted, inputSummary: "", targetType: null, snapshotId: null });
        }
        record(run.outcome.status !== "unsupported", "run_calculator");
        return { text: calcToolText(run.outcome), newDocs: [] };
      }
      const d = deps.calc.determine(cp);
      rec.results.push(summaryOfDetermination(d));
      if (d.status !== "unavailable") calcEvents.push({ event: "determination", data: determinationEventData(d, `r${++resultSeq}`, cc.determination_notice) });
      record(d.status !== "unavailable", "run_determination");
      return { text: determinationToolText(d), newDocs: [] };
    }
    if (!parsed) {
      record(false, "입력 모양 오류");
      return { text: "도구 입력이 올바르지 않습니다", newDocs: [] };
    }
    try {
      switch (parsed.name) {
        case "search_corpus": {
          const r = await deps.tools.search({ query: maskText(parsed.query).text, asOf: g.asOf.date, limit: 8, ...(parsed.docType ? { docType: parsed.docType } : {}) });
          record(true, parsed.query);
          return { text: `문서 ${r.length}건을 추가했습니다`, newDocs: r };
        }
        case "get_law_article": {
          const d = await deps.tools.getLawArticle({ ref: maskText(parsed.ref).text, asOf: g.asOf.date });
          record(d !== null, parsed.ref);
          return d ? { text: "조문 1건을 추가했습니다", newDocs: [d] } : { text: "찾지 못했습니다", newDocs: [] };
        }
        case "get_source": {
          const d = await deps.tools.getSource({ sourceId: parsed.sourceId, asOf: g.asOf.date });
          record(d !== null, parsed.sourceId);
          return d ? { text: "원문 1건을 추가했습니다", newDocs: [d] } : { text: "찾지 못했습니다", newDocs: [] };
        }
        case "lookup_glossary": {
          const r = await deps.tools.lookupGlossary({ term: maskText(parsed.term).text });
          record(true, parsed.term);
          return { text: `용어 ${r.length}건을 추가했습니다`, newDocs: r };
        }
        case "fetch_official_source": {
          if (!deps.liveFetcher) {
            record(false, parsed.query, parsed.targetType);
            return { text: "실시간 조회를 쓸 수 없습니다", newDocs: [] };
          }
          yield_status.push({ event: "status", data: { phase: "fetching" } });
          const r = await deps.liveFetcher.fetchOfficial({ targetType: parsed.targetType, query: maskText(parsed.query).text, asOf: g.asOf.date });
          record(r.ok, parsed.query, parsed.targetType, r.ok ? r.snapshotId : null);
          return r.ok ? { text: "공식 원문 1건을 추가했습니다 (미검수)", newDocs: [r.doc] } : { text: `조회하지 못했습니다 (${r.reason})`, newDocs: [] };
        }
        case "web_search_official": {
          if (!deps.officialSearch || !deps.tools.webSearchOfficial) {
            record(false, parsed.query);
            return { text: "사용할 수 없는 도구입니다", newDocs: [] };
          }
          const r = await deps.tools.webSearchOfficial({ query: maskText(parsed.query).text });
          const ok = r.filter((d) => d.isLive && d.snapshotId !== null && d.snapshotOk);
          record(true, parsed.query);
          return { text: `공식 검색 ${ok.length}건을 추가했습니다 (미검수)`, newDocs: ok };
        }
        case "suggest_actions": {
          record(true, parsed.taxItems.join(","));
          return { text: "다음 행동은 시스템이 화면에 붙입니다", newDocs: [] };
        }
      }
    } catch {
      record(false, tu.name);
      return { text: "도구 오류", newDocs: [] };
    }
  };


  let resp: MessagesResponse;
  try {
    resp = await call();
    const maxRounds = deps.live.maxCalls + 3;
    for (let round = 0; round < maxRounds; round++) {
      const uses = resp.content.filter(isToolUse);
      if (uses.length === 0) break;
      const results: unknown[] = [];
      const added: EvidenceDoc[] = [];
      for (const tu of uses) {
        const r = await runTool(tu);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.text });
        for (const d of r.newDocs) if (!docs.some((x) => keyOf(x) === keyOf(d)) && !added.some((x) => keyOf(x) === keyOf(d))) added.push(d);
      }
      while (yield_status.length > 0) yield yield_status.shift()!;
      docs = [...docs, ...added];
      extra.push({ role: "assistant", content: resp.content });
      // 새 문서는 같은 사용자 메시지의 문서 블록으로 붙인다 (인용은 문서 블록에서만 된다)
      extra.push({ role: "user", content: [...results, ...buildAddedBlocks(added)] });
      resp = await call();
    }
  } catch {
    for (const e of fallback("outage", "evidence_list", docs)) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }
  if (docs.length === 0) {
    for (const e of fallback("no_evidence", "evidence_list", ranked)) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }

  // ⑨ 검증 V1~V6 → 재생성 1회 → 근거 목록
  yield { event: "status", data: { phase: "verifying", count: docs.length } };
  const vctx = { asOf: g.asOf.date, questionText: g.masked, forbiddenPhrases: deps.forbidden, personNames: deps.personNames };
  let v: ValidationResult = validateParagraphs(paragraphsFromContent(resp.content, docs), vctx);
  rec.failures.push(...v.failures);
  if (v.needsRegeneration) {
    rec.regenerated = true;
    extra.push({ role: "assistant", content: resp.content.filter((b) => b.type === "text") });
    extra.push({ role: "user", content: regenerationNote(v.failures.map((f) => f.code)) });
    try {
      resp = await call();
      v = validateParagraphs(paragraphsFromContent(resp.content, docs), vctx);
      rec.failures.push(...v.failures);
    } catch {
      for (const e of fallback("outage", "evidence_list", docs)) yield e;
      finishCost();
      yield doneEvent();
      return rec;
    }
  }
  rec.passes = v.passes;

  if (v.fallback === "national_guide") {
    const reason = v.national === "transfer" ? "transfer_amount" : "inherit_gift_amount";
    const spec = SCOPE_RESPONSES[reason];
    rec.measure.push({ name: "ask_scope_redirected", props: { reason: "national_tax_calculator" } });
    for (const e of fallback("scope", "scope_guide", [], { ...spec, copyKey: reason })) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }
  if (v.paragraphs.length === 0) {
    for (const e of fallback("verification_failed", "evidence_list", docs)) yield e;
    finishCost();
    yield doneEvent();
    return rec;
  }

  // ⑩ 렌더 - 통과한 문단만, 칩은 DB 메타에서
  rec.validation = rec.regenerated ? "regenerated" : "passed";
  rec.kind = "answer";
  const seen = new Set<string>();
  for (const p of v.paragraphs) {
    for (const d of p.cited) {
      if (seen.has(keyOf(d))) continue;
      seen.add(keyOf(d));
      rec.citations.push({ sourceId: d.sourceId, sourceType: d.sourceType, isLive: d.isLive, snapshotId: d.snapshotId, chunkId: d.chunkId });
    }
  }
  rec.answerMasked = v.paragraphs.map((p) => p.text).join("\n\n");
  for (const [index, p] of v.paragraphs.entries()) {
    const chips: Chip[] = p.cited.map(renderChip);
    yield { event: "paragraph", data: { index, text: p.text, citations: chips } };
  }
  for (const e of calcEvents) yield e;
  if (deps.extras) for (const e of await deps.extras({ docs, masked: g.masked }).catch(() => [])) yield e;
  let actions: ActionSpec[] = [];
  try {
    actions = await deps.tools.suggestActions({ taxItems: [...new Set(docs.flatMap((d) => d.taxItems))].slice(0, 10) });
  } catch {
    actions = [];
  }
  finishCost();
  yield doneEvent({ actions, assumptions, assumptionNote: assumptions.length > 0 ? deps.copy.assumption_note : "", highRiskBanner: g.flags.highRisk ? deps.copy.high_risk_banner : "", footer: deps.copy.ai_footer, mode: input.mode });
  return rec;
}

function buildAddedBlocks(added: readonly EvidenceDoc[]): unknown[] {
  return added.map((d) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: d.content },
    title: d.sourceId,
    context: `${d.path} | ${d.validFrom}${d.validTo ? `~${d.validTo}` : ""}${d.isLive ? " | 실시간 미검수" : ""}`,
    citations: { enabled: true },
  }));
}

