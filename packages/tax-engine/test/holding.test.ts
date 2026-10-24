import { describe, expect, it } from 'vitest';
import { RULESET } from './ruleset';
import { calcHolding, type HoldingInput } from '../src/holding';
import type { CalcResult } from '../src/result';

const run = (input: HoldingInput): CalcResult => calcHolding(input, RULESET);

const amountOf = (r: CalcResult, code: string): number =>
  r.items.find((i) => i.code === code)?.amount ?? -1;

const amountsOf = (r: CalcResult, code: string): number[] =>
  r.items.filter((i) => i.code === code).map((i) => i.amount);

describe('보유세 — 재산세(주택)', () => {
  it('1세대1주택 공시 5억 → 특례세율 + 특례 공정시장가액비율 44%', () => {
    // 과세표준 = 500,000,000 × 44% = 220,000,000  (→ 1.5억 초과 3억 이하 구간)
    // 특례세율 1.5억~3억 구간: 0.2%, 누진공제 180,000
    // 재산세   = 220,000,000 × 0.2% − 180,000 = 440,000 − 180,000 = 260,000
    // 지방교육세 = 260,000 × 20% = 52,000
    // 지역자원시설세 = 500,000,000 × 0.12% − 27,700 = 600,000 − 27,700 = 572,300
    // 종부세   = 공시 5억 ≤ 1세대1주택 공제 12억 → 0
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      isSingleHouseOneHousehold: true,
    });
    expect(amountOf(r, 'PROP_TAX_HOUSE')).toBe(260_000);
    expect(amountOf(r, 'PROP_LOCAL_EDU')).toBe(52_000);
    expect(amountOf(r, 'REGIONAL_RESOURCE')).toBe(572_300);
    expect(amountOf(r, 'CRET_HOUSE')).toBe(0);
    expect(r.total).toBe(884_300);
  });

  it('1세대1주택 특례세율이 표준세율보다 실제로 유리하다 (동일 공시가격 비교)', () => {
    // 같은 공시 5억이라도 특례(공정 44% + 저율) 260,000 vs 표준(공정 60% + 표준율) 570,000
    const special = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      isSingleHouseOneHousehold: true,
    });
    const standard = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      isSingleHouseOneHousehold: false,
    });
    expect(amountOf(special, 'PROP_TAX_HOUSE')).toBeLessThan(
      amountOf(standard, 'PROP_TAX_HOUSE'),
    );
  });

  it('1세대1주택이 아니면 표준세율 + 공정시장가액비율 60%가 적용된다', () => {
    // 과세표준 = 500,000,000 × 60% = 300,000,000  (3억 이하 구간 경계 포함)
    // 표준세율 1.5억~3억 구간: 0.25%, 누진공제 180,000
    // 재산세   = 300,000,000 × 0.25% − 180,000 = 750,000 − 180,000 = 570,000
    // 지방교육세 = 114,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      isSingleHouseOneHousehold: false,
    });
    expect(amountOf(r, 'PROP_TAX_HOUSE')).toBe(570_000);
    expect(amountOf(r, 'PROP_LOCAL_EDU')).toBe(114_000);
    expect(r.total).toBe(1_256_300); // 570,000 + 572,300 + 114,000
  });

  it('[경계] 1세대1주택이라도 공시 9억 초과면 특례세율을 못 쓴다', () => {
    // 공시 9억 초과 → 표준세율 + 공정 60%
    // 과세표준 = 1,000,000,000 × 60% = 600,000,000
    // 재산세 = 600,000,000 × 0.4% − 630,000 = 2,400,000 − 630,000 = 1,770,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [1_000_000_000],
      isSingleHouseOneHousehold: true,
    });
    expect(amountOf(r, 'PROP_TAX_HOUSE')).toBe(1_770_000);
  });

  it('지분 50% 공동소유면 과세표준이 절반이 된다', () => {
    // 지분 = 500,000,000 × 50% = 250,000,000
    // 과세표준 = 250,000,000 × 60% = 150,000,000  (6천만~1.5억 구간 경계 포함)
    // 재산세 = 150,000,000 × 0.15% − 30,000 = 225,000 − 30,000 = 195,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      ownershipRatio: 0.5,
    });
    expect(amountOf(r, 'PROP_TAX_HOUSE')).toBe(195_000);
  });

  it('도시지역분은 명시적으로 켜야 과세된다 (미지정 시 경고)', () => {
    const off = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
    });
    expect(amountOf(off, 'PROP_TAX_URBAN')).toBe(-1); // 항목 없음
    expect(off.warnings.join()).toContain('도시지역분');

    // 과세표준 300,000,000 × 0.14% = 420,000
    const on = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      isUrbanArea: true,
    });
    expect(amountOf(on, 'PROP_TAX_URBAN')).toBe(420_000);
  });
});

