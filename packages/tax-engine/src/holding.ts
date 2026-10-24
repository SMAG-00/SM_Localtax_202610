import type { OwnerType, PropertyKind, Rate, Won } from './types';
import type { Ruleset } from './schema';
import { ResultBuilder, type CalcResult } from './result';
import { pickBracket, pickTier, progressive, taxOf } from './brackets';
import { clampNonNegative, floorWon } from './money';
import { ENGINE_VERSION } from './version';
import { pct } from './acquisition';
import { formatWon } from './money';

/** 토지 재산세 과세 구분 */
export type LandTaxType =
  | 'COMPREHENSIVE'
  | 'SEPARATE'
  | 'SPECIAL_FARMLAND'
  | 'SPECIAL_FACTORY'
  | 'SPECIAL_LUXURY';

export interface HoldingInput {
  readonly ownerType: OwnerType;
  readonly propertyKind: PropertyKind;
  /** 보유 물건별 공시가격(원). 주택은 여러 채를 배열로 넣는다. */
  readonly publishedPrices: readonly Won[];
  /** 지분율 (0~1). 미지정 시 1(단독소유). */
  readonly ownershipRatio?: number;
  /** 1세대 1주택 여부 (개인) */
  readonly isSingleHouseOneHousehold?: boolean;
  /** 도시지역분 과세 대상 여부 */
  readonly isUrbanArea?: boolean;
  /** 토지 과세 구분 (propertyKind === 'LAND'일 때) */
  readonly landType?: LandTaxType;
  /** 1세대1주택 세액공제용 — 만 나이 */
  readonly ownerAge?: number;
  /** 1세대1주택 세액공제용 — 보유연수 */
  readonly holdingYears?: number;
  /** 세부담상한 적용용 — 직전연도 총세액 */
  readonly previousYearTotal?: Won;
  /**
   * 재개발·재건축으로 종전주택이 **과세기준일(6/1) 현재 이미 멸실**된 상태인지.
   *
   * 재산세는 과세기준일 현재의 사실상 현황으로 과세한다(지방세법 §106③).
   * 주택이 헐린 뒤에는 과세대상이 '주택'이 아니라 '토지'이므로, 이 값이 true면
   * propertyKind가 HOUSE라도 토지분 경로로 보내고 종합합산으로 계산한다 (세무본부 결정).
   *
   * 아직 멸실 전(이주·인가만 난 상태)이라면 여전히 주택이므로 false 로 둔다.
   */
  readonly isRedevelopmentDemolished?: boolean;
}

/**
 * 보유세(재산세 + 부가세 + 종합부동산세) 계산. 1년치.
 *
 * 순수 함수. 네트워크·파일 I/O·LLM 호출 없음 (CLAUDE.md 불변 원칙 1).
 */
export function calcHolding(input: HoldingInput, ruleset: Ruleset): CalcResult {
  const rb = new ResultBuilder(ruleset.version);
  const ratio = input.ownershipRatio ?? 1;

  if (ratio <= 0 || ratio > 1) {
    throw new RangeError(`calcHolding: 지분율은 0 초과 1 이하여야 합니다 (${ratio})`);
  }
  if (input.publishedPrices.length === 0) {
    throw new Error('calcHolding: 공시가격이 최소 1건 필요합니다.');
  }

  if (input.propertyKind === 'OFFICETEL') {
    rb.warnExpert(
      '오피스텔은 기본적으로 건축물분 재산세(0.25%)가 과세됩니다. ' +
        '다만 실제 주거용으로 사용하며 주택분 과세 대상으로 신고·변경된 경우 주택분 세율이 적용됩니다. ' +
        '여기서는 건축물로 계산했습니다.',
    );
  }
  // 재개발 멸실: 과세기준일 현재 주택이 없으므로 주택분이 아니라 토지분으로 과세한다.
  // (지방세법 §106③ — 재산세 과세대상 구분은 과세기준일 현재의 사실상 현황을 따른다)
  const demolished = input.isRedevelopmentDemolished === true;
  const isHouse = input.propertyKind === 'HOUSE' && !demolished;

  if (demolished) {
    if (input.landType !== undefined && input.landType !== 'COMPREHENSIVE') {
      rb.warnExpert(
        `재개발 멸실 토지의 합산구분을 ${input.landType}로 입력하셨으나 종합합산으로 계산했습니다. ` +
          '멸실 토지의 합산구분은 지자체 판단이 갈릴 수 있으니 반드시 확인하십시오.',
      );
    }
    rb.warnExpert(
      '과세기준일(6월 1일) 현재 주택이 멸실된 것으로 입력하셨습니다. ' +
        '주택분 재산세·종합부동산세가 아니라 토지분(종합합산)으로 계산했습니다 — ' +
        '1세대1주택 특례·고령자·장기보유 세액공제는 적용되지 않습니다. ' +
        '멸실 시점과 합산구분은 세무본부 결정 사항이므로 반드시 확인하십시오.',
    );
  }

  if (isHouse) {
    calcHouseHolding(input, ruleset, rb, ratio);
  } else if (
    demolished ||
    input.propertyKind === 'LAND' ||
    input.propertyKind === 'FARMLAND'
  ) {
    // 멸실 토지는 합산구분을 종합합산으로 못박는다 (세무본부 결정).
    calcLandHolding(
      demolished ? { ...input, landType: 'COMPREHENSIVE' } : input,
      ruleset,
      rb,
      ratio,
    );
  } else {
    calcBuildingHolding(input, ruleset, rb, ratio);
  }

  // 세부담상한 (전년도 세액이 있을 때만 판정 가능)
  if (input.previousYearTotal === undefined) {
    rb.warnExpert(
      '직전연도 세액이 입력되지 않아 세부담상한(전년 대비 150%)을 적용하지 못했습니다.',
    );
  }

  return rb.build(ENGINE_VERSION);
}

