import "server-only";
import { readAssistantConfig, type ConfigResult } from "@/lib/assistant/config";

// 도우미 환경변수 읽기 (서버 전용) — 이름을 하나씩 읽어 환경변수 검사(check-env)가 읽는 곳을 찾게 한다.
// 모델 ID는 환경변수에서만 온다(코드에 기본값 없음). 도우미는 SUPABASE_SERVICE_ROLE_KEY를 읽지 않는다 (CHAT-11).

export function assistantEnv(): Record<string, string | undefined> {
  return {
    ASSISTANT_ENABLED: process.env.ASSISTANT_ENABLED,
    ASSISTANT_PUBLIC: process.env.ASSISTANT_PUBLIC,
    ASSISTANT_DAILY_TOKEN_BUDGET: process.env.ASSISTANT_DAILY_TOKEN_BUDGET,
    ASSISTANT_RATE_LIMIT: process.env.ASSISTANT_RATE_LIMIT,
    ASSISTANT_RETENTION_DAYS: process.env.ASSISTANT_RETENTION_DAYS,
    ASSISTANT_MAX_TURNS: process.env.ASSISTANT_MAX_TURNS,
    ASSISTANT_MAX_TOOL_CALLS: process.env.ASSISTANT_MAX_TOOL_CALLS,
    ASSISTANT_MAX_RESULTS: process.env.ASSISTANT_MAX_RESULTS,
    ANTHROPIC_MODEL_ANSWER: process.env.ANTHROPIC_MODEL_ANSWER,
    ANTHROPIC_MODEL_ROUTER: process.env.ANTHROPIC_MODEL_ROUTER,
  };
}

export const anthropicApiKey = (): string | undefined => process.env.ANTHROPIC_API_KEY || undefined;

/** 키가 워크스페이스에 묶여 있지 않으면 필요한 워크스페이스 ID (2026-10-24 실호출 확인) — 비밀이 아니다 */
export const anthropicWorkspaceId = (): string | undefined => process.env.ANTHROPIC_WORKSPACE_ID || undefined;

/** 모델 호출 주소 덮어쓰기 — 수용 E2E가 가짜 모델 서버를 가리킬 때만 쓴다 (비어 있으면 공식 주소). 비밀이 아니다 */
export const anthropicBaseUrl = (): string | undefined => process.env.ANTHROPIC_BASE_URL || undefined;

let logged = false;
/** 설정 결과 — 꺼진 이유가 설정 오류(금지 모델·모델 누락·잘못된 값)면 한 번 오류 로그를 남긴다 (모델 ID는 남기지 않는다) */
export function readConfig(): ConfigResult {
  const r = readAssistantConfig(assistantEnv());
  if (!r.ok && r.reason !== "disabled" && !logged) {
    logged = true;
    console.error(`[assistant] 설정 오류로 도우미가 꺼집니다: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`);
  }
  return r;
}
