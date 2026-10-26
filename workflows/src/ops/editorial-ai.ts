// 편집국 AI (W12-f - O2 결정례 요지 AIOPS-07 · O3 대중화 AIOPS-08 · O3 채널 원고 AIOPS-10 · O6 정합성 감시 AIOPS-09). AI SDK 없이 W10-e OpsModel(HTTP)을 그대로 쓴다.
// 순수 함수 - DB·환경변수를 열지 않는다. 결과는 모두 초안이고 호출한 쪽이 review_items에만 올린다(승인 전 공개 0).
// AI는 세액·감면 판정·개별 세무 결론을 만들지 않는다 - 지시문이 그렇게 정하고, 검사기가 원문에 없는 숫자·고유명사를 잡는다.
// 사건번호·일자·기관명은 AI가 쓰지 않는다 - 요지 줄에 사건번호·일자 모양이 있으면 형식 위반이고, 화면은 원문 메타에서 채운다.
import type { OpsModel } from "./ops-model.ts";
import type { TokenUsage } from "./budget.ts";
import { kstDate } from "./schedule.ts";

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };
const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}
const compact = (s: string) => s.replace(/\s+/g, "");
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max * 4) : "");

// ── 공통 검사기 ──────────────────────────────────────────────

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;
// 고유명사 모양 - 기관·법령·법원 이름으로 끝나는 낱말, 「」·따옴표로 묶인 이름, 영문 대문자 낱말
const NAME_RES = [/[가-힣A-Za-z0-9]{2,}(?:법|시행령|시행규칙|위원회|심판원|법원|공단|공사|협회|연구원|청)/g, /[「『"“]([^」』"”\n]{2,30})[」』"”]/g, /\b[A-Z][A-Za-z]{2,}\b/g];

/** 글 속 숫자(쉼표 제거)가 근거 글에 없으면 설명을 돌려준다 */
export function unsupportedNumbers(candidate: string, ground: string): string[] {
  const g = ground.replace(/,/g, "");
  const out: string[] = [];
  for (const m of candidate.matchAll(NUMBER_RE)) {
    const n = m[0].replace(/,/g, "");
    if (!g.includes(n)) out.push(`숫자가 원문에 없습니다: ${m[0]}`);
  }
  return out;
}

/** 글 속 고유명사 모양의 낱말이 근거 글에 없으면 설명을 돌려준다 */
export function unsupportedNames(candidate: string, ground: string): string[] {
  const g = compact(ground);
  const out: string[] = [];
  for (const re of NAME_RES) {
    for (const m of candidate.matchAll(re)) {
      const name = compact(m[1] ?? m[0]);
      if (name.length >= 2 && !g.includes(name)) out.push(`고유명사가 원문에 없습니다: ${m[1] ?? m[0]}`);
    }
  }
  return [...new Set(out)];
}

/** 원문에 없는 숫자·고유명사 경고 (AIOPS-08 검사기 - AIOPS-10이 같은 검사기를 쓴다) */
export function unsupportedFigures(candidate: string, ground: string): string[] {
  return [...unsupportedNumbers(candidate, ground), ...unsupportedNames(candidate, ground)];
}

/** 금지 표현(설정의 목록 - PRD-00 8.8)이 들어 있으면 그 낱말 목록 */
export function forbiddenHits(candidate: string, words: readonly string[]): string[] {
  const lower = candidate.toLowerCase();
  return words.map((w) => w.trim()).filter((w) => w !== "" && lower.includes(w.toLowerCase()));
}

const CASE_ID_RES = [/\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/, /제\s?\d[\d-]*\s?호/, /\d{2,4}\s?[가-힣]{1,3}\s?\d{2,6}/];
/** 사건번호·일자 모양이 있으면 true - 요지 줄에는 쓰지 않는다(코드가 원문 메타에서 채움) */
export function hasCaseIdentifier(s: string): boolean {
  return CASE_ID_RES.some((re) => re.test(s));
}

// ── O2 결정례 요지 ───────────────────────────────────────────

export const RESULT_TYPES = ["accepted", "dismissed", "partial", "inadmissible", "other"] as const;
export type ResultType = (typeof RESULT_TYPES)[number];
export const SUMMARY_LINE_MAX = 140;

export interface TagOption {
  tagKey: string;
  label: string;
  synonyms?: readonly string[];
  taxItems?: readonly string[];
}

export interface CaseSummaryInput {
  /** 결정례 본문(수집기가 옮긴 글) */
  body: string;
  taxKinds: readonly string[];
  /** 승인된 태그 사전 - 세목이 겹치거나 세목 제한이 없는 것만 지시문에 넣는다 */
  tags: readonly TagOption[];
  forbiddenWords?: readonly string[];
}

export interface CaseSummaryDraft {
  lines: [string, string, string];
  resultType: ResultType;
  popularity: number;
  tagKeys: string[];
  newTagCandidates: { label: string; reason: string }[];
  provisionCandidates: string[];
  warnings: string[];
}

export type CaseSummaryResult =
  | { ok: true; draft: CaseSummaryDraft; usage: TokenUsage; attempts: number }
  | { ok: false; reason: "format" | "api_error"; usage: TokenUsage; attempts: number };

/** 이 결정례에 쓸 수 있는 태그 후보 - 태그의 세목이 비어 있으면 제한 없음, 아니면 결정례 세목과 겹쳐야 한다 */
export function eligibleTags(tags: readonly TagOption[], taxKinds: readonly string[]): TagOption[] {
  return tags.filter((t) => !t.taxItems || t.taxItems.length === 0 || t.taxItems.some((x) => taxKinds.includes(x)));
}

export function buildCaseSummaryPrompt(tags: readonly TagOption[], forbidden: readonly string[] = []): string {
  const banned = forbidden.map((w) => w.trim()).filter(Boolean);
  return [
    "당신은 지방세 결정례·해석 문서의 요지 편집 보조입니다. 웹 검색이나 명령 실행은 하지 않고, 주어진 원문만 근거로 씁니다.",
    "## 규칙",
    `- 요지는 정확히 3줄이고, 줄마다 ${SUMMARY_LINE_MAX}자 이내의 쉬운 '~습니다'체 문장입니다.`,
    "- 사건번호·결정일·기관 이름은 쓰지 않습니다(화면이 원문 정보에서 채웁니다).",
    "- 세액·금액·감면 여부·개별 사안의 세무 결론을 새로 만들지 않습니다. 원문이 판단한 내용만 전달합니다.",
    "- 원문에 없는 숫자·고유명사를 쓰지 않습니다. 매수·매도·절세 행동을 권하지 않습니다.",
    ...(banned.length > 0 ? [`- 금지 표현: ${banned.join(", ")}`] : []),
    "- 결론 유형은 accepted(청구 받아들임)·dismissed(기각)·partial(일부 받아들임)·inadmissible(각하)·other 중 하나입니다.",
    "- 대중성 점수는 일반 독자의 관심도를 0~100 정수로 적습니다.",
    "- 태그는 아래 사전의 tagKey 중에서만 고릅니다. 맞는 것이 없으면 newTagCandidates에 이름과 이유를 적습니다.",
    "- 원문에 인용된 법령 조문을 '법령명 제N조' 모양으로 provisionCandidates에 적습니다(원문에 있는 것만).",
    "## 태그 사전",
    ...(tags.length > 0 ? tags.map((t) => `- ${t.tagKey}: ${t.label}${t.synonyms && t.synonyms.length ? ` (동의어: ${t.synonyms.join(", ")})` : ""}`) : ["- (없음)"]),
    "## 출력",
    '{"lines":["","",""],"resultType":"","popularity":0,"tagKeys":[],"newTagCandidates":[{"label":"","reason":""}],"provisionCandidates":[]} 형식의 JSON만 답합니다.',
  ].join("\n");
}

/** 형식 검사 - 문제 목록. 경고(원문에 없는 숫자·고유명사 등)는 형식 위반이 아니라 draft.warnings로 간다 */
export function validateCaseSummary(value: unknown, input: CaseSummaryInput): { draft: CaseSummaryDraft | null; problems: string[] } {
  const o = obj(value);
  if (!o) return { draft: null, problems: ["JSON 객체가 아닙니다"] };
  const problems: string[] = [];
  const rawLines = Array.isArray(o.lines) ? o.lines : [];
  const lines = rawLines.filter((l): l is string => typeof l === "string").map((l) => l.trim());
  if (rawLines.length !== 3 || lines.length !== 3 || lines.some((l) => l === "" || l.length > SUMMARY_LINE_MAX)) problems.push(`lines는 ${SUMMARY_LINE_MAX}자 이내 문장 3개여야 합니다`);
  for (const l of lines) if (hasCaseIdentifier(l)) problems.push("요지 줄에 사건번호·일자 모양이 있습니다 - 쓰지 않습니다");
  if (!(RESULT_TYPES as readonly unknown[]).includes(o.resultType)) problems.push(`resultType은 ${RESULT_TYPES.join("·")} 중 하나입니다`);
  const pop = typeof o.popularity === "number" && Number.isFinite(o.popularity) ? Math.round(o.popularity) : NaN;
  if (!(pop >= 0 && pop <= 100)) problems.push("popularity는 0~100 정수입니다");
  const hits = forbiddenHits(lines.join("\n"), input.forbiddenWords ?? []);
  if (hits.length) problems.push(`금지 표현: ${hits.join(", ")}`);
  if (problems.length) return { draft: null, problems };

  const allowed = new Set(eligibleTags(input.tags, input.taxKinds).map((t) => t.tagKey));
  const tagKeys = [...new Set((Array.isArray(o.tagKeys) ? o.tagKeys : []).filter((k): k is string => typeof k === "string" && allowed.has(k)))].slice(0, 5);
  const newTagCandidates = (Array.isArray(o.newTagCandidates) ? o.newTagCandidates : [])
    .map((c) => obj(c))
    .filter((c): c is Record<string, unknown> => !!c && typeof c.label === "string" && c.label.trim() !== "")
    .slice(0, 3)
    .map((c) => ({ label: (c.label as string).trim().slice(0, 60), reason: text(c.reason, 100).slice(0, 200) }));
  // 조문 후보는 원문에 그 표기가 있는 것만 - 없는 조문은 버린다
  const body = compact(input.body);
  const provisionCandidates = (Array.isArray(o.provisionCandidates) ? o.provisionCandidates : [])
    .filter((p): p is string => typeof p === "string" && p.trim() !== "" && body.includes(compact(p)))
    .slice(0, 10);
  const warnings = lines.flatMap((l) => unsupportedFigures(l, input.body));
  return { draft: { lines: lines as [string, string, string], resultType: o.resultType as ResultType, popularity: pop, tagKeys, newTagCandidates, provisionCandidates, warnings: [...new Set(warnings)] }, problems };
}

/** 형식을 어기면 1회 재시도. 모델이 던지면 api_error(재시도 없음 - 다음 실행이 다시 시도) */
export async function draftCaseSummary(model: OpsModel, input: CaseSummaryInput): Promise<CaseSummaryResult> {
  const system = buildCaseSummaryPrompt(eligibleTags(input.tags, input.taxKinds), input.forbiddenWords ?? []);
  const user = `세목: ${input.taxKinds.join(", ")}\n원문:\n${input.body.slice(0, 12000)}`;
  let usage = ZERO;
  let hint = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let done;
    try {
      done = await model.complete(system, user + hint);
    } catch {
      return { ok: false, reason: "api_error", usage, attempts: attempt };
    }
    usage = add(usage, done.usage);
    const v = validateCaseSummary(parseJson(done.text), input);
    if (v.draft) return { ok: true, draft: v.draft, usage, attempts: attempt };
    hint = `\n\n이전 답이 형식을 어겼습니다: ${v.problems.slice(0, 5).join("; ")}. 형식을 지켜 JSON만 다시 답하세요.`;
  }
  return { ok: false, reason: "format", usage, attempts: 2 };
}

