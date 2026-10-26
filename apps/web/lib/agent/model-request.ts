// 지방세봇 모델 요청 조립 - 순수 (W12-b b0·b5, PRD-04 6.7). API 모양에 대한 가정은 이 파일 한 곳에 모은다(설계 문서 1장).
//  · 지시문·도구 정의는 고정해 앞에 두고 마지막 시스템 블록에 캐시 지점을 둔다. 기준일·모드·문서는 첫 사용자 메시지(캐시 뒤).
//  · tool_choice는 보내지 않는다(auto). 인용 답변 호출에는 구조화 출력을 쓰지 않는다.
import type { MessagesRequest, ToolDef } from "../assistant/anthropic";
import type { Effort } from "./ask-config";
import { buildDocumentBlocks, type EvidenceDoc } from "./evidence";

export const ANSWER_MAX_TOKENS_FALLBACK = 2000;

export interface AnswerRequestInput {
  model: string;
  effort: Effort | null;
  system: string;
  tools: ToolDef[];
  variableText: string;
  question: string;
  docs: readonly EvidenceDoc[];
  /** 이어지는 대화(도구 호출 왕복, 재생성 요청)를 붙일 때 */
  extraMessages?: unknown[];
  maxTokens: number;
}

export function buildAnswerRequest(i: AnswerRequestInput): MessagesRequest {
  const first = {
    role: "user",
    content: [...buildDocumentBlocks(i.docs), { type: "text", text: `${i.variableText}\n\n[질문]\n${i.question}` }],
  };
  return {
    model: i.model,
    max_tokens: i.maxTokens,
    system: [{ type: "text", text: i.system, cache_control: { type: "ephemeral" } }],
    messages: [first, ...(i.extraMessages ?? [])],
    ...(i.tools.length > 0 ? { tools: i.tools } : {}),
    ...(i.effort ? { output_config: { effort: i.effort } } : {}),
  };
}

/** 재생성 요청 - 실패한 검사 코드만 알린다(이용자 글·문서를 다시 싣지 않는다) */
export const regenerationNote = (codes: readonly string[]): string => `검증기 ${[...new Set(codes)].join(", ")} 항목에서 막혔습니다. 같은 근거 문서만 사용해 해당 문제를 고쳐 다시 작성하세요.`;
