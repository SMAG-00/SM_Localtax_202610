# -*- coding: utf-8 -*-
"""기준선 생성기 (W11-g g2) - 이 저장소가 쓴 새 파일(안심 원본 아님).
사본(packages/igt-engine/reference)의 Python 엔진을 그대로 돌려, 기존 시험 57개가 부르는 입력·출력과 예시 4개와 시드 고정 무작위 입력의 출력을 JSON으로 고정한다.
기준선은 안심 현행 동작을 고정한 것이지 법령 정답 판정이 아니다 (3단계 설계 4.3).
실행: python -I -B packages/igt-engine/baseline/make_baseline.py   (사본 폴더에서만 import - 안심 원본 폴더는 열지 않는다)
"""
import copy
import json
import os
import random
import sys
import unittest
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
REF = HERE.parent / "reference"
sys.path.insert(0, str(REF))
sys.dont_write_bytecode = True
import calc_igt as C  # noqa: E402

BASE_RS = C.load_ruleset()
records, depth = [], [0]


def wrap(name):
    fn = getattr(C, name)

    def inner(*a, **kw):
        top = depth[0] == 0
        depth[0] += 1
        rec = {"fn": name, "args": copy.deepcopy(list(a)), "kwargs": copy.deepcopy(kw)} if top else None
        try:
            out = fn(*a, **kw)
            if rec is not None:
                rec["result"] = copy.deepcopy(out)
            return out
        except C.CalcError as e:
            if rec is not None:
                rec["calc_error"] = str(e)
            raise
        except Exception as e:  # 시험이 일부러 부른 예외 - 종류만 고정
            if rec is not None:
                rec["exception"] = type(e).__name__
            raise
        finally:
            depth[0] -= 1
            if rec is not None:
                records.append(rec)

    return inner


for n in ("calc_gift", "calc_inheritance", "progressive_tax", "filing_due"):
    setattr(C, n, wrap(n))

sys.path.insert(0, str(REF / "tests"))
import test_calc_igt as T  # noqa: E402  (calc_igt는 이미 바뀐 모듈이다)

suite = unittest.defaultTestLoader.loadTestsFromModule(T)
res = unittest.TextTestRunner(stream=open(os.devnull, "w"), verbosity=0).run(suite)
suite_run, suite_fail = res.testsRun, len(res.failures) + len(res.errors)


