import "server-only";

// 코파일럿 모델 환경변수 (W13-e) - 모델 이름·추론 강도는 환경변수에서만 온다(코드 상수 0). 4단계 검사(readAgentConfig)를 그대로 쓴다:
// 비어 있거나 30일 보관 모델 계열이면 코파일럿은 꺼진다.
export function copilotEnv(): Record<string, string | undefined> {
  return {
    AGENT_MODEL_ANSWER: process.env.AGENT_MODEL_COPILOT,
    AGENT_EFFORT_EXPERT: process.env.AGENT_EFFORT_COPILOT,
  };
}