// ─────────────────────────────────────────────────────────────
// 주택
// ─────────────────────────────────────────────────────────────

/**
 * 1세대1주택 특례·공제를 받을 수 있는 상태인가.
 *
 * **법인은 "1세대"가 될 수 없다** — 세대는 거주자와 그 가족으로 구성되므로(지방세법 시행령 §29,
 * 종부세법 §2 8호) 법인에는 성립하지 않는다. 그런데 화면은 이 체크박스를 개인일 때만 그리면서도
 * 상태 기본값(true)을 법인일 때도 그대로 넘긴다. 그래서 **엔진이 납세자 유형으로 잠근다** —
 * 호출부를 믿지 않는다(개인 vs 법인 비교도 같은 입력으로 양쪽을 돌린다).
 */
const isSingleHouseholdHouse = (input: HoldingInput): boolean =>
  input.ownerType === 'INDIVIDUAL' &&
  input.isSingleHouseOneHousehold === true &&
  input.publishedPrices.length === 1;

function calcHouseHolding(
  input: HoldingInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  ratio: number,
): void {
  const ph = ruleset.holding.property_tax.house;
  const single = isSingleHouseholdHouse(input);

  let propertyTaxTotal = 0;

  for (const published of input.publishedPrices) {
    const share = floorWon(published * ratio);
    const useSpecial = single && published <= ph.single_house_special.applies_under;

    let fairRatio: number;
    let brackets;
    let specialLabel: string;

    if (useSpecial) {
      rb.checkReview(ph.single_house_special, '1세대1주택 재산세 특례');
      const fr = pickBracket(
        published,
        ph.single_house_special.fair_market_ratio_brackets,
      );
      rb.checkReview(fr, '1세대1주택 공정시장가액비율');
      fairRatio = fr.ratio;
      brackets = ph.single_house_special.brackets;
      specialLabel = `1세대1주택 특례세율 적용 (공시가격 ${formatWon(published)} ≤ ${formatWon(ph.single_house_special.applies_under)})`;
    } else {
      fairRatio = ph.fair_market_ratio;
      brackets = ph.brackets;
      specialLabel = '주택 표준세율 적용';
    }

    const taxBase = floorWon(share * fairRatio);
    const { rate, deduction, amount, bracket } = progressive(taxBase, brackets);
    propertyTaxTotal += amount;

    rb.add({
      code: 'PROP_TAX_HOUSE',
      label: '재산세(주택)',
      base: taxBase,
      rate,
      amount,
      law: bracket.law,
      reasons: [
        specialLabel,
        `과세표준 = 공시가격 ${formatWon(published)} × 지분 ${(ratio * 100).toFixed(2)}% × 공정시장가액비율 ${pct(fairRatio)} = ${formatWon(taxBase)}`,
        `${bracket.condition} → 세율 ${pct(rate)}, 누진공제 ${formatWon(deduction)}`,
      ],
    });

    // 도시지역분
    if (input.isUrbanArea === true) {
      const urban = ruleset.holding.property_tax.urban_area;
      rb.addIfPositive({
        code: 'PROP_TAX_URBAN',
        label: '재산세 도시지역분',
        base: taxBase,
        rate: urban.rate ?? 0,
        amount: taxOf(taxBase, urban.rate ?? 0),
        law: urban.law,
        reasons: [urban.condition],
      });
    }

    // 지역자원시설세 (소방분) — 시가표준액 기준
    const rr = ruleset.holding.property_tax.regional_resource;
    rb.checkReview(rr, '지역자원시설세');
    const rrCalc = progressive(share, rr.brackets);
    rb.addIfPositive({
      code: 'REGIONAL_RESOURCE',
      label: '지역자원시설세(소방분)',
      base: share,
      rate: rrCalc.rate,
      amount: rrCalc.amount,
      law: rrCalc.bracket.law,
      reasons: [rrCalc.bracket.condition, '지자체 조례로 세율이 달라질 수 있다'],
    });
  }

  if (input.isUrbanArea === undefined) {
    rb.warnExpert('도시지역분 과세 대상 여부가 입력되지 않아 도시지역분을 제외했습니다.');
  }

  // 지방교육세 = 재산세액(도시지역분 제외) × 20%
  const edu = ruleset.holding.property_tax.local_education;
  rb.addIfPositive({
    code: 'PROP_LOCAL_EDU',
    label: '지방교육세',
    base: propertyTaxTotal,
    rate: edu.rate ?? 0,
    amount: taxOf(propertyTaxTotal, edu.rate ?? 0),
    law: edu.law,
    reasons: [edu.condition],
  });

  // 종합부동산세
  calcComprehensiveHouseTax(input, ruleset, rb, ratio, propertyTaxTotal);
}

