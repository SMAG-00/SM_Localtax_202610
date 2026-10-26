# -*- coding: utf-8 -*-
"""
안심 상속증여계산기 — 3단계: 결정론적 계산 엔진 calcIGT

승인 게이트(approve.py)를 통과한 rulesets/igt_rules_current.json 만을
세율·공제의 근거로 사용하는 상속세·증여세 계산 엔진.

원칙:
  - 계산은 코드, 해석·권고는 AI (엔진은 LLM을 호출하지 않는다)
  - 모든 계산 단계에 근거 조문을 표시한다
  - 룰셋에 없는 수치는 사용하지 않는다 — 시행령 위임 등 미확정 영역은
    계산에 반영하지 않고 [확인 필요] 경고로 표시한다 (정확성 > 완성도)

사용법:
  python calc_igt.py examples\\example_gift_adult_child.json           # 한국어 리포트
  python calc_igt.py examples\\example_inheritance_spouse.json --json  # JSON 출력

종료 코드: 0 정상 / 1 입력·룰셋 오류
"""

import calendar
import json
import sys
from datetime import date, datetime
from pathlib import Path

# 콘솔 출력을 UTF-8로 고정 (하네스 공통 정책)
if sys.stdout.encoding and sys.stdout.encoding.lower().replace("-", "") != "utf8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding and sys.stderr.encoding.lower().replace("-", "") != "utf8":
    sys.stderr.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).resolve().parent
RULESET_FILE = BASE_DIR / "rulesets" / "igt_rules_current.json"

# 증여자 관계 코드 → (룰셋 공제 키, 한국어 표시)
GIFT_RELATIONSHIPS = {
    "spouse": ("spouse", "배우자"),
    "lineal_ascendant": (None, "직계존속"),        # 성년/미성년에 따라 공제 키 분기
    "lineal_descendant": ("lineal_ascendant", "직계비속"),
    "other_relative": ("other_relatives", "기타친족(4촌 이내 혈족·3촌 이내 인척)"),
    "unrelated": (None, "타인(친족 아님)"),
}


class CalcError(Exception):
    """입력·룰셋 오류 — 사용자에게 원인을 알리고 종료한다."""


# ── 룰셋 로드 ──────────────────────────────────────────────
def load_ruleset(path=RULESET_FILE):
    """승인된 현재 룰셋 로드. 마감된(effective_to 설정) 룰셋은 로드 거부."""
    p = Path(path)
    if not p.exists():
        raise CalcError(f"룰셋 파일이 없습니다: {p} — approve.py로 승인된 룰셋이 필요합니다.")
    with open(p, encoding="utf-8-sig") as f:
        rs = json.load(f)
    if rs.get("effective_to") is not None:
        raise CalcError(
            f"룰셋 {rs.get('version')} 은 {rs.get('effective_to')} 로 마감되었습니다 — "
            "igt_rules_current.json 이 최신 승인본인지 확인하세요."
        )
    return rs


# ── 공통 유틸 ──────────────────────────────────────────────
def parse_date(s, field):
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise CalcError(f"{field} 는 YYYY-MM-DD 형식이어야 합니다: {s!r}")


def month_end(d):
    return date(d.year, d.month, calendar.monthrange(d.year, d.month)[1])


def add_months_clamped(d, months):
    """d에서 months개월 뒤. 일자가 넘치면 그 달 말일로 클램프 (신고기한 산정용)."""
    y, m = d.year, d.month + months
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def filing_due(base_date, months):
    """'~일이 속하는 달의 말일부터 N개월' 기한 산정.

    민법 제157조·제160조 기간계산(초일 불산입, 역에 의한 계산)에 따라
    결과적으로 (사건이 속한 달 + N개월)의 말일이 기한이 된다.
    예: 4월 상속개시 → 10월 31일, 8월 증여 → 11월 30일.
    """
    return month_end(add_months_clamped(base_date, months))


def won(n):
    return f"{int(n):,}원"


def progressive_tax(taxable, brackets):
    """5단계 누진세율 적용 (법 제26조). taxable ≤ 0 이면 0."""
    if taxable <= 0:
        return 0
    for b in brackets:
        if b["upto"] is None or taxable <= b["upto"]:
            return int(taxable * b["rate"] - b["progressive_deduction"])
    raise CalcError("세율 구간을 찾지 못했습니다 — 룰셋 tax_brackets 확인 필요.")


