// 한 턴의 흐름 — 순수 조립 (CHAT-03~07 · CHAT-10 · CHAT-11, PRD-01C 4.1 요청 흐름). 네트워크·DB는 주입받은 객체로만 쓴다.
//  마스킹 → (규칙으로 '하지 않음'이면 모델 0회로 고정 안내) → 예산 확인 → 라우터 → 서버가 먼저 검색 →
//  답변 모델(search_result 인용, 도구 상한) → 검증기 A1~A6 → 실패 시 재생성 1회 → 근거 목록('검색 결과만').
// 가드를 거치지 않고 모델을 부르는 길은 이 파일에 없다 — 모델 호출은 maskText 뒤 한 곳(callModel)뿐이다 (CHAT-08 모듈 경계).
import { type ContentBlock, type MessagesRequest, type MessagesResponse, type ModelClient, type TextBlock, type ToolDef, type ToolUseBlock } from "./anthropic";
import { budgetExceeded, emptyUsage, type FallbackReason, type Usage } from "./budget";
import {
  CARD_NOTICE,
  DECLINE_GUIDES,
  IMPERSONATION_REFUSAL,
  NO_RESULT_REASON,
  OPS_ROUTES,
  OUT_OF_SCOPE_REASON,
  declineByRule,
  fallbackIntent,
  isDecline,
  parseRouterOutput,
  resolveIntent,
  type DeclineIntent,
  type Intent,
} from "./intent";
import { maskText } from "./mask";
import { ANSWER_PROMPT, ROUTER_PROMPT, contextLine } from "./prompt";
import { normalizeUrl, verifyParagraphs, type AnswerParagraph, type StatusFact, type VerifyContext } from "./verify";
import type { AssistantConfig } from "./config";

/** 근거 자료 한 건 — 읽기 전용 도구가 공개 뷰에서 가져온 것 (url은 사이트 안 주소 또는 바깥 연결 주소) */
export interface SourceDoc {
  title: string;
  url: string;
  text: string;
}

/** 읽기 전용 도구 상자 (CHAT-03 · CHAT-11) — 쓰기 도구 0. 구현은 서버 어댑터(공개 뷰·anon 키) */
export interface Toolbox {
  searchSite(query: string, limit: number): Promise<SourceDoc[]>;
  getPage(path: string): Promise<SourceDoc | null>;
  getStatus(query: string): Promise<{ docs: SourceDoc[]; facts: StatusFact[]; vocabulary: string[] }>;
  getOfficialLinks(keys: readonly string[]): Promise<SourceDoc[]>;
  /** 열려 있는 사이트 안 주소만 남긴다 (기능 키 꺼짐·아직 없는 화면 제외) */
  openPaths(paths: readonly string[]): Promise<string[]>;
}

export interface PageContext {
  path: string;
  title?: string;
  field?: string;
}

export interface TurnInput {
  message: string;
  context?: PageContext;
}

export interface PipelineDeps {
  config: AssistantConfig;
  models: ModelClient;
  tools: Toolbox;
  /** 오늘(KST) 이미 쓴 토큰 */
  tokensToday: number;
  forbiddenPhrases: readonly string[];
  personNames: readonly string[];
}

export interface TurnResult {
  mode: "ai" | "search_only" | "fixed";
  fallbackReason: FallbackReason | null;
  intent: Intent;
  /** 검증을 통과한 문단과 그 출처 주소 */
  paragraphs: Array<{ text: string; sourceUrls: string[] }>;
  /** 출처 링크 (인용된 자료, 중복 제거) */
  sources: Array<{ title: string; href: string }>;
  /** 안내 링크 — 고정 안내·검색 결과만 응답의 갈 곳 */
  links: Array<{ label: string; href: string; external: boolean }>;
  /** 고정 안내 한 줄 사유 */
  reason: string | null;
  /** 전문가 버튼 (null이면 버튼 없음) — field는 /experts?field= 분야 코드, null이면 분야 없이 전체 (CHAT-17) */
  experts: { field: string | null } | null;
  summary: boolean;
  cardNotice: boolean;
  usage: Usage;
  toolCalls: Array<{ name: string; ok: boolean; results: number }>;
  failures: Array<{ code: string; paragraph: number }>;
  regenerated: boolean;
  answerCalls: number;
  questionMasked: string;
  answerMasked: string;
}

