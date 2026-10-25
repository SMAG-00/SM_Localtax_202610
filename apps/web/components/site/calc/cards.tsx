"use client";

import { useState } from "react";
import { ExternalCalculatorCard, SecondaryButton, SmCalculatorCard, type OfficialLink } from "@ltr/ui";
import { MeasureExternalOpened } from "./Measure";
import { CALC_COPY } from "@/lib/calc/copy";
import { wetaxAppLink, wetaxCardFor, type WetaxLinkRow, type WetaxScreen } from "@/lib/calc/wetax";

// 결과 화면의 다음 행동 카드들 - 위택스 바로가기(WETAX-01), 외부 계산기 카드(FAM-04), SM 계산기 카드(TX-04), 비교 진입(CALC-05).
// 주소는 모두 서버가 설정값에서 읽어 넘긴 것이고, 이 화면의 입력값은 어떤 주소에도 붙지 않는다.

const A = "font-bold text-navy-900 underline underline-offset-4";

export function WetaxCardView({ screen, rows, action }: { screen: WetaxScreen; rows: readonly WetaxLinkRow[]; action: string }) {
  const card = wetaxCardFor(screen, rows);
  const app = wetaxAppLink(rows);
  return (
    <aside data-ui="wetax-card" data-mode={card.mode} aria-label={CALC_COPY.wetaxLabel} className="rounded-2xl border border-navy-100 p-5">
      {card.mode === "text" ? (
        <p data-part="wetax-text" className="text-[15px] text-navy-800">
          {CALC_COPY.wetaxText}
        </p>
      ) : (
        <>
          <a href={card.url} target="_blank" rel="noopener noreferrer" data-part="wetax-go" className={`inline-flex min-h-11 items-center text-[17px] ${A}`}>
            {action}
          </a>
          <p className="mt-1 text-[14px] text-navy-700">
            {CALC_COPY.wetaxLabel} · 새 창{card.mode === "fallback" ? " · 첫 화면으로 연결돼요" : ""}
          </p>
          {card.checkedOn && <p className="mt-1 font-mono text-[13px] text-navy-600">확인일 {card.checkedOn}</p>}
        </>
      )}
      <p className="mt-2 text-[13px] text-navy-500">{CALC_COPY.wetaxNoProxy}</p>
      {/* 폭 640px 미만에서만 앱 안내 */}
      {app && (
        <p className="mt-2 sm:hidden" data-part="wetax-app">
          <a href={app.url} target="_blank" rel="noopener noreferrer" className={A}>
            {CALC_COPY.wetaxApp}
          </a>
        </p>
      )}
    </aside>
  );
}

export type OfficialPair = { link: OfficialLink; fallback: OfficialLink };

export function NationalCard({ external }: { external: OfficialPair | null }) {
  if (!external) return null;
  return (
    <>
      <MeasureExternalOpened screen="acquisition_result" />
      <ExternalCalculatorCard link={external.link} fallback={external.fallback} />
    </>
  );
}

export function SmCard({ sm }: { sm: (OfficialPair & { usageNote: string }) | null }) {
  if (!sm) return null;
  return <SmCalculatorCard calcKey="acquisition" link={sm.link} fallback={sm.fallback} usageNote={sm.usageNote} />;
}

/** [조건 바꿔 비교하기] - 회원은 비교 화면으로, 비회원은 가입 안내 카드(이미 본 결과는 그대로) */
export function CompareEntry({ isMember, enabled }: { isMember: boolean; enabled: boolean }) {
  const [asked, setAsked] = useState(false);
  if (!enabled) return null;
  if (isMember) {
    return (
      <p>
        <a href="/calc/compare" data-part="compare-go" className={`inline-flex min-h-11 items-center ${A}`}>
          조건 바꿔 비교하기
        </a>
      </p>
    );
  }
  return (
    <div>
      <SecondaryButton type="button" data-part="compare-ask" onClick={() => setAsked(true)}>
        조건 바꿔 비교하기
      </SecondaryButton>
      {asked && (
        <div data-part="compare-join" role="status" className="mt-3 rounded-2xl border border-navy-100 bg-ivory p-5">
          <p className="text-[15px] text-navy-800">{CALC_COPY.compareJoin}</p>
          <a href="/login" className={`mt-2 inline-flex min-h-11 items-center ${A}`}>
            로그인하고 비교하기
          </a>
        </div>
      )}
    </div>
  );
}
