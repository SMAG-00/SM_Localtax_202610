// 상속·증여세 결정론적 계산 엔진 (W11-g g3) - 「안심 상속증여계산기」 calc_igt.py 의 TypeScript 이식 (packages/igt-engine/SOURCE.json).
// 원칙: 순수 함수 둘뿐 - 네트워크·AI·환경변수·파일·시계 접근 0. 입력은 인자로만 받고 어디에도 저장하지 않는다 (FAM-10·11).
// 룰셋에 없는 수치는 쓰지 않는다. 다만 안심 원본이 코드에 박아 둔 상수(합산 하한 1천만원, 과세표준 최소 50만원, 세대생략 20억, 물납 2천만원 등)는
// 「안심 현행 동작과 원 단위 동일」을 증명하려고 그대로 옮겼다 - 감수 때 룰셋으로 옮길 목록이 SOURCE.json notes 에 있다.
import type {
  GiftResult,
  IgtCalcError,
  IgtInput,
  IgtPaymentGuide,
  IgtRuleset,
  IgtSchedule,
  IgtStep,
  InheritanceResult,
} from "./types";

type Rec = Record<string, unknown>;

// ── 입력 읽기 도우미 (Python dict.get·int·bool·or 의 동작을 그대로 따른다) ──────────────────
function calcError(message: string): IgtCalcError {
  const e = new Error(message) as IgtCalcError;
  e.name = "IgtCalcError";
  return e;
}
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Rec, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const get = (o: Rec, k: string, d: unknown): unknown => (has(o, k) ? o[k] : d);

/** Python 의 참/거짓 판정 (0·빈 문자열·빈 목록·빈 객체·null 은 거짓) */
function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isRec(v)) return Object.keys(v).length > 0;
  return true;
}
/** Python int() - 소수는 0 방향으로 버린다. 안전한 정수 범위를 벗어나면 계산하지 않는다 */
function int(v: unknown): number {
  let n: number;
  if (typeof v === "number" && Number.isFinite(v)) n = Math.trunc(v);
  else if (typeof v === "boolean") n = v ? 1 : 0;
  else if (typeof v === "string" && /^\s*[+-]?\d+\s*$/.test(v)) n = Number(v.trim());
  else throw new TypeError("int() 로 바꿀 수 없는 값입니다");
  if (!Number.isSafeInteger(n)) throw calcError("입력 값이 너무 큽니다 - 안전한 정수 범위(약 9천조)를 넘었습니다.");
  return n + 0; // -0 → 0
}
const neg = (n: number) => (n === 0 ? 0 : -n);
function rec(v: unknown): Rec {
  if (!isRec(v)) throw new TypeError("객체 입력이 필요한 자리에 다른 값이 있습니다");
  return v;
}
/** `x.get(k, d) or {}` */
const recOr = (o: Rec, k: string): Rec => {
  const v = get(o, k, {});
  return truthy(v) ? rec(v) : {};
};
/** `x.get(k, []) or []` */
const listOr = (o: Rec, k: string): unknown[] => {
  const v = get(o, k, []);
  if (!truthy(v)) return [];
  if (!Array.isArray(v)) throw new TypeError("목록 입력이 필요한 자리에 다른 값이 있습니다");
  return v;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function pyRepr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? `"${v}"` : `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}
/** Python 의 {x:g} - 유효 숫자 6자리, 끝의 0 제거 */
const fmtG = (x: number) => String(Number(x.toPrecision(6)));
const won = (n: number): string => {
  const i = Math.trunc(n);
  return `${i < 0 ? "-" : ""}${String(Math.abs(i)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
};

// ── 날짜 (UTC 없이 연·월·일만 - 시계 접근 0) ──────────────────────────────────────────────
interface Day {
  y: number;
  m: number;
  d: number;
}
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** 1970-01-01 을 0 으로 하는 일수 (윤년 규칙 직접 계산) */
function dayNumber({ y, m, d }: Day): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
const pad = (n: number, w: number) => String(n).padStart(w, "0");
const iso = ({ y, m, d }: Day) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;

function parseDate(s: unknown, field: string): Day {
  const m = typeof s === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s) : null;
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysIn(y, mo)) return { y, m: mo, d };
  }
  throw calcError(`${field} 는 YYYY-MM-DD 형식이어야 합니다: ${pyRepr(s)}`);
}
const monthEnd = ({ y, m }: Day): Day => ({ y, m, d: daysIn(y, m) });
function addMonthsClamped(day: Day, months: number): Day {
  let y = day.y;
  let m = day.m + months;
  y += Math.floor((m - 1) / 12);
  m = (((m - 1) % 12) + 12) % 12 + 1;
  return { y, m, d: Math.min(day.d, daysIn(y, m)) };
}
/** '~일이 속하는 달의 말일부터 N개월' 기한 - (사건이 속한 달 + N개월)의 말일 (민법 제157조·제160조) */
const filingDue = (base: Day, months: number): Day => monthEnd(addMonthsClamped(base, months));