const isExternal = (url: string) => /^https?:\/\//iu.test(url);
const fresh = (intent: Intent, questionMasked: string, cardNotice: boolean): TurnResult => ({
  mode: "fixed",
  fallbackReason: null,
  intent,
  paragraphs: [],
  sources: [],
  links: [],
  reason: null,
  experts: null,
  summary: false,
  cardNotice,
  usage: emptyUsage(),
  toolCalls: [],
  failures: [],
  regenerated: false,
  answerCalls: 0,
  questionMasked,
  answerMasked: "",
});

const dedupeDocs = (docs: readonly SourceDoc[], limit: number): SourceDoc[] => {
  const seen = new Set<string>();
  const out: SourceDoc[] = [];
  for (const d of docs) {
    const key = normalizeUrl(d.url);
    if (seen.has(key) || d.url === "") continue;
    seen.add(key);
    out.push(d);
    if (out.length >= limit) break;
  }
  return out;
};

const toLinks = (docs: readonly SourceDoc[]) => docs.map((d) => ({ label: d.title, href: d.url, external: isExternal(d.url) }));

async function safely<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

// ── 모델 호출 (마스킹된 글만) ───────────────────────────────

const TOOL_DEFS: ToolDef[] = [
  { name: "search_site", description: "이 사이트의 발행된 글·해설·용어·트래커를 검색합니다 (읽기 전용)", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "get_page", description: "이 사이트 페이지의 공개 본문을 읽습니다 (읽기 전용)", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } },
  { name: "get_status", description: "개정 트래커·프로젝트의 현재 단계와 확인일을 조회합니다 (읽기 전용)", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
  { name: "get_official_link", description: "SM 계산기·위택스·국세청 등 바깥 연결 주소를 조회합니다 (읽기 전용)", input_schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: false } },
];

const searchResultBlock = (d: SourceDoc) => ({ type: "search_result", source: d.url, title: d.title, content: [{ type: "text", text: d.text || d.title }], citations: { enabled: true } });

