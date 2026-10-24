import { z } from 'zod';

/**
 * 세율 룰셋 스키마.
 *
 * 설계 원칙:
 *  - 모든 세율 항목은 { rate | formula } + condition + law 를 반드시 갖는다.
 *  - `formula`는 **명명된 수식 ID**다. 문자열 수식을 eval하지 않는다.
 *    (룰셋 JSON이 코드 실행 경로가 되면 안 되기 때문. 수식 본체는 formulas.ts의 레지스트리에 있다.)
 *  - `REVIEW_REQUIRED: true` = 세무본부 검수 대상. 엔진은 이 항목을 쓰면 warnings에 사유를 남긴다.
 */

/** 엔진이 해석할 수 있는 수식 ID 화이트리스트 */
export const FORMULA_IDS = [
  'HOUSE_PAID_6TO9_LINEAR', // 주택 유상취득 6억~9억 구간 선형 산식 (지방세법 §11①8)
] as const;
export type FormulaId = (typeof FORMULA_IDS)[number];

const formulaId = z.enum(FORMULA_IDS);

/** 근거조문. 예: "지방세법 §11①8" */
const law = z.string().min(1, '근거조문(law)은 필수다');
const condition = z.string().min(1, '적용조건(condition)은 필수다');

const reviewable = {
  REVIEW_REQUIRED: z.boolean().optional(),
  note: z.string().optional(),
};

/** rate 또는 formula 중 정확히 하나를 가져야 한다 */
const rateOrFormula = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object({
      rate: z.number().min(0).max(1).optional(),
      formula: formulaId.optional(),
      condition,
      law,
      ...reviewable,
      ...shape,
    })
    // zod 4: 일반형 T가 섞인 객체 타입에서 칸을 바로 읽으면 타입 오류라, 두 칸만 좁혀 읽는다 (동작 같음 - SOURCE.json notes)
    .refine((v) => ((v as { rate?: number }).rate !== undefined) !== ((v as { formula?: string }).formula !== undefined), {
      message: 'rate 또는 formula 중 정확히 하나만 있어야 한다',
    });

export const RateItemSchema = rateOrFormula({});
export type RateItem = z.infer<typeof RateItemSchema>;

/** 누진 구간. up_to = 상한(이하), null이면 무제한 */
export const BracketSchema = rateOrFormula({
  up_to: z.number().positive().nullable(),
  /** 누진공제액(원). 세액 = 과세표준 × 세율 − 누진공제 */
  deduction: z.number().min(0).optional(),
});
export type Bracket = z.infer<typeof BracketSchema>;

/** 정액세 구간 (인지세) */
export const FlatBracketSchema = z.object({
  up_to: z.number().positive().nullable(),
  amount: z.number().int().min(0),
  condition,
  law,
  ...reviewable,
});

