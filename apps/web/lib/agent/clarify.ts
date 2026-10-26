// 요건 분석·역질문·검색 계획 - 순수 (W12-b b1, PRD-04 6.1 ②③④ · ASK-02, 6.2 요건 사전).
// 요건 사전은 PO·감수 입력이라 빈 사전으로 출하한다(EMPTY_DICTIONARY). 사전이 비면 역질문 없이 진행한다("요건 확인 필요" 표시는 답변 쪽).
// 상한(라운드 수, 라운드당 개수)은 ask_limits 설정에서 읽은 값이다 - 이 파일에 숫자 상수가 없다.
import type { AskLimits } from "./ask-limits";

export const UNSURE = "unsure";
export const UNSURE_LABEL = "모르겠어요";

export interface SlotOption {
  id: string;
  label: string;
}
export interface Slot {
  id: string;
  question: string;
  options: readonly SlotOption[];
  /** 질문 글에 이 낱말이 있으면 이미 말한 요건으로 본다 */
  satisfiedBy: readonly string[];
}
export interface Topic {
  id: string;
  taxItems: readonly string[];
  /** 질문에 이 낱말이 하나라도 있으면 이 주제 */
  keywords: readonly string[];
  required: readonly Slot[];
}
export interface RequirementDictionary {
  version: string;
  topics: readonly Topic[];
}
export const EMPTY_DICTIONARY: RequirementDictionary = { version: "pending-po-input", topics: [] };

export interface ClarifyState {
  /** 지금까지 물은 라운드 수 (서버 세션 값) */
  rounds: number;
  /** 슬롯 ID → 선택지 ID 또는 UNSURE */
  answers: Readonly<Record<string, string>>;
}

export interface ClarifyQuestion {
  slotId: string;
  text: string;
  options: readonly SlotOption[];
}

export type ClarifyPlan =
  | { kind: "ask"; round: number; questions: ClarifyQuestion[]; topicId: string }
  | { kind: "proceed"; topicId: string | null; taxItems: readonly string[]; unsure: Array<{ slotId: string; question: string }>; missing: Array<{ slotId: string; question: string }> };

/** 사전에 없는 슬롯·선택지는 버린다 - 클라이언트가 보낸 값을 믿지 않는다 */
export function sanitizeAnswers(dict: RequirementDictionary, raw: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of dict.topics) {
    for (const s of t.required) {
      const v = raw[s.id];
      if (v === undefined) continue;
      if (v === UNSURE || s.options.some((o) => o.id === v)) out[s.id] = v;
    }
  }
  return out;
}

export function matchTopic(dict: RequirementDictionary, masked: string): Topic | null {
  const q = masked.normalize("NFKC");
  return dict.topics.find((t) => t.keywords.some((k) => k !== "" && q.includes(k))) ?? null;
}

export function planClarify(masked: string, dict: RequirementDictionary, state: ClarifyState, limits: Pick<AskLimits, "clarifyRounds" | "clarifyPerRound">): ClarifyPlan {
  const topic = matchTopic(dict, masked);
  if (!topic) return { kind: "proceed", topicId: null, taxItems: [], unsure: [], missing: [] };
  const answers = sanitizeAnswers(dict, state.answers);
  const q = masked.normalize("NFKC");
  const isGiven = (s: Slot) => answers[s.id] !== undefined || s.satisfiedBy.some((w) => w !== "" && q.includes(w));
  const unsure = topic.required.filter((s) => answers[s.id] === UNSURE).map((s) => ({ slotId: s.id, question: s.question }));
  const missing = topic.required.filter((s) => !isGiven(s));
  if (missing.length === 0) return { kind: "proceed", topicId: topic.id, taxItems: topic.taxItems, unsure, missing: [] };
  // 상한 - 라운드를 다 썼거나 라운드당 개수가 0이면 더 묻지 않고 가정을 밝힌 조건부 답변으로 간다
  if (state.rounds >= limits.clarifyRounds || limits.clarifyPerRound <= 0) {
    return { kind: "proceed", topicId: topic.id, taxItems: topic.taxItems, unsure, missing: missing.map((s) => ({ slotId: s.id, question: s.question })) };
  }
  const asked = missing.slice(0, limits.clarifyPerRound);
  return {
    kind: "ask",
    round: state.rounds + 1,
    topicId: topic.id,
    questions: asked.map((s) => ({ slotId: s.id, text: s.question, options: [...s.options, { id: UNSURE, label: UNSURE_LABEL }] })),
  };
}

/** 검색 계획 - 하위 질의 최대 4개 (원 질문 + 고른 선택지 이름). 모델을 쓰지 않는 규칙 */
export function searchPlan(masked: string, dict: RequirementDictionary, answers: Readonly<Record<string, string>>, max = 4): string[] {
  const topic = matchTopic(dict, masked);
  const clean = sanitizeAnswers(dict, answers);
  const labels: string[] = [];
  for (const s of topic?.required ?? []) {
    const label = s.options.find((o) => o.id === clean[s.id])?.label;
    if (label) labels.push(label);
  }
  const queries = [masked, ...(labels.length > 0 ? [`${masked} ${labels.join(" ")}`] : []), ...labels.map((l) => `${l} ${(topic?.keywords[0] ?? "").trim()}`.trim())];
  return [...new Set(queries.map((s) => s.trim()).filter(Boolean))].slice(0, Math.max(1, max));
}
