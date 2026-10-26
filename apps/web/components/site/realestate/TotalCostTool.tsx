"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { track } from "@/lib/analytics/client";
import { SmCalculatorCard, Chip } from "@ltr/ui";
import { composeTotalCost, type Ruleset } from "@ltr/tax-engine";
import { formatWon } from "@/lib/calc/result-view";
import { snapshotHandoff } from "@/lib/realestate/handoff";
import { barsTotal, buildTotalCostInput, chartBars, compareScenarios, tableRows, type TotalCostForm, type TotalCostPolicy } from "@/lib/realestate/total-cost";
import type { SmTransferPair } from "@/lib/server/public/realestate-tools";

// 총비용 시뮬레이터 (/calc/total-cost - RE-05). 취득 지방세 + 해마다 보유세(엔진) + 사용자 가정 비용. 계산은 이 브라우저 안에서만 하고(네트워크 0),
// 입력은 메모리에만 있다(저장소·주소·서버·이벤트 0). 양도 단계는 계산하지 않는다: 매도가 칸·양도 줄이 없고 결과 아래 안내 한 줄과 SM 카드뿐이다.
// 금리·공시가격·보유 기간은 사용자 가정이다(시세·금리 예측·수익률·유리/불리 표현 없음).

type Open = { acquisition: boolean; property: boolean; comprehensive: boolean };
const INPUT = "min-h-11 w-full rounded-lg border border-navy-200 px-3 text-[16px]";
const num = (s: string): number | undefined => {
  const t = s.trim().replaceAll(",", "");
  return /^\d+$/.test(t) ? Number(t) : undefined;
};
/** 연 금리 글자(소수 둘째 자리까지) -> 만분율 정수. 소수 셋째 자리 이상·음수는 undefined */
const rateBp = (s: string): number | undefined => {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : undefined;
};

/** 들어온 길 - 이전 화면의 경로 이름만 본다(입력값·쿼리·해시는 보지 않는다) */
function entryPathOf(referrer: string): "realestate_tax" | "calc_index" | "article" | "situation" | "direct" {
  let path = "";
  try {
    path = referrer ? new URL(referrer).pathname : "";
  } catch {
    path = "";
  }
  return path.startsWith("/realestate/tax") ? "realestate_tax" : path === "/calc" || path === "/calc/" ? "calc_index" : path.startsWith("/articles") ? "article" : path.startsWith("/situations") ? "situation" : "direct";
}

