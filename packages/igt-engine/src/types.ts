// 상속·증여세 엔진 타입 (W11-g g3) - 값은 없고 모양만 있다. 룰셋 값은 rules-igt/ 와 DB(igt_rulesets)에서 오며 코드에는 세율·한도 숫자를 두지 않는다
// (단, 안심 원본 calc_igt.py 가 코드에 박아 둔 상수는 동일 출력 이식을 위해 engine.ts 에 그대로 있고 SOURCE.json 에 목록으로 남긴다).

/** 계산 입력 - 브라우저 메모리에서만 만들어지고 저장·전송하지 않는다 */
export type IgtInput = Readonly<Record<string, unknown>>;

/** [단계 이름, 금액, 설명, 근거 조문] */
export type IgtStep = [name: string, amount: number, description: string, basis: string];

export interface IgtScheduleRow {
  no: number;
  due: string;
  principal: number;
  surcharge: number;
  total: number;
}

export interface IgtSchedule {
  years: number;
  installments: number;
  rate: number;
  rate_as_of: string | null;
  rows: IgtScheduleRow[];
  total_surcharge: number;
  basis: string;
  note: string;
}

/** 납부 방법 안내 데이터 (분납·연부연납·물납) */
export interface IgtPaymentGuide {
  final_tax: number;
  installment?: string;
  installment_limit?: number;
  annual_installment?: string;
  annual_installment_schedule?: IgtSchedule;
  payment_in_kind_rule?: string;
  payment_in_kind_detail?: string;
  payment_in_kind_hint?: string;
}

export interface IgtResultBase {
  ruleset_version: string;
  steps: IgtStep[];
  tax_base: number;
  output_tax: number;
  surcharge: number;
  final_tax: number;
  filing_due: string;
  filing_due_basis: string;
  payment: IgtPaymentGuide;
  warnings: string[];
}

export interface GiftResult extends IgtResultBase {
  type: "gift";
}

export interface InheritanceResult extends IgtResultBase {
  type: "inheritance";
  taxable_amount: number;
  total_deduction: number;
  filing_months: number;
}

/** 입력 오류·룰셋 오류 - name 으로 구분한다 (클래스를 내보내지 않는다: 이 패키지의 내보내기는 함수 둘뿐) */
export interface IgtCalcError extends Error {
  name: "IgtCalcError";
}

interface Bracket {
  upto: number | null;
  rate: number;
  progressive_deduction: number;
}

interface Verifiable {
  basis: string;
  needs_verification?: boolean;
}

/** 룰셋 본문 - 최상위 칸은 common·gift·inheritance·payment 뿐 (DB igt_rulesets 가 같은 목록을 강제) */
export interface IgtRuleset {
  version: string;
  effective_from: string;
  effective_to?: string | null;
  common: {
    tax_brackets: Bracket[];
    tax_brackets_meta: Verifiable;
    reporting_tax_credit_rate: { rate: number } & Verifiable;
    generation_skip_surcharge: { base_rate: number; enhanced: { rate: number } } & Verifiable;
  };
  gift: {
    deductions: Record<string, unknown> & { marriage_birth: { combined_limit: number; basis: string } };
    aggregation_years: number;
    filing: Verifiable;
  };
  inheritance: {
    deductions: {
      basic: number;
      other_personal: { child: number; minor_per_year: number; elderly: number; disabled_per_year: number };
      lump_sum: { amount: number };
      spouse: { min: number; max: number } & Verifiable;
      financial_asset: { rate: number; max: number } & Verifiable;
      cohabiting_house: { rate: number; max: number } & Verifiable;
    };
    prior_gift_addback: { heir_years: number; non_heir_years: number };
    deemed_assets: Verifiable;
    filing: Verifiable;
  };
  payment: {
    installment: {
      threshold: number;
      rule: string;
      basis: string;
      needs_verification?: boolean;
      limit?: { small_max: number; large_rate: number };
    };
    annual_installment: {
      threshold: number;
      rule: string;
      basis: string;
      needs_verification?: boolean;
      surcharge_rate?: number | null;
      surcharge_rate_meta?: { as_of?: string } | null;
    };
    payment_in_kind: { scope: string; needs_verification?: boolean; charge_order?: string; limit_detail?: string };
  };
}