function progressiveTax(taxable: number, brackets: IgtRuleset["common"]["tax_brackets"]): number {
  if (taxable <= 0) return 0;
  for (const b of brackets) {
    if (b.upto === null || taxable <= b.upto) return Math.trunc(taxable * b.rate - b.progressive_deduction) + 0;
  }
  throw calcError("세율 구간을 찾지 못했습니다 — 룰셋 tax_brackets 확인 필요.");
}

function checkEffective(rs: IgtRuleset, event: Day, label: string, warnings: string[]): void {
  const ef = parseDate(rs.effective_from, "룰셋 effective_from");
  if (dayNumber(event) < dayNumber(ef)) {
    warnings.push(`${label}(${iso(event)})이 룰셋 적용 시작일(${iso(ef)})보다 빠릅니다 — 당시 시행 룰셋이 아닐 수 있으니 archive 버전 확인 필요`);
  }
}

/** 증여자 관계 코드 → (룰셋 공제 키, 한국어 표시) */
const GIFT_RELATIONSHIPS: Record<string, [string | null, string]> = {
  spouse: ["spouse", "배우자"],
  lineal_ascendant: [null, "직계존속"],
  lineal_descendant: ["lineal_ascendant", "직계비속"],
  other_relative: ["other_relatives", "기타친족(4촌 이내 혈족·3촌 이내 인척)"],
  unrelated: [null, "타인(친족 아님)"],
};

function ensureRuleset(rs: IgtRuleset): void {
  if (rs.effective_to !== undefined && rs.effective_to !== null) {
    throw calcError(`룰셋 ${rs.version} 은 ${rs.effective_to} 로 마감되었습니다 — 현행 룰셋인지 확인하세요.`);
  }
}