export function TotalCostTool({ ruleset, policy, open, sm }: { ruleset: Ruleset; policy: TotalCostPolicy; open: Open; sm: SmTransferPair | null }) {
  const [raw, setRaw] = useState({ price: "", area: "", houses: "", years: "", published: "", loan: "", rate: "", extra1: "", extra2: "" });
  const [adjusted, setAdjusted] = useState(false);
  const [owner, setOwner] = useState<"INDIVIDUAL" | "CORPORATION">("INDIVIDUAL");
  const [unknownPrice, setUnknownPrice] = useState(false);
  const [unknownRate, setUnknownRate] = useState(false);
  // 화면을 연 것만 1건 보낸다(계산 중에는 보내지 않는다 - 계산 중 네트워크 0). 이벤트에는 들어온 길 이름뿐이다
  useEffect(() => {
    void track("total_cost_started", { section: null, props: { entry_path: entryPathOf(document.referrer) } });
  }, []);
  const set = (k: keyof typeof raw) => (v: string) => setRaw((r) => ({ ...r, [k]: v }));

  // 주택 수 판정에서 넘어온 값은 메모리 전달로만 받는다 (RE-04)
  const handoff = useSyncExternalStore(() => () => {}, snapshotHandoff, () => null);

  const form: TotalCostForm = useMemo(() => {
    const extras = [raw.extra1, raw.extra2].flatMap((a, i) => (num(a) !== undefined ? [{ label: i === 0 ? "부대비용 1" : "부대비용 2", amount: num(a)! }] : []));
    return {
      ownerType: owner,
      ...(num(raw.price) !== undefined ? { price: num(raw.price)! } : {}),
      ...(raw.area.trim() !== "" && Number(raw.area) > 0 ? { exclusiveAreaSqm: Number(raw.area) } : {}),
      ...((num(raw.houses) ?? handoff?.houseCount) !== undefined ? { houseCount: (num(raw.houses) ?? handoff?.houseCount)! } : {}),
      isAdjustedArea: adjusted,
      ...(num(raw.years) !== undefined ? { holdingYears: num(raw.years)! } : {}),
      ...(!unknownPrice && num(raw.published) !== undefined ? { publishedPrice: num(raw.published)! } : {}),
      extraCosts: extras,
      ...(num(raw.loan) !== undefined ? { loanPrincipal: num(raw.loan)! } : {}),
      ...(!unknownRate && rateBp(raw.rate) !== undefined ? { loanRateBp: rateBp(raw.rate)! } : {}),
    };
  }, [raw, adjusted, owner, unknownPrice, unknownRate, handoff]);

  const built = useMemo(() => buildTotalCostInput(form, policy, open), [form, policy, open]);
  const outcome = useMemo(() => {
    if (!built.input) return null;
    try {
      const result = composeTotalCost(built.input, ruleset);
      return { result, bars: chartBars(result), compare: compareScenarios(form, policy, ruleset, open) };
    } catch {
      return "error" as const;
    }
  }, [built, ruleset, form, policy, open]);
  const maxBar = outcome && outcome !== "error" ? Math.max(1, ...outcome.bars.map((b) => b.total)) : 1;

  return (
    <main id="main" data-ui="total-cost" className="mx-auto w-full max-w-[860px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">총비용 시뮬레이터</h1>
      <p className="mt-2 text-[15px] text-navy-700">취득세부터 보유 기간의 재산세·종합부동산세까지, 그리고 직접 넣은 가정 비용을 더합니다. 입력한 내용은 이 화면에만 있고 저장하거나 보내지 않습니다.</p>

      <section data-part="inputs" className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-[15px] text-navy-800">소유 형태
          <select className={INPUT} value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)}>
            <option value="INDIVIDUAL">개인</option>
            <option value="CORPORATION">법인</option>
          </select>
        </label>
        <label className="text-[15px] text-navy-800">매매가 (원)
          <input className={INPUT} inputMode="numeric" name="price" value={raw.price} onChange={(e) => set("price")(e.target.value)} />
        </label>
        <label className="text-[15px] text-navy-800">전용면적 (㎡, 모르면 비움)
          <input className={INPUT} inputMode="decimal" value={raw.area} onChange={(e) => set("area")(e.target.value)} />
        </label>
        <label className="text-[15px] text-navy-800">취득 후 보유 주택 수 (모르면 비움)
          <input className={INPUT} inputMode="numeric" name="houses" value={raw.houses !== "" ? raw.houses : handoff ? String(handoff.houseCount) : ""} onChange={(e) => set("houses")(e.target.value)} />
        </label>
        <label className="flex min-h-11 items-center gap-3 text-[15px] text-navy-800">
          <input type="checkbox" className="h-5 w-5" checked={adjusted} onChange={(e) => setAdjusted(e.target.checked)} />
          <span>조정대상지역에 있어요</span>
        </label>
        <label className="text-[15px] text-navy-800">보유 기간 (년, 0부터 {policy.maxHoldingYears}까지)
          <input className={INPUT} inputMode="numeric" name="years" value={raw.years} onChange={(e) => set("years")(e.target.value)} />
        </label>
        <div className="text-[15px] text-navy-800">
          <label>공시가격 (원, 매년 같은 값으로 가정)
            <input className={INPUT} inputMode="numeric" name="published" disabled={unknownPrice} value={raw.published} onChange={(e) => set("published")(e.target.value)} />
          </label>
          <label className="mt-1 flex min-h-11 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={unknownPrice} onChange={(e) => setUnknownPrice(e.target.checked)} />
            <span>모르겠어요</span>
          </label>
        </div>
        <label className="text-[15px] text-navy-800">부대비용 1 (원, 예: 중개보수)
          <input className={INPUT} inputMode="numeric" name="extra1" value={raw.extra1} onChange={(e) => set("extra1")(e.target.value)} />
        </label>
        {policy.maxExtraItems >= 2 && (
          <label className="text-[15px] text-navy-800">부대비용 2 (원, 예: 등기비용)
            <input className={INPUT} inputMode="numeric" name="extra2" value={raw.extra2} onChange={(e) => set("extra2")(e.target.value)} />
          </label>
        )}
        <label className="text-[15px] text-navy-800">대출 원금 (원, 없으면 비움)
          <input className={INPUT} inputMode="numeric" name="loan" value={raw.loan} onChange={(e) => set("loan")(e.target.value)} />
        </label>
        <div className="text-[15px] text-navy-800">
          <label>연 금리 (%, 만기 일시 상환 가정)
            <input className={INPUT} inputMode="decimal" name="rate" disabled={unknownRate} value={raw.rate} onChange={(e) => set("rate")(e.target.value)} />
          </label>
          <label className="mt-1 flex min-h-11 items-center gap-3">
            <input type="checkbox" className="h-5 w-5" checked={unknownRate} onChange={(e) => setUnknownRate(e.target.checked)} />
            <span>모르겠어요</span>
          </label>
        </div>
      </section>

      {built.outOfRange.length > 0 && (
        <p data-part="range-error" role="alert" className="mt-4 text-[15px] font-bold text-navy-900">
          입력 범위를 넘었어요. 보유 기간은 {policy.maxHoldingYears}년, 부대비용은 {policy.maxExtraItems}개, 연 금리는 {policy.maxRateBp / 100}%까지 넣을 수 있습니다.
        </p>
      )}
      {outcome === "error" && <p className="mt-4 text-[15px] text-navy-800">입력한 값을 한 번 더 확인해 주세요</p>}

      {outcome && outcome !== "error" && (
        <section data-part="result" aria-live="polite" className="mt-8 space-y-6">
          <div data-ui="result-first" className="rounded-2xl border border-navy-100 bg-ivory p-5">
            <p className="text-[14px] text-navy-700">총비용 (취득 + 보유 {outcome.result.holdingYears}년)</p>
            <p data-part="total-amount" data-total={outcome.result.total} className="text-[28px] font-black tabular-nums text-navy-900">{formatWon(outcome.result.total)}</p>
            <p className="mt-1 flex flex-wrap gap-2">
              <Chip>가정: 모든 해에 현행 룰셋 적용</Chip>
              {built.notIncluded.map((n) => (
                <Chip key={n}>{n} 미포함</Chip>
              ))}
            </p>
          </div>

          <div data-part="chart" role="img" aria-label="연도별 총비용 막대 그래프" data-sum={barsTotal(outcome.bars)} className="space-y-2">
            {outcome.bars.map((b) => (
              <div key={b.year} data-part="bar" data-total={b.total} className="flex items-center gap-3 text-[14px] text-navy-800">
                <span className="w-14 shrink-0">{b.label}</span>
                <span className="h-5 rounded bg-hermes-500" style={{ width: `${(b.total / maxBar) * 100}%` }} />
              </div>
            ))}
          </div>

          <table data-part="table" data-sum={barsTotal(tableRows(outcome.result))} className="w-full text-[14px] tabular-nums">
            <caption className="sr-only">연도별 총비용</caption>
            <thead>
              <tr className="text-left text-navy-700">
                <th scope="col">시점</th><th scope="col">취득 세금</th><th scope="col">보유세</th><th scope="col">부대비용</th><th scope="col">이자</th><th scope="col">소계</th>
              </tr>
            </thead>
            <tbody>
              {tableRows(outcome.result).map((b) => (
                <tr key={b.year} data-part="row" data-total={b.total} className="border-t border-navy-100">
                  <th scope="row" className="text-left">{b.label}</th>
                  <td>{formatWon(b.acquisitionTax)}</td><td>{formatWon(b.holdingTax)}</td><td>{formatWon(b.extra)}</td><td>{formatWon(b.interest)}</td><td className="font-bold">{formatWon(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <details data-part="statement" className="rounded-2xl border border-navy-100 p-4">
            <summary className="min-h-11 cursor-pointer text-[16px] font-bold text-navy-900">세목 명세서</summary>
            <ul className="mt-2 space-y-1 text-[14px] text-navy-800">
              {outcome.result.lines.map((l, i) => (
                <li key={i} data-part="line" data-year={l.year} data-amount={l.amount}>
                  {l.year === 0 ? "취득" : `${l.year}년차`} · {l.label}{l.kind === "assumption" ? " (가정)" : ""} · {formatWon(l.amount)}
                </li>
              ))}
            </ul>
            <p className="mt-2 font-mono text-[13px] text-navy-600">룰셋 {outcome.result.rulesVersion}</p>
          </details>

          {outcome.compare && (
            <div data-part="compare" className="rounded-2xl border border-navy-100 p-4 text-[15px] text-navy-800">
              <p className="font-bold text-navy-900">보유 기간 비교</p>
              <p>{outcome.compare.years[0]}년 보유: {formatWon(outcome.compare.totals[0])}</p>
              <p>{outcome.compare.years[1]}년 보유: {formatWon(outcome.compare.totals[1])}</p>
              <p>차이: {formatWon(Math.abs(outcome.compare.difference))}</p>
            </div>
          )}

          <p data-part="transfer-notice" className="text-[15px] font-bold text-navy-900">팔 때의 양도세는 이 계산에 포함되지 않습니다.</p>
          {sm && <SmCalculatorCard calcKey="transfer" link={sm.link} fallback={sm.fallback} usageNote={sm.usageNote} />}
        </section>
      )}
    </main>
  );
}
