# -*- coding: utf-8 -*-
"""
calc_igt 계산 엔진 테스트 — 손계산 기대값과 1원 단위 대조.

모든 기대값은 승인 룰셋 v1(2026.07.11-v1, 현행 상증세법 본문 확인분)을 근거로
수기 계산한 값이다. 엔진과 룰셋을 하나의 단위로 검증한다.

실행: python -m unittest discover tests -v
"""

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import calc_igt
from calc_igt import (CalcError, calc_gift, calc_inheritance, filing_due,
                      load_ruleset, progressive_tax)

RS = load_ruleset()


def gift_input(**over):
    base = {
        "type": "gift",
        "gift_date": "2026-08-10",
        "donor_relationship": "lineal_ascendant",
        "recipient_is_minor": False,
        "recipient_is_resident": True,
        "gift_value": 500_000_000,
        "deduction_used_10y": 0,
        "prior_gifts_same_donor_10y": [],
        "marriage_birth": {"applicable": False},
        "generation_skip": False,
        "filed_on_time": True,
    }
    base.update(over)
    return base


def inh_input(**over):
    base = {
        "type": "inheritance",
        "death_date": "2026-03-15",
        "decedent_resident": True,
        "assets": {"real_estate": 700_000_000, "financial": 300_000_000},
        "deemed_assets": {},
        "debts": 0,
        "public_charges": 0,
        "funeral_expenses": 0,
        "heirs": {"spouse_exists": True, "children_count": 2},
        "spouse_actual_inheritance": 400_000_000,
        "net_financial_assets": 300_000_000,
        "prior_gifts": {},
        "filed_on_time": True,
    }
    base.update(over)
    return base


class TestBrackets(unittest.TestCase):
    """법 제26조 누진세율 — 구간 경계값 검증"""

    def test_bracket_boundaries(self):
        cases = [
            (100_000_000, 10_000_000),        # 1억 → 10%
            (100_000_001, 10_000_000),        # 1억+1원 → ×20%−1천만 (경계 직후)
            (500_000_000, 90_000_000),        # 5억 → 9천만 (법문 예시값과 일치)
            (1_000_000_000, 240_000_000),     # 10억 → 2.4억
            (3_000_000_000, 1_040_000_000),   # 30억 → 10.4억
            (5_000_000_000, 2_040_000_000),   # 50억 → ×50%−4.6억 = 20.4억
        ]
        for taxable, expected in cases:
            self.assertEqual(progressive_tax(taxable, RS["common"]["tax_brackets"]), expected,
                             f"과세표준 {taxable:,}")

    def test_zero_and_negative(self):
        self.assertEqual(progressive_tax(0, RS["common"]["tax_brackets"]), 0)
        self.assertEqual(progressive_tax(-100, RS["common"]["tax_brackets"]), 0)


class TestFilingDue(unittest.TestCase):
    """신고기한 — '말일부터 N개월'은 (사건월+N)의 말일 (민법 기간계산)"""

    def test_gift_3_months(self):
        self.assertEqual(filing_due(date(2026, 8, 10), 3), date(2026, 11, 30))
        self.assertEqual(filing_due(date(2026, 1, 15), 3), date(2026, 4, 30))

    def test_inheritance_6_months_nts_example(self):
        # 국세청 안내 예시 패턴: 4월 상속개시 → 10월 31일
        self.assertEqual(filing_due(date(2026, 4, 10), 6), date(2026, 10, 31))
        self.assertEqual(filing_due(date(2026, 6, 20), 6), date(2026, 12, 31))

    def test_year_rollover(self):
        self.assertEqual(filing_due(date(2026, 11, 5), 3), date(2027, 2, 28))