function calcComprehensiveHouseTax(
  input: HoldingInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  ratio: number,
  propertyTaxTotal: Won,
): void {
  const cret = ruleset.holding.comprehensive_real_estate_tax.house;
  const houseCount = input.publishedPrices.length;
  const single = isSingleHouseholdHouse(input);
  const totalPublished = floorWon(
    input.publishedPrices.reduce((sum, p) => sum + p, 0) * ratio,
  );

  // 법인: 기본공제 없음, 정율세율
  if (input.ownerType === 'CORPORATION') {
    const item =
      houseCount >= 3 ? cret.corporation_3house_plus : cret.corporation_2house_under;
    rb.checkReview(item, '법인 종부세 정율세율');
    const taxBase = floorWon(totalPublished * cret.fair_market_ratio);
    const rate = item.rate ?? 0;
    const gross = taxOf(taxBase, rate);
    const deductible = deductiblePropertyTax(taxBase, ruleset, rb);
    const net = clampNonNegative(gross - deductible);

    rb.addIfPositive({
      code: 'CRET_HOUSE',
      label: '종합부동산세(주택)',
      base: taxBase,
      rate,
      amount: net,
      law: item.law,
      reasons: [
        '법인은 기본공제·세부담상한이 적용되지 않는다',
        `과세표준 = 공시가격 합계 ${formatWon(totalPublished)} × 공정시장가액비율 ${pct(cret.fair_market_ratio)} = ${formatWon(taxBase)}`,
        `종부세 산출세액 ${formatWon(gross)} − 재산세 공제액 ${formatWon(deductible)} = ${formatWon(net)}`,
      ],
    });
    addRuralOnCret(net, ruleset, rb);
    return;
  }

  // 개인
  const deduction = single ? cret.single_house_deduction : cret.basic_deduction;
  const overDeduction = clampNonNegative(totalPublished - deduction);

  if (overDeduction === 0) {
    rb.add({
      code: 'CRET_HOUSE',
      label: '종합부동산세(주택)',
      base: 0,
      rate: 0,
      amount: 0,
      law: '종합부동산세법 §8①',
      reasons: [
        `공시가격 합계 ${formatWon(totalPublished)} ≤ 공제액 ${formatWon(deduction)}${single ? ' (1세대1주택)' : ''} → 과세표준 0, 종부세 없음`,
      ],
    });
    return;
  }

  const taxBase = floorWon(overDeduction * cret.fair_market_ratio);
  const brackets =
    houseCount >= 3 ? cret.individual_3house_plus : cret.individual_2house_under;
  const { rate, amount: gross, bracket } = progressive(taxBase, brackets);

  const deductible = deductiblePropertyTax(taxBase, ruleset, rb);
  let net = clampNonNegative(gross - deductible);

  const reasons = [
    `과세표준 = (공시가격 합계 ${formatWon(totalPublished)} − 공제 ${formatWon(deduction)}${single ? ' [1세대1주택]' : ''}) × 공정시장가액비율 ${pct(cret.fair_market_ratio)} = ${formatWon(taxBase)}`,
    `${bracket.condition} → 세율 ${pct(rate)}`,
    `산출세액 ${formatWon(gross)} − 재산세 공제액 ${formatWon(deductible)} = ${formatWon(net)}`,
  ];

  // 1세대1주택 세액공제 (고령자 + 장기보유, 합산 한도 80%)
  if (single) {
    const credit = resolveTaxCredit(input, cret, rb);
    if (credit.rate > 0) {
      const creditAmount = floorWon(net * credit.rate);
      net = clampNonNegative(net - creditAmount);
      reasons.push(
        `1세대1주택 세액공제 ${pct(credit.rate)} (${credit.detail.join(' + ')}) → 공제액 ${formatWon(creditAmount)}`,
      );
    }
  }

  rb.addIfPositive({
    code: 'CRET_HOUSE',
    label: '종합부동산세(주택)',
    base: taxBase,
    rate,
    amount: net,
    law: bracket.law,
    reasons,
  });

  addRuralOnCret(net, ruleset, rb);

  // 세부담상한
  if (input.previousYearTotal !== undefined) {
    const cap = floorWon(input.previousYearTotal * cret.tax_burden_cap);
    const current = propertyTaxTotal + net;
    if (current > cap) {
      rb.warnExpert(
        `세부담상한 초과: 올해 산출 ${formatWon(current)} > 전년 ${formatWon(input.previousYearTotal)} × ${cret.tax_burden_cap} = ${formatWon(cap)}. ` +
          '상한 적용 시 실제 고지세액은 이보다 낮아집니다. 상한 배분 로직은 미구현이므로 전문가 확인이 필요합니다.',
      );
    }
  }
}