const addUsage = (u: Usage, role: "answer" | "router", r: MessagesResponse) => {
  const usage = r.usage ?? {};
  if (role === "answer") {
    u.answerIn += usage.input_tokens ?? 0;
    u.answerOut += usage.output_tokens ?? 0;
  } else {
    u.routerIn += usage.input_tokens ?? 0;
    u.routerOut += usage.output_tokens ?? 0;
  }
  u.cached += (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
};

const isText = (b: ContentBlock): b is TextBlock => b.type === "text" && typeof (b as TextBlock).text === "string";
const isToolUse = (b: ContentBlock): b is ToolUseBlock => b.type === "tool_use";

/** 응답 블록 → 문단 (빈 줄로 나누고, 인용은 그 글 블록의 문단에 붙인다) */
export function paragraphsFromContent(content: readonly ContentBlock[]): AnswerParagraph[] {
  const paras: Array<{ text: string; urls: Set<string> }> = [{ text: "", urls: new Set() }];
  for (const b of content) {
    if (!isText(b)) continue;
    const urls = (b.citations ?? []).filter((c) => c.type === "search_result_location" && typeof c.source === "string").map((c) => c.source as string);
    b.text.split(/\n{2,}/u).forEach((part, i) => {
      if (i > 0) paras.push({ text: "", urls: new Set() });
      const cur = paras[paras.length - 1]!;
      cur.text += part;
      if (part.trim() !== "") urls.forEach((u) => cur.urls.add(u));
    });
  }
  return paras.filter((p) => p.text.trim() !== "").slice(0, 6).map((p) => ({ text: p.text.trim(), citedUrls: [...p.urls] }));
}

interface AnswerRun {
  paragraphs: AnswerParagraph[];
  docs: SourceDoc[];
  facts: StatusFact[];
  vocabulary: string[];
}

export async function runTurn(input: TurnInput, deps: PipelineDeps): Promise<TurnResult> {
  const { config, tools } = deps;
  const masked = maskText(input.message);
  const q = masked.text;
  const context = input.context;
  const base = (intent: Intent) => fresh(intent, q, masked.cardLike);

  // 1) 규칙이 막는 질문 — 모델 0회 (CHAT-05)
  const ruled = declineByRule(q);
  if (ruled) return declineResult(ruled, base(ruled), deps, q);

  // 2) 예산 — 넘으면 '검색 결과만', 모델 호출 0 (CHAT-10)
  if (budgetExceeded(deps.tokensToday, config.dailyTokenBudget)) {
    return searchOnly(base(fallbackIntent(q)), "budget", deps, q);
  }

  // 3) 라우터 (실패하면 보조 분류)
  const usage = emptyUsage();
  let routed: Intent | null = null;
  try {
    const r = await deps.models.create({ model: config.modelRouter, max_tokens: 60, system: ROUTER_PROMPT, messages: [{ role: "user", content: q }] });
    addUsage(usage, "router", r);
    routed = parseRouterOutput(r.content.filter(isText).map((b) => b.text).join(" "));
  } catch {
    routed = null;
  }
  const intent = resolveIntent(q, routed);
  if (isDecline(intent)) {
    const res = await declineResult(intent, base(intent), deps, q);
    res.usage = usage;
    return res;
  }
  if (intent === "out_of_scope") {
    const res = base(intent);
    res.usage = usage;
    res.reason = OUT_OF_SCOPE_REASON;
    res.links = toLinks(await safely(() => tools.searchSite(q, config.maxResults), []));
    return res;
  }

  // 4) 서버가 먼저 검색 — 자료 준비 (CHAT-03)
  const prepared = await prepare(intent, q, context, deps);
  if (prepared.docs.length === 0) {
    const res = base(intent);
    res.usage = usage;
    res.reason = NO_RESULT_REASON;
    res.links = [{ label: "사이트 검색", href: "/search", external: false }];
    return res;
  }

  // 5) 답변 모델 + 검증 (재생성 1회)
  let regenerated = false;
  let answerCalls = 0;
  const toolCalls: TurnResult["toolCalls"] = [];
  let last: { run: AnswerRun; verify: ReturnType<typeof verifyParagraphs> } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    // 재시도 1회 — 그래도 실패하면 '검색 결과만' (CHAT-10)
    const run =
      (await safely(() => callAnswer(q, context, intent, prepared, deps, usage, toolCalls, attempt === 1, () => answerCalls++), null)) ??
      (await safely(() => callAnswer(q, context, intent, prepared, deps, usage, toolCalls, attempt === 1, () => answerCalls++), null));
    if (!run) {
      const res = await searchOnly(base(intent), "error", deps, q, prepared.docs);
      return { ...res, usage, toolCalls, answerCalls };
    }
    const allowed = new Set(run.docs.map((d) => normalizeUrl(d.url)));
    const verify = verifyParagraphs(run.paragraphs, verifyContext(run, allowed, q, deps));
    last = { run, verify };
    if (verify.fallback === null && verify.paragraphs.length > 0) break;
    if (!verify.needsRegeneration) break;
    regenerated = true;
  }

  const { run, verify } = last!;
  const failures = verify.failures.map((f) => ({ code: f.code, paragraph: f.paragraph }));
  if (verify.fallback === "refusal") {
    const res = base(intent);
    return { ...res, usage, toolCalls, failures, regenerated, answerCalls, reason: IMPERSONATION_REFUSAL };
  }
  if (verify.fallback !== null || verify.paragraphs.length === 0) {
    const res = await searchOnly(base(intent), "verify", deps, q, run.docs);
    return { ...res, usage, toolCalls, failures, regenerated, answerCalls };
  }

  const titleOf = new Map(run.docs.map((d) => [normalizeUrl(d.url), d.title]));
  const sourceUrls = [...new Set(verify.paragraphs.flatMap((p) => p.citedUrls))].slice(0, 6);
  const res = base(intent);
  return {
    ...res,
    mode: "ai",
    paragraphs: verify.paragraphs.map((p) => ({ text: p.text, sourceUrls: p.citedUrls })),
    sources: sourceUrls.map((u) => ({ title: titleOf.get(normalizeUrl(u)) ?? u, href: u })),
    summary: intent === "summary",
    usage,
    toolCalls,
    failures,
    regenerated,
    answerCalls,
    answerMasked: verify.paragraphs.map((p) => p.text).join("\n\n"),
  };
}