export const SourceLawSchema = z.object({
  law_id: z.string().min(1),
  law_name: z.string().min(1),
  시행일자: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  확인일자: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ─────────────────────────────────────────────────────────────
// 취득 (acquisition)
// ─────────────────────────────────────────────────────────────

const SurtaxSchema = z.object({
  /** 지방교육세: 과세표준 × rate */
  local_education: RateItemSchema,
  /** 농어촌특별세: 과세표준 × rate. exempt_under_national_housing = 국민주택규모 이하 비과세 */
  rural_special: RateItemSchema.and(
    z.object({ exempt_under_national_housing: z.boolean().optional() }),
  ),
});

/** 취득세 본세 1건 = 세율 + 그에 딸린 부가세(지방교육세·농특세) */
const AcqCaseSchema = z.object({
  main: RateItemSchema,
  surtax: SurtaxSchema,
});

const AcqHouseBracketSchema = z.object({
  main: BracketSchema,
  surtax: SurtaxSchema,
});

export const AcquisitionSchema = z.object({
  /** 취득원인별 표준세율 (주택 유상취득 제외) */
  standard: z.object({
    paid_general: AcqCaseSchema,
    paid_farmland: AcqCaseSchema,
    inheritance_general: AcqCaseSchema,
    inheritance_farmland: AcqCaseSchema,
    gift: AcqCaseSchema,
    original: AcqCaseSchema,
  }),
  /** 주택 유상취득 구간세율 (6억 이하 / 6~9억 산식 / 9억 초과) */
  house_paid: z.object({
    brackets: z.array(AcqHouseBracketSchema).min(1),
    national_housing_area_sqm: z.number().positive(),
  }),
  /** 다주택·법인 주택 취득 중과 */
  heavy: z.object({
    corporation: AcqCaseSchema,
    adjusted_2house: AcqCaseSchema,
    adjusted_3house_plus: AcqCaseSchema,
    non_adjusted_3house: AcqCaseSchema,
    non_adjusted_4house_plus: AcqCaseSchema,
    /** 조정대상지역 3억 이상 주택 무상취득(증여) 중과 */
    gift_adjusted: AcqCaseSchema.and(
      z.object({ threshold_price: z.number().positive() }),
    ),
  }),
  /** 사치성재산 중과 (표준세율 + 중과기준세율×4 = +8%p) */
  luxury: z.object({
    surcharge_rate: z.number(),
    rural_special_surcharge_rate: z.number(),
    condition,
    law,
    ...reviewable,
  }),
  /** 대도시 법인 중과 (표준세율×3 − 중과기준세율×2) */
  corporate_metropolitan: AcqCaseSchema,
  /** 인지세 정액 구간표 */
  stamp_tax: z.object({
    brackets: z.array(FlatBracketSchema).min(1),
    house_exemption_under: z.number().positive(),
    condition,
    law,
    ...reviewable,
  }),
  /** 국민주택채권 매입율 + 즉시매도 할인율 */
  housing_bond: z.object({
    purchase_rate_brackets: z.array(BracketSchema).min(1),
    discount_rate: z.number().min(0).max(1),
    condition,
    law,
    ...reviewable,
  }),
  /** 중과기준세율 (지방세법 §6 19호) */
  heavy_base_rate: z.number(),
});

// ─────────────────────────────────────────────────────────────
// 보유 (holding)
// ─────────────────────────────────────────────────────────────

export const HoldingSchema = z.object({
  property_tax: z.object({
    house: z.object({
      brackets: z.array(BracketSchema).min(1),
      fair_market_ratio: z.number().min(0).max(1),
      /** 1세대1주택 특례세율 + 특례 공정시장가액비율 */
      single_house_special: z.object({
        brackets: z.array(BracketSchema).min(1),
        applies_under: z.number().positive(),
        fair_market_ratio_brackets: z.array(
          z.object({
            up_to: z.number().positive().nullable(),
            ratio: z.number().min(0).max(1),
            condition,
            law,
            ...reviewable,
          }),
        ),
        condition,
        law,
        ...reviewable,
      }),
    }),
    building: RateItemSchema,
    land: z.object({
      comprehensive: z.array(BracketSchema).min(1),
      separate: z.array(BracketSchema).min(1),
      special: z.object({
        farmland_forest: RateItemSchema,
        factory: RateItemSchema,
        luxury: RateItemSchema,
      }),
      fair_market_ratio: z.number().min(0).max(1),
    }),
    urban_area: RateItemSchema,
    local_education: RateItemSchema,
    regional_resource: z.object({
      brackets: z.array(BracketSchema).min(1),
      condition,
      law,
      ...reviewable,
    }),
  }),
  comprehensive_real_estate_tax: z.object({
    house: z.object({
      basic_deduction: z.number().int().min(0),
      single_house_deduction: z.number().int().min(0),
      fair_market_ratio: z.number().min(0).max(1),
      individual_2house_under: z.array(BracketSchema).min(1),
      individual_3house_plus: z.array(BracketSchema).min(1),
      corporation_2house_under: RateItemSchema,
      corporation_3house_plus: RateItemSchema,
      /** 1세대1주택 세액공제 (고령자 + 장기보유, 합산한도) */
      tax_credit: z.object({
        elderly: z.array(
          z.object({
            from_age: z.number().int().positive(),
            rate: z.number().min(0).max(1),
            condition,
            law,
            ...reviewable,
          }),
        ),
        long_term: z.array(
          z.object({
            from_years: z.number().int().positive(),
            rate: z.number().min(0).max(1),
            condition,
            law,
            ...reviewable,
          }),
        ),
        combined_limit: z.number().min(0).max(1),
      }),
      /** 세부담상한 */
      tax_burden_cap: z.number().min(1),
    }),
    rural_special: RateItemSchema,
  }),
});

// ─────────────────────────────────────────────────────────────
// 과점주주 간주취득 (oligopoly)
// ─────────────────────────────────────────────────────────────

export const OligopolySchema = z.object({
  /** 과점주주 판정 기준: 지분율 초과 시 */
  threshold: z.number().min(0).max(1),
  deemed_acquisition: RateItemSchema,
  surtax: z.object({
    local_education: RateItemSchema.and(z.object({ applies: z.boolean() })),
    rural_special: RateItemSchema,
  }),
});

// ─────────────────────────────────────────────────────────────

export const RulesetSchema = z.object({
  version: z.string().regex(/^\d{4}\.\d{2}$/, 'version은 YYYY.NN 형식이어야 한다'),
  /** 파일을 만들 때의 표시 (초안). 활성화 상태는 DB(rulesets)와 번들 목록이 정하며, 파일은 서명 뒤에도 고치지 않는다 */
  status: z.enum(['draft']).optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_laws: z.array(SourceLawSchema).min(1),
  acquisition: AcquisitionSchema,
  holding: HoldingSchema,
  oligopoly: OligopolySchema,
});

export type Ruleset = z.infer<typeof RulesetSchema>;

/** 룰셋을 검증하며 파싱한다. 실패 시 throw. */
export function parseRuleset(raw: unknown): Ruleset {
  return RulesetSchema.parse(raw);
}

/**
 * 룰셋 전체를 순회해 REVIEW_REQUIRED가 붙은 경로를 수집한다.
 * 세무본부 검수 범위 산출용.
 */
export function collectReviewRequired(node: unknown, path = ''): string[] {
  const found: string[] = [];
  if (node === null || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    node.forEach((child, i) =>
      found.push(...collectReviewRequired(child, `${path}[${i}]`)),
    );
    return found;
  }
  const obj = node as Record<string, unknown>;
  if (obj.REVIEW_REQUIRED === true) {
    const note = typeof obj.note === 'string' ? ` — ${obj.note}` : '';
    found.push(`${path || '(root)'}${note}`);
  }
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'REVIEW_REQUIRED' || key === 'note') continue;
    found.push(...collectReviewRequired(value, path ? `${path}.${key}` : key));
  }
  return found;
}
