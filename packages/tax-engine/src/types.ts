/**
 * 세금 계산 엔진 공용 타입.
 * 이 패키지는 순수 함수만 포함한다 — I/O·네트워크·LLM 호출 금지(CLAUDE.md 불변 원칙 1).
 */

/** 금액. 원(KRW) 단위 정수. Number.MAX_SAFE_INTEGER 이내에서만 사용한다. */
export type Won = number;

/** 세율. 소수로 표현한다. 예: 1% → 0.01 */
export type Rate = number;

/** 납세 주체 구분 (전역 컨텍스트 바) */
export type OwnerType = 'INDIVIDUAL' | 'CORPORATION';

/**
 * 물건 종류 7분류 (전역 컨텍스트 바).
 * NOTE: STAGE 1 세목 스펙 확정 시 최종 확정한다. [확인 필요]
 */
export type PropertyKind =
  | 'HOUSE' // 주택
  | 'OFFICETEL' // 오피스텔
  | 'PRESALE_RIGHT' // 분양권·입주권
  | 'LAND' // 토지
  | 'COMMERCIAL' // 상가·업무용 건물
  | 'FARMLAND' // 농지
  | 'ETC'; // 그 밖의 부동산

/** 세금 생애주기 3단계 (탭 구조) */
export type LifecyclePhase = 'ACQUISITION' | 'HOLDING' | 'TRANSFER';

/** 룰셋 버전 식별자. `/rules/{YYYY}.{NN}.json` 파일명과 1:1 대응한다. 예: "2026.01" */
export type RulesVersion = string;

/** 모든 계산 입력이 공유하는 전역 컨텍스트 */
export interface TaxContext {
  readonly ownerType: OwnerType;
  readonly propertyKind: PropertyKind;
  /** 계산 기준일 (ISO 8601 date, 예: "2026-07-12"). 적용 룰셋 선택의 기준. */
  readonly asOf: string;
}