class TestGiftStandard(unittest.TestCase):
    """증여세 표준 사례"""

    def test_adult_child_500m(self):
        """성인 자녀 5억: 공제 5천만 → 과표 4.5억 → 8천만 → 신고공제 3% → 7,760만"""
        r = calc_gift(gift_input(), RS)
        self.assertEqual(r["tax_base"], 450_000_000)
        self.assertEqual(r["output_tax"], 80_000_000)
        self.assertEqual(r["final_tax"], 77_600_000)
        self.assertEqual(r["filing_due"], "2026-11-30")

    def test_spouse_600m_fully_deducted(self):
        """배우자 6억: 공제 6억 → 과표 0 → 세액 0"""
        r = calc_gift(gift_input(donor_relationship="spouse", gift_value=600_000_000), RS)
        self.assertEqual(r["tax_base"], 0)
        self.assertEqual(r["final_tax"], 0)

    def test_minor_child_deduction_20m(self):
        """미성년 자녀 1억: 공제 2천만 → 과표 8천만 → 8백만 → 신고공제 → 776만"""
        r = calc_gift(gift_input(recipient_is_minor=True, gift_value=100_000_000), RS)
        self.assertEqual(r["tax_base"], 80_000_000)
        self.assertEqual(r["final_tax"], 7_760_000)

    def test_other_relative_100m(self):
        """기타친족(4촌 혈족 등) 1억: 공제 1천만 → 과표 9천만 → 9백만 → 873만"""
        r = calc_gift(gift_input(donor_relationship="other_relative", gift_value=100_000_000), RS)
        self.assertEqual(r["tax_base"], 90_000_000)
        self.assertEqual(r["output_tax"], 9_000_000)
        self.assertEqual(r["final_tax"], 8_730_000)

    def test_unrelated_no_deduction(self):
        """타인 증여: 공제 0 → 과표 = 증여가액"""
        r = calc_gift(gift_input(donor_relationship="unrelated", gift_value=100_000_000), RS)
        self.assertEqual(r["tax_base"], 100_000_000)
        self.assertEqual(r["output_tax"], 10_000_000)

    def test_nonresident_recipient_no_deduction(self):
        """비거주자 수증자: 제53조 공제 배제 (경고 포함)"""
        r = calc_gift(gift_input(recipient_is_resident=False, gift_value=100_000_000), RS)
        self.assertEqual(r["tax_base"], 100_000_000)
        self.assertTrue(any("비거주자" in w for w in r["warnings"]))

    def test_deduction_capped_by_taxable(self):
        """증여가액 3천만 < 공제한도 5천만: 공제는 과세가액까지만 → 과표 0"""
        r = calc_gift(gift_input(gift_value=30_000_000), RS)
        self.assertEqual(r["tax_base"], 0)
        self.assertEqual(r["final_tax"], 0)


class TestGiftMinimum(unittest.TestCase):
    """과세최저한 (제55조②)"""

    def test_below_500k_no_tax(self):
        """성인 자녀 5,040만 → 과표 40만 < 50만 → 부과 안함"""
        r = calc_gift(gift_input(gift_value=50_400_000), RS)
        self.assertEqual(r["tax_base"], 400_000)
        self.assertEqual(r["output_tax"], 0)
        self.assertEqual(r["final_tax"], 0)
        self.assertTrue(any("50만원 미만" in w for w in r["warnings"]))

    def test_exactly_500k_taxed(self):
        """과표 정확히 50만 → 과세 (50만 '미만'만 면제)"""
        r = calc_gift(gift_input(gift_value=50_500_000), RS)
        self.assertEqual(r["tax_base"], 500_000)
        self.assertEqual(r["output_tax"], 50_000)


class TestGiftSurcharge(unittest.TestCase):
    """세대생략 할증 (제57조)"""

    def test_grandchild_30pct(self):
        """조부→성인 손주 3억, 할증 30%: 과표 2.5억 → 4천만 → +1,200만 → 신고공제 → 50,440,000"""
        r = calc_gift(gift_input(gift_value=300_000_000, generation_skip=True), RS)
        self.assertEqual(r["output_tax"], 40_000_000)
        self.assertEqual(r["surcharge"], 12_000_000)
        self.assertEqual(r["final_tax"], 50_440_000)

    def test_minor_grandchild_over_2b_40pct(self):
        """조부→미성년 손주 25억(>20억): 할증 40%"""
        r = calc_gift(gift_input(gift_value=2_500_000_000, recipient_is_minor=True,
                                 generation_skip=True), RS)
        # 과표 24.8억 → 24.8억×40%−1.6억 = 8.32억, 할증 40% = 3.328억
        self.assertEqual(r["output_tax"], 832_000_000)
        self.assertEqual(r["surcharge"], 332_800_000)

    def test_minor_grandchild_under_2b_30pct(self):
        """미성년 손주라도 20억 이하면 30%"""
        r = calc_gift(gift_input(gift_value=300_000_000, recipient_is_minor=True,
                                 generation_skip=True), RS)
        # 공제 2천만 → 과표 2.8억 → 4,600만 → 할증 30% = 1,380만
        self.assertEqual(r["output_tax"], 46_000_000)
        self.assertEqual(r["surcharge"], 13_800_000)


