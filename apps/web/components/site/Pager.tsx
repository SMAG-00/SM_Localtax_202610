import { UiLink } from "@ltr/ui";
import { TEXT_LINK } from "./SiteSection";

// 목록 쪽 넘김 — 이전·다음 쪽 링크(사이트 안 이동은 화면 전환)와 지금 쪽(고정폭). 한 쪽뿐이면 요소 0.
export function Pager({ page, total, prev, next }: { page: number; total: number; prev: string | null; next: string | null }) {
  if (!prev && !next) return null;
  return (
    <nav aria-label="쪽 넘김" data-part="pager" className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2">
      {prev && (
        <UiLink href={prev} rel="prev" className={TEXT_LINK}>
          이전 쪽
        </UiLink>
      )}
      <span className="font-mono text-[13px] tracking-wide text-navy-600">{`${page}쪽 · 모두 ${total}건`}</span>
      {next && (
        <UiLink href={next} rel="next" className={TEXT_LINK}>
          다음 쪽
        </UiLink>
      )}
    </nav>
  );
}