// ══════════════════════════════════════════════════════════
// 증여세 (법 제47조 → 제53조·제53조의2 → 제55조 → 제26조·제56조 → 제57조 → 제58조 → 제69조)
// ══════════════════════════════════════════════════════════
export function calcGift(inp: IgtInput, rs: IgtRuleset): GiftResult {
  ensureRuleset(rs);
  const warnings: string[] = [];
  const steps: IgtStep[] = [];
  const input = rec(inp);
  if (!has(input, "gift_date")) throw Object.assign(new Error("KeyError: 'gift_date'"), { name: "KeyError" });
  const giftDate = parseDate(input.gift_date, "gift_date");
  checkEffective(rs, giftDate, "증여일", warnings);

  const rel = get(input, "donor_relationship", null);
  if (typeof rel !== "string" || !has(GIFT_RELATIONSHIPS, rel)) {
    throw calcError(`donor_relationship 은 ${"['" + Object.keys(GIFT_RELATIONSHIPS).join("', '") + "']"} 중 하나여야 합니다: ${pyRepr(rel)}`);
  }
  const minor = truthy(get(input, "recipient_is_minor", false));
  const resident = truthy(get(input, "recipient_is_resident", true));
  const giftValue = int(get(input, "gift_value", 0));
  if (giftValue <= 0) throw calcError("gift_value(증여재산가액)는 양수여야 합니다.");

  const g = rs.gift;
  const c = rs.common;

  // 1) 동일인 10년 합산 (제47조②)
  const prior = listOr(input, "prior_gifts_same_donor_10y");
  const priorValue = sum(prior.map((p) => int(get(rec(p), "value", 0))));
  const priorOutputTax = sum(prior.map((p) => int(get(rec(p), "output_tax", 0))));
  const aggThreshold = 10_000_000; // 합산 하한 1천만원 (제47조② 본문)
  const aggregated = priorValue >= aggThreshold ? priorValue : 0;
  if (priorValue > 0 && priorValue < aggThreshold) {
    warnings.push(`동일인 10년 내 증여 합계 ${won(priorValue)} < 1천만원 — 합산 대상 아님 (제47조②)`);
  }
  const taxableAmount = giftValue + aggregated;
  steps.push([
    "증여세 과세가액",
    taxableAmount,
    `증여재산가액 ${won(giftValue)}` + (aggregated ? ` + 동일인 ${int(g.aggregation_years)}년 내 합산 ${won(aggregated)}` : ""),
    "법 제47조제1항·제2항",
  ]);

  // 2) 증여재산공제 (제53조) - 거주자 수증자만
  let [dedKey, relKo] = GIFT_RELATIONSHIPS[rel];
  if (rel === "lineal_ascendant") dedKey = minor ? "lineal_descendant_minor" : "lineal_descendant_adult";
  let deductionLimit: number;
  if (!resident) {
    deductionLimit = 0;
    warnings.push("수증자가 비거주자 — 증여재산공제(제53조)는 거주자에게만 적용되어 공제 0원");
  } else if (dedKey === null) {
    deductionLimit = 0;
  } else {
    deductionLimit = int(g.deductions[dedKey]);
  }
  const used = int(get(input, "deduction_used_10y", 0));
  const basicDeduction = Math.max(0, Math.min(deductionLimit - used, taxableAmount));
  steps.push(["증여재산공제", neg(basicDeduction), `${relKo} 공제한도 ${won(deductionLimit)} − 10년 내 기사용 ${won(used)}`, "법 제53조 (10년 통산)"]);

  // 3) 혼인·출산 공제 (제53조의2)
  const mb = recOr(input, "marriage_birth");
  let mbDeduction = 0;
  if (truthy(get(mb, "applicable", undefined))) {
    const mbRule = g.deductions.marriage_birth;
    if (rel !== "lineal_ascendant") {
      warnings.push("혼인·출산 공제는 직계존속으로부터의 증여에만 적용 — 공제 미반영 (제53조의2)");
    } else if (!resident) {
      warnings.push("혼인·출산 공제는 거주자에게만 적용 — 공제 미반영 (제53조의2)");
    } else {
      const mbUsed = int(get(mb, "already_used", 0));
      mbDeduction = Math.max(0, Math.min(int(mbRule.combined_limit) - mbUsed, taxableAmount - basicDeduction));
      steps.push([
        "혼인·출산 증여재산공제",
        neg(mbDeduction),
        `통합한도 ${won(mbRule.combined_limit)} − 기사용 ${won(mbUsed)} (혼인신고 전후 2년/출생·입양 2년 이내 요건은 입력자 확인)`,
        mbRule.basis,
      ]);
    }
  }

  // 4) 과세표준 (제55조) - 감정평가 수수료 공제는 시행령 위임으로 미반영
  const taxBase = Math.max(0, taxableAmount - basicDeduction - mbDeduction);
  const belowMinimum = taxBase < 500_000;
  steps.push(["과세표준", taxBase, "과세가액 − 증여재산공제 − 혼인·출산공제 (감정평가 수수료 미반영)", "법 제55조제1항"]);
  if (belowMinimum && taxBase > 0) warnings.push("과세표준 50만원 미만 — 증여세를 부과하지 않음 (제55조②)");

  // 5) 산출세액 (제26조 세율을 제56조가 준용)
  const outputTax = belowMinimum ? 0 : progressiveTax(taxBase, c.tax_brackets);
  steps.push(["산출세액", outputTax, "5단계 누진세율 10~50% 적용", c.tax_brackets_meta.basis]);

  // 6) 세대생략 할증 (제57조)
  let surcharge = 0;
  if (truthy(get(input, "generation_skip", undefined)) && outputTax > 0) {
    const sc = c.generation_skip_surcharge;
    const rate = minor && giftValue > 2_000_000_000 ? sc.enhanced.rate : sc.base_rate;
    surcharge = Math.trunc(outputTax * rate);
    steps.push([
      "세대생략 할증",
      surcharge,
      `산출세액 × ${Math.trunc(rate * 100)}% (자녀 아닌 직계비속 수증` + (rate === sc.enhanced.rate ? ", 미성년+20억 초과 → 40%" : "") + ")",
      "법 제57조",
    ]);
  }

  // 7) 납부세액공제 - 합산된 사전증여의 기납부세액 (제58조)
  let priorCredit = 0;
  if (aggregated && priorOutputTax) {
    // 한도 = 산출세액 × (가산 증여 과세표준 / 합산 과세표준) - 가액 비율로 안분한 단순화 산식
    const ratio = taxableAmount ? aggregated / taxableAmount : 0;
    const creditLimit = Math.trunc(outputTax * ratio);
    priorCredit = Math.min(priorOutputTax, creditLimit);
    steps.push(["납부세액공제(사전증여 기납부)", neg(priorCredit), `기납부 산출세액 ${won(priorOutputTax)} vs 한도 ${won(creditLimit)} 중 작은 금액`, "법 제58조"]);
    warnings.push(
      "[단순화] 제58조② 한도는 가산 증여재산의 '과세표준' 비율이 정확하나, 본 엔진은 가액 비율로 안분 — 사전증여가 큰 경우 전문가 확인 필요",
    );
  }

  // 8) 신고세액공제 (제69조②)
  const creditBase = Math.max(0, outputTax + surcharge - priorCredit);
  const filed = truthy(get(input, "filed_on_time", true));
  const reportCredit = filed ? Math.trunc(creditBase * c.reporting_tax_credit_rate.rate) : 0;
  steps.push([
    "신고세액공제",
    neg(reportCredit),
    `(산출세액+할증−납부세액공제) × ${fmtG(c.reporting_tax_credit_rate.rate * 100)}%` + (filed ? "" : " — 기한 내 신고 아님 → 0원"),
    "법 제69조제2항",
  ]);
  const finalTax = Math.max(0, creditBase - reportCredit);

  // 9) 신고·납부 안내
  const due = filingDue(giftDate, 3);
  const payment = buildPaymentGuide(finalTax, rs, false, warnings, due, get(input, "annual_installment_years", null));

  return {
    type: "gift",
    ruleset_version: rs.version,
    steps,
    tax_base: taxBase,
    output_tax: outputTax,
    surcharge,
    final_tax: finalTax,
    filing_due: iso(due),
    filing_due_basis: g.filing.basis,
    payment,
    warnings,
  };
}

