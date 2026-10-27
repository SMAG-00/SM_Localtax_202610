import { z } from 'zod';
import type { Won } from './types';
import type { Ruleset } from './schema';
import { ResultBuilder, type CalcResult, type TaxItem } from './result';
import { pickBracket, progressive } from './brackets';
import { assertWon, formatWon } from './money';
import { calcOligopoly, type OligopolyInput } from './oligopoly';
export type { OligopolyInput };
import { calcAcquisition, type AcquisitionInput } from './acquisition';
import { calcHolding, type HoldingInput } from './holding';
import { ENGINE_VERSION } from './version';

/**
 * 전문가 계산기 엔진 (5단계 W13-f: CALC-17 과점주주 · CALC-18 개인·법인 지방세 비교 · CALC-19 법인지방소득세).
 *
 * - 순수 함수. 네트워크·파일 I/O·LLM 호출 없음.
 * - 값(상장 여부별 과세 범위, 법인지방소득세 세율 구간)은 전부 "전문가 룰셋"(ExpertRuleset)에서 읽는다.
 *   이 파일에 세율·한도·구간 숫자 상수는 없다. 감수된 전문가 룰셋이 없으면 화면은 계산을 열지 않는다.
 * - 지방세만 계산한다. 법인지방소득세의 입력인 법인세 과세표준은 사용자 입력값이며 이 파일은 국세를 계산하지 않는다.
 * - 공개 진입점(index.ts)에 넣지 않는다 - '@ltr/tax-engine/expert'로만 불러온다.
 */

const law = z.string().min(1, '근거조문(law)은 필수다');
const condition = z.string().min(1, '적용조건(condition)은 필수다');
const reviewable = { REVIEW_REQUIRED: z.boolean().optional(), note: z.string().optional() };

/** 상장 여부별 과점주주 간주취득 과세 범위 (룰셋 값 - 감수 입력) */
export const ListingScopeSchema = z.object({
  /** 이 구분에 간주취득세를 과세하는가 */
  applies: z.boolean(),
  /** 과점주주 판정 지분율 기준(0~1). 없으면 기본 룰셋의 threshold */
  threshold: z.number().min(0).max(1).optional(),
  law,
  condition,
  ...reviewable,
});

const CorpBracketSchema = z.object({
  /** '이하' 경계(원). 마지막 구간은 null */
  up_to: z.number().int().positive().nullable(),
  rate: z.number().min(0).max(1),
  /** 누진공제(원) */
  deduction: z.number().int().min(0).optional(),
  law,
  condition,
  ...reviewable,
});

export const ExpertRulesetSchema = z
  .object({
    version: z.string().regex(/^\d{4}\.\d{2}$/, 'version은 YYYY.NN 형식이어야 한다'),
    /** 시험용 룰셋 표시. true면 화면이 "시험용" 배지를 달고 공개 경로가 읽지 않는다 */
    test_only: z.boolean().optional(),
    oligopoly_listing: z.object({ listed: ListingScopeSchema, unlisted: ListingScopeSchema }),
    corporate_local_income: z.object({
      brackets: z.array(CorpBracketSchema).min(1),
    }),
  })
  .superRefine((v, ctx) => {
    const bs = v.corporate_local_income.brackets;
    bs.forEach((b, i) => {
      const last = i === bs.length - 1;
      if (last !== (b.up_to === null)) {
        ctx.addIssue({ code: 'custom', message: '구간표는 마지막 구간만 up_to가 null이어야 한다', path: ['corporate_local_income', 'brackets', i, 'up_to'] });
      }
      const prev = bs[i - 1];
      if (prev && prev.up_to !== null && b.up_to !== null && b.up_to <= prev.up_to) {
        ctx.addIssue({ code: 'custom', message: '구간 경계는 오름차순이어야 한다', path: ['corporate_local_income', 'brackets', i, 'up_to'] });
      }
    });
  });

export type ExpertRuleset = z.infer<typeof ExpertRulesetSchema>;
export type ListingScope = z.infer<typeof ListingScopeSchema>;

export function parseExpertRuleset(raw: unknown): ExpertRuleset {
  return ExpertRulesetSchema.parse(raw);
}

