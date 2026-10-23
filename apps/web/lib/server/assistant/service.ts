import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFetchClient, ModelError, type ModelClient } from "@/lib/assistant/anthropic";
import { costOf, totalTokens } from "@/lib/assistant/budget";
import { exposureFor, type AssistantConfig, type Exposure } from "@/lib/assistant/config";
import { ASSISTANT_FORBIDDEN_PHRASES, BASE_PERSON_NAMES } from "@/lib/assistant/forbidden";
import { CARD_NOTICE } from "@/lib/assistant/intent";
import { maskText } from "@/lib/assistant/mask";
import { runTurn, type Toolbox, type TurnResult } from "@/lib/assistant/pipeline";
import { PROMPT_VERSION } from "@/lib/assistant/prompt";
import { parseAssistantRequest } from "@/lib/assistant/request";
import { clientIp } from "@/lib/analytics/request";
import { getViewer } from "@/lib/server/dal";
import { guardSecret } from "@/lib/server/env";
import { anthropicApiKey, anthropicBaseUrl, anthropicWorkspaceId, readConfig } from "./env";
import { readRuntime, rateHit, rateKey, recordTurn, registerPrompts, db, type RuntimeState } from "./store";
import { createToolbox, expertAvailability } from "./toolbox";

// /api/assistant 한 번의 처리 (CHAT-01~12) — 가드: 기능 플래그 → 노출 판정 → 요청 스키마 → 속도 → 일일 예산 → 마스킹 → 파이프라인 → 기록.
// 모델은 파이프라인 안에서 마스킹된 글만 받는다. service role 0 (viewer 확인은 dal이 하는 직원 역할 조회이며 도우미 코드가 읽는 값이 아니다).

const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => Response.json(body, { status, headers: { ...HEADERS, ...extra } });

/** 직원(관리자·역할 보유)인가 — 공개 전에는 내부 계정에게만 보인다 */
export async function viewerIsInternal(request?: Request): Promise<boolean> {
  try {
    const v = await getViewer(request);
    return v !== null && (v.isAdmin || v.roles.length > 0);
  } catch {
    return false;
  }
}

/** 지금 이 방문자에게 도우미가 보이는가 + 고지 문구 (레이아웃·API 공용) */
export async function resolveExposure(request?: Request): Promise<{ exposure: Exposure; config: AssistantConfig | null; runtime: RuntimeState | null; client: SupabaseClient | null }> {
  const cfg = readConfig();
  if (!cfg.ok) return { exposure: "off", config: null, runtime: null, client: null };
  const client = db();
  const runtime = client ? await readRuntime(client) : null;
  if (!client || !runtime) return { exposure: "off", config: cfg.config, runtime: null, client };
  const internal = await viewerIsInternal(request);
  return { exposure: exposureFor(cfg, { internal }, runtime.publicReady), config: cfg.config, runtime, client };
}

let promptIds: { answer: number; router: number } | null = null;

/** 가짜 모델 서버·시험용 주입 — 서버 모듈 안에서만 바꾼다(환경변수 ANTHROPIC_BASE_URL로 주소를 바꾸는 것이 기본 경로) */
function modelClient(): ModelClient {
  const apiKey = anthropicApiKey();
  if (!apiKey) return { create: () => Promise.reject(new ModelError("모델 키가 없습니다", "http", 401)) };
  return createFetchClient({ apiKey, baseUrl: anthropicBaseUrl(), workspaceId: anthropicWorkspaceId() });
}

interface Reply {
  sessionId: string;
  mode: TurnResult["mode"] | "rate_limited";
  intent: string;
  reason: string | null;
  paragraphs: Array<{ text: string; sourceUrls: string[] }>;
  sources: TurnResult["sources"];
  links: TurnResult["links"];
  experts: { findHref: string | null; requestHref: string | null } | null;
  summary: boolean;
  /** 모델 문장이 있는 답에만 — 'AI 답변' 표시 (CHAT-16) */
  aiBadge: boolean;
  cardNotice: string | null;
  retryAfter?: number;
}

async function expertButtons(result: Pick<TurnResult, "experts">): Promise<Reply["experts"]> {
  if (!result.experts) return null;
  const avail = await expertAvailability().catch(() => ({ find: false, request: false }));
  const findHref = avail.find ? (result.experts.field ? `/experts?field=${encodeURIComponent(result.experts.field)}` : "/experts") : null;
  const requestHref = avail.request ? "/experts/request" : null;
  return findHref || requestHref ? { findHref, requestHref } : null;
}