// ══════════════════════════════════════════════════════════
// 상속세 (제8~10조 → 제13·14조 → 제18~24조 → 제25조 → 제26조 → 제27조 → 제28조 → 제69조)
// ══════════════════════════════════════════════════════════
export function calcInheritance(inp: IgtInput, rs: IgtRuleset): InheritanceResult {
  ensureRuleset(rs);
  const warnings: string[] = [];
  const steps: IgtStep[] = [];
  const input = rec(inp);
  if (!has(input, "death_date")) throw Object.assign(new Error("KeyError: 'death_date'"), { name: "KeyError" });
  const deathDate = parseDate(input.death_date, "death_date");
  checkEffective(rs, deathDate, "상속개시일", warnings);
  const resident = truthy(get(input, "decedent_resident", true));

  const i = rs.inheritance;
  const c = rs.common;
  const d = i.deductions;

  // 1) 총상속재산 = 본래 상속재산 + 간주상속재산 (제8·9·10조)
  const assets = recOr(input, "assets");
  const assetTotal = sum(Object.values(assets).map(int));
  const deemed = recOr(input, "deemed_assets");
  const deemedTotal = sum(Object.values(deemed).map(int));
  const gross = assetTotal + deemedTotal;
  if (gross <= 0) throw calcError("assets/deemed_assets 합계(총상속재산)는 양수여야 합니다.");
  steps.push(["총상속재산", gross, `본래 상속재산 ${won(assetTotal)} + 간주상속재산(보험금·신탁·퇴직금) ${won(deemedTotal)}`, i.deemed_assets.basis]);

  // 2) 공과금·장례비·채무 차감 (제14조) - 장례비 한도는 시행령 위임으로 미검증
  const debts = int(get(input, "debts", 0));
  const charges = int(get(input, "public_charges", 0));
  const funeral = int(get(input, "funeral_expenses", 0));
  const subtract = Math.min(debts + charges + funeral, gross); // 초과분은 없는 것으로 (제13조①)
  if (funeral > 0) {
    warnings.push(
      "[확인 필요] 장례비용 공제 한도(시행령 위임)는 룰셋 미확정 — 입력값을 그대로 차감함. 통상 한도를 넘는 장례비는 전문가 확인 필요 (법 제14조③)",
    );
  }
  steps.push(["공과금·장례비·채무 차감", neg(subtract), `채무 ${won(debts)} + 공과금 ${won(charges)} + 장례비 ${won(funeral)}`, "법 제14조"]);

  // 3) 사전증여재산 가산 (제13조): 상속인 10년, 그 외 5년
  const pg = recOr(input, "prior_gifts");
  const pgHeirs = listOr(pg, "to_heirs_10y");
  const pgOthers = listOr(pg, "to_others_5y");
  const addedHeirs = sum(pgHeirs.map((p) => int(get(rec(p), "value", 0))));
  const addedOthers = sum(pgOthers.map((p) => int(get(rec(p), "value", 0))));
  const added = addedHeirs + addedOthers;
  const taxableAmount = gross - subtract + added;
  steps.push([
    "상속세 과세가액",
    taxableAmount,
    `(총상속재산 − 차감액) + 사전증여 가산(상속인 ${int(i.prior_gift_addback.heir_years)}년 ${won(addedHeirs)}, 그 외 ${int(i.prior_gift_addback.non_heir_years)}년 ${won(addedOthers)})`,
    "법 제13조",
  ]);
  if (!resident) {
    warnings.push("피상속인 비거주자 — 국내 재산·해당 채무만 과세 대상(제13조②·제14조②). 기초공제 외 상속공제 적용에 제한이 있으므로 전문가 확인 필요");
  }

  // 4) 상속공제
  const heirs = recOr(input, "heirs");
  const spouseExists = truthy(get(heirs, "spouse_exists", false));
  const children = int(get(heirs, "children_count", 0));
  const filed = truthy(get(input, "filed_on_time", true));
  const deductions: Array<[string, number, string, string]> = [];

  // 4-a) 일괄공제 vs 기초+인적 (제18·20·21조)
  const op = d.other_personal;
  const personal =
    children * int(op.child) +
    sum(listOr(heirs, "minor_children").map((m) => Math.max(0, 19 - int(get(rec(m), "age", 19))) * int(op.minor_per_year))) +
    int(get(heirs, "elderly_count", 0)) * int(op.elderly) +
    sum(listOr(heirs, "disabled").map((x) => int(get(rec(x), "life_expectancy_years", 0)) * int(op.disabled_per_year)));
  const basePlusPersonal = int(d.basic) + personal;
  const spouseSoleHeir = spouseExists && children === 0 && truthy(get(heirs, "spouse_sole", children === 0));
  let chosen: number;
  let desc: string;
  if (spouseSoleHeir) {
    chosen = basePlusPersonal;
    desc = `배우자 단독상속 — 일괄공제 불가, 기초 ${won(d.basic)} + 인적 ${won(personal)}`;
  } else if (!filed) {
    chosen = int(d.lump_sum.amount);
    desc = "무신고 — 일괄공제 5억원 적용";
  } else {
    chosen = Math.max(basePlusPersonal, int(d.lump_sum.amount));
    desc = `max(기초 ${won(d.basic)} + 인적 ${won(personal)}, 일괄 ${won(d.lump_sum.amount)}) → ${basePlusPersonal > int(d.lump_sum.amount) ? "기초+인적" : "일괄공제"} 선택`;
  }
  deductions.push(["기초·인적/일괄공제", chosen, desc, "법 제18조·제20조·제21조"]);

  // 4-b) 배우자 상속공제 (제19조)
  if (spouseExists) {
    const actual = int(get(input, "spouse_actual_inheritance", 0));
    let legalShare = get(heirs, "spouse_legal_share", null) as number | null;
    if (legalShare === null) {
      // 민법 제1009조: 배우자는 직계비속 상속분의 5할 가산 → 1.5 / (1.5 + 자녀수)
      legalShare = children > 0 ? 1.5 / (1.5 + children) : 1.0;
    }
    const bequestNonHeir = int(get(input, "bequests_to_non_heirs", 0));
    const spousePriorBase = int(get(input, "spouse_prior_gift_taxable_base", 0));
    // 한도금액 = (A − B + C) × D − E  [A: 상속재산가액(본래+간주로 단순화), C: 상속인 사전증여 가산액]
    const formulaLimit = Math.trunc((gross - bequestNonHeir + addedHeirs) * Number(legalShare)) - spousePriorBase;
    const limit = Math.max(0, Math.min(formulaLimit, int(d.spouse.max)));
    let spouseDed: number;
    let sdesc: string;
    if (actual <= 0 || actual < int(d.spouse.min)) {
      spouseDed = int(d.spouse.min);
      sdesc = `실제 상속액 ${won(actual)} < 5억 → 최소 5억원 공제 (제19조④)`;
    } else {
      spouseDed = Math.min(actual, limit);
      sdesc = `min(실제 상속액 ${won(actual)}, 한도 ${won(limit)}) [법정상속분 ${Number(legalShare).toFixed(4)} 산식 한도 ${won(Math.max(0, formulaLimit))}, 상한 30억]`;
      warnings.push("[단순화] 배우자공제 한도식의 A(상속재산가액)는 시행령 세부 조정 전 총상속재산 기준 — 유증·분할 구조가 복잡하면 전문가 확인 필요");
      warnings.push("배우자상속재산분할기한(신고기한 다음날부터 9개월) 내 분할·신고 요건 충족 필요 (제19조②)");
    }
    deductions.push(["배우자 상속공제", spouseDed, sdesc, d.spouse.basis]);
  }

  // 4-c) 금융재산 상속공제 (제22조)
  const netFin = int(has(input, "net_financial_assets") ? input.net_financial_assets : truthy(get(assets, "financial", 0)) ? assets.financial : 0);
  if (netFin > 0) {
    const fa = d.financial_asset;
    let finDed: number;
    let fdesc: string;
    if (netFin <= 20_000_000) {
      finDed = netFin;
      fdesc = "순금융재산 2천만원 이하 — 전액 공제";
    } else {
      finDed = Math.min(Math.max(Math.trunc(netFin * fa.rate), 20_000_000), int(fa.max));
      fdesc = `max(순금융재산 × 20%, 2천만원) = ${won(finDed)} (한도 2억)`;
    }
    deductions.push(["금융재산 상속공제", finDed, fdesc, fa.basis]);
  }

  // 4-d) 동거주택 상속공제 (제23조의2)
  const ch = recOr(input, "cohabiting_house");
  if (truthy(get(ch, "applicable", undefined))) {
    const houseNet = int(get(ch, "house_value_net", 0));
    const houseDed = Math.min(Math.trunc(houseNet * d.cohabiting_house.rate), int(d.cohabiting_house.max));
    deductions.push([
      "동거주택 상속공제",
      houseDed,
      `주택가액(담보채무 차감) ${won(houseNet)} × 100%, 한도 6억 — 10년 동거·1세대1주택·무주택 상속인 요건은 입력자 확인`,
      d.cohabiting_house.basis,
    ]);
  }

  // 4-e) 가업상속공제 - 요건 판정이 개별 사실관계에 의존하므로 계산하지 않고 안내만 한다
  if (truthy(get(recOr(input, "family_business"), "applicable", undefined))) {
    warnings.push(
      "[확인 필요] 가업상속공제(제18조의2, 한도 300/400/600억)는 요건 판정(시행령 §15 — 룰셋 decree_requirements 참조)이 개별 사실관계에 의존해 본 엔진이 계산하지 않음 — 반드시 전문가 확인 (해당 시 세액이 크게 달라짐)",
    );
  }

  // 4-f) 공제 종합한도 (제24조)
  const bequestNonHeir2 = int(get(input, "bequests_to_non_heirs", 0));
  const renounced = int(get(input, "renounced_to_next_rank", 0));
  const allPrior = [...pgHeirs, ...pgOthers];
  const priorTaxableSum = sum(allPrior.map((p) => int(has(rec(p), "taxable_base") ? rec(p).taxable_base : get(rec(p), "value", 0))));
  const limitSubtract3 = taxableAmount > 500_000_000 ? priorTaxableSum : 0;
  const comprehensiveLimit = Math.max(0, taxableAmount - bequestNonHeir2 - renounced - limitSubtract3);
  const totalDeductionRaw = sum(deductions.map((x) => x[1]));
  const totalDeduction = Math.min(totalDeductionRaw, comprehensiveLimit);
  const capped = totalDeduction < totalDeductionRaw;
  for (const [name, amount, ddesc, basis] of deductions) steps.push([`공제: ${name}`, neg(amount), ddesc, basis]);
  steps.push([
    "공제 종합한도 적용",
    totalDeduction,
    `공제 합계 ${won(totalDeductionRaw)} vs 한도 ${won(comprehensiveLimit)}` + (capped ? " — 한도 초과분 절삭" : " — 한도 내"),
    "법 제24조",
  ]);

  // 5) 과세표준 (제25조) - 감정평가 수수료 공제는 시행령 위임으로 미반영
  const taxBase = Math.max(0, taxableAmount - totalDeduction);
  const belowMinimum = taxBase < 500_000;
  steps.push(["과세표준", taxBase, "과세가액 − 상속공제(한도 적용) (감정평가 수수료 미반영)", "법 제25조제1항"]);
  if (belowMinimum && taxBase > 0) warnings.push("과세표준 50만원 미만 — 상속세를 부과하지 않음 (제25조②)");

  // 6) 산출세액 (제26조)
  const outputTax = belowMinimum ? 0 : progressiveTax(taxBase, c.tax_brackets);
  steps.push(["산출세액", outputTax, "5단계 누진세율 10~50% 적용", c.tax_brackets_meta.basis]);

  // 7) 세대생략 할증 (제27조) - 할증대상 재산 비율 안분
  let surcharge = 0;
  const rawSkip = get(input, "generation_skip_share", 0);
  const skipShare = truthy(rawSkip) ? Number(rawSkip) : 0;
  if (skipShare && !(skipShare > 0 && skipShare <= 1)) throw calcError("generation_skip_share 는 0~1 사이 비율이어야 합니다.");
  if (skipShare > 0 && outputTax > 0) {
    const sc = c.generation_skip_surcharge;
    const rate = truthy(get(input, "generation_skip_minor_over_2b", undefined)) ? sc.enhanced.rate : sc.base_rate;
    surcharge = Math.trunc(outputTax * skipShare * rate);
    steps.push([
      "세대생략 할증",
      surcharge,
      `산출세액 × 할증대상 재산비율 ${(skipShare * 100).toFixed(2)}% × ${Math.trunc(rate * 100)}% (대습상속은 제외 대상)`,
      "법 제27조",
    ]);
  }

  // 8) 증여세액공제 - 가산한 사전증여의 기납부 증여세 (제28조)
  let priorCredit = 0;
  const priorOutputTax = sum(allPrior.map((p) => int(get(rec(p), "output_tax", 0))));
  if (added && priorOutputTax) {
    if (taxableAmount <= 500_000_000) {
      warnings.push("상속세 과세가액 5억원 이하 — 사전증여 기납부 증여세액공제 배제 (제28조① 단서)");
    } else {
      const ratio = taxBase > 0 ? Math.min(1.0, priorTaxableSum / taxBase) : 0;
      const creditLimit = Math.trunc(outputTax * ratio);
      priorCredit = Math.min(priorOutputTax, creditLimit);
      steps.push(["증여세액공제(사전증여 기납부)", neg(priorCredit), `기납부 산출세액 ${won(priorOutputTax)} vs 한도 ${won(creditLimit)} 중 작은 금액`, "법 제28조"]);
      warnings.push("[단순화] 제28조② 한도는 상속인별 안분이 정확하나 본 엔진은 전체 비율로 계산 — 상속인이 여럿이고 사전증여가 크면 전문가 확인 필요");
    }
  }

  // 9) 신고세액공제 (제69조①)
  const creditBase = Math.max(0, outputTax + surcharge - priorCredit);
  const reportCredit = filed ? Math.trunc(creditBase * c.reporting_tax_credit_rate.rate) : 0;
  steps.push([
    "신고세액공제",
    neg(reportCredit),
    `(산출세액+할증−증여세액공제) × ${fmtG(c.reporting_tax_credit_rate.rate * 100)}%` + (filed ? "" : " — 기한 내 신고 아님 → 0원"),
    "법 제69조제1항",
  ]);
  const finalTax = Math.max(0, creditBase - reportCredit);

  // 10) 신고·납부 안내
  const months = !resident || truthy(get(input, "heir_abroad", undefined)) ? 9 : 6;
  const due = filingDue(deathDate, months);
  const payment = buildPaymentGuide(finalTax, rs, true, warnings, due, get(input, "annual_installment_years", null));

  // 물납 1차 진단 (제73조①)
  const realEstateSecurities = int(get(assets, "real_estate", 0)) + int(get(assets, "securities", 0));
  if (finalTax > int(rs.payment.annual_installment.threshold) && gross > 0) {
    if (realEstateSecurities > gross / 2 && finalTax > netFin) {
      payment.payment_in_kind_hint =
        "물납 요건 1차 해당 가능 — 부동산·유가증권이 상속재산의 1/2 초과, 세액 2천만원 초과, 세액이 금융재산 초과 (세무서 협의 필요, 법 제73조①)";
    }
  }

  return {
    type: "inheritance",
    ruleset_version: rs.version,
    steps,
    taxable_amount: taxableAmount,
    total_deduction: totalDeduction,
    tax_base: taxBase,
    output_tax: outputTax,
    surcharge,
    final_tax: finalTax,
    filing_due: iso(due),
    filing_due_basis: i.filing.basis,
    filing_months: months,
    payment,
    warnings,
  };
}