// ─────────────────────────────────────────────────────────────
// CALC-17 과점주주 간주취득세 - 상장 여부 분기
// ─────────────────────────────────────────────────────────────

export type ListingChoice = 'listed' | 'unlisted' | 'unknown';

export interface OligopolyExpertScenario {
  readonly listing: 'listed' | 'unlisted';
  readonly result: CalcResult;
}

export interface OligopolyExpertResult {
  readonly choice: ListingChoice;
  /** 'unknown'이면 두 시나리오를 나란히(listed, unlisted 순서), 아니면 하나 */
  readonly scenarios: readonly OligopolyExpertScenario[];
  readonly expertRulesVersion: string;
  readonly baseRulesVersion: string;
}

export function calcOligopolyByListing(
  input: OligopolyInput,
  choice: ListingChoice,
  ruleset: Ruleset,
  expert: ExpertRuleset,
): OligopolyExpertResult {
  const kinds: Array<'listed' | 'unlisted'> = choice === 'unknown' ? ['listed', 'unlisted'] : [choice];
  const scenarios = kinds.map((listing): OligopolyExpertScenario => {
    const scope = expert.oligopoly_listing[listing];
    if (!scope.applies) {
      const rb = new ResultBuilder(ruleset.version);
      rb.checkReview(scope, `과점주주 간주취득 과세 범위(${listing === 'listed' ? '상장' : '비상장'})`);
      rb.add({
        code: 'OLIGOPOLY_DEEMED_ACQ',
        label: '간주취득세',
        base: 0,
        rate: 0,
        amount: 0,
        law: scope.law,
        reasons: [`룰셋: 이 구분(${listing === 'listed' ? '상장법인' : '비상장법인'})은 과점주주 간주취득세 과세 범위에 해당하지 않음 → 세액 없음`],
      });
      return { listing, result: rb.build(ENGINE_VERSION) };
    }
    const effective: Ruleset =
      scope.threshold === undefined ? ruleset : { ...ruleset, oligopoly: { ...ruleset.oligopoly, threshold: scope.threshold } };
    const result = calcOligopoly(input, effective);
    const rb = new ResultBuilder(ruleset.version);
    rb.checkReview(scope, `과점주주 간주취득 과세 범위(${listing === 'listed' ? '상장' : '비상장'})`);
    const review = rb.build(ENGINE_VERSION).warnings;
    return { listing, result: { ...result, warnings: [...review, ...result.warnings] } };
  });
  return { choice, scenarios, expertRulesVersion: expert.version, baseRulesVersion: ruleset.version };
}

// ─────────────────────────────────────────────────────────────
// CALC-19 법인지방소득세 - 최소 범위(과세표준 → 세율 구간)
// ─────────────────────────────────────────────────────────────

export interface CorporateLocalIncomeInput {
  /** 법인세 과세표준 (사용자 입력값, 원). 세무조정은 하지 않는다 */
  readonly taxBase: Won;
}

export function calcCorporateLocalIncome(input: CorporateLocalIncomeInput, expert: ExpertRuleset): CalcResult {
  assertWon(input.taxBase, 'taxBase');
  if (input.taxBase < 0) throw new RangeError(`calcCorporateLocalIncome: 과세표준은 0 이상이어야 합니다 (${input.taxBase})`);
  const rb = new ResultBuilder(expert.version);
  const brackets = expert.corporate_local_income.brackets;
  const r = progressive(input.taxBase, brackets);
  rb.checkReview(r.bracket, '법인지방소득세 세율 구간');
  const upTo = r.bracket.up_to;
  rb.add({
    code: 'CORP_LOCAL_INCOME',
    label: '법인지방소득세',
    base: input.taxBase,
    rate: r.rate,
    amount: r.amount,
    law: r.bracket.law,
    reasons: [
      `과세표준 ${formatWon(input.taxBase)}은 ${upTo === null ? '마지막 구간' : `${formatWon(upTo)} 이하 구간`}에 해당 (${r.bracket.condition})`,
      '과세표준은 입력값이며 세무조정은 하지 않습니다',
    ],
  });
  return rb.build(ENGINE_VERSION);
}

