"use client";

import { useSyncExternalStore } from "react";
import { calcAcquisition, type DeterminationTable, type Ruleset } from "@ltr/tax-engine";
import type { AcquisitionCause } from "@ltr/tax-engine";
import { CALC_COPY } from "@/lib/calc/copy";
import { ACQUISITION_QUESTIONS, acquisitionFacts, buildAcquisition, type AcquisitionForm } from "@/lib/calc/acquisition";
import { reductionBlock } from "@/lib/calc/reduction";
import { buildResultView } from "@/lib/calc/result-view";
import type { Assumptions } from "@/lib/calc/shared";
import { wetaxCardFor, type WetaxLinkRow } from "@/lib/calc/wetax";
import { FamilyNextLinks } from "../realestate/FamilyNextLinks";
import { snapshotHandoff } from "@/lib/realestate/handoff";
import type { FamilyNextData } from "@/lib/server/public/realestate-tools";
import { CompareEntry, NationalCard, SmCard, WetaxCardView, type OfficialPair } from "./cards";
import { ResultBlocks } from "./ResultBlocks";
import { CalculatorShell } from "./Shell";

// 취득세 계산기 화면 (CALC-01·11·12·13 · FAM-03·04·07) - 계산은 이 브라우저에서만 한다(엔진은 순수 함수, 서버 요청 0).
// 공개 전 취득 원인을 고르면 금액을 만들지 않고(0원도 아님) 안내 + SM 카드 + 외부 계산기 카드만 보인다 (FAM-07).

export interface AcquisitionCalculatorProps {
  ruleset: Ruleset;
  reductionTable: DeterminationTable | null;
  /** 원인별 공개 여부 - 서버가 게이트 뷰에서 계산해 넘긴다 */
  causeOpen: Record<AcquisitionCause, boolean>;
  /** 원인별 정확도 배지 글 (공개된 원인만) */
  badges: Record<AcquisitionCause, string | null>;
  wetax: WetaxLinkRow[];
  assumptions: Assumptions;
  isMember: boolean;
  /** 결과 6번 칸의 상담 요청 보조 링크 주소 (GROW-06) - 전문가 연락 요청이 닫혀 있으면 null */
  consultHref?: string | null;
  compareEnabled: boolean;
  guideHref: string | null;
  external: OfficialPair | null;
  sm: (OfficialPair & { usageNote: string }) | null;
  /** 상속·증여 후 다음에 확인할 것 (FAM-05) - 원인별로 공개된 도구만. 없으면 null */
  familyNext?: Partial<Record<"INHERITANCE" | "GIFT", FamilyNextData | null>>;
  /** 장애 폴백 등 화면 위 안내 (CALC-08) */
  notice?: string | null;
  /** 지역 코드 -> 허브 주소 (REG1-10) */
  regionLinks?: Record<string, { name: string; href: string }>;
}

const NATIONAL: readonly AcquisitionCause[] = ["INHERITANCE", "GIFT"];

export function AcquisitionCalculator(p: AcquisitionCalculatorProps) {
  // 주택 수 판정에서 넘어온 값은 브라우저 메모리로만 받는다 (RE-04) - 서버 렌더에는 없고 하이드레이션 뒤에 들어와 Shell을 새 값으로 다시 시작한다
  const handoff = useSyncExternalStore(() => () => {}, snapshotHandoff, () => null);
  const family = (cause: AcquisitionCause | undefined) => {
    const d = cause === "INHERITANCE" || cause === "GIFT" ? p.familyNext?.[cause] : null;
    return d ? <FamilyNextLinks from="acquisition_result" cards={d.cards} sm={d.sm} /> : null;
  };
  const ready = (form: AcquisitionForm, unknown: ReadonlySet<string>) => buildAcquisition(form, unknown, p.assumptions).input !== null;

  const blocked = (form: AcquisitionForm) =>
    form.cause && p.causeOpen[form.cause] === false ? (
      <section data-part="unsupported" data-state="unsupported" className="space-y-4 rounded-2xl border border-navy-100 bg-ivory p-5">
        <h2 className="text-[19px] font-black text-navy-900">{CALC_COPY.unsupportedTitle}</h2>
        {p.guideHref && (
          <a href={p.guideHref} className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
            상속·증여 안내 보기
          </a>
        )}
        <SmCard sm={p.sm} />
        {NATIONAL.includes(form.cause) && <NationalCard external={p.external} />}
        {family(form.cause)}
      </section>
    ) : null;

  const result = (form: AcquisitionForm, unknown: ReadonlySet<string>) => {
    const built = buildAcquisition(form, unknown, p.assumptions);
    if (!built.input) return null;
    let view;
    try {
      view = buildResultView(calcAcquisition(built.input, p.ruleset));
    } catch {
      return <p className="text-[15px] text-navy-800">입력한 값을 한 번 더 확인해 주세요</p>;
    }
    const cause = built.input.cause;
    const national = NATIONAL.includes(cause);
    const card = wetaxCardFor("acquisition", p.wetax);
    return (
      <ResultBlocks
        title="취득세 결과"
        view={view}
        place={card.mode === "text" ? null : CALC_COPY.wetaxLabel}
        afterTotal={national ? <p data-part="national-notice" className="mt-2 text-[15px] font-bold text-navy-800">{CALC_COPY.nationalNotice}</p> : null}
        reduction={reductionBlock(p.reductionTable, acquisitionFacts(built.form))}
        assumed={built.assumed}
        badge={p.badges[cause]}
        consultHref={p.consultHref ?? null}
        next={
          <>
            <CompareEntry isMember={p.isMember} enabled={p.compareEnabled} />
            <WetaxCardView screen="acquisition" rows={p.wetax} action="위택스에서 신고하러 가기" />
            {national && <NationalCard external={p.external} />}
            {family(cause)}
          </>
        }
      />
    );
  };

  return <CalculatorShell<AcquisitionForm> key={handoff ? `handoff-${handoff.houseCount}` : "plain"} tool="acquisition" rulesetVersion={p.ruleset.version} notice={p.notice ?? null} regionLinks={p.regionLinks} eyebrow="ACQUISITION · 취득세" title="취득세 계산" questions={ACQUISITION_QUESTIONS} initial={handoff ? { houseCount: handoff.houseCount } : {}} ready={ready} blocked={blocked} result={result} />;
}