def check_effective(rs, event_date, label, warnings):
    ef = parse_date(rs["effective_from"], "룰셋 effective_from")
    if event_date < ef:
        warnings.append(
            f"{label}({event_date})이 룰셋 적용 시작일({ef})보다 빠릅니다 — "
            "당시 시행 룰셋이 아닐 수 있으니 archive 버전 확인 필요"
        )


# ══════════════════════════════════════════════════════════
# 증여세 계산 (법 제47조 → 제53조·제53조의2 → 제55조 → 제26조·제56조 → 제57조 → 제58조 → 제69조)
# ══════════════════════════════════════════════════════════
def calc_gift(inp, rs):
    warnings = []
    steps = []

    gift_date = parse_date(inp["gift_date"], "gift_date")
    check_effective(rs, gift_date, "증여일", warnings)

    rel = inp.get("donor_relationship")
    if rel not in GIFT_RELATIONSHIPS:
        raise CalcError(f"donor_relationship 은 {list(GIFT_RELATIONSHIPS)} 중 하나여야 합니다: {rel!r}")
    minor = bool(inp.get("recipient_is_minor", False))
    resident = bool(inp.get("recipient_is_resident", True))

    gift_value = int(inp.get("gift_value", 0))
    if gift_value <= 0:
        raise CalcError("gift_value(증여재산가액)는 양수여야 합니다.")

    g = rs["gift"]
    c = rs["common"]

    # 1) 동일인 10년 합산 (제47조②)
    prior = inp.get("prior_gifts_same_donor_10y", []) or []
    prior_value = sum(int(p.get("value", 0)) for p in prior)
    prior_output_tax = sum(int(p.get("output_tax", 0)) for p in prior)
    agg_threshold = 10_000_000  # 합산 하한 1천만원 (제47조② 본문)
    aggregated = prior_value if prior_value >= agg_threshold else 0
    if 0 < prior_value < agg_threshold:
        warnings.append(f"동일인 10년 내 증여 합계 {won(prior_value)} < 1천만원 — 합산 대상 아님 (제47조②)")
    taxable_amount = gift_value + aggregated
    steps.append(("증여세 과세가액", taxable_amount,
                  f"증여재산가액 {won(gift_value)}"
                  + (f" + 동일인 {int(g['aggregation_years'])}년 내 합산 {won(aggregated)}" if aggregated else ""),
                  "법 제47조제1항·제2항"))

    # 2) 증여재산공제 (제53조) — 거주자 수증자만
    ded_key, rel_ko = GIFT_RELATIONSHIPS[rel]
    if rel == "lineal_ascendant":
        ded_key = "lineal_descendant_minor" if minor else "lineal_descendant_adult"
    if not resident:
        deduction_limit = 0
        warnings.append("수증자가 비거주자 — 증여재산공제(제53조)는 거주자에게만 적용되어 공제 0원")
    elif ded_key is None:
        deduction_limit = 0
    else:
        deduction_limit = int(g["deductions"][ded_key])
    used = int(inp.get("deduction_used_10y", 0))
    basic_deduction = max(0, min(deduction_limit - used, taxable_amount))
    steps.append(("증여재산공제", -basic_deduction,
                  f"{rel_ko} 공제한도 {won(deduction_limit)} − 10년 내 기사용 {won(used)}",
                  "법 제53조 (10년 통산)"))

    # 3) 혼인·출산 공제 (제53조의2)
    mb = inp.get("marriage_birth", {}) or {}
    mb_deduction = 0
    if mb.get("applicable"):
        mb_rule = g["deductions"]["marriage_birth"]
        if rel != "lineal_ascendant":
            warnings.append("혼인·출산 공제는 직계존속으로부터의 증여에만 적용 — 공제 미반영 (제53조의2)")
        elif not resident:
            warnings.append("혼인·출산 공제는 거주자에게만 적용 — 공제 미반영 (제53조의2)")
        else:
            mb_used = int(mb.get("already_used", 0))
            mb_deduction = max(0, min(int(mb_rule["combined_limit"]) - mb_used,
                                      taxable_amount - basic_deduction))
            steps.append(("혼인·출산 증여재산공제", -mb_deduction,
                          f"통합한도 {won(mb_rule['combined_limit'])} − 기사용 {won(mb_used)} "
                          "(혼인신고 전후 2년/출생·입양 2년 이내 요건은 입력자 확인)",
                          mb_rule["basis"]))

    # 4) 과세표준 (제55조) — 감정평가 수수료 공제는 시행령 위임으로 미반영
    tax_base = max(0, taxable_amount - basic_deduction - mb_deduction)
    below_minimum = tax_base < 500_000
    steps.append(("과세표준", tax_base, "과세가액 − 증여재산공제 − 혼인·출산공제 (감정평가 수수료 미반영)", "법 제55조제1항"))
    if below_minimum and tax_base > 0:
        warnings.append("과세표준 50만원 미만 — 증여세를 부과하지 않음 (제55조②)")

    # 5) 산출세액 (제26조 세율을 제56조가 준용)
    output_tax = 0 if below_minimum else progressive_tax(tax_base, c["tax_brackets"])
    steps.append(("산출세액", output_tax, "5단계 누진세율 10~50% 적용", c["tax_brackets_meta"]["basis"]))

    # 6) 세대생략 할증 (제57조)
    surcharge = 0
    if inp.get("generation_skip") and output_tax > 0:
        sc = c["generation_skip_surcharge"]
        rate = sc["enhanced"]["rate"] if (minor and gift_value > 2_000_000_000) else sc["base_rate"]
        surcharge = int(output_tax * rate)
        steps.append(("세대생략 할증", surcharge,
                      f"산출세액 × {int(rate*100)}% (자녀 아닌 직계비속 수증"
                      + (", 미성년+20억 초과 → 40%" if rate == sc["enhanced"]["rate"] else "") + ")",
                      "법 제57조"))

    # 7) 납부세액공제 — 합산된 사전증여의 기납부세액 (제58조)
    prior_credit = 0
    if aggregated and prior_output_tax:
        # 한도 = 산출세액 × (가산 증여 과세표준 / 합산 과세표준) — 가액 비율로 안분한 단순화 산식
        ratio = aggregated / taxable_amount if taxable_amount else 0
        credit_limit = int(output_tax * ratio)
        prior_credit = min(prior_output_tax, credit_limit)
        steps.append(("납부세액공제(사전증여 기납부)", -prior_credit,
                      f"기납부 산출세액 {won(prior_output_tax)} vs 한도 {won(credit_limit)} 중 작은 금액",
                      "법 제58조"))
        warnings.append("[단순화] 제58조② 한도는 가산 증여재산의 '과세표준' 비율이 정확하나, "
                        "본 엔진은 가액 비율로 안분 — 사전증여가 큰 경우 전문가 확인 필요")

    # 8) 신고세액공제 (제69조②)
    credit_base = max(0, output_tax + surcharge - prior_credit)
    filed = bool(inp.get("filed_on_time", True))
    report_credit = int(credit_base * c["reporting_tax_credit_rate"]["rate"]) if filed else 0
    steps.append(("신고세액공제", -report_credit,
                  f"(산출세액+할증−납부세액공제) × {c['reporting_tax_credit_rate']['rate']*100:g}%"
                  + ("" if filed else " — 기한 내 신고 아님 → 0원"),
                  "법 제69조제2항"))

    final_tax = max(0, credit_base - report_credit)

    # 9) 신고·납부 안내
    due = filing_due(gift_date, 3)
    payment = build_payment_guide(final_tax, rs, is_inheritance=False, warnings=warnings,
                                  filing_due_date=due,
                                  annual_years=inp.get("annual_installment_years"))

    return {
        "type": "gift",
        "ruleset_version": rs["version"],
        "steps": steps,
        "tax_base": tax_base,
        "output_tax": output_tax,
        "surcharge": surcharge,
        "final_tax": final_tax,
        "filing_due": due.isoformat(),
        "filing_due_basis": g["filing"]["basis"],
        "payment": payment,
        "warnings": warnings,
    }


