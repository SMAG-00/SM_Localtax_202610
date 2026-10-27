import "server-only";
import { randomUUID } from "node:crypto";
import { createFetchClient, ModelError, type ModelClient } from "@/lib/assistant/anthropic";
import { readAgentConfig } from "@/lib/agent/ask-config";
import { budgetState } from "@/lib/agent/ask-limits";
import { EMPTY_COPY } from "@/lib/agent/fixed-copy";
import { runAgentTurn, type AgentTurnRecord } from "@/lib/agent/flow";
import { parseAskRequest } from "@/lib/agent/request";
import { eventStream, SSE_HEADERS } from "@/lib/agent/sse";
import { defaultForbidden, defaultPersonNames } from "@/lib/agent/validators";
import { ASSISTANT_DEFAULTS } from "@/lib/assistant/config";
import { getViewer } from "@/lib/server/dal";
import { anthropicApiKey, anthropicBaseUrl, anthropicWorkspaceId } from "@/lib/server/assistant/env";
import { db } from "@/lib/server/assistant/store";
import { viewerIsInternal } from "@/lib/server/assistant/service";
import { askAllowed } from "@/lib/agent/rollout";
import { withEntryContext } from "@/lib/agent/entry";
import { trustedClientIp } from "@/lib/analytics/request";
import { guardSecret } from "@/lib/server/env";
import { adminClient } from "@/lib/server/supabase";
import { consumeQuota, openSession, quotaSubject, readModeGate, refundQuota, sessionStateFor } from "./d-store";
import { agentEnv } from "./env";
import { loadCalcPort, loadRequirementDictionary } from "./calc-port";
import { readRuntime, recordResults, recordTurn, registerPrompts, sessionState } from "./store";
import { createAgentToolbox } from "./toolbox";

// /api/ask 한 번의 처리 (W12-b b6 - ASK-01, PRD-04 6.13). 가드: 모델 설정 → 공개 단계·기능 키 → 요청 스키마 → 세션 상태 → 흐름(SSE) → 기록.
// 공개 단계 none이면 모두에게 404(게이트 전 시험은 /admin/eval), 4a·4b는 내부 계정, 4c에서만 일반에게 열린다(W12-d가 대상 계정을 더 세분화).
// 하루 한도 차감·등급 판정·대화 저장 끄기는 W12-d 몫. 이 모듈은 service role을 읽지 않는다.

const PLAIN = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: PLAIN });
/** 모델 출력 토큰 상한 - 비용 상한이 아니라 응답이 끝없이 길어지는 것을 막는 기술적 한도 */
const MAX_OUTPUT_TOKENS = 2000;

function modelClient(): ModelClient {
  const apiKey = anthropicApiKey();
  if (!apiKey) return { create: () => Promise.reject(new ModelError("모델 키가 없습니다", "http", 401)) };
  return createFetchClient({ apiKey, baseUrl: anthropicBaseUrl(), workspaceId: anthropicWorkspaceId(), timeoutMs: 60_000 });
}

