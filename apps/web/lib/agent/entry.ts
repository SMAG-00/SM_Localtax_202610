// 지방세봇 진입점·화면 노출 순수 규칙 (W12-d d1·d3, CHAT-15 · HOME-10 · ASK-13).
// 진입점은 도우미 창을 지방세봇 모드로 열고 질의를 입력창에 채울 뿐이다 - 자동 전송 0, 주소·제목 변화 0, 한도 차감 0.
import { modeAvailable, type AskModeGate, type Audience } from "./rollout";
import type { Entry } from "./request";

/** 창 안 알림 이벤트 이름 - 진입점 버튼이 보내고 도우미 창이 받는다 */
export const AGENT_OPEN_EVENT = "ltr:open-agent";
export interface AgentOpenDetail {
  prefill: string;
  entry: Entry;
  entryId: string | null;
}

/** 맥락 ID(조문·결정례·기사·단계·쟁점 ID) 모양 - 짧은 영숫자·한글·기호만, 공백·따옴표·꺾쇠 0 */
export const ENTRY_ID_RE = /^[A-Za-z0-9가-힣_.:-]{1,80}$/u;
export function parseEntryId(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null) return null;
  return typeof v === "string" && ENTRY_ID_RE.test(v) ? v : "invalid";
}

const ENTRY_LABEL: Record<Entry, string> = {
  mode_switch: "모드 전환",
  search_results: "검색 결과",
  law: "조문",
  case: "결정례",
  calc: "계산 결과",
  article: "기사",
  step: "정비 단계",
  issue_map: "쟁점 지도",
};

/** 첫 질문에만 진입 맥락을 붙인다 (ASK-13). 맥락 ID가 없으면 질문 그대로 */
export function withEntryContext(message: string, entry: Entry | null, entryId: string | null, turn: number): string {
  if (turn !== 0 || !entry || !entryId) return message;
  return `[${ENTRY_LABEL[entry]} ${entryId}] ${message}`;
}

export interface AgentUiProps {
  noticeVersion: string;
  modeNotice: string;
  answerFooter: string;
  audience: Audience;
}

/** 도우미 창에 모드 탭을 줄 것인가: 공개 판정 통과 + 모드 고지 문구가 비어 있지 않아야 한다. 아니면 null(모드 버튼 렌더 0) */
export function agentUiProps(gate: AskModeGate, audience: Audience): AgentUiProps | null {
  if (!modeAvailable(gate, audience)) return null;
  if (gate.modeNotice.trim() === "") return null;
  return { noticeVersion: gate.noticeVersion, modeNotice: gate.modeNotice, answerFooter: gate.answerFooter, audience };
}

/** `/search` 위 [지방세봇에게 이 질문 묻기] 카드를 그릴 것인가 - 검색어가 있고 모드가 열려 있을 때만 */
export function searchCardVisible(ui: AgentUiProps | null, q: string): boolean {
  return ui !== null && q.trim() !== "";
}