describe('보유세 — 종합부동산세', () => {
  it('개인 2주택 (공시 10억 + 8억) → 종부세 발생', () => {
    // [재산세]
    //  10억 × 60% = 600,000,000 → 600,000,000 × 0.4% − 630,000 = 1,770,000
    //   8억 × 60% = 480,000,000 → 480,000,000 × 0.4% − 630,000 = 1,290,000
    //  합계 3,060,000 → 지방교육세 612,000
    // [지역자원시설세] 10억: 1,172,300 / 8억: 932,300
    // [종부세]
    //  공시합계 18억 − 기본공제 9억 = 9억 → × 60% = 540,000,000
    //  2주택 이하 3억~6억 구간: 0.7%, 누진공제 600,000
    //  산출세액 = 540,000,000 × 0.7% − 600,000 = 3,780,000 − 600,000 = 3,180,000
    //  재산세 공제 = (540,000,000 × 60% = 324,000,000) → 324,000,000 × 0.4% − 630,000 = 666,000
    //  종부세 = 3,180,000 − 666,000 = 2,514,000
    //  농특세 = 2,514,000 × 20% = 502,800
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [1_000_000_000, 800_000_000],
    });
    expect(amountsOf(r, 'PROP_TAX_HOUSE')).toEqual([1_770_000, 1_290_000]);
    expect(amountOf(r, 'PROP_LOCAL_EDU')).toBe(612_000);
    expect(amountOf(r, 'CRET_HOUSE')).toBe(2_514_000);
    expect(amountOf(r, 'CRET_RURAL')).toBe(502_800);
    expect(r.total).toBe(8_793_400);
  });

  it('[경계] 1세대1주택 공시 12억 이하면 종부세가 0이다', () => {
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [1_200_000_000],
      isSingleHouseOneHousehold: true,
    });
    expect(amountOf(r, 'CRET_HOUSE')).toBe(0);
    expect(amountOf(r, 'CRET_RURAL')).toBe(-1); // 종부세 0이므로 농특세 항목 없음
  });

  it('법인은 기본공제 없이 정율세율(2.7%)이 적용된다', () => {
    // 과세표준 = 1,000,000,000 × 60% = 600,000,000  (공제 없음)
    // 산출세액 = 600,000,000 × 2.7% = 16,200,000
    // 재산세 공제 = (600,000,000 × 60% = 360,000,000) → 360,000,000 × 0.4% − 630,000 = 810,000
    // 종부세 = 16,200,000 − 810,000 = 15,390,000 / 농특세 = 3,078,000
    const r = run({
      ownerType: 'CORPORATION',
      propertyKind: 'HOUSE',
      publishedPrices: [1_000_000_000],
    });
    expect(amountOf(r, 'CRET_HOUSE')).toBe(15_390_000);
    expect(amountOf(r, 'CRET_RURAL')).toBe(3_078_000);
    expect(r.total).toBe(21_764_300); // 1,770,000 + 1,172,300 + 354,000 + 15,390,000 + 3,078,000
  });

  it('법인은 공시 5억(개인이면 종부세 0)에도 종부세가 나온다 — 기본공제 배제 효과', () => {
    const individual = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
    });
    const corporation = run({
      ownerType: 'CORPORATION',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
    });
    expect(amountOf(individual, 'CRET_HOUSE')).toBe(0);
    expect(amountOf(corporation, 'CRET_HOUSE')).toBeGreaterThan(0);
  });

  it('1세대1주택 고령자·장기보유 세액공제는 합산 한도 80%가 적용된다', () => {
    // 공시 20억, 만 70세(40%), 보유 15년(50%) → 합 90% > 한도 80% → 80% 적용
    // 종부세 과세표준 = (20억 − 12억) × 60% = 480,000,000
    // 산출세액 = 480,000,000 × 0.7% − 600,000 = 3,360,000 − 600,000 = 2,760,000
    // 재산세 공제 = (480,000,000 × 60% = 288,000,000) → 288,000,000 × 0.25% − 180,000 = 540,000
    // 공제 후   = 2,760,000 − 540,000 = 2,220,000
    // 세액공제  = 2,220,000 × 80% = 1,776,000 → 종부세 = 444,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [2_000_000_000],
      isSingleHouseOneHousehold: true,
      ownerAge: 70,
      holdingYears: 15,
    });
    expect(amountOf(r, 'CRET_HOUSE')).toBe(444_000);
    expect(amountOf(r, 'CRET_RURAL')).toBe(88_800);
    expect(r.items.find((i) => i.code === 'CRET_HOUSE')?.reasons.join()).toContain(
      '한도',
    );
  });

  it('3주택 이상은 더 가파른 누진세율표를 쓴다 (2주택 이하보다 세액이 크다)', () => {
    // 동일 공시가격 합계(40억)에서 2주택 vs 3주택 비교
    const two = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [2_000_000_000, 2_000_000_000],
    });
    const three = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [2_000_000_000, 1_000_000_000, 1_000_000_000],
    });
    // 과세표준 = (40억 − 9억) × 60% = 1,860,000,000 → 12억~25억 구간
    // 2주택 이하: 1.3%, 누진공제 6,000,000 → 24,180,000 − 6,000,000 = 18,180,000
    // 3주택 이상: 2.0%, 누진공제 14,400,000 → 37,200,000 − 14,400,000 = 22,800,000
    expect(three.items.find((i) => i.code === 'CRET_HOUSE')?.rate).toBe(0.02);
    expect(two.items.find((i) => i.code === 'CRET_HOUSE')?.rate).toBe(0.013);
    expect(amountOf(three, 'CRET_HOUSE')).toBeGreaterThan(amountOf(two, 'CRET_HOUSE'));
  });
});

