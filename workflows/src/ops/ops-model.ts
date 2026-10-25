// 운영 AI (W10-e - O4 브리핑 편집 AIOPS-02 · O1 룰셋 영향 제안 AIOPS-03). AI SDK 없이 HTTP로 호출한다(새 패키지 0) - AI 호출은 workflows 안에서만 (AIOPS-05).
// 키가 없으면 createOpsModel이 null이라 호출 0이고, 모델은 주입 가능한 인터페이스라서 시험은 가짜 모델로 돈다.
// 이 파일은 DB를 열지 않는다. 결과(초안)는 호출한 쪽이 review_items(ai_draft)에만 쓴다.
import { unsupportedTokens } from "./brief-checkers.ts";
import { buildBriefSystemPrompt } from "./brief-prompt.ts";
import { canSuggestRulesetImpact } from "./stage.ts";
import type { TokenUsage } from "./budget.ts";

export interface OpsCompletion {
  text: string;
  usage: TokenUsage;
}

export interface OpsModel {
  readonly name: string;
  complete(system: string, user: string): Promise<OpsCompletion>;
}

export interface OpsModelConfig {
  apiKey: string | undefined;
  model: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch;
  maxTokens?: number;
}

/** 키·모델 이름 중 하나라도 없으면 null (운영 AI 호출 0) */
export function createOpsModel(cfg: OpsModelConfig): OpsModel | null {
  if (!cfg.apiKey || !cfg.model) return null;
  const base = (cfg.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  const doFetch = cfg.fetchImpl ?? fetch;
  const model = cfg.model;
  const apiKey = cfg.apiKey;
  return {
    name: model,
    async complete(system, user) {
      const res = await doFetch(`${base}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: cfg.maxTokens ?? 1500, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`운영 AI 응답 오류 ${res.status}`);
      const body = (await res.json()) as { content?: { type?: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      return { text, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 } };
    },
  };
}

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });
const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

// ── O4 브리핑 편집 ──────────────────────────────────────────

export const FALLBACK_NOTE = "요약 실패 — 검수자 작성";

export interface BriefDraftInput {
  itemId: string;
  /** 코드가 원문에서 넣은 사실 값 - 번호·일자·주소는 AI가 만들지 않는다 */
  facts: { title: string; stageLabel?: string; sourceNo?: string; sourceDate?: string; sourceUrl?: string };
  excerpt: string;
  /** 설정의 금지어 목록 - 지시문에 "금지 표현"으로 들어간다 */
  forbiddenWords?: readonly string[];
}

export interface BriefDraft {
  title: string;
  summary: string;
  implication: string;
  editorLines: [string, string, string];
}

export type BriefDraftResult =
  | { ok: true; draft: BriefDraft; usage: TokenUsage; attempts: number }
  | { ok: false; reason: "format" | "api_error"; note: typeof FALLBACK_NOTE; usage: TokenUsage; attempts: number };

const LIMITS = { title: 60, summary: 200, implication: 200, line: 100 } as const;

/** 형식 검사 - 문제 목록 (비어 있으면 통과). 원문에 없는 번호·일자·주소가 있어도 형식 위반으로 본다 */
export function validateBriefDraft(value: unknown, ground: string): { draft: BriefDraft | null; problems: string[] } {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return { draft: null, problems: ["JSON 객체가 아닙니다"] };
  const o = value as Record<string, unknown>;
  const str = (k: string, max: number): string => {
    const v = typeof o[k] === "string" ? (o[k] as string).trim() : "";
    if (v === "") problems.push(`${k}가 비어 있습니다`);
    else if (v.length > max) problems.push(`${k}가 ${max}자를 넘습니다`);
    return v;
  };
  const title = str("title", LIMITS.title);
  const summary = str("summary", LIMITS.summary);
  const implication = str("implication", LIMITS.implication);
  const lines = Array.isArray(o.editorLines) ? (o.editorLines as unknown[]) : [];
  if (lines.length !== 3 || !lines.every((l) => typeof l === "string" && l.trim() !== "" && l.trim().length <= LIMITS.line)) problems.push(`editorLines는 ${LIMITS.line}자 이내 문장 3개여야 합니다`);
  for (const text of [title, summary, implication, ...lines.filter((l): l is string => typeof l === "string")]) {
    for (const m of unsupportedTokens(text, ground)) problems.push(m);
  }
  if (problems.length) return { draft: null, problems };
  return { draft: { title, summary, implication, editorLines: lines.map((l) => (l as string).trim()) as [string, string, string] }, problems };
}

/** 형식을 어기면 1회 재시도, 다시 실패하면 "요약 실패 — 검수자 작성" (AIOPS-02). 모델이 던지면 api_error(재시도 없음 - 다음 실행이 다시 시도) */
export async function draftBriefItem(model: OpsModel, input: BriefDraftInput): Promise<BriefDraftResult> {
  const ground = [input.excerpt, input.facts.sourceNo ?? "", input.facts.sourceDate ?? "", input.facts.sourceUrl ?? ""].join("\n");
  const user = `사실 값: ${JSON.stringify(input.facts)}\n원문 발췌:\n${input.excerpt.slice(0, 6000)}`;
  const system = buildBriefSystemPrompt(input.forbiddenWords ?? []);
  let usage = ZERO;
  let hint = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let done;
    try {
      done = await model.complete(system, user + hint);
    } catch {
      return { ok: false, reason: "api_error", note: FALLBACK_NOTE, usage, attempts: attempt };
    }
    usage = addUsage(usage, done.usage);
    const v = validateBriefDraft(parseJson(done.text), ground);
    if (v.draft) return { ok: true, draft: v.draft, usage, attempts: attempt };
    hint = `\n\n이전 답이 형식을 어겼습니다: ${v.problems.slice(0, 5).join("; ")}. 형식을 지켜 JSON만 다시 답하세요.`;
  }
  return { ok: false, reason: "format", note: FALLBACK_NOTE, usage, attempts: 2 };
}

// ── O1 룰셋 영향 제안 (P1) ─────────────────────────────────

export const IMPACT_TARGETS = ["ruleset", "determination_table", "tax_calendar"] as const;
export type ImpactTarget = (typeof IMPACT_TARGETS)[number];

export interface ImpactProposal {
  target: ImpactTarget;
  summary: string;
  /** 새 조문 글자에서 그대로 옮긴 인용 - 코드가 조문에 있는지 검증한다 */
  quote: string;
}

export interface ImpactInput {
  stage: string;
  /** 새 개정판 조문 글자 (수집기가 API에서 옮긴 값) */
  articleText: string;
}

export type ImpactResult =
  | { status: "skipped"; reason: "not_confirmed_stage" | "no_text" }
  | { status: "none"; usage: TokenUsage; dropped: number }
  | { status: "proposed"; proposals: ImpactProposal[]; dropped: number; usage: TokenUsage };

const squash = (s: string) => s.replace(/\s+/g, "");

/** 인용이 조문 글자에 그대로 있는 제안만 남긴다 ("조문에 없는 문장을 근거로 든 제안은 버린다") */
export function verifyCitations(proposals: ImpactProposal[], articleText: string): { kept: ImpactProposal[]; dropped: number } {
  const hay = squash(articleText);
  const kept = proposals.filter((p) => squash(p.quote).length >= 8 && hay.includes(squash(p.quote)));
  return { kept, dropped: proposals.length - kept.length };
}

function toProposals(value: unknown): ImpactProposal[] {
  const arr = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { proposals?: unknown }).proposals) ? (value as { proposals: unknown[] }).proposals : [];
  const out: ImpactProposal[] = [];
  for (const p of arr as Record<string, unknown>[]) {
    if (p && typeof p.summary === "string" && typeof p.quote === "string" && (IMPACT_TARGETS as readonly string[]).includes(String(p.target))) {
      out.push({ target: p.target as ImpactTarget, summary: p.summary.trim().slice(0, 300), quote: p.quote.trim() });
    }
  }
  return out;
}

/**
 * 3단계 분석 - 제안자 -> 반론자 -> 정리자 - 뒤에 코드가 인용을 검증한다. 공포·시행 단계가 아니면 호출 0 (TX-05).
 * 룰셋·판정표·달력에 적용될 제안이 하나도 남지 않으면 초안을 만들지 않는다. 제안은 활성화 경로를 대신하지 않는다(RULE-02) - 감수위원 큐 후보일 뿐.
 */
export async function suggestRulesetImpact(model: OpsModel, input: ImpactInput): Promise<ImpactResult> {
  if (!canSuggestRulesetImpact(input.stage)) return { status: "skipped", reason: "not_confirmed_stage" };
  if (input.articleText.trim() === "") return { status: "skipped", reason: "no_text" };
  const text = input.articleText.slice(0, 12000);
  let usage = ZERO;
  const run = async (system: string, user: string) => {
    const done = await model.complete(system, user);
    usage = addUsage(usage, done.usage);
    return parseJson(done.text);
  };
  const shape = '[{"target":"ruleset|determination_table|tax_calendar","summary":"","quote":"조문에서 그대로 옮긴 문장"}]';
  const proposed = toProposals(await run(`당신은 제안자입니다. 새 조문 글자에서 룰셋·판정표·달력에 영향을 줄 수 있는 부분만 JSON 배열로 답합니다. quote는 조문 글자에서 그대로 옮깁니다. 형식: ${shape}`, `조문:\n${text}`));
  if (proposed.length === 0) return { status: "none", usage, dropped: 0 };
  const critiqued = toProposals(await run(`당신은 반론자입니다. 아래 제안 중 조문 글자만으로 뒷받침되지 않는 것을 빼고 남길 것만 같은 형식의 JSON 배열로 답합니다. 형식: ${shape}`, `조문:\n${text}\n\n제안:\n${JSON.stringify(proposed)}`));
  const finalList = toProposals(await run(`당신은 정리자입니다. 중복을 합치고 같은 형식의 JSON 배열로 답합니다. quote는 바꾸지 않습니다. 형식: ${shape}`, `제안:\n${JSON.stringify(critiqued)}`));
  const { kept, dropped } = verifyCitations(finalList, input.articleText);
  const droppedTotal = dropped + Math.max(0, proposed.length - finalList.length);
  if (kept.length === 0) return { status: "none", usage, dropped: droppedTotal };
  return { status: "proposed", proposals: kept, dropped: droppedTotal, usage };
}
