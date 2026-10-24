import type { OwnerType, PropertyKind, Rate, Won } from './types';
import type { Ruleset } from './schema';
import { ResultBuilder, type CalcResult } from './result';
import { bracketRate, flatAmount, pickBracket, taxOf } from './brackets';
import { formatWon } from './money';
import { ENGINE_VERSION } from './version';

/** 취득원인 */
export type AcquisitionCause = 'PAID' | 'INHERITANCE' | 'GIFT' | 'ORIGINAL';

export interface AcquisitionInput {
  readonly ownerType: OwnerType;
  readonly propertyKind: PropertyKind;
  readonly cause: AcquisitionCause;
  /** 취득당시가액 = 과세표준 (원) */
  readonly price: Won;
  /** 전용면적(㎡). 농어촌특별세 국민주택규모 판정에 쓴다. */
  readonly exclusiveAreaSqm?: number;
  /** 취득 후 보유하게 되는 주택 수 (이번 취득분 포함) */
  readonly houseCount?: number;
  /** 조정대상지역 소재 여부 */
  readonly isAdjustedArea?: boolean;
  /** 사치성재산(고급주택·고급오락장·고급선박) 해당 여부 */
  readonly isLuxury?: boolean;
  /** 대도시 내 법인 중과 요건(설립·전입 5년 이내 등) 충족 여부 */
  readonly isMetropolitanCorpHeavy?: boolean;
  /** 증여 중과 판정용 시가표준액. 미지정 시 price를 쓴다. */
  readonly officialPrice?: Won;
  /** 매매계약서 작성 여부 (인지세) */
  readonly hasContract?: boolean;
  /** 국민주택채권 매입 대상 여부 (소유권 이전 등기) */
  readonly buysHousingBond?: boolean;
  /**
   * 국민주택채권 즉시매도 할인율 (0~1). 매도일의 고시 할인율을 넣는다.
   *
   * 미지정이면 룰셋 값으로 폴백하되 경고를 남긴다 — 룰셋의 할인율은 스스로
   * "자리표시자이며 절대 그대로 쓰지 말 것"이라 적어 둔 값이다. 채권 할인율은
   * 시장금리에 따라 매일 변동해 룰셋에 고정할 수 있는 성질이 아니다.
   */
  readonly bondDiscountRate?: Rate;
  /**
   * 재개발·재건축 조합원 상세 (도시정비법상 정비사업).
   *
   * 지정하면 조합원 지위에 따라 취득세 경로가 갈린다:
   *  - ORIGINAL(원조합원)   종전부동산 소유자. 신축주택은 원시취득(cause='ORIGINAL', 2.8%),
   *                        납부 청산금은 종전 권리면적 초과분의 대가로 보아 토지 유상승계로 별도 과세.
   *  - SUCCESSOR(승계조합원) 입주권 매수자. 관리처분인가로 주택이 권리로 변환된 것으로 보아
   *                        멸실 여부와 무관하게 토지 유상승계세율을 적용하고 주택 수에 넣지 않는다.
   *
   * 두 취급 모두 세무본부 결정 사항이므로 결과에 검수 경고를 남긴다.
   */
  readonly membershipDetail?: {
    /** 조합원 구분 */
    readonly role: 'ORIGINAL' | 'SUCCESSOR';
    /** 관리처분계획인가일 (YYYY-MM-DD). 표시·검증용 */
    readonly approvalDate: string;
    /** 원조합원이 납부한 청산금(추가분담금). 미지정 시 0 */
    readonly paidSettlement?: Won;
  };
}

interface MainRate {
  readonly rate: Rate;
  readonly law: string;
  readonly condition: string;
  readonly localEducationRate: Rate;
  readonly ruralSpecialRate: Rate;
  readonly ruralExemptUnderNationalHousing: boolean;
  readonly reasons: string[];
}

