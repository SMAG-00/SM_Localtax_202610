// DB 결제 함수 오류('billing:코드') -> 응답 상태·문장 (W10-f). 순수 함수 — 문장은 화면에 그대로 보이는 안내라 정책·법률 문구를 쓰지 않고 상태만 말한다.

const TABLE: Record<string, { status: number; message: string }> = {
  login_required: { status: 401, message: "로그인이 필요합니다" },
  terms_ack_required: { status: 422, message: "결제 전 안내 확인이 필요합니다" },
  closed: { status: 404, message: "지금은 열려 있지 않습니다" },
  plan_unavailable: { status: 404, message: "선택한 요금제를 지금 이용할 수 없습니다" },
  already_subscribed: { status: 409, message: "이미 이용 중인 구독이 있습니다" },
  order_not_found: { status: 404, message: "주문을 찾을 수 없습니다" },
  subscription_not_found: { status: 404, message: "구독을 찾을 수 없습니다" },
  not_renewable: { status: 409, message: "자동갱신 대상이 아닙니다" },
  not_due: { status: 409, message: "아직 갱신 시각이 아닙니다" },
  renewal_notice_missing: { status: 409, message: "갱신 사전 고지 기록이 없어 갱신하지 않습니다" },
};

export function mapBillingError(message: string | undefined): { status: number; message: string; code: string } | null {
  const m = message?.match(/billing:([a-z_]+)/);
  const hit = m ? TABLE[m[1]!] : undefined;
  return m && hit ? { ...hit, code: m[1]! } : null;
}

/** live 주문은 DB가 commerce_readiness 없이는 check_violation으로 거부한다 - 같은 사유를 서버도 먼저 막으므로 여기서는 문장만 */
export function isReadinessViolation(message: string | undefined): boolean {
  return Boolean(message?.includes("commerce_readiness"));
}