class TestGiftAggregation(unittest.TestCase):
    """동일인 10년 합산 (제47조②) + 납부세액공제 (제58조)"""

    def test_aggregation_with_prior_credit(self):
        """3억 + 사전 2억(기납부 2천만), 공제 소진, 혼인공제 1억 → final 48,500,000"""
        r = calc_gift(gift_input(
            gift_value=300_000_000,
            deduction_used_10y=50_000_000,
            prior_gifts_same_donor_10y=[{"value": 200_000_000, "output_tax": 20_000_000}],
            marriage_birth={"applicable": True, "already_used": 0},
        ), RS)
        self.assertEqual(r["tax_base"], 400_000_000)          # 5억 − 0 − 1억
        self.assertEqual(r["output_tax"], 70_000_000)
        self.assertEqual(r["final_tax"], 48_500_000)           # (7천만−2천만)×0.97

    def test_prior_credit_capped_by_limit(self):
        """기납부세액이 한도(가액 비율 안분)를 초과하면 한도까지만 공제"""
        r = calc_gift(gift_input(
            gift_value=300_000_000,
            prior_gifts_same_donor_10y=[{"value": 200_000_000, "output_tax": 999_000_000}],
        ), RS)
        # 과세가액 5억, 공제 5천만 → 과표 4.5억 → 산출 8천만; 한도 = 8천만 × (2/5) = 3,200만
        credit_step = [s for s in r["steps"] if s[0].startswith("납부세액공제")][0]
        self.assertEqual(credit_step[1], -32_000_000)

    def test_under_10m_not_aggregated(self):
        """동일인 사전증여 합계 1천만 미만 → 합산 배제"""
        r = calc_gift(gift_input(
            gift_value=100_000_000,
            prior_gifts_same_donor_10y=[{"value": 9_000_000, "output_tax": 0}],
        ), RS)
        self.assertEqual(r["tax_base"], 50_000_000)  # 1억 − 공제 5천만 (합산 없음)
        self.assertTrue(any("합산 대상 아님" in w for w in r["warnings"]))


class TestGiftMarriageBirth(unittest.TestCase):
    """혼인·출산 증여재산공제 (제53조의2)"""

    def test_marriage_deduction_stacks_with_basic(self):
        """성인 자녀 2억 + 혼인공제: 5천만 + 1억 → 과표 5천만"""
        r = calc_gift(gift_input(gift_value=200_000_000,
                                 marriage_birth={"applicable": True, "already_used": 0}), RS)
        self.assertEqual(r["tax_base"], 50_000_000)

    def test_combined_limit_respects_already_used(self):
        """기사용 6천만 → 잔여 4천만만 공제"""
        r = calc_gift(gift_input(gift_value=200_000_000,
                                 marriage_birth={"applicable": True, "already_used": 60_000_000}), RS)
        self.assertEqual(r["tax_base"], 110_000_000)  # 2억 − 5천만 − 4천만

    def test_marriage_only_from_lineal_ascendant(self):
        """직계존속 외 증여에는 혼인공제 미적용 (경고)"""
        r = calc_gift(gift_input(donor_relationship="other_relative", gift_value=200_000_000,
                                 marriage_birth={"applicable": True}), RS)
        self.assertEqual(r["tax_base"], 190_000_000)  # 기타친족 1천만만 공제
        self.assertTrue(any("직계존속" in w for w in r["warnings"]))


class TestGiftNoFiling(unittest.TestCase):
    def test_no_filing_no_credit(self):
        """무신고 → 신고세액공제 0"""
        r = calc_gift(gift_input(filed_on_time=False), RS)
        self.assertEqual(r["final_tax"], 80_000_000)  # 신고공제 없음