/**
 * 취득세 세율 적용상 '주택'인지.
 *
 * 오피스텔은 주택이 아니다 — 주거용이라도 취득세는 건축물로 보아 유상 4%를 적용한다.
 * (주택 수 산정에는 포함될 수 있으나, 그건 다른 주택의 세율에 영향을 줄 뿐 오피스텔 자신의 세율이 아니다.)
 */
const isHouseForRate = (kind: PropertyKind): boolean => kind === 'HOUSE';

/**
 * 취득세 및 부가세(지방교육세·농어촌특별세) + 인지세 + 국민주택채권 실부담액 계산.
 *
 * 순수 함수. 네트워크·파일 I/O·LLM 호출 없음 (CLAUDE.md 불변 원칙 1).
 */
export function calcAcquisition(input: AcquisitionInput, ruleset: Ruleset): CalcResult {
  const rb = new ResultBuilder(ruleset.version);
  const acq = ruleset.acquisition;
  const base = input.price;

  if (input.propertyKind === 'OFFICETEL') {
    rb.warnExpert(
      '오피스텔은 주거용이라도 취득세는 건축물로 보아 유상 4%를 적용합니다. ' +
        '다만 2020.8.12 이후 취득한 주거용 오피스텔은 다른 주택의 취득세 중과 판정 시 주택 수에 포함되므로, ' +
        '보유 주택이 있다면 그 주택의 세율에 영향을 줍니다.',
    );
  }

  const main = resolveMainRate(input, ruleset, rb);

  // ── 취득세 본세 ────────────────────────────────────────────
  rb.add({
    code: 'ACQ_TAX',
    label: '취득세',
    base,
    rate: main.rate,
    amount: taxOf(base, main.rate),
    law: main.law,
    reasons: main.reasons,
  });

  // ── 지방교육세 ────────────────────────────────────────────
  rb.addIfPositive({
    code: 'ACQ_LOCAL_EDU',
    label: '지방교육세',
    base,
    rate: main.localEducationRate,
    amount: taxOf(base, main.localEducationRate),
    law: '지방세법 §151①1',
    reasons: [
      `취득세율 ${pct(main.rate)} 기준 지방교육세율 ${pct(main.localEducationRate)}`,
    ],
  });

  // ── 농어촌특별세 (국민주택규모 이하 주택 비과세) ───────────
  const area = input.exclusiveAreaSqm;
  const limitSqm = acq.house_paid.national_housing_area_sqm;
  const isNationalHousing =
    isHouseForRate(input.propertyKind) && area !== undefined && area <= limitSqm;

  if (isHouseForRate(input.propertyKind) && area === undefined) {
    rb.warnExpert(
      `전용면적이 입력되지 않아 농어촌특별세 국민주택규모(${limitSqm}㎡ 이하) 비과세 판정을 할 수 없습니다. 과세로 계산했습니다.`,
    );
  }

  if (isNationalHousing && main.ruralExemptUnderNationalHousing) {
    rb.add({
      code: 'ACQ_RURAL',
      label: '농어촌특별세',
      base,
      rate: 0,
      amount: 0,
      law: '농어촌특별세법 §4 11호',
      reasons: [`국민주택규모(전용 ${limitSqm}㎡) 이하 주택 → 비과세 (전용 ${area}㎡)`],
    });
  } else {
    rb.addIfPositive({
      code: 'ACQ_RURAL',
      label: '농어촌특별세',
      base,
      rate: main.ruralSpecialRate,
      amount: taxOf(base, main.ruralSpecialRate),
      law: '농어촌특별세법 §5①6',
      reasons: [`농어촌특별세율 ${pct(main.ruralSpecialRate)}`],
    });
  }

  // ── 원조합원 납부 청산금 (토지 유상승계로 별도 과세) ───────
  //
  // 원조합원은 종전부동산을 계속 보유한 것으로 보아 신축건물분만 원시취득(2.8%)한다.
  // 다만 종전 권리면적을 넘는 부분은 새로 사들인 것과 다르지 않으므로,
  // 그 대가인 청산금을 과세표준으로 토지 유상승계세율을 매긴다 (세무본부 결정).
  //
  // 본세와 합치지 않고 별도 항목으로 낸다 — 과세표준(건물분 vs 청산금)과 세율(2.8% vs 4%)이
  // 다르므로 한 줄로 합치면 어느 쪽이 얼마인지 검증할 수 없다.
  const member = input.membershipDetail;
  const settlement = member?.role === 'ORIGINAL' ? (member.paidSettlement ?? 0) : 0;
  if (settlement > 0) {
    const land = acq.standard.paid_general;
    const landRate = land.main.rate ?? 0;
    const eduRate = land.surtax.local_education.rate ?? 0;
    const ruralRate = land.surtax.rural_special.rate ?? 0;
    rb.checkReview(land.main, '원조합원 청산금 취득세율');

    if (input.cause !== 'ORIGINAL') {
      rb.warnExpert(
        `원조합원 청산금을 입력했으나 취득 원인이 원시취득이 아닙니다(${input.cause}). ` +
          '관리처분계획에 따라 취득하는 신축주택은 원시취득으로 신고하는 것이 일반적이니 확인하십시오.',
      );
    }

    rb.add({
      code: 'ACQ_TAX_SETTLEMENT',
      label: '취득세(청산금분)',
      base: settlement,
      rate: landRate,
      amount: taxOf(settlement, landRate),
      law: land.main.law,
      reasons: [
        `원조합원 — 납부 청산금 ${formatWon(settlement)}은 종전 권리면적 초과분의 대가로 보아 토지 유상승계로 과세`,
        `${land.main.condition} → 세율 ${pct(landRate)}`,
        `건물분 ${formatWon(base)}(원시취득)과 과세표준·세율이 다르므로 항목을 분리한다`,
      ],
    });
    rb.addIfPositive({
      code: 'ACQ_LOCAL_EDU_SETTLEMENT',
      label: '지방교육세(청산금분)',
      base: settlement,
      rate: eduRate,
      amount: taxOf(settlement, eduRate),
      law: land.surtax.local_education.law,
      reasons: [land.surtax.local_education.condition],
    });
    rb.addIfPositive({
      code: 'ACQ_RURAL_SETTLEMENT',
      label: '농어촌특별세(청산금분)',
      base: settlement,
      rate: ruralRate,
      amount: taxOf(settlement, ruralRate),
      law: land.surtax.rural_special.law,
      reasons: [
        land.surtax.rural_special.condition,
        // 청산금분은 토지 승계취득이라 국민주택규모 비과세(농특세법 §4 11호) 대상이 아니다.
        '국민주택규모 비과세는 주택 취득분에만 적용되므로 청산금분에는 붙지 않는다',
      ],
    });

    rb.warnExpert(
      `원조합원 청산금 ${formatWon(settlement)}에 토지 유상승계세율 ${pct(landRate)}를 적용했습니다. ` +
        '청산금의 취득세 과세 여부·세율은 세무본부 결정 사항이므로 반드시 확인하십시오. ' +
        '관리처분계획서상 종전자산 평가액과 권리가액을 대조해 청산금 금액 자체도 검증이 필요합니다.',
    );
  }

  // ── 인지세 ────────────────────────────────────────────────
  if (input.hasContract === true) {
    const stamp = acq.stamp_tax;
    rb.checkReview(stamp, '인지세');
    const houseExempt =
      isHouseForRate(input.propertyKind) && base <= stamp.house_exemption_under;
    if (houseExempt) {
      rb.add({
        code: 'STAMP_TAX',
        label: '인지세',
        base,
        rate: null,
        amount: 0,
        law: '인지세법 §6 5호',
        reasons: [
          `주택으로서 기재금액 ${formatWon(stamp.house_exemption_under)} 이하 → 비과세`,
        ],
      });
    } else {
      const tier = flatAmount(base, stamp.brackets);
      rb.addIfPositive({
        code: 'STAMP_TAX',
        label: '인지세',
        base,
        rate: null,
        amount: tier.amount,
        law: tier.law,
        reasons: [tier.condition],
      });
    }
  }

  // ── 국민주택채권 (매입 후 즉시매도 시 실부담액) ────────────
  if (input.buysHousingBond === true) {
    const bond = acq.housing_bond;
    rb.checkReview(bond, '국민주택채권');

    const override = input.bondDiscountRate;
    if (
      override !== undefined &&
      (!Number.isFinite(override) || override < 0 || override > 1)
    ) {
      throw new RangeError(
        `calcAcquisition: 국민주택채권 할인율은 0 이상 1 이하여야 합니다 (${override})`,
      );
    }
    const discountRate = override ?? bond.discount_rate;

    const bracket = pickBracket(base, bond.purchase_rate_brackets);
    const purchaseRate = bracketRate(bracket, base);
    const purchaseAmount = taxOf(base, purchaseRate);
    const realBurden = taxOf(purchaseAmount, discountRate);
    rb.addIfPositive({
      code: 'HOUSING_BOND',
      label: '국민주택채권(즉시매도 실부담액)',
      base,
      rate: purchaseRate,
      amount: realBurden,
      law: bracket.law,
      reasons: [
        bracket.condition,
        `매입액 ${formatWon(purchaseAmount)} × 할인율 ${pct(discountRate)} = ${formatWon(realBurden)}`,
        override === undefined
          ? '할인율은 룰셋의 자리표시자 값이다 — 실제 매도일의 고시 할인율로 다시 계산해야 한다.'
          : '할인율은 입력값(매도일 고시 할인율)이다.',
        '세금이 아니라 채권 매입에 따른 실부담액이다.',
      ],
    });
    if (override === undefined) {
      rb.warnExpert(
        `국민주택채권 할인율이 입력되지 않아 룰셋의 자리표시자 값(${pct(bond.discount_rate)})으로 계산했습니다. ` +
          '할인율은 채권 시장금리에 따라 매일 변동하므로 이 금액은 실제 부담액이 아닙니다. 매도일의 고시 할인율을 입력하십시오.',
      );
    }
    rb.warnExpert(
      '국민주택채권 매입율 구간표는 특별시·광역시 기준입니다. 그 밖의 지역은 구간·요율이 다르므로 실제 매입액이 달라집니다.',
    );
  }

  return rb.build(ENGINE_VERSION);
}