/** 구간 경계 시험용 - 룰셋의 경계값에서 −1원/경계/+1원 입력을 만든다 (값은 룰셋에서만 나온다) */
export function bracketEdgeInputs(expert: ExpertRuleset): Array<{ base: Won; bracketIndex: number; edge: 'minus' | 'on' | 'plus' }> {
  const out: Array<{ base: Won; bracketIndex: number; edge: 'minus' | 'on' | 'plus' }> = [];
  const bs = expert.corporate_local_income.brackets;
  bs.forEach((b, i) => {
    if (b.up_to === null) return;
    out.push({ base: b.up_to - 1, bracketIndex: i, edge: 'minus' }, { base: b.up_to, bracketIndex: i, edge: 'on' }, { base: b.up_to + 1, bracketIndex: i + 1, edge: 'plus' });
  });
  return out;
}

/** 입력 과세표준이 속하는 구간 번호 (화면의 구간 설명용) */
export function corporateBracketIndex(base: Won, expert: ExpertRuleset): number {
  const bs = expert.corporate_local_income.brackets;
  return bs.indexOf(pickBracket(base, bs));
}

// ─────────────────────────────────────────────────────────────
// CALC-18 개인 vs 법인 - 지방세 세목만 (취득세·재산세 계열)
// ─────────────────────────────────────────────────────────────

/** 지방세 줄만 통과시킨다. 허용 목록 방식 - 알 수 없는 코드는 버린다(국세 금액이 섞여 들어올 수 없다) */
// 농어촌특별세(ACQ_RURAL*)·인지세·채권은 지방세 줄이 아니므로 통과시키지 않는다
const LOCAL_CODE = /^(ACQ_TAX|ACQ_LOCAL_EDU|PROP_|REGIONAL_RESOURCE$)/;

export interface EntityLocalTaxInput {
  readonly acquisition: Omit<AcquisitionInput, 'ownerType'>;
  /** 보유 1년치 비교가 필요하면 공시가격을 준다. 없으면 취득세만 비교 */
  readonly holding?: Omit<HoldingInput, 'ownerType'>;
}

export interface EntityLocalTaxSide {
  readonly ownerType: 'INDIVIDUAL' | 'CORPORATION';
  readonly acquisitionItems: readonly TaxItem[];
  readonly holdingItems: readonly TaxItem[];
  readonly acquisitionTotal: Won;
  readonly holdingTotal: Won;
  readonly total: Won;
  readonly warnings: readonly string[];
}

export interface EntityLocalTaxResult {
  readonly individual: EntityLocalTaxSide;
  readonly corporation: EntityLocalTaxSide;
  readonly rulesVersion: string;
  /** 두 주체 지방세 합계 차이 (법인 − 개인, 음수 가능). 권유 문장 없이 숫자만 */
  readonly totalDiff: Won;
}

const sum = (items: readonly TaxItem[]): Won => items.reduce((s, i) => s + i.amount, 0);
const localOnly = (items: readonly TaxItem[]): TaxItem[] => items.filter((i) => LOCAL_CODE.test(i.code));

function side(ownerType: 'INDIVIDUAL' | 'CORPORATION', input: EntityLocalTaxInput, ruleset: Ruleset): EntityLocalTaxSide {
  const acq = calcAcquisition({ ...input.acquisition, ownerType }, ruleset);
  const hold = input.holding ? calcHolding({ ...input.holding, ownerType }, ruleset) : null;
  const acquisitionItems = localOnly(acq.items);
  const holdingItems = hold ? localOnly(hold.items) : [];
  const acquisitionTotal = sum(acquisitionItems);
  const holdingTotal = sum(holdingItems);
  return {
    ownerType,
    acquisitionItems,
    holdingItems,
    acquisitionTotal,
    holdingTotal,
    total: acquisitionTotal + holdingTotal,
    warnings: [...acq.warnings, ...(hold?.warnings ?? [])],
  };
}

export function calcEntityLocalTaxes(input: EntityLocalTaxInput, ruleset: Ruleset): EntityLocalTaxResult {
  const individual = side('INDIVIDUAL', input, ruleset);
  const corporation = side('CORPORATION', input, ruleset);
  return { individual, corporation, rulesVersion: ruleset.version, totalDiff: corporation.total - individual.total };
}
