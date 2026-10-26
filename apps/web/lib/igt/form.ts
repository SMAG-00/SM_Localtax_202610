// 상속·증여세 입력 폼 -> 엔진 입력 (FAM-10·11) - 순수 함수. 입력값은 브라우저 메모리의 폼 상태에만 있고 이 파일은 어디에도 저장·전송하지 않는다.
// 입력 항목은 안심 원본 엔진이 받는 항목 그대로다 [감수 필요]. 숫자 칸은 글자로 받아 쉼표·공백을 지우고 0 이상 정수만 받는다.

export type FormResult = { ok: true; input: Record<string, unknown> } | { ok: false; errors: string[] };

/** 원 단위 글자 -> 정수. 빈 칸은 0. 음수·소수·글자는 null */
export function parseWon(s: string): number | null {
  const t = s.replace(/[,\s원]/g, "");
  if (t === "") return 0;
  if (!/^\d{1,15}$/.test(t)) return null;
  return Number(t);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface GiftForm {
  giftDate: string;
  relationship: string;
  minor: boolean;
  resident: boolean;
  giftValue: string;
  deductionUsed: string;
  priorValue: string;
  priorTax: string;
  marriageBirth: boolean;
  marriageBirthUsed: string;
  generationSkip: boolean;
  filedOnTime: boolean;
  annualYears: string;
}
export const GIFT_FORM_EMPTY: GiftForm = {
  giftDate: "",
  relationship: "lineal_ascendant",
  minor: false,
  resident: true,
  giftValue: "",
  deductionUsed: "",
  priorValue: "",
  priorTax: "",
  marriageBirth: false,
  marriageBirthUsed: "",
  generationSkip: false,
  filedOnTime: true,
  annualYears: "",
};

export function buildGiftInput(f: GiftForm): FormResult {
  const errors: string[] = [];
  const n = (label: string, s: string): number => {
    const v = parseWon(s);
    if (v === null) {
      errors.push(`${label}: 0 이상의 숫자만 입력합니다`);
      return 0;
    }
    return v;
  };
  if (!DATE.test(f.giftDate)) errors.push("증여일: 날짜를 고릅니다");
  const giftValue = n("증여재산가액", f.giftValue);
  if (giftValue <= 0 && errors.length === 0) errors.push("증여재산가액: 0보다 커야 합니다");
  const input: Record<string, unknown> = {
    gift_date: f.giftDate,
    donor_relationship: f.relationship,
    recipient_is_minor: f.minor,
    recipient_is_resident: f.resident,
    gift_value: giftValue,
    deduction_used_10y: n("10년 내 이미 쓴 증여재산공제", f.deductionUsed),
    marriage_birth: { applicable: f.marriageBirth, already_used: n("이미 쓴 혼인·출산 공제", f.marriageBirthUsed) },
    generation_skip: f.generationSkip,
    filed_on_time: f.filedOnTime,
  };
  const priorValue = n("10년 내 같은 증여자 증여 합계", f.priorValue);
  const priorTax = n("그 증여의 이미 낸 산출세액", f.priorTax);
  input.prior_gifts_same_donor_10y = priorValue > 0 || priorTax > 0 ? [{ value: priorValue, output_tax: priorTax }] : [];
  if (f.annualYears.trim() !== "") {
    const y = Number(f.annualYears);
    if (!Number.isInteger(y) || y < 1 || y > 20) errors.push("연부연납 희망 연수: 1~20 사이 정수");
    else input.annual_installment_years = y;
  }
  return errors.length ? { ok: false, errors } : { ok: true, input };
}

export interface InheritanceForm {
  deathDate: string;
  resident: boolean;
  realEstate: string;
  financial: string;
  securities: string;
  otherAssets: string;
  deemed: string;
  debts: string;
  charges: string;
  funeral: string;
  spouseExists: boolean;
  childrenCount: string;
  minorAges: string;
  elderlyCount: string;
  spouseActual: string;
  netFinancial: string;
  bequestsNonHeirs: string;
  priorHeirsValue: string;
  priorHeirsTax: string;
  priorOthersValue: string;
  priorOthersTax: string;
  cohabiting: boolean;
  cohabitingValue: string;
  familyBusiness: boolean;
  skipShare: string;
  skipMinorOver: boolean;
  heirAbroad: boolean;
  filedOnTime: boolean;
  annualYears: string;
}
export const INHERITANCE_FORM_EMPTY: InheritanceForm = {
  deathDate: "",
  resident: true,
  realEstate: "",
  financial: "",
  securities: "",
  otherAssets: "",
  deemed: "",
  debts: "",
  charges: "",
  funeral: "",
  spouseExists: false,
  childrenCount: "0",
  minorAges: "",
  elderlyCount: "0",
  spouseActual: "",
  netFinancial: "",
  bequestsNonHeirs: "",
  priorHeirsValue: "",
  priorHeirsTax: "",
  priorOthersValue: "",
  priorOthersTax: "",
  cohabiting: false,
  cohabitingValue: "",
  familyBusiness: false,
  skipShare: "",
  skipMinorOver: false,
  heirAbroad: false,
  filedOnTime: true,
  annualYears: "",
};

export function buildInheritanceInput(f: InheritanceForm): FormResult {
  const errors: string[] = [];
  const n = (label: string, s: string): number => {
    const v = parseWon(s);
    if (v === null) {
      errors.push(`${label}: 0 이상의 숫자만 입력합니다`);
      return 0;
    }
    return v;
  };
  const count = (label: string, s: string): number => {
    const v = Number(s.trim() === "" ? "0" : s);
    if (!Number.isInteger(v) || v < 0 || v > 50) {
      errors.push(`${label}: 0~50 사이 정수`);
      return 0;
    }
    return v;
  };
  if (!DATE.test(f.deathDate)) errors.push("상속개시일(사망일): 날짜를 고릅니다");
  const assets = { real_estate: n("부동산", f.realEstate), financial: n("금융재산", f.financial), securities: n("유가증권", f.securities), other: n("그 밖의 재산", f.otherAssets) };
  const deemedValue = n("간주상속재산(보험금·신탁·퇴직금)", f.deemed);
  if (Object.values(assets).reduce((a, b) => a + b, 0) + deemedValue <= 0 && errors.length === 0) errors.push("상속재산: 합계가 0보다 커야 합니다");
  const ages = f.minorAges
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
  if (ages.some((a) => !Number.isInteger(a) || a < 0 || a > 18)) errors.push("미성년 자녀 나이: 0~18 사이 정수를 쉼표로 나눠 입력합니다");
  const input: Record<string, unknown> = {
    death_date: f.deathDate,
    decedent_resident: f.resident,
    assets,
    deemed_assets: deemedValue > 0 ? { deemed: deemedValue } : {},
    debts: n("채무", f.debts),
    public_charges: n("공과금", f.charges),
    funeral_expenses: n("장례비", f.funeral),
    heirs: {
      spouse_exists: f.spouseExists,
      children_count: count("자녀 수", f.childrenCount),
      minor_children: ages.filter((a) => Number.isInteger(a)).map((age) => ({ age })),
      elderly_count: count("65세 이상 상속인·동거가족 수", f.elderlyCount),
    },
    spouse_actual_inheritance: n("배우자가 실제 상속받는 금액", f.spouseActual),
    bequests_to_non_heirs: n("상속인 아닌 사람에게 유증한 재산", f.bequestsNonHeirs),
    prior_gifts: {
      to_heirs_10y: [{ v: n("상속인에게 10년 내 증여", f.priorHeirsValue), t: n("그 증여의 이미 낸 산출세액", f.priorHeirsTax) }]
        .filter((x) => x.v > 0 || x.t > 0)
        .map((x) => ({ value: x.v, output_tax: x.t })),
      to_others_5y: [{ v: n("상속인 아닌 사람에게 5년 내 증여", f.priorOthersValue), t: n("그 증여의 이미 낸 산출세액", f.priorOthersTax) }]
        .filter((x) => x.v > 0 || x.t > 0)
        .map((x) => ({ value: x.v, output_tax: x.t })),
    },
    cohabiting_house: { applicable: f.cohabiting, house_value_net: n("동거주택 가액(담보채무 차감)", f.cohabitingValue) },
    family_business: { applicable: f.familyBusiness },
    generation_skip_minor_over_2b: f.skipMinorOver,
    heir_abroad: f.heirAbroad,
    filed_on_time: f.filedOnTime,
  };
  if (f.netFinancial.trim() !== "") input.net_financial_assets = n("순금융재산", f.netFinancial);
  if (f.skipShare.trim() !== "") {
    const s = Number(f.skipShare);
    if (!(s > 0 && s <= 1)) errors.push("세대생략 할증 대상 재산 비율: 0보다 크고 1 이하 (예 0.5)");
    else input.generation_skip_share = s;
  }
  if (f.annualYears.trim() !== "") {
    const y = Number(f.annualYears);
    if (!Number.isInteger(y) || y < 1 || y > 20) errors.push("연부연납 희망 연수: 1~20 사이 정수");
    else input.annual_installment_years = y;
  }
  return errors.length ? { ok: false, errors } : { ok: true, input };
}