/** 취득원인·물건종류·중과요건을 따져 본세율과 부가세율을 확정한다. */
function resolveMainRate(
  input: AcquisitionInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
): MainRate {
  const acq = ruleset.acquisition;
  const reasons: string[] = [];

  // 0) 승계조합원 입주권 — 주택 판정보다 먼저 가로챈다.
  //
  // 관리처분계획인가로 종전주택은 '입주권'이라는 권리로 변환된 상태다.
  // 이를 사들이는 승계조합원은 주택이 아니라 그 권리(토지 지분)를 취득하는 것으로 보아
  // 토지 유상승계세율을 적용하고, 다주택 중과 판정에도 넣지 않는다 (세무본부 결정).
  //
  // 주택 세율 경로보다 먼저 두는 이유: 아래 1)이 propertyKind만 보고 주택 구간표를
  // 태워 버리면 승계조합원이 다주택 중과(8~12%)에 걸린다.
  const membership = input.membershipDetail;
  if (membership?.role === 'SUCCESSOR') {
    const land = acq.standard.paid_general;
    rb.checkReview(land.main, '승계조합원 입주권 취득세율');
    rb.warnExpert(
      `승계조합원(관리처분계획인가일 ${membership.approvalDate} 이후 입주권 취득)으로 보아 ` +
        `토지 유상승계세율 ${pct(land.main.rate ?? 0)}를 적용했습니다. 주택 수에도 넣지 않았습니다. ` +
        '이 취급은 세무본부 결정 사항이므로 반드시 확인하십시오. ' +
        '준공 후 신축건물분은 별도로 원시취득(2.8%) 신고 대상입니다.',
    );
    reasons.push(
      `승계조합원 — 입주권 취득을 토지 유상승계로 본다 (인가일 ${membership.approvalDate} 이후 취득)`,
      `${land.main.condition} → 세율 ${pct(land.main.rate ?? 0)}`,
    );
    return {
      rate: land.main.rate ?? 0,
      law: land.main.law,
      condition: land.main.condition,
      localEducationRate: land.surtax.local_education.rate ?? 0,
      ruralSpecialRate: land.surtax.rural_special.rate ?? 0,
      ruralExemptUnderNationalHousing:
        land.surtax.rural_special.exempt_under_national_housing === true,
      reasons,
    };
  }

  // 1) 주택 유상취득 — 중과 판정 우선
  if (isHouseForRate(input.propertyKind) && input.cause === 'PAID') {
    const heavy = resolveHouseHeavy(input, ruleset, rb, reasons);
    if (heavy) return heavy;

    // 주택 구간표는 up_to가 main 안에 중첩돼 있으므로 main 기준으로 구간을 고른다.
    // (최상위 up_to를 보는 pickBracket을 쓰면 어떤 가격도 매칭되지 않아 항상 마지막 구간이 잡힌다)
    const bracket = pickHouseBracket(input.price, acq.house_paid.brackets);
    rb.checkReview(bracket.main, '주택 유상취득 세율');
    const rate = bracketRate(bracket.main, input.price);
    reasons.push(`주택 유상취득 ${bracket.main.condition} → 세율 ${pct(rate)}`);

    // 지방교육세: 주택 유상취득은 (취득세율 × 50%) × 20% = 취득세율 × 0.1
    // 산식 구간(6~9억)의 세율은 소수 6자리를 넘을 수 있으므로(예: 1.6667% → 0.0016667) 반올림하지 않는다.
    // 부동소수점 잡음은 taxOf()의 roundMicro가 걷어낸다.
    const eduItem = bracket.surtax.local_education;
    const eduRate = eduItem.rate !== undefined ? eduItem.rate : rate * 0.5 * 0.2;
    if (eduItem.formula !== undefined) {
      reasons.push('지방교육세는 산식세율에 연동한다: 취득세율 × 50% × 20%');
    }

    return withLuxury(input, ruleset, rb, {
      rate,
      law: bracket.main.law,
      condition: bracket.main.condition,
      localEducationRate: eduRate,
      ruralSpecialRate: bracket.surtax.rural_special.rate ?? 0,
      ruralExemptUnderNationalHousing:
        bracket.surtax.rural_special.exempt_under_national_housing === true,
      reasons,
    });
  }

  // 2) 주택 무상취득(증여) — 조정대상지역 고가주택 중과
  if (isHouseForRate(input.propertyKind) && input.cause === 'GIFT') {
    const giftHeavy = acq.heavy.gift_adjusted;
    const officialPrice = input.officialPrice ?? input.price;
    if (input.isAdjustedArea === undefined) {
      rb.warnExpert(
        '조정대상지역 여부가 입력되지 않아 증여 중과(§13의2②) 판정을 할 수 없습니다. 비조정지역으로 보고 일반세율을 적용했습니다.',
      );
    }
    // 중과 판정 기준은 **시가표준액**이지 취득가액이 아니다 (§13의2②).
    // 통상 시가표준액 < 시가라, 취득가액으로 갈음하면 중과가 과잉 적용될 수 있다.
    if (input.isAdjustedArea === true && input.officialPrice === undefined) {
      rb.warnExpert(
        `시가표준액이 입력되지 않아 취득가액 ${formatWon(input.price)}을 시가표준액으로 갈음해 증여 중과(${formatWon(giftHeavy.threshold_price)} 이상)를 판정했습니다. ` +
          '시가표준액은 통상 시가보다 낮으므로, 실제 시가표준액이 기준 미만이면 중과 대상이 아닙니다. 반드시 확인하십시오.',
      );
    }
    if (input.isAdjustedArea === true && officialPrice >= giftHeavy.threshold_price) {
      rb.checkReview(giftHeavy.main, '조정대상지역 주택 증여 중과');
      reasons.push(
        `조정대상지역 + 시가표준액 ${formatWon(officialPrice)} ≥ ${formatWon(giftHeavy.threshold_price)} → 증여 중과`,
      );
      return withLuxury(input, ruleset, rb, {
        rate: giftHeavy.main.rate ?? 0,
        law: giftHeavy.main.law,
        condition: giftHeavy.main.condition,
        localEducationRate: giftHeavy.surtax.local_education.rate ?? 0,
        ruralSpecialRate: giftHeavy.surtax.rural_special.rate ?? 0,
        ruralExemptUnderNationalHousing:
          giftHeavy.surtax.rural_special.exempt_under_national_housing === true,
        reasons,
      });
    }
  }

  // 3) 대도시 법인 중과 (주택 외 부동산 유상취득)
  if (
    input.ownerType === 'CORPORATION' &&
    input.cause === 'PAID' &&
    input.isMetropolitanCorpHeavy === true &&
    !isHouseForRate(input.propertyKind)
  ) {
    const metro = acq.corporate_metropolitan;
    rb.checkReview(metro.main, '대도시 법인 중과');
    reasons.push('대도시 내 법인 중과 요건 충족 → 표준세율×3 − 중과기준세율×2');
    return withLuxury(input, ruleset, rb, {
      rate: metro.main.rate ?? 0,
      law: metro.main.law,
      condition: metro.main.condition,
      localEducationRate: metro.surtax.local_education.rate ?? 0,
      ruralSpecialRate: metro.surtax.rural_special.rate ?? 0,
      ruralExemptUnderNationalHousing:
        metro.surtax.rural_special.exempt_under_national_housing === true,
      reasons,
    });
  }

  // 4) 표준세율
  const std = pickStandardCase(input, acq);
  rb.checkReview(std.case.main, '취득세 표준세율');
  reasons.push(`${std.case.main.condition} → 표준세율 ${pct(std.case.main.rate ?? 0)}`);
  return withLuxury(input, ruleset, rb, {
    rate: std.case.main.rate ?? 0,
    law: std.case.main.law,
    condition: std.case.main.condition,
    localEducationRate: std.case.surtax.local_education.rate ?? 0,
    ruralSpecialRate: std.case.surtax.rural_special.rate ?? 0,
    ruralExemptUnderNationalHousing:
      std.case.surtax.rural_special.exempt_under_national_housing === true,
    reasons,
  });
}

