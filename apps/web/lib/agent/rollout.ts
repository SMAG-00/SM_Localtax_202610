// 지방세봇 모드 공개 판정 - 순수 (W12-d d1, CHAT-15 · HOME-10 · COMPLY-01).
// 모드 버튼·진입점 카드는 네 조건이 모두 참일 때만 그린다: 기능 키 taxbot ∧ 공개 단계 승인(none 아님) ∧ 모드 고지 승인 ∧ 대상 계정.
// 공개 단계는 W12-e의 승인 함수(리포트 필요)로만 바뀌므로 stage가 none이 아니라는 것이 곧 '리포트 + 승인'이다.
// 계정 3종: internal(직원) · member(로그인 회원) · guest(비회원). 4a·4b는 internal만, 4c에서만 targets 설정에 따라 member·guest.

export type Stage = "none" | "4a" | "4b" | "4c";
export type Audience = "internal" | "member" | "guest";

export interface AskModeGate {
  taxbot: boolean;
  stage: Stage;
  noticeApproved: boolean;
  noticeVersion: string;
  modeNotice: string;
  answerFooter: string;
  targets: { guest: boolean; member: boolean };
}

const STAGES: readonly unknown[] = ["none", "4a", "4b", "4c"];

/** public_ask_mode() 반환값 → 게이트. 모양이 틀리거나 비어 있으면 모두 닫힘 */
export function parseAskModeGate(raw: unknown): AskModeGate {
  const closed: AskModeGate = { taxbot: false, stage: "none", noticeApproved: false, noticeVersion: "", modeNotice: "", answerFooter: "", targets: { guest: false, member: false } };
  if (typeof raw !== "object" || raw === null) return closed;
  const o = raw as Record<string, unknown>;
  const t = typeof o.targets === "object" && o.targets !== null ? (o.targets as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    taxbot: o.taxbot === true,
    stage: STAGES.includes(o.stage) ? (o.stage as Stage) : "none",
    noticeApproved: o.notice_approved === true,
    noticeVersion: str(o.notice_version),
    modeNotice: str(o.mode_notice),
    answerFooter: str(o.answer_footer),
    targets: { guest: t.guest === true, member: t.member === true },
  };
}

/** 이 계정에게 모드 버튼·진입점을 그리는가 */
export function modeAvailable(gate: AskModeGate, audience: Audience): boolean {
  if (!gate.taxbot || gate.stage === "none" || !gate.noticeApproved) return false;
  if (audience === "internal") return true;
  if (gate.stage !== "4c") return false;
  return audience === "member" ? gate.targets.member : gate.targets.guest;
}

/** 서버가 /api/ask를 받아도 되는가 - 화면과 같은 판정을 쓴다(화면에서 숨겼는데 API는 열려 있는 틈 0) */
export function askAllowed(gate: AskModeGate, audience: Audience): boolean {
  return modeAvailable(gate, audience);
}