def norm(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: norm(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [norm(x) for x in v]
    return v


def to_case(r, source):
    c = {"source": source, "fn": r["fn"]}
    if r["fn"] in ("calc_gift", "calc_inheritance"):
        args = r["args"]
        inp = args[0]
        rs = args[1] if len(args) > 1 else r["kwargs"].get("rs")
        c["input"] = norm(inp)
        if rs != BASE_RS:
            c["ruleset"] = rs
    else:
        c["args"] = norm(r["args"])
    for k in ("result", "calc_error", "exception"):
        if k in r:
            c[k] = norm(r[k])
    return c


cases = [to_case(r, "test_calc_igt") for r in records]

# 예시 입력 4개
for p in sorted((REF / "examples").glob("example_*.json")):
    inp = json.loads(p.read_text(encoding="utf-8-sig"))
    name = "calc_gift" if inp["type"] == "gift" else "calc_inheritance"
    cases.append({"source": "example:" + p.name, "fn": name, "input": inp, "result": norm(getattr(C, name)(inp, BASE_RS))})

# 시드 고정 무작위 입력 (시험용 값 - 실제 사례 아님)
rnd = random.Random(20261026)
REL = ["spouse", "lineal_ascendant", "lineal_descendant", "other_relative", "unrelated"]


def amount(hi):
    return rnd.choice([rnd.randint(1, hi), rnd.randint(0, 40) * 10_000_000, rnd.randint(1, 9) * 100_000_000,
                       rnd.choice([99_999_999, 100_000_000, 100_000_001, 500_000_000, 1_000_000_000, 3_000_000_000])])


def rdate():
    return "%04d-%02d-%02d" % (rnd.randint(2024, 2028), rnd.randint(1, 12), rnd.randint(1, 31 if rnd.random() < 0.3 else 28))


def gift_in():
    d = {"type": "gift", "gift_date": rdate(), "donor_relationship": rnd.choice(REL), "recipient_is_minor": rnd.random() < 0.3,
         "recipient_is_resident": rnd.random() < 0.85, "gift_value": amount(8_000_000_000) if rnd.random() > 0.03 else rnd.choice([0, -5]),
         "deduction_used_10y": rnd.choice([0, 0, 50_000_000, 600_000_000, rnd.randint(0, 700_000_000)]),
         "prior_gifts_same_donor_10y": [{"value": amount(2_000_000_000), "output_tax": rnd.randint(0, 300_000_000)} for _ in range(rnd.choice([0, 0, 1, 2, 3]))],
         "marriage_birth": {"applicable": rnd.random() < 0.3, "already_used": rnd.choice([0, 0, 30_000_000, 100_000_000])},
         "generation_skip": rnd.random() < 0.25, "filed_on_time": rnd.random() < 0.85}
    if rnd.random() < 0.3:
        d["annual_installment_years"] = rnd.randint(1, 12)
    return d


def inh_in():
    spouse = rnd.random() < 0.6
    kids = rnd.randint(0, 5)
    assets = {k: rnd.choice([0, amount(5_000_000_000)]) for k in ("real_estate", "financial", "securities", "other")}
    if sum(assets.values()) == 0:
        assets["real_estate"] = 900_000_000
    d = {"type": "inheritance", "death_date": rdate(), "decedent_resident": rnd.random() < 0.9, "assets": assets,
         "deemed_assets": rnd.choice([{}, {"insurance": amount(1_000_000_000)}]), "debts": rnd.choice([0, amount(500_000_000)]),
         "public_charges": rnd.choice([0, 3_000_000]), "funeral_expenses": rnd.choice([0, 0, 8_000_000]),
         "heirs": {"spouse_exists": spouse, "children_count": kids,
                   "minor_children": [{"age": rnd.randint(0, 18)} for _ in range(rnd.randint(0, min(kids, 3)))],
                   "elderly_count": rnd.randint(0, 2),
                   "disabled": [{"life_expectancy_years": rnd.randint(1, 40)}] if rnd.random() < 0.15 else []},
         "spouse_actual_inheritance": rnd.choice([0, 300_000_000, amount(4_000_000_000)]),
         "bequests_to_non_heirs": rnd.choice([0, 0, 100_000_000]), "renounced_to_next_rank": rnd.choice([0, 0, 50_000_000]),
         "spouse_prior_gift_taxable_base": rnd.choice([0, 0, 200_000_000]),
         "prior_gifts": {
             "to_heirs_10y": [{"value": amount(1_500_000_000), "taxable_base": amount(1_000_000_000), "output_tax": rnd.randint(0, 200_000_000)} for _ in range(rnd.choice([0, 0, 1, 2]))],
             "to_others_5y": [{"value": amount(500_000_000), "output_tax": rnd.randint(0, 50_000_000)} for _ in range(rnd.choice([0, 0, 1]))]},
         "cohabiting_house": {"applicable": rnd.random() < 0.3, "house_value_net": amount(1_500_000_000)},
         "family_business": {"applicable": rnd.random() < 0.1}, "filed_on_time": rnd.random() < 0.85,
         "generation_skip_share": rnd.choice([0, 0, 0.3, 1, 0.5]), "generation_skip_minor_over_2b": rnd.random() < 0.3,
         "heir_abroad": rnd.random() < 0.1}
    if rnd.random() < 0.5:
        d["net_financial_assets"] = rnd.choice([0, 10_000_000, amount(2_000_000_000)])
    if rnd.random() < 0.3:
        d["annual_installment_years"] = rnd.randint(1, 15)
    if rnd.random() < 0.3:
        d["heirs"]["spouse_legal_share"] = rnd.choice([0.5, 0.3, 0.6, 1])
    return d


for i in range(300):
    for kind, mk, fn in (("gift", gift_in, C.calc_gift), ("inheritance", inh_in, C.calc_inheritance)):
        inp = mk()
        c = {"source": "random:%s:%d" % (kind, i), "fn": "calc_" + kind, "input": inp}
        try:
            c["result"] = norm(fn(inp, BASE_RS))
        except C.CalcError as e:
            c["calc_error"] = str(e)
        cases.append(c)

out = {"generator": "packages/igt-engine/baseline/make_baseline.py", "python": sys.version.split()[0], "ruleset_version": BASE_RS["version"],
       "source_suite": {"tests_run": suite_run, "failures": suite_fail}, "random_seed": 20261026, "cases": cases}
(HERE / "baseline.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
print("suite", suite_run, "fail", suite_fail, "cases", len(cases))
print(Counter((c["source"].split(":")[0], c["fn"], "err" if "calc_error" in c else ("exc:" + c["exception"] if "exception" in c else "ok")) for c in cases))
print("custom-ruleset cases", sum(1 for c in cases if "ruleset" in c))