// ── O3 대중화 (기사 요약 상자) ───────────────────────────────

export const BOX_LINE_MAX = 120;
export const BOX_MEANING_MAX = 300;
export const CARD_STEPS = ["situation", "issue", "judgment", "lesson", "checkpoint"] as const;

export interface ArticleBoxInput {
  title: string;
  /** 기사 본문 글(블록에서 뽑은 글) */
  articleText: string;
  forbiddenWords?: readonly string[];
}

export interface ArticleBoxDraft {
  threeLines: [string, string, string];
  meaning: string;
  cardnews: Record<(typeof CARD_STEPS)[number], string>;
  seoTitle: string;
  seoDescription: string;
  warnings: string[];
}

export type ArticleBoxResult =
  | { ok: true; draft: ArticleBoxDraft; usage: TokenUsage; attempts: number }
  | { ok: false; reason: "format" | "api_error"; usage: TokenUsage; attempts: number };

export function buildArticleBoxPrompt(forbidden: readonly string[] = []): string {
  const banned = forbidden.map((w) => w.trim()).filter(Boolean);
  return [
    "당신은 승인된 기사를 일반 독자용으로 풀어 쓰는 편집 보조입니다. 기사 본문만 근거로 쓰고 웹 검색이나 명령 실행은 하지 않습니다.",
    "## 규칙",
    `- 3줄 요약은 줄마다 ${BOX_LINE_MAX}자 이내 문장 3개, '내게 무슨 의미?'는 ${BOX_MEANING_MAX}자 이내입니다. 쉬운 '~습니다'체로 씁니다.`,
    "- 카드뉴스 원고는 상황, 쟁점, 판단, 교훈, 체크포인트 다섯 칸을 각각 한두 문장으로 씁니다.",
    "- 검색용 제목(60자 이내)과 설명(150자 이내)을 씁니다.",
    "- 기사에 없는 숫자·고유명사를 쓰지 않습니다. 세액·감면 여부·개별 사안의 세무 결론을 새로 만들지 않습니다. 매수·매도·절세 행동을 권하지 않습니다.",
    ...(banned.length > 0 ? [`- 금지 표현: ${banned.join(", ")}`] : []),
    "## 출력",
    '{"threeLines":["","",""],"meaning":"","cardnews":{"situation":"","issue":"","judgment":"","lesson":"","checkpoint":""},"seoTitle":"","seoDescription":""} 형식의 JSON만 답합니다.',
  ].join("\n");
}