/**
 * 종부세에서 공제할 재산세액.
 *
 * 종합부동산세법 시행령 §4의2의 취지에 따라, 종부세 과세표준에 해당하는 부분에 대해
 * 재산세 표준세율로 계산한 상당액을 공제한다.
 * 여기서는 실무에서 통용되는 간이 산식을 쓴다: 종부세 과세표준 × 재산세 공정시장가액비율 → 재산세율표 적용.
 */
function deductiblePropertyTax(
  cretTaxBase: Won,
  ruleset: Ruleset,
  rb: ResultBuilder,
): Won {
  const ph = ruleset.holding.property_tax.house;
  const equivalentBase = floorWon(cretTaxBase * ph.fair_market_ratio);
  const { amount } = progressive(equivalentBase, ph.brackets);
  rb.warnExpert(
    '종부세의 재산세 공제액은 시행령 §4의2의 간이 산식으로 계산했습니다. ' +
      '실제 고지세액과 차이가 날 수 있으므로 세무본부 검수가 필요합니다.',
  );
  return amount;
}

function addRuralOnCret(cretAmount: Won, ruleset: Ruleset, rb: ResultBuilder): void {
  const rural = ruleset.holding.comprehensive_real_estate_tax.rural_special;
  rb.addIfPositive({
    code: 'CRET_RURAL',
    label: '농어촌특별세(종부세분)',
    base: cretAmount,
    rate: rural.rate ?? 0,
    amount: taxOf(cretAmount, rural.rate ?? 0),
    law: rural.law,
    reasons: [rural.condition],
  });
}

function resolveTaxCredit(
  input: HoldingInput,
  cret: Ruleset['holding']['comprehensive_real_estate_tax']['house'],
  rb: ResultBuilder,
): { rate: Rate; detail: string[] } {
  const detail: string[] = [];
  let total = 0;

  if (input.ownerAge === undefined && input.holdingYears === undefined) {
    rb.warnExpert(
      '1세대1주택 세액공제(고령자·장기보유) 판정에 필요한 나이·보유연수가 없어 공제를 적용하지 않았습니다.',
    );
    return { rate: 0, detail };
  }

  if (input.ownerAge !== undefined) {
    const tier = pickTier(input.ownerAge, cret.tax_credit.elderly, (t) => t.from_age);
    if (tier) {
      total += tier.rate;
      detail.push(`고령자 ${pct(tier.rate)}`);
    }
  }
  if (input.holdingYears !== undefined) {
    const tier = pickTier(
      input.holdingYears,
      cret.tax_credit.long_term,
      (t) => t.from_years,
    );
    if (tier) {
      total += tier.rate;
      detail.push(`장기보유 ${pct(tier.rate)}`);
    }
  }

  const limit = cret.tax_credit.combined_limit;
  if (total > limit) {
    detail.push(`합산 한도 ${pct(limit)} 적용`);
    total = limit;
  }
  return { rate: Math.round(total * 1_000_000) / 1_000_000, detail };
}