# ══════════════════════════════════════════════════════════
# 상속세 계산 (제8~10조 → 제13·14조 → 제18~24조 → 제25조 → 제26조 → 제27조 → 제28조 → 제69조)
# ══════════════════════════════════════════════════════════
def calc_inheritance(inp, rs):
    warnings = []
    steps = []

    death_date = parse_date(inp["death_date"], "death_date")
    check_effective(rs, death_date, "상속개시일", warnings)
    resident = bool(inp.get("decedent_resident", True))

    i = rs["inheritance"]
    c = rs["common"]
    d = i["deductions"]

    # 1) 총상속재산 = 본래 상속재산 + 간주상속재산 (제8·9·10조)
    assets = inp.get("assets", {}) or {}
    asset_total = sum(int(v) for v in assets.values())
    deemed = inp.get("deemed_assets", {}) or {}
    deemed_total = sum(int(v) for v in deemed.values())
    gross = asset_total + deemed_total
    if gross <= 0:
        raise CalcError("assets/deemed_assets 합계(총상속재산)는 양수여야 합니다.")
    steps.append(("총상속재산", gross,
                  f"본래 상속재산 {won(asset_total)} + 간주상속재산(보험금·신탁·퇴직금) {won(deemed_total)}",
                  i["deemed_assets"]["basis"]))

    # 2) 공과금·장례비·채무 차감 (제14조) — 장례비 한도는 시행령 위임으로 미검증
    debts = int(inp.get("debts", 0))
    charges = int(inp.get("public_charges", 0))
    funeral = int(inp.get("funeral_expenses", 0))
    subtract = min(debts + charges + funeral, gross)  # 초과분은 없는 것으로 (제13조①)
    if funeral > 0:
        warnings.append("[확인 필요] 장례비용 공제 한도(시행령 위임)는 룰셋 미확정 — 입력값을 그대로 차감함. "
                        "통상 한도를 넘는 장례비는 전문가 확인 필요 (법 제14조③)")
    steps.append(("공과금·장례비·채무 차감", -subtract,
                  f"채무 {won(debts)} + 공과금 {won(charges)} + 장례비 {won(funeral)}",
                  "법 제14조"))

    # 3) 사전증여재산 가산 (제13조): 상속인 10년, 그 외 5년
    pg = inp.get("prior_gifts", {}) or {}
    pg_heirs = pg.get("to_heirs_10y", []) or []
    pg_others = pg.get("to_others_5y", []) or []
    added_heirs = sum(int(p.get("value", 0)) for p in pg_heirs)
    added_others = sum(int(p.get("value", 0)) for p in pg_others)
    added = added_heirs + added_others
    taxable_amount = gross - subtract + added
    steps.append(("상속세 과세가액", taxable_amount,
                  f"(총상속재산 − 차감액) + 사전증여 가산(상속인 {int(i['prior_gift_addback']['heir_years'])}년 "
                  f"{won(added_heirs)}, 그 외 {int(i['prior_gift_addback']['non_heir_years'])}년 {won(added_others)})",
                  "법 제13조"))
    if not resident:
        warnings.append("피상속인 비거주자 — 국내 재산·해당 채무만 과세 대상(제13조②·제14조②). "
                        "기초공제 외 상속공제 적용에 제한이 있으므로 전문가 확인 필요")

    # 4) 상속공제
    heirs = inp.get("heirs", {}) or {}
    spouse_exists = bool(heirs.get("spouse_exists", False))
    children = int(heirs.get("children_count", 0))
    filed = bool(inp.get("filed_on_time", True))

    deductions = []  # (이름, 금액, 설명, 근거)

    # 4-a) 일괄공제 vs 기초+인적 (제18·20·21조)
    personal = (
        children * int(d["other_personal"]["child"])
        + sum(max(0, 19 - int(m.get("age", 19))) * int(d["other_personal"]["minor_per_year"])
              for m in heirs.get("minor_children", []) or [])
        + int(heirs.get("elderly_count", 0)) * int(d["other_personal"]["elderly"])
        + sum(int(x.get("life_expectancy_years", 0)) * int(d["other_personal"]["disabled_per_year"])
              for x in heirs.get("disabled", []) or [])
    )
    base_plus_personal = int(d["basic"]) + personal
    spouse_sole_heir = spouse_exists and children == 0 and bool(heirs.get("spouse_sole", children == 0))
    if spouse_sole_heir:
        chosen = base_plus_personal
        desc = f"배우자 단독상속 — 일괄공제 불가, 기초 {won(d['basic'])} + 인적 {won(personal)}"
    elif not filed:
        chosen = int(d["lump_sum"]["amount"])
        desc = "무신고 — 일괄공제 5억원 적용"
    else:
        chosen = max(base_plus_personal, int(d["lump_sum"]["amount"]))
        desc = (f"max(기초 {won(d['basic'])} + 인적 {won(personal)}, 일괄 {won(d['lump_sum']['amount'])}) "
                f"→ {'기초+인적' if base_plus_personal > int(d['lump_sum']['amount']) else '일괄공제'} 선택")
    deductions.append(("기초·인적/일괄공제", chosen, desc, "법 제18조·제20조·제21조"))

    # 4-b) 배우자 상속공제 (제19조)
    if spouse_exists:
        actual = int(inp.get("spouse_actual_inheritance", 0))
        legal_share = heirs.get("spouse_legal_share")
        if legal_share is None:
            # 민법 제1009조: 배우자는 직계비속 상속분의 5할 가산 → 1.5 / (1.5 + 자녀수)
            legal_share = 1.5 / (1.5 + children) if children > 0 else 1.0
        bequest_non_heir = int(inp.get("bequests_to_non_heirs", 0))
        spouse_prior_base = int(inp.get("spouse_prior_gift_taxable_base", 0))
        # 한도금액 = (A − B + C) × D − E  [A: 상속재산가액(본래+간주로 단순화), C: 상속인 사전증여 가산액]
        formula_limit = int((gross - bequest_non_heir + added_heirs) * legal_share) - spouse_prior_base
        limit = max(0, min(formula_limit, int(d["spouse"]["max"])))
        if actual <= 0 or actual < int(d["spouse"]["min"]):
            spouse_ded = int(d["spouse"]["min"])
            desc = f"실제 상속액 {won(actual)} < 5억 → 최소 5억원 공제 (제19조④)"
        else:
            spouse_ded = min(actual, limit)
            desc = (f"min(실제 상속액 {won(actual)}, 한도 {won(limit)}) "
                    f"[법정상속분 {legal_share:.4f} 산식 한도 {won(max(0, formula_limit))}, 상한 30억]")
            warnings.append("[단순화] 배우자공제 한도식의 A(상속재산가액)는 시행령 세부 조정 전 총상속재산 기준 — "
                            "유증·분할 구조가 복잡하면 전문가 확인 필요")
            warnings.append("배우자상속재산분할기한(신고기한 다음날부터 9개월) 내 분할·신고 요건 충족 필요 (제19조②)")
        deductions.append(("배우자 상속공제", spouse_ded, desc, d["spouse"]["basis"]))

    # 4-c) 금융재산 상속공제 (제22조)
    net_fin = int(inp.get("net_financial_assets", assets.get("financial", 0) or 0))
    if net_fin > 0:
        fa = d["financial_asset"]
        if net_fin <= 20_000_000:
            fin_ded = net_fin
            desc = "순금융재산 2천만원 이하 — 전액 공제"
        else:
            fin_ded = min(max(int(net_fin * fa["rate"]), 20_000_000), int(fa["max"]))
            desc = f"max(순금융재산 × 20%, 2천만원) = {won(fin_ded)} (한도 2억)"
        deductions.append(("금융재산 상속공제", fin_ded, desc, fa["basis"]))

    # 4-d) 동거주택 상속공제 (제23조의2)
    ch = inp.get("cohabiting_house", {}) or {}
    if ch.get("applicable"):
        house_net = int(ch.get("house_value_net", 0))
        house_ded = min(int(house_net * d["cohabiting_house"]["rate"]), int(d["cohabiting_house"]["max"]))
        deductions.append(("동거주택 상속공제", house_ded,
                           f"주택가액(담보채무 차감) {won(house_net)} × 100%, 한도 6억 — "
                           "10년 동거·1세대1주택·무주택 상속인 요건은 입력자 확인",
                           d["cohabiting_house"]["basis"]))

    # 4-e) 가업상속공제 — 시행령 §15 대조 완료(요건 확정), 다만 요건 판정이 개별 사실관계
    #      (업종 별표·사업무관자산 산정 등)에 의존하므로 엔진은 계산하지 않고 안내만 한다
    if (inp.get("family_business", {}) or {}).get("applicable"):
        warnings.append("[확인 필요] 가업상속공제(제18조의2, 한도 300/400/600억)는 요건 판정"
                        "(시행령 §15 — 룰셋 decree_requirements 참조)이 개별 사실관계에 의존해 "
                        "본 엔진이 계산하지 않음 — 반드시 전문가 확인 (해당 시 세액이 크게 달라짐)")

    # 4-f) 공제 종합한도 (제24조)
    bequest_non_heir = int(inp.get("bequests_to_non_heirs", 0))
    renounced = int(inp.get("renounced_to_next_rank", 0))
    prior_taxable_sum = sum(int(p.get("taxable_base", p.get("value", 0))) for p in pg_heirs + pg_others)
    limit_subtract3 = prior_taxable_sum if taxable_amount > 500_000_000 else 0
    comprehensive_limit = max(0, taxable_amount - bequest_non_heir - renounced - limit_subtract3)
    total_deduction_raw = sum(x[1] for x in deductions)
    total_deduction = min(total_deduction_raw, comprehensive_limit)
    capped = total_deduction < total_deduction_raw

    for name, amount, desc, basis in deductions:
        steps.append((f"공제: {name}", -amount, desc, basis))
    steps.append(("공제 종합한도 적용", total_deduction,
                  f"공제 합계 {won(total_deduction_raw)} vs 한도 {won(comprehensive_limit)}"
                  + (" — 한도 초과분 절삭" if capped else " — 한도 내"),
                  "법 제24조"))

    # 5) 과세표준 (제25조) — 감정평가 수수료 공제는 시행령 위임으로 미반영
    tax_base = max(0, taxable_amount - total_deduction)
    below_minimum = tax_base < 500_000
    steps.append(("과세표준", tax_base, "과세가액 − 상속공제(한도 적용) (감정평가 수수료 미반영)", "법 제25조제1항"))
    if below_minimum and tax_base > 0:
        warnings.append("과세표준 50만원 미만 — 상속세를 부과하지 않음 (제25조②)")

    # 6) 산출세액 (제26조)
    output_tax = 0 if below_minimum else progressive_tax(tax_base, c["tax_brackets"])
    steps.append(("산출세액", output_tax, "5단계 누진세율 10~50% 적용", c["tax_brackets_meta"]["basis"]))

    # 7) 세대생략 할증 (제27조) — 할증대상 재산 비율 안분
    surcharge = 0
    skip_share = float(inp.get("generation_skip_share", 0) or 0)
    if skip_share and not 0 < skip_share <= 1:
        raise CalcError("generation_skip_share 는 0~1 사이 비율이어야 합니다.")
    if skip_share > 0 and output_tax > 0:
        sc = c["generation_skip_surcharge"]
        rate = sc["enhanced"]["rate"] if inp.get("generation_skip_minor_over_2b") else sc["base_rate"]
        surcharge = int(output_tax * skip_share * rate)
        steps.append(("세대생략 할증", surcharge,
                      f"산출세액 × 할증대상 재산비율 {skip_share:.2%} × {int(rate*100)}% (대습상속은 제외 대상)",
                      "법 제27조"))

    # 8) 증여세액공제 — 가산한 사전증여의 기납부 증여세 (제28조)
    prior_credit = 0
    prior_output_tax = sum(int(p.get("output_tax", 0)) for p in pg_heirs + pg_others)
    if added and prior_output_tax:
        if taxable_amount <= 500_000_000:
            warnings.append("상속세 과세가액 5억원 이하 — 사전증여 기납부 증여세액공제 배제 (제28조① 단서)")
        else:
            ratio = min(1.0, prior_taxable_sum / tax_base) if tax_base > 0 else 0
            credit_limit = int(output_tax * ratio)
            prior_credit = min(prior_output_tax, credit_limit)
            steps.append(("증여세액공제(사전증여 기납부)", -prior_credit,
                          f"기납부 산출세액 {won(prior_output_tax)} vs 한도 {won(credit_limit)} 중 작은 금액",
                          "법 제28조"))
            warnings.append("[단순화] 제28조② 한도는 상속인별 안분이 정확하나 본 엔진은 전체 비율로 계산 — "
                            "상속인이 여럿이고 사전증여가 크면 전문가 확인 필요")

    # 9) 신고세액공제 (제69조①)
    credit_base = max(0, output_tax + surcharge - prior_credit)
    report_credit = int(credit_base * c["reporting_tax_credit_rate"]["rate"]) if filed else 0
    steps.append(("신고세액공제", -report_credit,
                  f"(산출세액+할증−증여세액공제) × {c['reporting_tax_credit_rate']['rate']*100:g}%"
                  + ("" if filed else " — 기한 내 신고 아님 → 0원"),
                  "법 제69조제1항"))

    final_tax = max(0, credit_base - report_credit)

    # 10) 신고·납부 안내
    months = 9 if (not resident or inp.get("heir_abroad")) else 6
    due = filing_due(death_date, months)
    payment = build_payment_guide(final_tax, rs, is_inheritance=True, warnings=warnings,
                                  filing_due_date=due,
                                  annual_years=inp.get("annual_installment_years"))

    # 물납 1차 진단 (제73조①)
    real_estate_securities = int(assets.get("real_estate", 0)) + int(assets.get("securities", 0))
    if final_tax > int(rs["payment"]["annual_installment"]["threshold"]) and gross > 0:
        if real_estate_securities > gross / 2 and final_tax > int(inp.get("net_financial_assets", assets.get("financial", 0) or 0)):
            payment["payment_in_kind_hint"] = ("물납 요건 1차 해당 가능 — 부동산·유가증권이 상속재산의 1/2 초과, "
                                               "세액 2천만원 초과, 세액이 금융재산 초과 (세무서 협의 필요, 법 제73조①)")

    return {
        "type": "inheritance",
        "ruleset_version": rs["version"],
        "steps": steps,
        "taxable_amount": taxable_amount,
        "total_deduction": total_deduction,
        "tax_base": tax_base,
        "output_tax": output_tax,
        "surcharge": surcharge,
        "final_tax": final_tax,
        "filing_due": due.isoformat(),
        "filing_due_basis": i["filing"]["basis"],
        "filing_months": months,
        "payment": payment,
        "warnings": warnings,
    }