export function validateArticleBox(value: unknown, input: ArticleBoxInput): { draft: ArticleBoxDraft | null; problems: string[] } {
  const o = obj(value);
  if (!o) return { draft: null, problems: ["JSON 객체가 아닙니다"] };
  const problems: string[] = [];
  const rawLines = Array.isArray(o.threeLines) ? o.threeLines : [];
  const lines = rawLines.filter((l): l is string => typeof l === "string").map((l) => l.trim());
  if (rawLines.length !== 3 || lines.length !== 3 || lines.some((l) => l === "" || l.length > BOX_LINE_MAX)) problems.push(`threeLines는 ${BOX_LINE_MAX}자 이내 문장 3개여야 합니다`);
  const meaning = typeof o.meaning === "string" ? o.meaning.trim() : "";
  if (meaning === "" || meaning.length > BOX_MEANING_MAX) problems.push(`meaning은 1~${BOX_MEANING_MAX}자입니다`);
  const card = obj(o.cardnews);
  const cardnews = {} as Record<(typeof CARD_STEPS)[number], string>;
  for (const k of CARD_STEPS) {
    const v = card && typeof card[k] === "string" ? (card[k] as string).trim() : "";
    if (v === "" || v.length > 300) problems.push(`cardnews.${k}는 1~300자입니다`);
    cardnews[k] = v;
  }
  const seoTitle = typeof o.seoTitle === "string" ? o.seoTitle.trim() : "";
  const seoDescription = typeof o.seoDescription === "string" ? o.seoDescription.trim() : "";
  if (seoTitle === "" || seoTitle.length > 60) problems.push("seoTitle은 1~60자입니다");
  if (seoDescription === "" || seoDescription.length > 150) problems.push("seoDescription은 1~150자입니다");
  const all = [...lines, meaning, ...Object.values(cardnews), seoTitle, seoDescription].join("\n");
  const hits = forbiddenHits(all, input.forbiddenWords ?? []);
  if (hits.length) problems.push(`금지 표현: ${hits.join(", ")}`);
  if (problems.length) return { draft: null, problems };
  const ground = `${input.title}\n${input.articleText}`;
  return { draft: { threeLines: lines as [string, string, string], meaning, cardnews, seoTitle, seoDescription, warnings: [...new Set(unsupportedFigures(all, ground))] }, problems };
}