// ─────────────────────────────────────────────────────────────
// 토지 / 건축물
// ─────────────────────────────────────────────────────────────

function calcLandHolding(
  input: HoldingInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  ratio: number,
): void {
  const land = ruleset.holding.property_tax.land;
  const landType = input.landType;

  if (landType === undefined) {
    rb.warnExpert(
      '토지 과세 구분(종합합산/별도합산/분리과세)이 입력되지 않아 종합합산으로 계산했습니다.',
    );
  }
  const kind = landType ?? 'COMPREHENSIVE';
  const totalPublished = floorWon(
    input.publishedPrices.reduce((sum, p) => sum + p, 0) * ratio,
  );
  const taxBase = floorWon(totalPublished * land.fair_market_ratio);

  let rate: Rate;
  let amount: Won;
  let law: string;
  let condition: string;

  if (kind === 'COMPREHENSIVE' || kind === 'SEPARATE') {
    const brackets = kind === 'COMPREHENSIVE' ? land.comprehensive : land.separate;
    const calc = progressive(taxBase, brackets);
    rate = calc.rate;
    amount = calc.amount;
    law = calc.bracket.law;
    condition = calc.bracket.condition;
  } else {
    const item =
      kind === 'SPECIAL_FARMLAND'
        ? land.special.farmland_forest
        : kind === 'SPECIAL_FACTORY'
          ? land.special.factory
          : land.special.luxury;
    rate = item.rate ?? 0;
    amount = taxOf(taxBase, rate);
    law = item.law;
    condition = item.condition;
  }

  rb.add({
    code: 'PROP_TAX_LAND',
    label: '재산세(토지)',
    base: taxBase,
    rate,
    amount,
    law,
    reasons: [
      condition,
      `과세표준 = 공시가격 ${formatWon(totalPublished)} × 공정시장가액비율 ${pct(land.fair_market_ratio)} = ${formatWon(taxBase)}`,
    ],
  });

  addPropertyTaxSurtax(amount, taxBase, input, ruleset, rb);
  rb.warnExpert(
    '토지분 종합부동산세(종합합산 5억·별도합산 80억 공제)는 이번 단계에서 미구현입니다. 토지 종부세가 필요한 케이스는 전문가 확인이 필요합니다.',
  );
}

function calcBuildingHolding(
  input: HoldingInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  ratio: number,
): void {
  const building = ruleset.holding.property_tax.building;
  const land = ruleset.holding.property_tax.land;
  const totalPublished = floorWon(
    input.publishedPrices.reduce((sum, p) => sum + p, 0) * ratio,
  );
  const taxBase = floorWon(totalPublished * land.fair_market_ratio);
  const rate = building.rate ?? 0;
  const amount = taxOf(taxBase, rate);

  rb.add({
    code: 'PROP_TAX_BUILDING',
    label: '재산세(건축물)',
    base: taxBase,
    rate,
    amount,
    law: building.law,
    reasons: [
      building.condition,
      `과세표준 = 시가표준액 ${formatWon(totalPublished)} × 공정시장가액비율 ${pct(land.fair_market_ratio)} = ${formatWon(taxBase)}`,
    ],
  });

  addPropertyTaxSurtax(amount, taxBase, input, ruleset, rb);
}

function addPropertyTaxSurtax(
  propertyTax: Won,
  taxBase: Won,
  input: HoldingInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
): void {
  if (input.isUrbanArea === true) {
    const urban = ruleset.holding.property_tax.urban_area;
    rb.addIfPositive({
      code: 'PROP_TAX_URBAN',
      label: '재산세 도시지역분',
      base: taxBase,
      rate: urban.rate ?? 0,
      amount: taxOf(taxBase, urban.rate ?? 0),
      law: urban.law,
      reasons: [urban.condition],
    });
  }
  const edu = ruleset.holding.property_tax.local_education;
  rb.addIfPositive({
    code: 'PROP_LOCAL_EDU',
    label: '지방교육세',
    base: propertyTax,
    rate: edu.rate ?? 0,
    amount: taxOf(propertyTax, edu.rate ?? 0),
    law: edu.law,
    reasons: [edu.condition],
  });
}