function verifyContext(run: AnswerRun, allowed: Set<string>, question: string, deps: PipelineDeps): VerifyContext {
  return {
    allowedUrls: allowed,
    sourceTextByUrl: new Map(run.docs.map((d) => [normalizeUrl(d.url), `${d.title} ${d.text}`])),
    questionText: question,
    forbiddenPhrases: deps.forbiddenPhrases,
    personNames: deps.personNames,
    statusFacts: run.facts,
    stageVocabulary: run.vocabulary,
  };
}

async function declineResult(intent: DeclineIntent, res: TurnResult, deps: PipelineDeps, q: string): Promise<TurnResult> {
  const guide = DECLINE_GUIDES[intent];
  const [official, related] = await Promise.all([
    safely(() => deps.tools.getOfficialLinks(guide.linkKeys), []),
    guide.expertField === null ? Promise.resolve([] as SourceDoc[]) : safely(() => deps.tools.searchSite(q, 3), []),
  ]);
  res.mode = "fixed";
  res.reason = guide.reason;
  res.links = [...toLinks(official), ...guide.siteLinks.map((l) => ({ ...l, external: false })), ...toLinks(related)];
  res.experts = guide.expertField === null ? null : { field: guide.expertField };
  return res;
}

async function searchOnly(res: TurnResult, reason: FallbackReason, deps: PipelineDeps, q: string, docs?: readonly SourceDoc[]): Promise<TurnResult> {
  const found = docs && docs.length > 0 ? dedupeDocs(docs, deps.config.maxResults) : await safely(() => deps.tools.searchSite(q, deps.config.maxResults), []);
  res.mode = "search_only";
  res.fallbackReason = reason;
  res.links = toLinks(found);
  res.reason = found.length === 0 ? NO_RESULT_REASON : null;
  res.experts = { field: null };
  return res;
}

interface Prepared {
  docs: SourceDoc[];
  facts: StatusFact[];
  vocabulary: string[];
}

async function prepare(intent: Intent, q: string, context: PageContext | undefined, deps: PipelineDeps): Promise<Prepared> {
  const { tools, config } = deps;
  const docs: SourceDoc[] = [];
  let facts: StatusFact[] = [];
  let vocabulary: string[] = [];
  if (intent === "summary" && context?.path) {
    const page = await safely(() => tools.getPage(context.path), null);
    if (page) docs.push(page);
  }
  if (intent === "status") {
    const s = await safely(() => tools.getStatus(q), { docs: [], facts: [], vocabulary: [] });
    docs.push(...s.docs);
    facts = s.facts;
    vocabulary = s.vocabulary;
  }
  if (intent === "ops") {
    const wanted = OPS_ROUTES.filter((r) => r.test.test(q));
    const open = await safely(() => tools.openPaths(wanted.map((r) => r.href)), []);
    for (const r of wanted) if (open.includes(r.href)) docs.push({ title: r.label, url: r.href, text: `${r.label} 안내 페이지입니다.` });
  }
  docs.push(...(await safely(() => tools.searchSite(q, config.maxResults), [])));
  return { docs: dedupeDocs(docs, config.maxResults), facts, vocabulary };
}

