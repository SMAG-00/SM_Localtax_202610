import { describe, expect, it } from 'vitest';
import { RULESET, RULESET_RAW } from './ruleset';
import { RulesetSchema, collectReviewRequired, parseRuleset } from '../src/schema';
import { houseP6to9Linear, resolveFormula } from '../src/formulas';

describe('룰셋 스키마 검증', () => {
  it('프로덕션 룰셋 /rules/2026.01.json 이 스키마를 통과한다', () => {
    const parsed = parseRuleset(RULESET_RAW);
    expect(parsed.version).toBe('2026.01');
    expect(parsed.effective_from).toBe('2026-01-01');
  });

  it('source_laws에 지방세법·소득세법·종부세법·법인세법이 모두 들어 있다 (법령 감시 하네스 연결점)', () => {
    const names = RULESET.source_laws.map((l) => l.law_name);
    expect(names).toContain('지방세법');
    expect(names).toContain('소득세법');
    expect(names).toContain('종합부동산세법');
    expect(names).toContain('법인세법');
    for (const law of RULESET.source_laws) {
      expect(law.law_id).not.toBe('');
      expect(law.시행일자).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(law.확인일자).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('rate와 formula를 둘 다 가진 항목은 스키마가 거부한다', () => {
    const broken = structuredClone(RULESET_RAW) as Record<string, any>;
    broken.acquisition.standard.paid_general.main.formula = 'HOUSE_PAID_6TO9_LINEAR';
    expect(() => RulesetSchema.parse(broken)).toThrow();
  });

  it('rate도 formula도 없는 항목은 스키마가 거부한다', () => {
    const broken = structuredClone(RULESET_RAW) as Record<string, any>;
    delete broken.acquisition.standard.paid_general.main.rate;
    expect(() => RulesetSchema.parse(broken)).toThrow();
  });

  it('근거조문(law)이 없는 항목은 스키마가 거부한다', () => {
    const broken = structuredClone(RULESET_RAW) as Record<string, any>;
    delete broken.acquisition.standard.gift.main.law;
    expect(() => RulesetSchema.parse(broken)).toThrow();
  });

  it('version이 YYYY.NN 형식이 아니면 거부한다', () => {
    const broken = structuredClone(RULESET_RAW) as Record<string, any>;
    broken.version = '2026-01';
    expect(() => RulesetSchema.parse(broken)).toThrow();
  });

  it('등록되지 않은 수식 ID는 스키마가 거부한다 (룰셋을 통한 코드 주입 차단)', () => {
    const broken = structuredClone(RULESET_RAW) as Record<string, any>;
    broken.acquisition.house_paid.brackets[1].main.formula = 'process.exit(1)';
    expect(() => RulesetSchema.parse(broken)).toThrow();
  });

  it('resolveFormula는 등록되지 않은 ID를 거부한다', () => {
    expect(() => resolveFormula('EVIL_FORMULA')).toThrow(/등록되지 않은 수식 ID/);
  });

  it('모든 세율 항목의 근거조문이 실제 조문 형식(법령명 + §조항 또는 별표)을 갖는다', () => {
    const laws = collectLaws(RULESET);
    expect(laws.length).toBeGreaterThan(30);
    for (const law of laws) {
      // "지방세법 §11①8" 또는 "주택도시기금법 시행령 별표" 형식
      expect(law, `근거조문 형식 위반: ${law}`).toMatch(/^[가-힣]+법.*(§\d+|별표)/);
    }
  });

  it('REVIEW_REQUIRED 항목을 수집할 수 있다 (세무본부 검수 범위)', () => {
    const flagged = collectReviewRequired(RULESET);
    // 다주택 중과, 공정시장가액비율, 국민주택채권 등은 반드시 검수 대상이어야 한다
    expect(flagged.length).toBeGreaterThan(10);
    const joined = flagged.join('\n');
    expect(joined).toContain('acquisition.heavy');
    expect(joined).toContain('acquisition.housing_bond');
  });
});

describe('주택 유상취득 6~9억 구간 산식 (지방세법 §11①8)', () => {
  it('6억에서 1%가 되어 하위 구간과 연속된다', () => {
    // (600,000,000 × 2 ÷ 3억) − 3 = 4 − 3 = 1%
    expect(houseP6to9Linear(600_000_000)).toBeCloseTo(0.01, 10);
  });

  it('9억에서 3%가 되어 상위 구간과 연속된다', () => {
    // (900,000,000 × 2 ÷ 3억) − 3 = 6 − 3 = 3%
    expect(houseP6to9Linear(900_000_000)).toBeCloseTo(0.03, 10);
  });

  it('7.5억 → 정확히 2%', () => {
    // (750,000,000 × 2 ÷ 3억) − 3 = 5 − 3 = 2%
    expect(houseP6to9Linear(750_000_000)).toBeCloseTo(0.02, 10);
  });

  it('7억 → 1.6667% (소수점 다섯째자리에서 반올림하여 넷째자리까지)', () => {
    // (700,000,000 × 2 ÷ 3억) − 3 = 4.666666... − 3 = 1.666666...% → 1.6667%
    expect(houseP6to9Linear(700_000_000)).toBe(0.016667);
  });

  it('산식은 구간 내에서 단조증가한다', () => {
    let prev = -1;
    for (let p = 600_000_000; p <= 900_000_000; p += 10_000_000) {
      const rate = houseP6to9Linear(p);
      expect(rate).toBeGreaterThan(prev);
      prev = rate;
    }
  });
});

/** 룰셋 전체를 훑어 law 필드를 모은다 */
function collectLaws(node: unknown, acc: string[] = []): string[] {
  if (node === null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((child) => collectLaws(child, acc));
    return acc;
  }
  const obj = node as Record<string, unknown>;
  if (typeof obj.law === 'string') acc.push(obj.law);
  Object.values(obj).forEach((value) => collectLaws(value, acc));
  return acc;
}