# ── 납부 방법 안내 (제70·71·72·73조) ─────────────────────────
def installment_limit(final_tax, inst_rule):
    """분납 가능 상한 (시행령 §66②). 검증된 limit 규칙이 있을 때만 호출."""
    lim = inst_rule["limit"]
    if final_tax <= int(lim["small_max"]):
        return max(0, final_tax - int(inst_rule["threshold"]))
    return int(final_tax * float(lim["large_rate"]))


def annual_installment_schedule(final_tax, filing_due_date, rs, is_inheritance, years=None):
    """연부연납 상환 스케줄 (법 제71조·제72조).

    방식: 신고 시 1회분 + 이후 매년 1회분 = (연부연납기간 n년 → n+1 회 균등분할).
    각 회분 세액은 1천만원을 초과해야 하므로(제71조② 단서) n을 자동 절삭한다.
    가산금 = (허가 총세액 − 직전 회까지 납부한 분할세액 합계) × 구간 일수 × 연 가산율/365 (제72조).
    ※ 일반 상속재산(10년)·일반 증여재산(5년) 기준 — 가업상속(20년) 등 특례 기간은 미지원.
    """
    ai = rs["payment"]["annual_installment"]
    rate = float(ai["surcharge_rate"])
    cap = 10 if is_inheritance else 5
    n = min(int(years) if years else cap, cap)
    # 각 회분 1천만원 초과 요건: final_tax/(n+1) > 1천만 → n 절삭
    while n > 0 and final_tax // (n + 1) <= 10_000_000:
        n -= 1
    if n < 1:
        return None
    per = final_tax // (n + 1)
    amounts = [per] * n + [final_tax - per * n]  # 마지막 회에 끝수 몰기
    rows, paid, prev_due = [], 0, filing_due_date
    for idx, principal in enumerate(amounts):
        due = add_months_clamped(filing_due_date, 12 * idx)
        remaining = final_tax - paid
        days = (due - prev_due).days
        surcharge = int(remaining * rate * days / 365) if idx > 0 else 0
        rows.append({"no": idx + 1, "due": due.isoformat(), "principal": principal,
                     "surcharge": surcharge, "total": principal + surcharge})
        paid += principal
        prev_due = due
    return {
        "years": n, "installments": n + 1, "rate": rate,
        "rate_as_of": (ai.get("surcharge_rate_meta") or {}).get("as_of"),
        "rows": rows,
        "total_surcharge": sum(r["surcharge"] for r in rows),
        "basis": "법 제71조·제72조, 시행령 제69조",
        "note": "가산율은 국세환급가산금 이자율 연동으로 수시 변동 — 실제 납부 시점 재확인 필요. "
                "신고 시 1회분 납부 + 이후 매년 균등분할 가정, 가업상속 특례 기간(20년 등) 미반영.",
    }