class TestInheritanceStandard(unittest.TestCase):
    """상속세 표준 사례"""

    def test_1b_spouse_children_zero_tax(self):
        """재산 10억, 배우자+자녀2 — 일괄 5억 + 배우자 최소 5억 → 세액 0 (대표 사례)"""
        r = calc_inheritance(inh_input(), RS)
        self.assertEqual(r["taxable_amount"], 1_000_000_000)
        self.assertEqual(r["tax_base"], 0)
        self.assertEqual(r["final_tax"], 0)

    def test_500m_children_only_zero_tax(self):
        """재산 5억, 자녀만 — 일괄공제 5억 → 세액 0"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 500_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 2},
            spouse_actual_inheritance=0, net_financial_assets=0,
        ), RS)
        self.assertEqual(r["final_tax"], 0)

    def test_large_estate_with_prior_gift(self):
        """30억 + 간주 2억 + 사전증여 3억 − 채무 2.15억 — 손계산 281,300,000"""
        r = calc_inheritance(inh_input(
            death_date="2026-06-20",
            assets={"real_estate": 2_000_000_000, "financial": 800_000_000},
            deemed_assets={"insurance": 200_000_000},
            debts=200_000_000, public_charges=5_000_000, funeral_expenses=10_000_000,
            spouse_actual_inheritance=1_200_000_000,
            net_financial_assets=800_000_000,
            prior_gifts={"to_heirs_10y": [
                {"value": 300_000_000, "taxable_base": 250_000_000, "output_tax": 40_000_000}]},
        ), RS)
        self.assertEqual(r["taxable_amount"], 3_085_000_000)
        self.assertEqual(r["total_deduction"], 1_860_000_000)   # 일괄5억+배우자12억+금융1.6억
        self.assertEqual(r["tax_base"], 1_225_000_000)
        self.assertEqual(r["output_tax"], 330_000_000)
        self.assertEqual(r["final_tax"], 281_300_000)
        self.assertEqual(r["filing_due"], "2026-12-31")


class TestInheritanceDeductions(unittest.TestCase):
    """상속공제 선택·한도 로직"""

    def test_base_plus_personal_beats_lump_sum(self):
        """기초 2억 + 인적 3.4억(자녀4+미성년+장애인) > 일괄 5억 → 기초+인적 선택"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 2_000_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 4,
                   "minor_children": [{"age": 9}],   # (19−9)×1천만 = 1억
                   "disabled": [{"life_expectancy_years": 4}]},  # 4천만
            spouse_actual_inheritance=0, net_financial_assets=0,
        ), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 기초·인적/일괄공제"][0]
        # 2억 + (4×5천만 + 1억 + 4천만) = 2억 + 3.4억 = 5.4억 > 5억
        self.assertEqual(step[1], -540_000_000)

    def test_no_filing_forces_lump_sum(self):
        """무신고 → 일괄 5억 강제 (제21조① 단서) + 신고세액공제 0"""
        r = calc_inheritance(inh_input(
            filed_on_time=False,
            assets={"real_estate": 2_000_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 4,
                   "minor_children": [{"age": 9}],
                   "disabled": [{"life_expectancy_years": 4}]},
            spouse_actual_inheritance=0, net_financial_assets=0,
        ), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 기초·인적/일괄공제"][0]
        self.assertEqual(step[1], -500_000_000)
        credit_step = [s for s in r["steps"] if s[0] == "신고세액공제"][0]
        self.assertEqual(credit_step[1], 0)

    def test_spouse_sole_heir_no_lump_sum(self):
        """배우자 단독상속 → 일괄공제 불가, 기초 2억만 (제21조②)"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 1_500_000_000}, deemed_assets={},
            heirs={"spouse_exists": True, "children_count": 0},
            spouse_actual_inheritance=1_500_000_000, net_financial_assets=0,
        ), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 기초·인적/일괄공제"][0]
        self.assertEqual(step[1], -200_000_000)

    def test_spouse_minimum_500m(self):
        """배우자 실제 상속액 0 → 최소 5억 공제 (제19조④)"""
        r = calc_inheritance(inh_input(spouse_actual_inheritance=0), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 배우자 상속공제"][0]
        self.assertEqual(step[1], -500_000_000)

    def test_spouse_capped_at_legal_share(self):
        """배우자 실제 상속액이 법정지분 한도를 넘으면 한도까지만"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 3_500_000_000}, deemed_assets={},
            heirs={"spouse_exists": True, "children_count": 2},
            spouse_actual_inheritance=3_000_000_000,   # 법정지분 한도 35억×3/7=15억
            net_financial_assets=0,
        ), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 배우자 상속공제"][0]
        self.assertEqual(step[1], -1_500_000_000)

    def test_spouse_capped_at_3b(self):
        """법정지분 한도가 30억을 넘어도 상한 30억 (제19조①2호)"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 10_000_000_000}, deemed_assets={},
            heirs={"spouse_exists": True, "children_count": 1},
            spouse_actual_inheritance=5_000_000_000,   # 산식한도 100억×0.6=60억 → 상한 30억
            net_financial_assets=0,
        ), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 배우자 상속공제"][0]
        self.assertEqual(step[1], -3_000_000_000)

    def test_financial_asset_tiers(self):
        """금융재산공제: ≤2천만 전액 / 20% vs 2천만 큰 금액 / 상한 2억"""
        cases = [
            (15_000_000, 15_000_000),      # 전액
            (80_000_000, 20_000_000),      # 20%=1,600만 < 2천만 → 2천만
            (300_000_000, 60_000_000),     # 20%
            (2_000_000_000, 200_000_000),  # 상한 2억
        ]
        for net_fin, expected in cases:
            r = calc_inheritance(inh_input(
                assets={"real_estate": 2_000_000_000, "financial": net_fin},
                net_financial_assets=net_fin), RS)
            step = [s for s in r["steps"] if s[0] == "공제: 금융재산 상속공제"][0]
            self.assertEqual(step[1], -expected, f"순금융재산 {net_fin:,}")

    def test_cohabiting_house_capped_600m(self):
        """동거주택 공제 100%, 한도 6억"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 2_000_000_000}, net_financial_assets=0,
            cohabiting_house={"applicable": True, "house_value_net": 900_000_000}), RS)
        step = [s for s in r["steps"] if s[0] == "공제: 동거주택 상속공제"][0]
        self.assertEqual(step[1], -600_000_000)

    def test_comprehensive_limit_caps_deductions(self):
        """공제 종합한도(제24조): 과세가액 6억 − 사전증여 과세표준 2.5억 = 3.5억으로 절삭"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 300_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=0,
            prior_gifts={"to_heirs_10y": [
                {"value": 300_000_000, "taxable_base": 250_000_000, "output_tax": 20_000_000}]},
        ), RS)
        self.assertEqual(r["taxable_amount"], 600_000_000)
        self.assertEqual(r["total_deduction"], 350_000_000)   # 일괄 5억 → 한도 절삭
        self.assertEqual(r["tax_base"], 250_000_000)
        # 산출 4천만 − 기납부공제 2천만 → 신고공제 60만 → 19,400,000
        self.assertEqual(r["final_tax"], 19_400_000)

    def test_family_business_flag_warns_only(self):
        """가업상속공제 플래그 → 계산 미반영 + [확인 필요] 경고 (needs_verification)"""
        r = calc_inheritance(inh_input(family_business={"applicable": True}), RS)
        self.assertTrue(any("가업상속공제" in w for w in r["warnings"]))
        self.assertFalse(any("가업" in s[0] for s in r["steps"]))


class TestInheritancePriorGiftCredit(unittest.TestCase):
    """사전증여 가산·증여세액공제 (제13조·제28조)"""

    def test_credit_denied_when_taxable_under_500m(self):
        """과세가액 5억 이하 → 제28조① 단서로 공제 배제"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 200_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=0,
            prior_gifts={"to_heirs_10y": [
                {"value": 300_000_000, "taxable_base": 250_000_000, "output_tax": 20_000_000}]},
        ), RS)
        self.assertEqual(r["taxable_amount"], 500_000_000)
        self.assertFalse(any(s[0].startswith("증여세액공제") for s in r["steps"]))
        self.assertTrue(any("5억원 이하" in w for w in r["warnings"]))

    def test_debt_exceeding_assets_clamped(self):
        """차감액이 재산 초과 시 초과분은 없는 것으로 (제13조①)"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 100_000_000}, deemed_assets={},
            debts=999_000_000,
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=0,
            prior_gifts={"to_heirs_10y": [{"value": 300_000_000, "output_tax": 0}]},
        ), RS)
        self.assertEqual(r["taxable_amount"], 300_000_000)  # 0 + 가산 3억


class TestInheritanceSurcharge(unittest.TestCase):
    """세대생략 할증 (제27조) — 재산 비율 안분"""

    def test_surcharge_prorated(self):
        """할증대상 비율 40%, 30% 할증"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 3_000_000_000}, deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=0,
            generation_skip_share=0.4,
        ), RS)
        # 과세가액 30억 − 일괄 5억 = 과표 25억 → 산출 25억×0.4−1.6억 = 8.4억
        self.assertEqual(r["output_tax"], 840_000_000)
        self.assertEqual(r["surcharge"], int(840_000_000 * 0.4 * 0.3))

    def test_invalid_share_raises(self):
        with self.assertRaises(CalcError):
            calc_inheritance(inh_input(generation_skip_share=1.5), RS)


