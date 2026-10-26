"use client";

import { useState } from "react";
import { SmCalculatorCard, TaxKindBadge } from "@ltr/ui";
import { LIFECYCLE_CAUSE_LABEL, type LifecycleSection, type LifecycleView } from "@/lib/realestate/tax-lifecycle";
import type { SmTransferPair } from "@/lib/server/public/realestate-tools";

// 부동산 세금 전 주기 (/realestate/tax - RE-01·RE-02). 글은 서명·공개된 가이드에서만 온다.
// 양도 탭 = 해설 + 확인 목록 + SM 양도세 카드뿐이다: 계산 칸·매도가 칸·금액 0. 확인 목록 체크는 이 컴포넌트의 메모리에만 있다(저장·전송 0).

const LINK = "font-bold text-navy-900 underline underline-offset-4";

function Accordion({ s }: { s: LifecycleSection }) {
  return (
    <details data-part="accordion" data-tax-kind={s.taxKind} className="rounded-2xl border border-navy-100 bg-white p-4">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 text-[17px] font-bold text-navy-900">
        <TaxKindBadge kind={s.taxKind} />
        <span>{s.title}</span>
      </summary>
      <p className="mt-2 whitespace-pre-line text-[15px] leading-7 text-navy-800">{s.body}</p>
      {s.sources.length > 0 && <p className="mt-2 text-[13px] text-navy-600">근거: {s.sources.join(" · ")}</p>}
    </details>
  );
}

export function TaxLifecycleView({ title, view, lastReviewedAt, asOf, sm }: { title: string; view: LifecycleView; lastReviewedAt: string | null; asOf: string | null; sm: SmTransferPair | null }) {
  const [tab, setTab] = useState<string>(view.tabs[0]!.tab);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const current = view.tabs.find((t) => t.tab === tab) ?? view.tabs[0]!;
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <main id="main" data-ui="tax-lifecycle" className="mx-auto w-full max-w-[1100px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">{title}</h1>
      <p className="mt-1 text-[13px] text-navy-600">
        {lastReviewedAt ? `최종 감수일 ${lastReviewedAt.slice(0, 10)}` : ""}
        {asOf ? ` · 기준일 ${asOf}` : ""}
      </p>
      <div role="tablist" aria-label="세금 전 주기" className="mt-5 flex gap-2">
        {view.tabs.map((t) => (
          <button key={t.tab} role="tab" type="button" id={`tab-${t.tab}`} aria-selected={t.tab === current.tab} aria-controls={`panel-${t.tab}`} data-tab={t.tab} onClick={() => setTab(t.tab)} className={`min-h-11 rounded-full border px-5 text-[16px] font-bold ${t.tab === current.tab ? "border-navy-900 bg-navy-900 text-ivory" : "border-navy-200 bg-white text-navy-900"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${current.tab}`} aria-labelledby={`tab-${current.tab}`} data-part="panel" data-tab={current.tab} className="mt-5 space-y-4">
        {current.tab === "acquire" &&
          current.causes.map((c) => (
            <div key={c.cause} data-part="cause" data-cause={c.cause} className="space-y-3 rounded-2xl border border-navy-100 p-4">
              <h2 className="text-[19px] font-black text-navy-900">{LIFECYCLE_CAUSE_LABEL[c.cause]}으로 취득</h2>
              {c.guideHref && (
                <a href={c.guideHref} data-part="cause-link" className={`inline-flex min-h-11 items-center ${LINK}`}>
                  상속·증여 안내 보기
                </a>
              )}
              {c.sections.map((s, i) => (
                <Accordion key={`${s.title}-${i}`} s={s} />
              ))}
            </div>
          ))}
        {current.sections.map((s, i) => (
          <Accordion key={`${s.title}-${i}`} s={s} />
        ))}
        {current.tab === "transfer" && (
          <>
            {view.checklist.length > 0 && (
              <fieldset data-part="transfer-checklist" className="rounded-2xl border border-navy-100 p-4">
                <legend className="px-1 text-[17px] font-bold text-navy-900">SM 계산기에 넣기 전 확인할 것</legend>
                <ul className="mt-2 space-y-2">
                  {view.checklist.map((item) => (
                    <li key={item.id}>
                      <label className="flex min-h-11 items-center gap-3 text-[15px] text-navy-800">
                        <input type="checkbox" checked={checked.has(item.id)} onChange={() => toggle(item.id)} className="h-5 w-5" />
                        <span>{item.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-navy-600">체크한 내용은 이 화면에만 있고 저장하거나 보내지 않습니다.</p>
              </fieldset>
            )}
            <p data-part="transfer-notice" className="text-[15px] text-navy-800">
              이 사이트는 양도 단계의 세금을 계산하지 않습니다. 계산은 아래 SM 부동산 세금 플랫폼에서 하세요. 입력한 값은 넘어가지 않습니다.
            </p>
            {sm && <SmCalculatorCard calcKey="transfer" link={sm.link} fallback={sm.fallback} usageNote={sm.usageNote} />}
          </>
        )}
      </section>
    </main>
  );
}
