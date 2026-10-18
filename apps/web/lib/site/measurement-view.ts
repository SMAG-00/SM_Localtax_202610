// 측정 거부 화면의 글자 (GROW-01 '측정 거부(바닥글 설정)' — docs/dev/W2-c_설계.md 5.1). 순수 모듈 — 화면(app/(site)/about/measurement)은 이 값만 그린다.
// 문구는 법률 검토 전 초안이다 [결정 안건 — 설계 9장 #7]. 안내 문장은 60자 이하(R8).
import type { MeasurementChoice, MeasurementState } from "@/lib/analytics/consent";

export const MEASUREMENT_TITLE = "측정 거부";

export const MEASUREMENT_EXPLANATION = [
  "어떤 글이 읽히는지 알려고 무작위 방문자 번호를 씁니다.",
  "이름·이메일·IP 주소·브라우저 정보 원문은 저장하지 않습니다.",
  "거부하면 이 브라우저는 방문 기록을 보내지 않습니다.",
] as const;

const STATUS: Readonly<Record<MeasurementState, string>> = {
  measuring: "지금은 방문을 측정하고 있습니다.",
  refused: "지금은 측정을 거부한 상태입니다.",
  gpc: "브라우저의 GPC 신호를 받아 측정하지 않고 있습니다.",
};

const DONE: Readonly<Record<MeasurementChoice, string>> = {
  refuse: "측정 거부를 저장했습니다.",
  allow: "측정 허용을 저장했습니다.",
};

export interface MeasurementView {
  status: string;
  /** 방금 저장했다는 알림 — 화면에 돌아왔을 때만 */
  notice: string | null;
  /** 버튼 하나 — 지금 상태의 반대 (GPC 상태에서는 거부를 저장해 둘 수 있다) */
  button: { choice: MeasurementChoice; label: string };
}

export function measurementView(state: MeasurementState, done: string | undefined): MeasurementView {
  const notice = done === "refuse" || done === "allow" ? DONE[done] : null;
  const button: MeasurementView["button"] = state === "refused" ? { choice: "allow", label: "측정 허용하기" } : { choice: "refuse", label: "측정 거부하기" };
  return { status: STATUS[state], notice, button };
}
