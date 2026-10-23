import { LinkCard, UiLink, cx } from "@ltr/ui";
import type { HubLinkCard, RegionChip, RegionChips } from "@/lib/server/public/realestate-hub-logic";
import { SIDO_CHIP_LABELS } from "@/lib/site/hub-view";

// /realestate 허브 확장의 작은 부분들 (W4 22단계 — PR-01): 지역 칩 · 링크 카드. 규칙은 realestate-hub-logic.ts.
// 칩 = 지역 허브 ③ 부동산·개발 앵커 링크(JS 없이 동작). 링크 카드는 열린 기능만 받는다(닫힌 기능 카드 0).

const CHIP =
  "inline-flex min-h-11 items-center rounded-md border border-navy-100 bg-white px-3 text-[15px] font-bold text-navy-700 transition hover:border-hermes-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

function ChipList({ label, chips, part }: { label: string; chips: readonly RegionChip[]; part: string }) {
  if (chips.length === 0) return null;
  return (
    <div data-part={part} className="mt-8">
      <h3 className="text-[15px] font-bold text-navy-600">{label}</h3>
      <ul aria-label={label} className="mt-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <li key={c.code} data-region-code={c.code}>
            <UiLink href={c.href} data-part="region-chip" data-chip-kind={c.kind} className={cx(CHIP)}>
              {c.label}
            </UiLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 지역 칩 — 시범 지역(있을 때) + 시·도 전부. 모두 지역 허브 ③ 앵커로 간다 */
export function RealEstateChips({ chips }: { chips: RegionChips }) {
  return (
    <>
      <p className="mt-4 text-[17px] text-navy-700">지역을 고르면 그 지역 허브의 부동산·개발 블록으로 이동합니다.</p>
      <ChipList label={SIDO_CHIP_LABELS.pilot} chips={chips.pilot} part="chips-pilot" />
      <ChipList label="시·도" chips={chips.sido} part="chips-sido" />
    </>
  );
}

/** 링크 카드 — 개발방법 비교 · 상속·증여 안내 (열린 기능만) */
export function RealEstateLinkCards({ cards }: { cards: readonly HubLinkCard[] }) {
  return (
    <ul data-part="hub-link-cards" className="mt-8 grid gap-4 sm:grid-cols-2">
      {cards.map((c) => (
        <li key={c.key} data-link-card={c.key} className="flex">
          <LinkCard href={c.href} className="w-full">
            <span className="block text-[19px] leading-snug font-black text-navy-900">{c.title}</span>
            <span className="mt-2 block text-[15px] text-navy-700">{c.description}</span>
            {c.meta && <span className="mt-3 block font-mono text-[13px] tracking-wide text-navy-600">{c.meta}</span>}
          </LinkCard>
        </li>
      ))}
    </ul>
  );
}