// ── 납부 방법 안내 (제70·71·72·73조) ─────────────────────────
function installmentLimit(finalTax: number, inst: { small_max: number; large_rate: number }, threshold: number): number {
  if (finalTax <= int(inst.small_max)) return Math.max(0, finalTax - threshold);
  return Math.trunc(finalTax * Number(inst.large_rate));
}

function annualInstallmentSchedule(finalTax: number, filingDueDate: Day, rs: IgtRuleset, isInheritance: boolean, years: unknown): IgtSchedule | null {
  const ai = rs.payment.annual_installment;
  const rate = Number(ai.surcharge_rate);
  const cap = isInheritance ? 10 : 5;
  let n = Math.min(truthy(years) ? int(years) : cap, cap);
  // 각 회분 1천만원 초과 요건: finalTax/(n+1) > 1천만 → n 절삭
  while (n > 0 && Math.floor(finalTax / (n + 1)) <= 10_000_000) n -= 1;
  if (n < 1) return null;
  const per = Math.floor(finalTax / (n + 1));
  const amounts = [...Array<number>(n).fill(per), finalTax - per * n]; // 마지막 회에 끝수 몰기
  const rows: IgtSchedule["rows"] = [];
  let paid = 0;
  let prevDue = filingDueDate;
  amounts.forEach((principal, idx) => {
    const due = addMonthsClamped(filingDueDate, 12 * idx);
    const remaining = finalTax - paid;
    const days = dayNumber(due) - dayNumber(prevDue);
    const surcharge = idx > 0 ? Math.trunc((remaining * rate * days) / 365) : 0;
    rows.push({ no: idx + 1, due: iso(due), principal, surcharge, total: principal + surcharge });
    paid += principal;
    prevDue = due;
  });
  return {
    years: n,
    installments: n + 1,
    rate,
    rate_as_of: ai.surcharge_rate_meta?.as_of ?? null,
    rows,
    total_surcharge: sum(rows.map((r) => r.surcharge)),
    basis: "법 제71조·제72조, 시행령 제69조",
    note:
      "가산율은 국세환급가산금 이자율 연동으로 수시 변동 — 실제 납부 시점 재확인 필요. " +
      "신고 시 1회분 납부 + 이후 매년 균등분할 가정, 가업상속 특례 기간(20년 등) 미반영.",
  };
}

