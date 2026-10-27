import { parseExpertRuleset, type ExpertRuleset } from '../src/expert';

/**
 * 전문가 계산기 시험용 룰셋 (W13-f). 시험용 표시 + 지어낸 값이다 - 실제 세율·구간·과세 범위가 아니다.
 * 버전 2090.01은 시험 전용 번호(실제 룰셋 연도와 겹치지 않는다). 이 값은 화면·공개 경로 어디에도 들어가지 않는다.
 */
export const TEST_EXPERT_RAW: unknown = {
  version: '2090.01',
  test_only: true,
  oligopoly_listing: {
    listed: { applies: false, law: '시험용 조문 L', condition: '시험용: 상장 구분 과세 범위 밖', REVIEW_REQUIRED: true, note: '시험용 지어낸 값' },
    unlisted: { applies: true, threshold: 0.4, law: '시험용 조문 U', condition: '시험용: 비상장 구분 기준 지분율 변경(지어낸 값)' },
  },
  corporate_local_income: {
    brackets: [
      { up_to: 1_000_000, rate: 0.01, law: '시험용 조문 C1', condition: '시험용 구간 1' },
      { up_to: 5_000_000, rate: 0.02, deduction: 10_000, law: '시험용 조문 C2', condition: '시험용 구간 2', REVIEW_REQUIRED: true },
      { up_to: null, rate: 0.03, deduction: 60_000, law: '시험용 조문 C3', condition: '시험용 구간 3' },
    ],
  },
};

export const TEST_EXPERT: ExpertRuleset = parseExpertRuleset(TEST_EXPERT_RAW);