type AcqCase = Ruleset['acquisition']['standard']['paid_general'];
type AcqHouseBracket = Ruleset['acquisition']['house_paid']['brackets'][number];

/** 주택 유상취득 구간 선택. up_to('이하' 경계)가 main 안에 있다. */
function pickHouseBracket(
  price: Won,
  brackets: readonly AcqHouseBracket[],
): AcqHouseBracket {
  for (const bracket of brackets) {
    if (bracket.main.up_to === null || price <= bracket.main.up_to) return bracket;
  }
  const last = brackets[brackets.length - 1];
  if (last === undefined) {
    throw new Error('pickHouseBracket: 주택 구간표가 비어 있습니다.');
  }
  return last;
}

function pickStandardCase(
  input: AcquisitionInput,
  acq: Ruleset['acquisition'],
): { case: AcqCase } {
  const isFarmland = input.propertyKind === 'FARMLAND';
  switch (input.cause) {
    case 'PAID':
      return {
        case: isFarmland ? acq.standard.paid_farmland : acq.standard.paid_general,
      };
    case 'INHERITANCE':
      return {
        case: isFarmland
          ? acq.standard.inheritance_farmland
          : acq.standard.inheritance_general,
      };
    case 'GIFT':
      return { case: acq.standard.gift };
    case 'ORIGINAL':
      return { case: acq.standard.original };
  }
}