describe('보유세 — 토지 · 건축물', () => {
  it('종합합산 토지 공시 3억, 지분 50% → 재산세 275,000원', () => {
    // 지분 = 300,000,000 × 50% = 150,000,000
    // 과세표준 = 150,000,000 × 70% = 105,000,000  (1억 초과 구간)
    // 재산세 = 105,000,000 × 0.5% − 250,000 = 525,000 − 250,000 = 275,000
    // 지방교육세 = 55,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'LAND',
      publishedPrices: [300_000_000],
      ownershipRatio: 0.5,
      landType: 'COMPREHENSIVE',
    });
    expect(amountOf(r, 'PROP_TAX_LAND')).toBe(275_000);
    expect(amountOf(r, 'PROP_LOCAL_EDU')).toBe(55_000);
    expect(r.total).toBe(330_000);
  });

  it('별도합산 토지는 종합합산보다 세율이 낮다 (동일 과세표준 기준)', () => {
    const comprehensive = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'LAND',
      publishedPrices: [1_000_000_000],
      landType: 'COMPREHENSIVE',
    });
    const separate = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'LAND',
      publishedPrices: [1_000_000_000],
      landType: 'SEPARATE',
    });
    // 과세표준 = 700,000,000
    // 종합합산: 0.5%, 공제 250,000 → 3,500,000 − 250,000 = 3,250,000
    // 별도합산: 0.3%, 공제 200,000 → 2,100,000 − 200,000 = 1,900,000
    expect(amountOf(comprehensive, 'PROP_TAX_LAND')).toBe(3_250_000);
    expect(amountOf(separate, 'PROP_TAX_LAND')).toBe(1_900_000);
  });

  it('분리과세 농지는 0.07% 저율이 적용된다', () => {
    // 과세표준 = 300,000,000 × 70% = 210,000,000 → × 0.07% = 147,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'FARMLAND',
      publishedPrices: [300_000_000],
      landType: 'SPECIAL_FARMLAND',
    });
    expect(amountOf(r, 'PROP_TAX_LAND')).toBe(147_000);
  });

  it('상가(건축물)는 0.25% 단일세율이 적용된다', () => {
    // 과세표준 = 1,000,000,000 × 70% = 700,000,000 → × 0.25% = 1,750,000
    const r = run({
      ownerType: 'INDIVIDUAL',
      propertyKind: 'COMMERCIAL',
      publishedPrices: [1_000_000_000],
    });
    expect(amountOf(r, 'PROP_TAX_BUILDING')).toBe(1_750_000);
    expect(amountOf(r, 'PROP_LOCAL_EDU')).toBe(350_000);
  });
});

