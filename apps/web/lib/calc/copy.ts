// 계산기 화면 고정 문구 - 법·세무 내용이 아니라 화면 안내만 둔다. 숫자·기한·요건 값은 여기에 없다(감수 입력 칸은 데이터에서 온다).
// 단정 표현("받을 수 있습니다"·"확정"·"100%")을 쓰지 않는다 - copy.test.ts가 검사한다 (CALC-13).

export const CALC_COPY = {
  totalLabel: "내야 할 세금 모두",
  zeroTitle: "이번에는 낼 세금이 없어요",
  notLiableTitle: "올해 재산세는 내지 않아요",
  notLiableReason: "과세기준일에 소유하지 않았다고 답하셨어요",
  deadlineLabel: "언제까지 · 어디서",
  deadlineMissing: "신고 기한 안내는 아직 준비 중이에요. 위택스에서 확인해 주세요",
  reductionFound: (n: number) => `해당될 수 있는 감면 ${n}건`,
  reductionNone: "입력으로 찾은 감면이 없어요",
  reductionNoneLink: "점검한 감면 목록 보기",
  reductionNotice: "요건 확인 필요 — 감면 여부는 신고할 때 정해져요",
  reductionAmountSlot: "적용했을 때 금액은 감수 후 계산 모듈이 생기면 보여 드려요",
  nationalNotice: "상속세·증여세는 이 계산에 포함되지 않습니다",
  unsupportedTitle: "이 원인의 금액은 아직 공개하지 않습니다",
  assumedChip: "가정",
  noAssumption: "가정 없음 · 입력하지 않은 값은 계산기 기본 처리를 따라요",
  modeAll: "한 화면에 모두 입력",
  modeFlow: "질문으로 하나씩 입력",
  dontKnow: "모르겠어요",
  prev: "이전",
  neverSaved: "입력한 값은 저장하지도 보내지도 않아요. 새로고침하면 사라져요",
  disclaimer: "참고용 계산이에요. 실제 세액은 신고 때 정해져요",
  refundNotice: "금액은 알려 드리지 않아요 · 진단 입력값은 저장하지 않습니다",
  compareJoin: "비교는 회원에게 열려 있어요. 로그인하면 조건을 바꿔 나란히 볼 수 있어요",
  compareMax: (n: number) => `비교는 조건 ${n}개까지 할 수 있어요`,
  wetaxText: "위택스(행정안전부 공식)에서 직접 찾아 주세요",
  wetaxLabel: "위택스(행정안전부 공식)",
  wetaxApp: "스마트 위택스 앱에서도 할 수 있어요",
  wetaxNoProxy: "이 사이트는 신고·납부·로그인을 대신하지 않아요",
} as const;

/** 단정·과장 표현 - 계산기 화면 고정 문구에 나오면 안 된다 */
export const ASSERTIVE_PATTERNS: readonly RegExp[] = [/받을\s*수\s*있습니다/, /확정/, /100\s*%/, /반드시\s*(?:돌려|환급)/];