def build_payment_guide(final_tax, rs, is_inheritance, warnings, filing_due_date=None,
                        annual_years=None):
    p = rs["payment"]
    guide = {"final_tax": final_tax}
    inst = p["installment"]
    if final_tax > int(inst["threshold"]):
        if not inst.get("needs_verification") and "limit" in inst:
            limit = installment_limit(final_tax, inst)
            guide["installment"] = (f"분납 가능 — 납부기한 경과 후 2개월 이내, 최대 {won(limit)}까지 "
                                    f"(시행령 §66②: {'1천만원 초과분' if final_tax <= int(inst['limit']['small_max']) else '세액의 50% 이하'}) "
                                    f"({inst['basis']})")
            guide["installment_limit"] = limit
        else:
            guide["installment"] = f"분납 가능 — {inst['rule']} ({inst['basis']})"
            warnings.append("[확인 필요] 분납 가능 금액의 상한은 시행령 위임으로 룰셋 미확정 — 세부는 전문가 확인")
    ai = p["annual_installment"]
    if final_tax > int(ai["threshold"]):
        guide["annual_installment"] = f"연부연납 신청 가능 — {ai['rule']} ({ai['basis']})"
        if not ai.get("needs_verification") and ai.get("surcharge_rate") is not None:
            rate = float(ai["surcharge_rate"])
            guide["annual_installment"] += f" · 가산율 연 {rate*100:g}%(변동 가능)"
            if filing_due_date is not None:
                schedule = annual_installment_schedule(final_tax, filing_due_date, rs,
                                                       is_inheritance, annual_years)
                if schedule:
                    guide["annual_installment_schedule"] = schedule
        else:
            warnings.append("[확인 필요] 연부연납 가산금 이자율은 고시 연동으로 룰셋 미확정 — 신청 전 확인 필수")
    if is_inheritance:
        guide["payment_in_kind_rule"] = p["payment_in_kind"]["scope"]
        pik = p["payment_in_kind"]
        if (final_tax > 20_000_000 and not pik.get("needs_verification")
                and pik.get("charge_order")):
            guide["payment_in_kind_detail"] = f"{pik.get('limit_detail', '')} / {pik['charge_order']}"
    return guide


