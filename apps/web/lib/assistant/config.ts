// AI 도우미 설정 읽기 — 순수 함수 (CHAT-10 · CHAT-12, docs/dev/W7b_설계.md 2장 · 12장 #5).
// 환경변수 객체를 받아 검사한다 — process.env를 직접 읽지 않는다(서버 어댑터가 넘긴다). 모델 ID는 코드에 두지 않는다:
// 변수가 비었거나 금지 계열(Fable·Mythos — 데이터 30일 보관이 필요한 모델)이면 도우미가 꺼진다(런처 0, 페이지 정상).

export type Env = Readonly<Record<string, string | undefined>>;

/** 초기 한도 (설계 12장 #5 — 내부 베타 실측 뒤 조정) */
export const ASSISTANT_DEFAULTS = {
  dailyTokenBudget: 200_000,
  rateLimit: 10,
  rateWindowSeconds: 600,
  retentionDays: 30,
  maxTurns: 10,
  maxToolCalls: 3,
  maxResults: 5,
  /** 질문 최대 글자 수 (요청 스키마) */
  maxQuestionChars: 500,
} as const;

/** 도우미에 쓰지 않는 모델 계열 (PRD_최종 §6.2 — 데이터 30일 보관 필요) */
const FORBIDDEN_MODEL = /fable|mythos/i;
/** 모델 ID 모양 — 영문 소문자·숫자·점·하이픈·밑줄·콜론 */
const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{2,99}$/i;

export interface AssistantConfig {
  enabled: true;
  /** 공개 플래그 — 켜져 있어도 게이트(평가 통과 + 고지 감수)가 없으면 일반 방문자에게 안 열린다 */
  publicFlag: boolean;
  modelAnswer: string;
  modelRouter: string;
  dailyTokenBudget: number;
  rate: { limit: number; windowSeconds: number };
  retentionDays: number;
  maxTurns: number;
  maxToolCalls: number;
  maxResults: number;
}

export type ConfigOff =
  | "disabled"
  | "model_answer_missing"
  | "model_router_missing"
  | "model_forbidden"
  | "model_invalid"
  | "invalid_value";

export type ConfigResult = { ok: true; config: AssistantConfig } | { ok: false; reason: ConfigOff; detail?: string };

const ON = new Set(["1", "true", "on", "yes"]);
export const isOn = (v: string | undefined): boolean => ON.has((v ?? "").trim().toLowerCase());

/** 정수 변수 — 비면 기본값, 숫자가 아니거나 범위 밖이면 null(설정 오류) */
function intVar(v: string | undefined, fallback: number, min: number, max: number): number | null {
  const s = (v ?? "").trim();
  if (s === "") return fallback;
  if (!/^[0-9]{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** `횟수/초` (예: 10/600) — 비면 기본값 */
function rateVar(v: string | undefined): { limit: number; windowSeconds: number } | null {
  const s = (v ?? "").trim();
  if (s === "") return { limit: ASSISTANT_DEFAULTS.rateLimit, windowSeconds: ASSISTANT_DEFAULTS.rateWindowSeconds };
  const m = /^([0-9]{1,5})\/([0-9]{1,5})$/.exec(s);
  if (!m) return null;
  const limit = Number(m[1]);
  const windowSeconds = Number(m[2]);
  return limit >= 1 && limit <= 100_000 && windowSeconds >= 1 && windowSeconds <= 86_400 ? { limit, windowSeconds } : null;
}

export function readAssistantConfig(env: Env): ConfigResult {
  if (!isOn(env.ASSISTANT_ENABLED)) return { ok: false, reason: "disabled" };
  const modelAnswer = (env.ANTHROPIC_MODEL_ANSWER ?? "").trim();
  const modelRouter = (env.ANTHROPIC_MODEL_ROUTER ?? "").trim();
  if (!modelAnswer) return { ok: false, reason: "model_answer_missing" };
  if (!modelRouter) return { ok: false, reason: "model_router_missing" };
  for (const id of [modelAnswer, modelRouter]) {
    if (FORBIDDEN_MODEL.test(id)) return { ok: false, reason: "model_forbidden", detail: "금지 모델 계열" };
    if (!MODEL_ID.test(id)) return { ok: false, reason: "model_invalid" };
  }
  const dailyTokenBudget = intVar(env.ASSISTANT_DAILY_TOKEN_BUDGET, ASSISTANT_DEFAULTS.dailyTokenBudget, 1, 1_000_000_000);
  const rate = rateVar(env.ASSISTANT_RATE_LIMIT);
  const retentionDays = intVar(env.ASSISTANT_RETENTION_DAYS, ASSISTANT_DEFAULTS.retentionDays, 1, 365);
  const maxTurns = intVar(env.ASSISTANT_MAX_TURNS, ASSISTANT_DEFAULTS.maxTurns, 1, 100);
  const maxToolCalls = intVar(env.ASSISTANT_MAX_TOOL_CALLS, ASSISTANT_DEFAULTS.maxToolCalls, 0, 10);
  const maxResults = intVar(env.ASSISTANT_MAX_RESULTS, ASSISTANT_DEFAULTS.maxResults, 1, 20);
  const bad = (
    [
      ["ASSISTANT_DAILY_TOKEN_BUDGET", dailyTokenBudget],
      ["ASSISTANT_RATE_LIMIT", rate],
      ["ASSISTANT_RETENTION_DAYS", retentionDays],
      ["ASSISTANT_MAX_TURNS", maxTurns],
      ["ASSISTANT_MAX_TOOL_CALLS", maxToolCalls],
      ["ASSISTANT_MAX_RESULTS", maxResults],
    ] as const
  ).find(([, v]) => v === null);
  if (bad) return { ok: false, reason: "invalid_value", detail: bad[0] };
  return {
    ok: true,
    config: {
      enabled: true,
      publicFlag: isOn(env.ASSISTANT_PUBLIC),
      modelAnswer,
      modelRouter,
      dailyTokenBudget: dailyTokenBudget!,
      rate: rate!,
      retentionDays: retentionDays!,
      maxTurns: maxTurns!,
      maxToolCalls: maxToolCalls!,
      maxResults: maxResults!,
    },
  };
}

/** 누구에게 보이는가 — 내부 계정(로그인한 직원)은 설정만 되면 보이고, 일반 방문자는 공개 플래그 + 게이트(평가 통과 + 고지 감수)가 모두 있어야 한다 (CHAT-14) */
export type Exposure = "off" | "internal" | "public";

export function exposureFor(result: ConfigResult, viewer: { internal: boolean }, publicReady: boolean): Exposure {
  if (!result.ok) return "off";
  if (result.config.publicFlag && publicReady) return "public";
  return viewer.internal ? "internal" : "off";
}
