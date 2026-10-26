// 지방세봇 환경변수 읽기 - 순수 함수 (W12-b, PRD-04 6.7). 환경변수 객체를 받아 검사한다(process.env를 직접 읽지 않는다).
// 모델 ID와 추론 강도는 환경변수에서만 온다(코드 상수 0). 30일 보관 모델 계열(Fable·Mythos)이면 기동 실패(= 꺼짐).

export type Env = Readonly<Record<string, string | undefined>>;

const FORBIDDEN_MODEL = /fable|mythos/i;
const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{2,99}$/i;
export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

export interface AgentConfig {
  modelAnswer: string;
  /** 보조 모델 - 없으면 모델이 거절했을 때 보조 재시도 없이 바로 검색 모드 */
  modelUtility: string | null;
  effortGeneral: Effort | null;
  effortExpert: Effort | null;
  effortUtility: Effort | null;
}

export type AgentConfigOff = "model_answer_missing" | "model_forbidden" | "model_invalid" | "effort_invalid";
export type AgentConfigResult = { ok: true; config: AgentConfig } | { ok: false; reason: AgentConfigOff; detail?: string };

function effort(v: string | undefined): Effort | null | "bad" {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "") return null;
  return (EFFORTS as readonly string[]).includes(s) ? (s as Effort) : "bad";
}

export function readAgentConfig(env: Env): AgentConfigResult {
  const answer = (env.AGENT_MODEL_ANSWER ?? "").trim();
  const utility = (env.AGENT_MODEL_UTILITY ?? "").trim();
  if (!answer) return { ok: false, reason: "model_answer_missing" };
  for (const id of [answer, utility]) {
    if (id === "") continue;
    if (FORBIDDEN_MODEL.test(id)) return { ok: false, reason: "model_forbidden", detail: "금지 모델 계열" };
    if (!MODEL_ID.test(id)) return { ok: false, reason: "model_invalid" };
  }
  const g = effort(env.AGENT_EFFORT_ANSWER);
  const e = effort(env.AGENT_EFFORT_EXPERT);
  const u = effort(env.AGENT_EFFORT_UTILITY);
  const bad = (
    [
      ["AGENT_EFFORT_ANSWER", g],
      ["AGENT_EFFORT_EXPERT", e],
      ["AGENT_EFFORT_UTILITY", u],
    ] as const
  ).find(([, x]) => x === "bad");
  if (bad) return { ok: false, reason: "effort_invalid", detail: bad[0] };
  return {
    ok: true,
    config: { modelAnswer: answer, modelUtility: utility || null, effortGeneral: g as Effort | null, effortExpert: e as Effort | null, effortUtility: u as Effort | null },
  };
}