# ── 리포트 출력 ─────────────────────────────────────────────
def render_report(result):
    kind = "증여세" if result["type"] == "gift" else "상속세"
    lines = [
        "═" * 78,
        f"  안심 상속증여계산기 — {kind} 계산 리포트",
        f"  적용 룰셋: {result['ruleset_version']} (승인 게이트 통과본)",
        "═" * 78,
        "",
        f"{'단계':<28} {'금액':>20}   근거",
        "-" * 78,
    ]
    for name, amount, desc, basis in result["steps"]:
        lines.append(f"{name:<26} {won(amount):>20}   {basis}")
        lines.append(f"{'':<26} {'':>20}   └ {desc}")
    lines += [
        "-" * 78,
        f"{'자진납부세액(신고 기준)':<24} {won(result['final_tax']):>20}",
        "",
        f"■ 신고기한: {result['filing_due']}  ({result['filing_due_basis']})",
    ]
    pay = result["payment"]
    if "installment" in pay:
        lines.append(f"■ {pay['installment']}")
    if "annual_installment" in pay:
        lines.append(f"■ {pay['annual_installment']}")
    sched = pay.get("annual_installment_schedule")
    if sched:
        lines += [
            "",
            f"  [연부연납 스케줄 — {sched['years']}년({sched['installments']}회 균등), "
            f"가산율 연 {sched['rate']*100:g}% ({sched['basis']})]",
            f"  {'회차':<4} {'납부기한':<12} {'본세':>16} {'가산금':>14} {'납부액':>16}",
        ]
        for r in sched["rows"]:
            lines.append(f"  {r['no']:<5} {r['due']:<12} {won(r['principal']):>16} "
                         f"{won(r['surcharge']):>14} {won(r['total']):>16}")
        lines.append(f"  {'':<5} {'가산금 합계':<12} {'':>16} {won(sched['total_surcharge']):>14}")
        lines.append(f"  └ {sched['note']}")
    if "payment_in_kind_hint" in pay:
        lines.append(f"■ {pay['payment_in_kind_hint']}")
    if "payment_in_kind_detail" in pay:
        lines.append(f"■ 물납 세부(시행령 §73·§74): {pay['payment_in_kind_detail']}")
    if result["warnings"]:
        lines += ["", "⚠ 확인 필요·단순화 고지:"]
        for w in result["warnings"]:
            lines.append(f"  - {w}")
    lines += [
        "",
        "※ 본 결과는 참고용 시뮬레이션입니다. 실제 신고 전 반드시 세무 전문가 확인이 필요합니다.",
        "※ 국고금 단수처리(10원 미만 절사)는 미적용. 감정평가 수수료 공제(시행령) 미반영.",
    ]
    return "\n".join(lines)


# ── 메인 ──────────────────────────────────────────────────
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv
    if not args:
        print("사용법: python calc_igt.py <입력.json> [--json]")
        return 1

    try:
        with open(args[0], encoding="utf-8-sig") as f:
            inp = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"[입력 오류] {e}")
        return 1

    try:
        rs = load_ruleset()
        kind = inp.get("type")
        if kind == "gift":
            result = calc_gift(inp, rs)
        elif kind == "inheritance":
            result = calc_inheritance(inp, rs)
        else:
            raise CalcError('입력 JSON의 "type" 은 "gift" 또는 "inheritance" 여야 합니다.')
    except CalcError as e:
        print(f"[계산 불가] {e}")
        return 1

    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_report(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