export async function handleAskPost(request: Request): Promise<Response> {
  // 모델 설정 없음·금지 계열 → 404 (있다는 사실도 드러내지 않는다)
  const cfg = readAgentConfig(agentEnv());
  const client = db();
  if (!cfg.ok || !client) return json({ error: "not found" }, 404);
  const rt = await readRuntime(client);
  if (!rt || !rt.taxbot || !rt.limits || !rt.live) return json({ error: "not found" }, 404);
  const internal = await viewerIsInternal(request);
  if (rt.stage === "none" || (rt.stage !== "4c" && !internal)) return json({ error: "not found" }, 404);
  // W12-d d1: 화면의 모드 버튼과 같은 판정(기능 키 ∧ 공개 단계 ∧ 모드 고지 승인 ∧ 대상 계정). 서버 연결은 service_role로만 기록·한도를 다룬다
  const admin = adminClient();
  if (!admin) return json({ error: "not found" }, 404);
  const viewer = await getViewer(request).catch(() => null);
  const audience = internal ? "internal" : viewer ? "member" : "guest";
  if (!askAllowed(await readModeGate(client), audience)) return json({ error: "not found" }, 404);

  const raw = await request.text();
  if (raw.length > 8000) return json({ error: "요청이 너무 깁니다" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON이 아닙니다" }, 400);
  }
  const parsed = parseAskRequest(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const req = parsed.value;

  const prompts = await registerPrompts(client);
  if (!prompts) return json({ error: "잠시 후 다시 시도해 주세요" }, 503);
  const sessionId = req.sessionId ?? randomUUID();
  const state = (await sessionStateFor(admin, sessionId, viewer?.userId ?? null)) ?? (await sessionState(client, sessionId)) ?? { turns: 0, clarifyRounds: 0 };
  const tier = viewer ? "member" : "guest";
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

  // W12-d d4: 보내기를 눌러 요청이 온 이 시점에만 하루 한도를 차감한다 (진입·창 열기는 이 API를 부르지 않는다). 프리미엄 등급은 5단계 구독 연결 전이라 회원 한도를 쓴다
  const secret = guardSecret();
  if (!viewer && !secret) return json({ error: "서버 설정이 끝나지 않았습니다" }, 503);
  const subject = quotaSubject({ userId: viewer?.userId ?? null, ip: trustedClientIp(request.headers), secret: secret ?? "" });
  const quota = await consumeQuota(admin, subject, tier);
  if (!quota.allowed) return json({ error: "quota", code: quota.code, next: quota.next, limit: quota.limit, used: quota.used }, 429);
  const opened = await openSession(admin, { sessionId, userId: viewer?.userId ?? null, mode: req.mode, entry: req.entry, internal, retainDays: ASSISTANT_DEFAULTS.retentionDays, save: !req.saveOff });
  if (!opened) {
    await refundQuota(admin, subject);
    return json({ error: "잠시 후 다시 시도해 주세요" }, 503);
  }

  // W12-c - 계산·판정 포트(공개 읽기)와 3단계 요건 사전. 읽기 실패는 빈 사전·닫힌 포트로 이어진다
  const [calcPort, dictionary] = await Promise.all([loadCalcPort(), loadRequirementDictionary(client)]);
  const gen = runAgentTurn(
    { message: withEntryContext(req.message, req.entry, req.entryId, state.turns), mode: req.mode, turn: state.turns, clarify: { rounds: state.clarifyRounds, answers: req.clarifyAnswers } },
    {
      config: cfg.config,
      limits: rt.limits,
      live: rt.live,
      officialSearch: rt.officialSearch,
      models: modelClient(),
      tools: createAgentToolbox(client),
      // 실시간 조회 서버 연결은 OC 호출 서버 등록 요건(설계 5장 #17) 확인 전까지 꺼 둔다 - 색인 근거로만 답한다
      liveFetcher: null,
      scopeFlags: rt.scopes,
      copy: EMPTY_COPY,
      dictionary,
      calc: calcPort,
      tier,
      budget: budgetState(rt.spentMonthWon, rt.budget, rt.pricing),
      pricing: rt.pricing,
      today,
      forbidden: defaultForbidden(),
      personNames: defaultPersonNames(),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  );

  const stream = eventStream<AgentTurnRecord>(gen, async (rec) => {
    if (!rec) return;
    // 서버가 service_role로만 기록한다 (169 - anon 기록 위조 차단). 서버 장애(error)로 답을 못 낸 요청은 한도를 되돌린다
    if (rec.kind === "error") await refundQuota(admin, subject);
    await recordTurn(admin, {
      session_id: sessionId,
      mode: req.mode,
      entry: req.entry,
      internal,
      as_of_date: today,
      retention_days: ASSISTANT_DEFAULTS.retentionDays,
      question_masked: rec.questionMasked,
      answer_masked: rec.answerMasked,
      kind: rec.kind,
      fallback_reason: rec.fallbackReason,
      scope: rec.scope,
      model: cfg.config.modelAnswer,
      prompt_version_id: prompts.answer,
      tokens_in: rec.usage.answerIn + rec.usage.utilityIn,
      tokens_out: rec.usage.answerOut + rec.usage.utilityOut,
      tokens_cached: rec.usage.answerCached,
      cost: rec.costWon,
      model_calls: rec.modelCalls,
      citations: rec.citations.map((c) => ({ source_id: c.sourceId, source_type: c.sourceType, chunk_id: c.chunkId, is_live: c.isLive, snapshot_id: c.snapshotId })),
      tool_calls: rec.toolCalls.map((t) => ({ tool: t.name, input_summary: t.inputSummary, latency_ms: t.latencyMs, ok: t.ok, target_type: t.targetType, snapshot_id: t.snapshotId })),
      validation: {
        v1: rec.passes.V1 ?? true, v2: rec.passes.V2 ?? true, v3: rec.passes.V3 ?? true, v4: rec.passes.V4 ?? true, v5: rec.passes.V5 ?? true, v6: rec.passes.V6 ?? true,
        regenerated: rec.regenerated,
        failure_codes: [...new Set(rec.failures.map((f) => f.code))],
      },
    });
    await recordResults(admin, sessionId, state.turns + 1, rec.results);
  });
  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, "x-ask-session": sessionId } });
}