async function runTool(name: string, input: unknown, deps: PipelineDeps, run: AnswerRun): Promise<SourceDoc[]> {
  const o = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).slice(0, 200) : "");
  switch (name) {
    case "search_site":
      return safely(() => deps.tools.searchSite(maskText(str("query")).text, deps.config.maxResults), []);
    case "get_page": {
      const page = await safely(() => deps.tools.getPage(str("path")), null);
      return page ? [page] : [];
    }
    case "get_status": {
      const s = await safely(() => deps.tools.getStatus(maskText(str("query")).text), { docs: [], facts: [], vocabulary: [] });
      run.facts.push(...s.facts);
      run.vocabulary.push(...s.vocabulary);
      return s.docs;
    }
    case "get_official_link":
      return safely(() => deps.tools.getOfficialLinks([str("key")]), []);
    default:
      return [];
  }
}

/** 답변 모델 호출 — search_result 블록 + 인용, 도구는 읽기 전용·상한 강제. 요청 본문에 웹 도구·구조화 출력 설정 0 (CHAT-03 · CHAT-04) */
async function callAnswer(
  q: string,
  context: PageContext | undefined,
  intent: Intent,
  prepared: Prepared,
  deps: PipelineDeps,
  usage: Usage,
  toolCalls: TurnResult["toolCalls"],
  retry: boolean,
  onCall: () => void,
): Promise<AnswerRun> {
  const { config } = deps;
  const run: AnswerRun = { paragraphs: [], docs: [...prepared.docs], facts: [...prepared.facts], vocabulary: [...prepared.vocabulary] };
  const note = retry ? "\n[재작성] 이전 답이 검증을 통과하지 못했습니다. 세액·금액·금지 표현 없이, 주어진 자료만 인용해 다시 쓰세요." : "";
  const question = `${contextLine(context)}[요청 종류: ${intent}]\n${q}${note}`;
  const messages: unknown[] = [{ role: "user", content: [...prepared.docs.map(searchResultBlock), { type: "text", text: question }] }];
  let remaining = config.maxToolCalls;
  let response: MessagesResponse | null = null;
  for (let turn = 0; turn <= config.maxToolCalls + 1; turn++) {
    const request: MessagesRequest = { model: config.modelAnswer, max_tokens: 1024, system: ANSWER_PROMPT, messages, ...(remaining > 0 ? { tools: TOOL_DEFS } : {}) };
    onCall();
    response = await deps.models.create(request);
    addUsage(usage, "answer", response);
    const uses = response.content.filter(isToolUse);
    if (uses.length === 0) break;
    const results: unknown[] = [];
    for (const use of uses) {
      if (remaining <= 0) {
        // 상한+1번째 — 서버가 막고 그때까지의 결과로 답하게 한다 (CHAT-11)
        results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: "도구 호출 상한에 도달했습니다. 지금까지의 자료로 답하세요." });
        continue;
      }
      remaining -= 1;
      const docs = dedupeDocs(await runTool(use.name, use.input, deps, run), config.maxResults);
      toolCalls.push({ name: use.name, ok: docs.length > 0, results: docs.length });
      run.docs.push(...docs);
      results.push({ type: "tool_result", tool_use_id: use.id, content: docs.length > 0 ? docs.map(searchResultBlock) : [{ type: "text", text: "결과가 없습니다." }] });
    }
    messages.push({ role: "assistant", content: response.content }, { role: "user", content: results });
  }
  run.paragraphs = response ? paragraphsFromContent(response.content) : [];
  return run;
}