describe('보유세 — 입력 검증', () => {
  it('지분율이 0 이하 또는 1 초과면 예외를 던진다', () => {
    const input: HoldingInput = {
      ownerType: 'INDIVIDUAL',
      propertyKind: 'HOUSE',
      publishedPrices: [500_000_000],
      ownershipRatio: 1.5,
    };
    expect(() => run(input)).toThrow(/지분율/);
    expect(() => run({ ...input, ownershipRatio: 0 })).toThrow(/지분율/);
  });

  it('공시가격이 하나도 없으면 예외를 던진다', () => {
    expect(() =>
      run({ ownerType: 'INDIVIDUAL', propertyKind: 'HOUSE', publishedPrices: [] }),
    ).toThrow(/공시가격/);
  });
});

describe('보유세 — 1세대1주택 특례는 개인만 (법인은 "1세대"가 될 수 없다)', () => {
  const corp: HoldingInput = {
    ownerType: 'CORPORATION',
    propertyKind: 'HOUSE',
    publishedPrices: [800_000_000],
    isSingleHouseOneHousehold: true, // 화면이 법인일 때도 이 값을 그대로 넘긴다
    isUrbanArea: false,
  };

  it('법인이 isSingleHouseOneHousehold=true를 넘겨도 재산세 특례세율을 적용하지 않는다', () => {
    // 특례(잘못): 공정비율 45% → 과표 360,000,000 × 0.35% − 630,000 =   630,000
    // 표준(정답): 공정비율 60% → 과표 480,000,000 × 0.4%  − 630,000 = 1,290,000
    const r = run(corp);
    const prop = r.items.find((i) => i.code === 'PROP_TAX_HOUSE');
    expect(prop?.base).toBe(480_000_000);
    expect(prop?.rate).toBe(0.004);
    expect(prop?.amount).toBe(1_290_000);
    expect(prop?.reasons[0]).toContain('표준세율');
  });

  it('법인은 1세대1주택 여부와 무관하게 같은 재산세가 나온다', () => {
    const withFlag = run(corp);
    const withoutFlag = run({ ...corp, isSingleHouseOneHousehold: false });
    expect(withFlag.total).toBe(withoutFlag.total);
  });

  it('개인은 같은 입력에서 특례세율을 그대로 받는다 (회귀 방지)', () => {
    const r = run({ ...corp, ownerType: 'INDIVIDUAL' });
    const prop = r.items.find((i) => i.code === 'PROP_TAX_HOUSE');
    expect(prop?.rate).toBe(0.0035);
    expect(prop?.amount).toBe(630_000);
  });
});
