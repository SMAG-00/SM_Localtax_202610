/**
 * @ltr/tax-engine - 지방세 세액 계산 엔진 (순수 TypeScript)
 *
 * SM 부동산 세금 플랫폼 엔진의 가지치기 복사본이다 (원본 커밋·파일 해시: SOURCE.json). 원본은 바꾸지 않는다.
 * 지방세(취득세·재산세·종합부동산세 계산 모듈)만 내보낸다 - 국세 계산 모듈과 시나리오 비교는 복사하지 않았다 (2단계 설계 4.2).
 *
 *  1. 이 패키지의 모든 함수는 순수 함수다. 네트워크·파일 I/O·LLM 호출을 하지 않는다.
 *  2. 모든 계산 결과에는 rulesVersion이 각인된다 (ResultBuilder를 거치지 않으면 결과를 만들 수 없다).
 *
 * 세율·공제액은 전부 룰셋(rules/{YYYY}.{NN}.json)에 있다. 엔진에 세율 상수를 하드코딩하지 않는다.
 * 과점주주 간주취득(calcOligopoly)은 5단계 전까지 공개 진입점에 넣지 않는다.
 */

export { ENGINE_VERSION } from './version';

export * from './types';
export * from './money';
export * from './dates';
export * from './schema';
export * from './formulas';
export * from './brackets';
export * from './result';

export {
  calcAcquisition,
  type AcquisitionInput,
  type AcquisitionCause,
} from './acquisition';
export { calcHolding, type HoldingInput, type LandTaxType } from './holding';

// 판정표 평가기 (CALC-04·13) - 값은 감수된 판정표 데이터에만 있다
export {
  DeterminationTableSchema,
  LIKELIHOODS,
  parseDeterminationTable,
  evaluateDeterminationTable,
  type Condition,
  type DeterminationOutcome,
  type DeterminationTable,
  type Facts,
  type Likelihood,
  type ReductionResult,
  type RefundResult,
  type RequirementResult,
  // W11-a 결론형·목록 집계형
  CONCLUSION_KINDS,
  LIST_COUNT_KINDS,
  W11_DETERMINATION_KINDS,
  ConclusionTableSchema,
  ListCountTableSchema,
  parseTableByKind,
  evaluateConclusionTable,
  evaluateListCountTable,
  sharedRuleRows,
  assertSeparateOrigins,
  type ConclusionKind,
  type ConclusionOutcome,
  type ConclusionStatus,
  type ConclusionTable,
  type ConclusionText,
  type ListCountOutcome,
  type ListCountTable,
  type MissingItem,
  type W11DeterminationTable,
} from './determination';
