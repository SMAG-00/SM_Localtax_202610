import "server-only";
import { randomUUID } from "node:crypto";
import { createFetchClient, ModelError, type ModelClient } from "@/lib/assistant/anthropic";
import { readAgentConfig } from "@/lib/agent/ask-config";
import { budgetState } from "@/lib/agent/ask-limits";
import { EMPTY_COPY } from "@/lib/agent/fixed-copy";
import { runAgentTurn, type AgentTurnRecord } from "@/lib/agent/flow";
import { eventStream, SSE_HEADERS } from "@/lib/agent/sse";
import { defaultForbidden, defaultPersonNames } from "@/lib/agent/validators";
import { createAgentToolbox } from "@/lib/server/agent/toolbox";
import { readRuntime } from "@/lib/server/agent/store";
import { anthropicApiKey, anthropicBaseUrl, anthropicWorkspaceId } from "@/lib/server/assistant/env";
import { db } from "@/lib/server/assistant/store";
import { hasEntitlementKey } from "@/lib/server/billing/service";
import { featureOn, readSetting } from "@/lib/server/brief/policy";
import { getViewer, isSameSiteRequest } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { copilotEnv } from "./env";
import { collectEvidence, restrictedToolbox } from "./evidence";
import { buildTaskMessage, decideCopilotGate, parseCopilotRequest, parseMonthlyLimit, statusOfRefusal } from "./logic";
import { consumeRun, recordRun, refundRun, summaryAllowedIds } from "./store";
import { userScopedClient } from "./user-client";

// POST /api/copilot (W13-e) - 가드: 모델 설정 → 기능 키 → 공개 단계 → 계정·권한 → 월 한도 값 → 입력 → 근거 수집 → 한도 차감 → 4단계 흐름(SSE) → 기록.
// 가드 앞에서 모델을 부르는 길은 없다. 새 모델 호출 경로 0 - runAgentTurn(검증기 V1~V6 포함) 한 곳만 쓴다.

const PLAIN = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: PLAIN });
const MAX_OUTPUT_TOKENS = 3000;

function modelClient(): ModelClient {
  const apiKey = anthropicApiKey();
  if (!apiKey) return { create: () => Promise.reject(new ModelError("모델 키가 없습니다", "http", 401)) };
  return createFetchClient({ apiKey, baseUrl: anthropicBaseUrl(), workspaceId: anthropicWorkspaceId(), timeoutMs: 90_000 });
}

export async function handleCopilotPost(request: Request): Promise<Response> {
  const cfg = readAgentConfig(copilotEnv());
  const client = db();
  const admin = adminClient();
  if (!client || !admin) return json({ error: "not found" }, 404);
  if (!isSameSiteRequest(request)) return json({ error: "cross_site" }, 403);

  const on = await featureOn(admin, "research_copilot").catch(() => false);
  const rt = on && cfg.ok ? await readRuntime(client) : null;
  const viewer = on ? await getViewer(request).catch(() => null) : null;
  const limit = on ? parseMonthlyLimit(await readSetting(admin, "copilot_monthly_limit").catch(() => undefined)) : null;
  const entitled = viewer ? await hasEntitlementKey(admin, viewer.userId, "copilot") : false;
  const gate = decideCopilotGate({
    featureOn: on,
    modelConfigured: cfg.ok,
    stage: rt?.stage ?? "none",
    limit,
    internal: !!viewer && (viewer.isAdmin || viewer.roles.length > 0),
    loggedIn: !!viewer,
    entitled,
  });
  if (!gate.open || !cfg.ok || !rt || !rt.limits || !rt.live || !viewer) {
    return json({ error: gate.open ? "not found" : gate.reason === "entitlement_missing" ? "entitlement" : "not found" }, gate.open ? 404 : statusOfRefusal(gate.reason));
  }

  const raw = await request.text();
  if (raw.length > 10_000) return json({ error: "too_long" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parseCopilotRequest(body);
  if (!parsed.ok) return json({ error: parsed.code }, parsed.status);
  const req = parsed.value;

  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const userDb = await userScopedClient(request);
  if (!userDb) return json({ error: "unauthorized" }, 401);
  const collected = await collectEvidence(req, {
    tools: createAgentToolbox(userDb),
    today,
    premiumOk: entitled || viewer.isAdmin || viewer.roles.length > 0,
    summaryAllowed: (ids) => summaryAllowedIds(admin, ids),
  });
  if (!collected.ok) return json({ error: collected.code }, collected.status);

  const quota = await consumeRun(admin, viewer.userId, limit);
  if (!quota.allowed) return json({ error: "quota", code: quota.code, used: quota.used, limit: quota.limit }, 429);

  const runId = randomUUID();
  const gen = runAgentTurn(
    { message: buildTaskMessage(req), mode: "expert", turn: 0, clarify: { rounds: 0, answers: {} } },
    {
      config: cfg.config,
      limits: rt.limits,
      live: rt.live,
      officialSearch: false,
      models: modelClient(),
      tools: restrictedToolbox(collected.docs),
      liveFetcher: null,
      scopeFlags: rt.scopes,
      copy: EMPTY_COPY,
      dictionary: { version: "copilot", topics: [] },
      tier: "member",
      budget: budgetState(rt.spentMonthWon, rt.budget, rt.pricing),
      pricing: rt.pricing,
      today,
      forbidden: defaultForbidden(),
      personNames: defaultPersonNames(),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  );

  const stream = eventStream<AgentTurnRecord>(gen, async (rec) => {
    // 답을 못 낸 실행(오류·폴백·역질문)은 한도를 되돌린다
    if (!rec || rec.kind !== "answer") await refundRun(admin, viewer.userId);
    if (!rec) return;
    await recordRun(admin, {
      id: runId,
      user_id: viewer.userId,
      kind: req.kind,
      status: rec.kind,
      model: cfg.config.modelAnswer,
      citation_ids: rec.citations.map((c) => c.sourceId),
      validation: { passes: rec.passes, regenerated: rec.regenerated, failure_codes: [...new Set(rec.failures.map((f) => f.code))] },
      tokens_in: rec.usage.answerIn + rec.usage.utilityIn,
      tokens_out: rec.usage.answerOut + rec.usage.utilityOut,
      cost: rec.costWon,
    });
  });
  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS, "x-copilot-run": runId } });
}