function buildPaymentGuide(finalTax: number, rs: IgtRuleset, isInheritance: boolean, warnings: string[], filingDueDate: Day, annualYears: unknown): IgtPaymentGuide {
  const p = rs.payment;
  const guide: IgtPaymentGuide = { final_tax: finalTax };
  const inst = p.installment;
  if (finalTax > int(inst.threshold)) {
    if (!inst.needs_verification && inst.limit) {
      const limit = installmentLimit(finalTax, inst.limit, int(inst.threshold));
      guide.installment =
        `분납 가능 — 납부기한 경과 후 2개월 이내, 최대 ${won(limit)}까지 ` +
        `(시행령 §66②: ${finalTax <= int(inst.limit.small_max) ? "1천만원 초과분" : "세액의 50% 이하"}) (${inst.basis})`;
      guide.installment_limit = limit;
    } else {
      guide.installment = `분납 가능 — ${inst.rule} (${inst.basis})`;
      warnings.push("[확인 필요] 분납 가능 금액의 상한은 시행령 위임으로 룰셋 미확정 — 세부는 전문가 확인");
    }
  }
  const ai = p.annual_installment;
  if (finalTax > int(ai.threshold)) {
    guide.annual_installment = `연부연납 신청 가능 — ${ai.rule} (${ai.basis})`;
    if (!ai.needs_verification && ai.surcharge_rate !== null && ai.surcharge_rate !== undefined) {
      guide.annual_installment += ` · 가산율 연 ${fmtG(Number(ai.surcharge_rate) * 100)}%(변동 가능)`;
      const schedule = annualInstallmentSchedule(finalTax, filingDueDate, rs, isInheritance, annualYears);
      if (schedule) guide.annual_installment_schedule = schedule;
    } else {
      warnings.push("[확인 필요] 연부연납 가산금 이자율은 고시 연동으로 룰셋 미확정 — 신청 전 확인 필수");
    }
  }
  if (isInheritance) {
    const pik = p.payment_in_kind;
    guide.payment_in_kind_rule = pik.scope;
    if (finalTax > 20_000_000 && !pik.needs_verification && pik.charge_order) {
      guide.payment_in_kind_detail = `${pik.limit_detail ?? ""} / ${pik.charge_order}`;
    }
  }
  return guide;
}