class TestPaymentGuide(unittest.TestCase):
    """납부 안내 (제70·71·73조)"""

    def test_installment_and_annuity_flags(self):
        r = calc_gift(gift_input(), RS)  # final 7,760만 > 2천만
        self.assertIn("installment", r["payment"])
        self.assertIn("annual_installment", r["payment"])

    def test_small_tax_no_flags(self):
        r = calc_gift(gift_input(gift_value=60_000_000), RS)  # 과표 1천만 → 세액 97만
        self.assertNotIn("installment", r["payment"])
        self.assertNotIn("annual_installment", r["payment"])

    def test_payment_in_kind_hint(self):
        """부동산 1/2 초과 + 세액 2천만 초과 + 세액 > 금융재산 → 물납 힌트"""
        r = calc_inheritance(inh_input(
            assets={"real_estate": 3_000_000_000, "financial": 10_000_000},
            deemed_assets={},
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=10_000_000,
        ), RS)
        self.assertGreater(r["final_tax"], 20_000_000)
        self.assertIn("payment_in_kind_hint", r["payment"])


class TestVerifiedPaymentRules(unittest.TestCase):
    """시행령 대조 확정분 (룰셋 v2026.07.12-v1) — 분납 상한·연부연납 스케줄"""

    def test_installment_limit_small(self):
        """세액 2천만 이하: 1천만 초과분까지 분납 (시행령 §66②1)"""
        self.assertEqual(
            calc_igt.installment_limit(16_000_000, RS["payment"]["installment"]),
            6_000_000)

    def test_installment_limit_large(self):
        """세액 2천만 초과: 50% 이하 분납 (시행령 §66②2)"""
        self.assertEqual(
            calc_igt.installment_limit(100_000_000, RS["payment"]["installment"]),
            50_000_000)

    def test_installment_limit_in_result(self):
        r = calc_gift(gift_input(), RS)  # final 77,600,000
        self.assertEqual(r["payment"]["installment_limit"], r["final_tax"] // 2)
        # 확정 산식 반영 후에는 분납 [확인 필요] 경고가 없어야 한다
        self.assertFalse(any("분납 가능 금액의 상한" in w for w in r["warnings"]))

    def test_annuity_schedule_gift_5y(self):
        """증여세 연부연납: 최대 5년(6회), 본세 합계 = 자진납부세액, 첫 회 가산금 0"""
        r = calc_gift(gift_input(), RS)
        s = r["payment"]["annual_installment_schedule"]
        self.assertEqual(s["years"], 5)
        self.assertEqual(len(s["rows"]), 6)
        self.assertEqual(sum(x["principal"] for x in s["rows"]), r["final_tax"])
        self.assertEqual(s["rows"][0]["surcharge"], 0)
        self.assertEqual(s["rows"][0]["due"], r["filing_due"])
        self.assertEqual(s["rate"], 0.031)

    def test_annuity_schedule_surcharge_formula(self):
        """2회차 가산금 = 잔액 × 일수 × 3.1%/365 (법 제72조)"""
        r = calc_gift(gift_input(), RS)
        s = r["payment"]["annual_installment_schedule"]
        per = r["final_tax"] // 6
        remaining = r["final_tax"] - per          # 1회분 납부 후 잔액
        d1 = date.fromisoformat(s["rows"][0]["due"])
        d2 = date.fromisoformat(s["rows"][1]["due"])
        expected = int(remaining * 0.031 * (d2 - d1).days / 365)
        self.assertEqual(s["rows"][1]["surcharge"], expected)

    def test_annuity_years_trimmed_by_10m_rule(self):
        """각 회분 1천만 초과 요건(제71조② 단서) — 세액이 작으면 기간 자동 절삭"""
        # 세액 3,880만원 → 4분할(9.7M)은 회분 1천만 이하 → 최대 2년(3회, 회분 12,933,333)
        r = calc_gift(gift_input(gift_value=300_000_000), RS)
        self.assertEqual(r["final_tax"], 38_800_000)
        s = r["payment"]["annual_installment_schedule"]
        self.assertEqual(s["years"], 2)
        self.assertTrue(all(x["principal"] > 10_000_000 for x in s["rows"]))

    def test_annuity_years_user_choice(self):
        """annual_installment_years 입력으로 기간 단축 가능 (법정 상한 내)"""
        r = calc_gift(gift_input(annual_installment_years=3), RS)
        self.assertEqual(r["payment"]["annual_installment_schedule"]["years"], 3)

    def test_no_verified_warnings_after_ruleset_update(self):
        """검증 완료 룰셋에서는 연부연납 [확인 필요] 경고 제거"""
        r = calc_gift(gift_input(), RS)
        self.assertFalse(any("연부연납 가산금 이자율" in w for w in r["warnings"]))

    def test_payment_in_kind_detail_only_above_threshold(self):
        big = calc_inheritance(inh_input(
            assets={"real_estate": 3_000_000_000, "financial": 10_000_000},
            heirs={"spouse_exists": False, "children_count": 1},
            spouse_actual_inheritance=0, net_financial_assets=10_000_000), RS)
        self.assertIn("payment_in_kind_detail", big["payment"])
        small = calc_inheritance(inh_input(), RS)  # 세액 0
        self.assertNotIn("payment_in_kind_detail", small["payment"])

    def test_ruleset_no_pending_verification(self):
        """룰셋 v2026.07.12-v1: needs_verification true 항목이 남아 있지 않다"""
        def collect(obj, path=""):
            found = []
            if isinstance(obj, dict):
                if obj.get("needs_verification") is True:
                    found.append(path)
                for k, v in obj.items():
                    found += collect(v, f"{path}.{k}")
            return found
        self.assertEqual(collect(RS), [])


class TestRulesetGuards(unittest.TestCase):
    """룰셋 안전장치"""

    def test_closed_ruleset_rejected(self):
        """effective_to가 마감된 룰셋은 로드 거부"""
        rs = json.loads(json.dumps(RS))
        rs["effective_to"] = "2026-12-31"
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "closed.json"
            p.write_text(json.dumps(rs, ensure_ascii=False), encoding="utf-8")
            with self.assertRaises(CalcError):
                load_ruleset(p)

    def test_event_before_effective_from_warns(self):
        """룰셋 적용 시작일 이전 증여일 → 경고"""
        r = calc_gift(gift_input(gift_date="2025-06-01"), RS)
        self.assertTrue(any("적용 시작일" in w for w in r["warnings"]))

    def test_invalid_inputs_raise(self):
        with self.assertRaises(CalcError):
            calc_gift(gift_input(gift_value=0), RS)
        with self.assertRaises(CalcError):
            calc_gift(gift_input(donor_relationship="friend?"), RS)
        with self.assertRaises(CalcError):
            calc_gift(gift_input(gift_date="2026/08/10"), RS)
        with self.assertRaises(CalcError):
            calc_inheritance(inh_input(assets={}, deemed_assets={}), RS)


if __name__ == "__main__":
    unittest.main(verbosity=2)