export async function handleAssistantPost(request: Request, toolsOverride?: Toolbox): Promise<Response> {
  const { exposure, config, runtime, client } = await resolveExposure(request);
  // 꺼짐·미공개는 404 — 도우미가 있다는 사실도 드러내지 않는다 (CHAT-14: 비내부 계정 요청은 런처 0)
  if (exposure === "off" || !config || !runtime || !client) return json({ error: "not found" }, 404);

  const raw = await request.text();
  if (raw.length > 8000) return json({ error: "요청이 너무 깁니다" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON이 아닙니다" }, 400);
  }
  const parsed = parseAssistantRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const req = parsed.value;
  if (req.noticeVersion !== runtime.notice.version) return json({ error: "고지 확인이 필요합니다", noticeVersion: runtime.notice.version }, 409);

  const secret = guardSecret();
  if (!secret) return json({ error: "서버 설정이 끝나지 않았습니다" }, 503);
  const ids = promptIds ?? (promptIds = await registerPrompts(client));
  if (!ids) return json({ error: "잠시 후 다시 시도해 주세요" }, 503);

  const sessionId = req.sessionId ?? randomUUID();
  const masked = maskText(req.message);
  const base = { internal: exposure === "internal", retention_days: config.retentionDays, session_id: sessionId, prompt_version_id: ids.answer, model: config.modelAnswer, router_model: config.modelRouter };

  // 속도 제한 — 세션·IP 두 키 + 하루 대화 턴 상한. 하나라도 넘으면 모델 호출 없이 안내 (CHAT-10)
  const ip = clientIp(request.headers);
  const hits = await Promise.all([
    rateHit(client, rateKey(secret, "session", sessionId), config.rate),
    rateHit(client, rateKey(secret, "ip", ip), config.rate),
    rateHit(client, rateKey(secret, "turns", sessionId), { limit: config.maxTurns, windowSeconds: 86_400 }),
  ]);
  const blocked = hits.find((h) => h === null || !h.allowed);
  if (blocked !== undefined) {
    if (blocked === null) return json({ error: "잠시 후 다시 시도해 주세요" }, 503);
    await recordTurn(client, { ...base, question_masked: masked.text || "(빈 질문)", answer_masked: null, intent: "rate", mode: "rate_limited", fallback_reason: "rate" });
    const reply: Reply = { sessionId, mode: "rate_limited", intent: "rate", reason: "질문이 너무 많습니다. 잠시 후 다시 시도해 주세요.", paragraphs: [], sources: [], links: [], experts: null, summary: false, aiBadge: false, cardNotice: null, retryAfter: blocked.retryAfter };
    return json(reply, 429, { "retry-after": String(Math.max(1, blocked.retryAfter)) });
  }

  const result = await runTurn(
    { message: req.message, context: req.context },
    { config, models: modelClient(), tools: toolsOverride ?? createToolbox(), tokensToday: runtime.tokensToday, forbiddenPhrases: ASSISTANT_FORBIDDEN_PHRASES, personNames: BASE_PERSON_NAMES },
  );

  const tokens = totalTokens(result.usage);
  const answerText = result.mode === "ai" ? result.answerMasked : result.reason ?? "";
  await recordTurn(client, {
    ...base,
    question_masked: result.questionMasked || "(빈 질문)",
    answer_masked: answerText === "" ? null : answerText,
    intent: result.intent,
    mode: result.mode,
    fallback_reason: result.fallbackReason,
    citation_urls: result.sources.map((s) => s.href),
    tool_calls: result.toolCalls,
    verifier: { failures: result.failures, regenerated: result.regenerated, prompt: PROMPT_VERSION },
    tokens_in: tokens.in,
    tokens_out: tokens.out,
    tokens_cached: result.usage.cached,
    cost: costOf(result.usage, runtime.pricing),
  });

  const reply: Reply = {
    sessionId,
    mode: result.mode,
    intent: result.intent,
    reason: result.reason,
    paragraphs: result.paragraphs,
    sources: result.sources,
    links: result.links,
    experts: await expertButtons(result),
    summary: result.summary,
    aiBadge: result.mode === "ai" && result.paragraphs.length > 0,
    cardNotice: result.cardNotice ? CARD_NOTICE : null,
  };
  return json(reply);
}
