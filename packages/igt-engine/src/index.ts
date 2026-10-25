// 상속·증여세 엔진의 공개 진입점 - 내보내는 함수는 둘뿐이다 (증여세 계산 · 상속세 계산, 납부 안내 데이터는 결과에 들어 있다).
// 양도세·부담부증여·절세 시나리오·신고서 초안·AI 해설은 이 패키지에 없다 (PRD-03 FAM-15). 타입은 실행 코드가 아니다.
export { calcGift, calcInheritance } from "./engine";
export type {
  GiftResult,
  IgtCalcError,
  IgtInput,
  IgtPaymentGuide,
  IgtResultBase,
  IgtRuleset,
  IgtSchedule,
  IgtScheduleRow,
  IgtStep,
  InheritanceResult,
} from "./types";
