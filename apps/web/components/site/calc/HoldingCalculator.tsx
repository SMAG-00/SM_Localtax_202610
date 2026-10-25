"use client";

import { calcHolding, type Ruleset } from "@ltr/tax-engine";
import { CALC_COPY } from "@/lib/calc/copy";
import { HOLDING_QUESTIONS, buildHolding, holdingResultFor, type HoldingForm, type HoldingGroup } from "@/lib/calc/holding";
import { buildResultView } from "@/lib/calc/result-view";
import { reductionBlock } from "@/lib/calc/reduction";
import type { Assumptions } from "@/lib/calc/shared";
import { wetaxCardFor, type WetaxLinkRow, type WetaxScreen } from "@/lib/calc/wetax";
import { WetaxCardView } from "./cards";
import { ResultBlocks } from "./ResultBlocks";
import { CalculatorShell } from "./Shell";

// 재산세·종합부동산세 계산기 화면 (CALC-02) - 두 세목을 따로 공개한다: 게이트가 닫힌 세목의 항목·합계는 만들지 않는다.
export interface HoldingCalculatorProps {
  ruleset: Ruleset;
  /** 결과 6번 칸의 상담 요청 보조 링크 주소 (GROW-06) - 전문가 연락 요청이 닫혀 있으면 null */
  consultHref?: string | null;
  open: Record<HoldingGroup, boolean>;
  badges: Record<HoldingGroup, string | null>;
  wetax: WetaxLinkRow[];
  assumptions: Assumptions;
  /** 위택스 납부 메뉴 - 열린 세목 기준 */
  wetaxScreen: Extract<WetaxScreen, "property" | "comprehensive">;
  /** 장애 폴백 등 화면 위 안내 (CALC-08) */
  notice?: string | null;
  /** 지역 코드 -> 허브 주소 (REG1-10) */
  regionLinks?: Record<string, { name: string; href: string }>;
}

export function HoldingCalculator(p: HoldingCalculatorProps) {
  const ready = (form: HoldingForm, unknown: ReadonlySet<string>) => {
    const b = buildHolding(form, unknown, p.assumptions);
    return !b.liable || b.input !== null;
  };

  const result = (form: HoldingForm, unknown: ReadonlySet<string>) => {
    const built = buildHolding(form, unknown, p.assumptions);
    if (!built.liable) {
      return (
        <section data-ui="result-first" data-state="not-liable" className="rounded-2xl border border-navy-100 bg-ivory p-5">
          <p data-part="total-amount" className="text-[24px] font-black text-navy-900">{CALC_COPY.notLiableTitle}</p>
          <p className="mt-1 text-[15px] text-navy-700">{CALC_COPY.notLiableReason}</p>
        </section>
      );
    }
    if (!built.input) return null;
    let view;
    let both: { property: boolean; comprehensive: boolean };
    try {
      const r = calcHolding(built.input, p.ruleset);
      view = buildResultView(r, holdingResultFor(r, p.open).items);
      both = p.open;
    } catch {
      return <p className="text-[15px] text-navy-800">입력한 값을 한 번 더 확인해 주세요</p>;
    }
    const card = wetaxCardFor(p.wetaxScreen, p.wetax);
    const badge = [both.property ? p.badges.property : null, both.comprehensive ? p.badges.comprehensive : null].filter(Boolean).join(" / ") || null;
    return (
      <ResultBlocks
        title={both.property && both.comprehensive ? "재산세·종합부동산세 결과" : both.property ? "재산세 결과" : "종합부동산세 결과"}
        view={view}
        place={card.mode === "text" ? null : CALC_COPY.wetaxLabel}
        reduction={reductionBlock(null, {})}
        consultHref={p.consultHref ?? null}
        assumed={built.assumed}
        badge={badge}
        next={<WetaxCardView screen={p.wetaxScreen} rows={p.wetax} action="위택스에서 납부하러 가기" />}
      />
    );
  };

  return <CalculatorShell<HoldingForm> tool="holding" rulesetVersion={p.ruleset.version} notice={p.notice ?? null} regionLinks={p.regionLinks} eyebrow="HOLDING · 재산세·종합부동산세" title="재산세·종합부동산세 계산" questions={HOLDING_QUESTIONS} initial={{}} ready={ready} result={result} />;
}