export async function draftArticleBox(model: OpsModel, input: ArticleBoxInput): Promise<ArticleBoxResult> {
  const system = buildArticleBoxPrompt(input.forbiddenWords ?? []);
  const user = `제목: ${input.title}\n본문:\n${input.articleText.slice(0, 12000)}`;
  let usage = ZERO;
  let hint = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let done;
    try {
      done = await model.complete(system, user + hint);
    } catch {
      return { ok: false, reason: "api_error", usage, attempts: attempt };
    }
    usage = add(usage, done.usage);
    const v = validateArticleBox(parseJson(done.text), input);
    if (v.draft) return { ok: true, draft: v.draft, usage, attempts: attempt };
    hint = `\n\n이전 답이 형식을 어겼습니다: ${v.problems.slice(0, 5).join("; ")}. 형식을 지켜 JSON만 다시 답하세요.`;
  }
  return { ok: false, reason: "format", usage, attempts: 2 };
}

// ── O3 채널별 원고 ───────────────────────────────────────────

export const CHANNELS = ["brief", "cardnews", "shorts", "naver_blog", "naver_post"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = { brief: "브리프 요약", cardnews: "카드뉴스 문안", shorts: "유튜브 쇼츠 대본", naver_blog: "네이버 블로그 원고", naver_post: "네이버 포스트 원고" };
/** 모든 원고 끝에 코드가 붙이는 줄 - 원문 기사 링크와 AI 활용 표기(AIOPS-10). 문구는 [PO 확인 필요] */
export const AI_NOTICE_LINE = "이 원고는 AI가 초안을 만들고 편집자가 검수했습니다.";

/** 설정 channel_copy_limits -> 채널별 글자 수 상한. 비어 있거나 채널 값이 양의 정수가 아니면 그 채널은 생성 0 */
export function parseChannelLimits(value: unknown): Partial<Record<Channel, number>> {
  const o = obj(value);
  const out: Partial<Record<Channel, number>> = {};
  if (!o) return out;
  for (const c of CHANNELS) {
    const n = o[c];
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out[c] = n;
  }
  return out;
}

export interface ChannelCopyInput {
  channel: Channel;
  title: string;
  articleText: string;
  /** 원문 기사 링크(UTM 포함, 코드가 만든 값) */
  articleUrl: string;
  limit: number;
  forbiddenWords?: readonly string[];
}

export type ChannelCopyResult =
  | { ok: true; text: string; body: string; warnings: string[]; usage: TokenUsage; attempts: number }
  | { ok: false; reason: "format" | "too_long" | "api_error"; usage: TokenUsage; attempts: number };

/** 끝줄(원문 링크 + AI 활용 표기) - 코드가 붙인다 */
export function channelFooter(url: string): string {
  return `\n\n원문 기사: ${url}\n${AI_NOTICE_LINE}`;
}

export function buildChannelPrompt(channel: Channel, bodyLimit: number, forbidden: readonly string[] = []): string {
  const banned = forbidden.map((w) => w.trim()).filter(Boolean);
  return [
    `당신은 승인된 기사를 '${CHANNEL_LABELS[channel]}'로 바꾸는 편집 보조입니다. 기사 본문만 근거로 쓰고 웹 검색이나 명령 실행은 하지 않습니다.`,
    `- 본문은 ${bodyLimit}자(공백 포함) 이내입니다. 링크와 AI 활용 표기는 코드가 붙이니 쓰지 않습니다.`,
    "- 쉬운 '~습니다'체로 쓰고, 기사에 없는 숫자·고유명사를 쓰지 않습니다. 세액·감면 여부·개별 사안의 세무 결론을 새로 만들지 않습니다. 매수·매도·절세 행동을 권하지 않습니다.",
    ...(banned.length > 0 ? [`- 금지 표현: ${banned.join(", ")}`] : []),
    '{"text":""} 형식의 JSON만 답합니다.',
  ].join("\n");
}

/** 끝줄까지 합쳐 상한을 넘기면 만들지 않는다(자르지 않음) - 본문 상한 = limit - 끝줄 길이 */
export async function draftChannelCopy(model: OpsModel, input: ChannelCopyInput): Promise<ChannelCopyResult> {
  const footer = channelFooter(input.articleUrl);
  const bodyLimit = input.limit - footer.length;
  if (bodyLimit < 20) return { ok: false, reason: "too_long", usage: ZERO, attempts: 0 };
  const system = buildChannelPrompt(input.channel, bodyLimit, input.forbiddenWords ?? []);
  const user = `제목: ${input.title}\n본문:\n${input.articleText.slice(0, 12000)}`;
  let usage = ZERO;
  let hint = "";
  let lastReason: "format" | "too_long" = "format";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let done;
    try {
      done = await model.complete(system, user + hint);
    } catch {
      return { ok: false, reason: "api_error", usage, attempts: attempt };
    }
    usage = add(usage, done.usage);
    const o = obj(parseJson(done.text));
    const body = o && typeof o.text === "string" ? o.text.trim() : "";
    const problems: string[] = [];
    if (body === "") problems.push("text가 비어 있습니다");
    if (body.length > bodyLimit) {
      problems.push(`본문이 ${bodyLimit}자를 넘습니다(${body.length}자)`);
      lastReason = "too_long";
    } else if (body === "") lastReason = "format";
    const hits = forbiddenHits(body, input.forbiddenWords ?? []);
    if (hits.length) {
      problems.push(`금지 표현: ${hits.join(", ")}`);
      lastReason = "format";
    }
    if (problems.length === 0) {
      return { ok: true, text: body + footer, body, warnings: unsupportedFigures(body, `${input.title}\n${input.articleText}`), usage, attempts: attempt };
    }
    hint = `\n\n이전 답이 규칙을 어겼습니다: ${problems.join("; ")}. 규칙을 지켜 JSON만 다시 답하세요.`;
  }
  return { ok: false, reason: lastReason, usage, attempts: 2 };
}