/** 다주택·법인 주택 취득 중과 (지방세법 §13의2) */
function resolveHouseHeavy(
  input: AcquisitionInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  reasons: string[],
): MainRate | null {
  const heavy = ruleset.acquisition.heavy;

  const toRate = (c: AcqCase, why: string): MainRate => {
    rb.checkReview(c.main, '주택 취득 중과세율');
    reasons.push(why);
    return withLuxury(input, ruleset, rb, {
      rate: c.main.rate ?? 0,
      law: c.main.law,
      condition: c.main.condition,
      localEducationRate: c.surtax.local_education.rate ?? 0,
      ruralSpecialRate: c.surtax.rural_special.rate ?? 0,
      ruralExemptUnderNationalHousing:
        c.surtax.rural_special.exempt_under_national_housing === true,
      reasons,
    });
  };

  if (input.ownerType === 'CORPORATION') {
    return toRate(heavy.corporation, '법인의 주택 유상취득 → 중과 (주택 수 무관)');
  }

  const count = input.houseCount;
  if (count === undefined) {
    rb.warnExpert(
      '취득 후 주택 수가 입력되지 않아 다주택 중과(§13의2) 판정을 할 수 없습니다. 1주택으로 보고 일반세율을 적용했습니다.',
    );
    return null;
  }
  if (input.isAdjustedArea === undefined) {
    rb.warnExpert(
      '조정대상지역 여부가 입력되지 않아 다주택 중과 판정 정확도가 떨어집니다. 비조정지역으로 보고 계산했습니다.',
    );
  }

  const adjusted = input.isAdjustedArea === true;
  if (adjusted) {
    if (count >= 3) {
      return toRate(
        heavy.adjusted_3house_plus,
        `조정대상지역 + 취득 후 ${count}주택 → 중과`,
      );
    }
    if (count === 2) {
      return toRate(heavy.adjusted_2house, `조정대상지역 + 취득 후 2주택 → 중과`);
    }
    return null;
  }
  if (count >= 4) {
    return toRate(
      heavy.non_adjusted_4house_plus,
      `비조정지역 + 취득 후 ${count}주택 → 중과`,
    );
  }
  if (count === 3) {
    return toRate(heavy.non_adjusted_3house, '비조정지역 + 취득 후 3주택 → 중과');
  }
  return null;
}

