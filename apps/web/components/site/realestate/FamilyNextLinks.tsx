"use client";

import Link from "next/link";
import { SmCalculatorCard } from "@ltr/ui";
import { track } from "@/lib/analytics/client";
import type { FamilyNextCard } from "@/lib/realestate/family-next";
import type { SmTransferPair } from "@/lib/server/public/realestate-tools";

// 상속·증여 후 다음에 확인할 것 (FAM-05) - 주택 수 판정 · 보유세 · 추후 양도세 안내, 공개된 도구만(미공개 카드·"준비 중" 0).
// 링크 주소에는 값이 없다. 이동은 클릭 때만 측정하고 이벤트에는 화면·대상 이름뿐이다(입력값·원인·금액 0).

type From = "guide_page" | "situation_page" | "acquisition_result";
type Target = "house_count" | "holding_tax" | "transfer_guide";
const A = "inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4";

const send = (from: From, target: Target) => void track("family_next_check_opened", { section: null, props: { from_screen: from, target } });

export function FamilyNextLinks({ from, cards, sm }: { from: From; cards: readonly FamilyNextCard[]; sm: SmTransferPair | null }) {
  const shown = cards.filter((c) => c.id !== "transfer" || sm !== null);
  if (shown.length === 0) return null;
  return (
    <section data-ui="family-next" data-from={from} aria-labelledby="family-next-title" className="mt-10 space-y-3">
      <h2 id="family-next-title" className="text-[19px] font-black text-navy-900">다음에 확인할 것</h2>
      <ul className="grid gap-4 sm:grid-cols-3">
        {shown.map((c) => (
          <li key={c.id} data-card={c.id} className="rounded-2xl border border-navy-100 bg-white p-4">
            {c.id === "house_count" && (
              <Link href={c.href} onClick={() => send(from, "house_count")} className={A}>
                주택 수 판정하기
              </Link>
            )}
            {c.id === "holding" && (
              <Link href={c.href} onClick={() => send(from, "holding_tax")} className={A}>
                보유세 계산하기
              </Link>
            )}
            {c.id === "transfer" && sm && (
              <div onClickCapture={(e) => e.target instanceof Element && e.target.closest("a[href]") && send(from, "transfer_guide")}>
                <SmCalculatorCard calcKey="transfer" link={sm.link} fallback={sm.fallback} usageNote={sm.usageNote} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