// ── O6 정합성 감시 ───────────────────────────────────────────

export interface ImpactJudgeInput {
  articleText: string;
  /** 바뀐 조문의 이전·새 글 - 수집기가 옮긴 값 */
  oldText: string;
  newText: string;
}
export type ImpactJudgeResult = { ok: true; sentences: string[]; usage: TokenUsage } | { ok: false; usage: TokenUsage };

/** 문장 단위 영향 판단 - 기사 글에 실제로 있는 문장만 남긴다(지어낸 문장 버림) */
export async function judgeImpactSentences(model: OpsModel, input: ImpactJudgeInput): Promise<ImpactJudgeResult> {
  const system = [
    "당신은 법령 개정이 기사에 미치는 영향을 표시하는 편집 보조입니다. 아래 기사에서 개정 전 조문을 전제로 쓴 문장만 골라 기사 글 그대로 옮깁니다.",
    "새 내용을 쓰거나 세무 결론을 내리지 않습니다. 해당하는 문장이 없으면 빈 배열입니다.",
    '{"sentences":[""]} 형식의 JSON만 답합니다.',
  ].join("\n");
  const user = `개정 전 조문:\n${input.oldText.slice(0, 4000)}\n\n개정 후 조문:\n${input.newText.slice(0, 4000)}\n\n기사:\n${input.articleText.slice(0, 10000)}`;
  let done;
  try {
    done = await model.complete(system, user);
  } catch {
    return { ok: false, usage: ZERO };
  }
  const o = obj(parseJson(done.text));
  const arr = o && Array.isArray(o.sentences) ? o.sentences : [];
  const hay = compact(input.articleText);
  const sentences = arr.filter((s): s is string => typeof s === "string" && compact(s).length >= 8 && hay.includes(compact(s))).slice(0, 10);
  return { ok: true, sentences, usage: done.usage };
}

