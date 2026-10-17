import type { ReactNode } from "react";
import { Eyebrow } from "../base";

export type RegionRef = { name: string; href: string };

export type RegionHubHeadProps = {
  sido: RegionRef;
  /** 시·군·구 허브일 때만 */
  sigungu?: RegionRef;
  /** 같은 시·도의 시·군·구 — 옮겨 갈 링크 */
  sigunguOptions?: RegionRef[];
  /** 분야 지방세 포인트 블록 */
  taxPoint?: ReactNode;
  /** 분야 필터 */
  filter?: ReactNode;
  /** 지자체 허브 블록 (다섯 블록) */
  blocks?: ReactNode;
  /** 지역 세금 연결 블록 */
  taxLinks?: ReactNode;
};

const CRUMB =
  "inline-flex min-h-11 items-center text-[15px] font-semibold text-navy-600 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 aria-[current=page]:font-bold aria-[current=page]:text-navy-900";

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-navy-300" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * 지역 허브 머리 — /local 시·도 > 시·군·구 이동 + 분야 지방세 포인트 블록 + 분야 필터 + 지자체 허브 블록 + 지역 세금 연결 블록.
 * 순서는 이 컴포넌트가 정한다 (RP-07)
 */
export function RegionHubHead({ sido, sigungu, sigunguOptions, taxPoint, filter, blocks, taxLinks }: RegionHubHeadProps) {
  const crumbs: Array<RegionRef & { current: boolean }> = [
    { name: "지자체뉴스", href: "/local", current: false },
    { name: sido.name, href: sido.href, current: !sigungu },
    ...(sigungu ? [{ ...sigungu, current: true }] : []),
  ];
  const options = (sigunguOptions ?? []).filter((o) => o.href !== sigungu?.href);

  return (
    <div data-ui="region-hub-head">
      <header>
        <nav aria-label="지역 이동">
          <ol className="flex flex-wrap items-center gap-x-1">
            {crumbs.map((c, i) => (
              <li key={c.href} className="inline-flex items-center gap-x-1">
                {i > 0 && <Chevron />}
                <a href={c.href} aria-current={c.current ? "page" : undefined} className={CRUMB}>
                  {c.name}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-6">
          <Eyebrow>LOCAL</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">{sigungu ? `${sido.name} ${sigungu.name}` : sido.name}</h1>
        </div>
        {options.length > 0 && (
          <details className="mt-4 rounded-xl border border-navy-100 bg-white">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[15px] font-bold text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
              시·군·구 바꾸기
            </summary>
            <ul className="flex flex-wrap gap-2 px-4 pb-4">
              {options.map((o) => (
                <li key={o.href}>
                  <a
                    href={o.href}
                    className="inline-flex min-h-11 items-center rounded-md border border-navy-100 bg-ivory px-3 text-[15px] font-bold text-navy-700 transition hover:border-hermes-400 hover:bg-hermes-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                  >
                    {o.name}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </header>
      {taxPoint && <div className="mt-8">{taxPoint}</div>}
      {filter && <div className="mt-8">{filter}</div>}
      {blocks && <div className="mt-12">{blocks}</div>}
      {taxLinks && <div className="mt-20">{taxLinks}</div>}
    </div>
  );
}