/** 사치성재산 중과: 표준세율 + 중과기준세율(2%)×4 = +8%p (지방세법 §13⑤) */
function withLuxury(
  input: AcquisitionInput,
  ruleset: Ruleset,
  rb: ResultBuilder,
  main: MainRate,
): MainRate {
  if (input.isLuxury !== true) return main;
  const luxury = ruleset.acquisition.luxury;
  rb.checkReview(luxury, '사치성재산 중과');
  const rate = round6(main.rate + luxury.surcharge_rate);
  const rural = round6(main.ruralSpecialRate + luxury.rural_special_surcharge_rate);
  return {
    ...main,
    rate,
    ruralSpecialRate: rural,
    ruralExemptUnderNationalHousing: false, // 고급주택은 국민주택규모 비과세 대상이 아니다
    reasons: [
      ...main.reasons,
      `사치성재산 중과: ${pct(main.rate)} + ${pct(luxury.surcharge_rate)} = ${pct(rate)}`,
      `농어촌특별세 중과분 가산: ${pct(main.ruralSpecialRate)} + ${pct(luxury.rural_special_surcharge_rate)} = ${pct(rural)}`,
    ],
  };
}

/** 부동소수점 누적오차 제거 (세율은 소수 6자리까지) */
function round6(rate: number): Rate {
  return Math.round(rate * 1_000_000) / 1_000_000;
}

function pct(rate: Rate): string {
  return `${(rate * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

export { round6, pct };