// ── 일정 ─────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const kstMidnight = (ymd: string) => Date.parse(`${ymd}T00:00:00+09:00`);
const isBusinessDay = (ymd: string, holidays: ReadonlySet<string>) => {
  const dow = new Date(`${ymd}T12:00:00+09:00`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(ymd);
};

/** 개정 감지 뒤 1영업일 기한 (AIOPS-09) - 감지 날(한국)부터 다음 영업일의 마지막 순간. 시각은 주입한다(서버 시간대와 무관). 공휴일 목록은 인자(settings) */
export function proposalDeadline(detectedAt: Date, holidays: readonly string[] = []): Date {
  const hol = new Set(holidays);
  let ymd = kstDate(detectedAt);
  let t = kstMidnight(ymd);
  do {
    t += DAY_MS;
    ymd = kstDate(new Date(t + 12 * 3_600_000));
  } while (!isBusinessDay(ymd, hol));
  return new Date(t + DAY_MS - 1);
}

/** 제안이 기한을 넘겼나 */
export function proposalLate(detectedAt: Date, proposedAt: Date, holidays: readonly string[] = []): boolean {
  return proposedAt.getTime() > proposalDeadline(detectedAt, holidays).getTime();
}

/** 한국 날짜 기준 월요일인가 (매주 점검 실행일) */
export function isKstMonday(now: Date): boolean {
  return new Date(`${kstDate(now)}T12:00:00+09:00`).getUTCDay() === 1;
}

/** 한국 날짜 기준 ISO 주 키 (YYYY-Www) - 주마다 경보 1건 */
export function isoWeekKey(now: Date): string {
  const d = new Date(`${kstDate(now)}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
