import { useId } from "react";
import { Eyebrow } from "../base";
import { ExternalLink } from "./shared";

/**
 * 연결 종류 — 감수 해설 · 상황 카드 · SM 계산기(별도 사이트) · 공식 지자체 원문 · 자체 계산기(2단계, 기능 플래그).
 * 관광 정보는 종류에 없다 (REG1-10).
 */
export type RegionTaxLinkKind = "explainer" | "situation" | "sm-calculator" | "official" | "calculator";

export type RegionTaxLink = {
  kind: RegionTaxLinkKind;
  label: string;
  href: string;
  /** 기능 플래그 — false면 링크를 아예 그리지 않는다 ('준비 중' 링크 0) */
  enabled?: boolean;
};

const KIND: Record<RegionTaxLinkKind, { tag: string; external: boolean }> = {
  explainer: { tag: "감수 해설", external: false },
  situation: { tag: "상황별 안내", external: false },
  "sm-calculator": { tag: "SM 계산기 · 별도 사이트", external: true },
  official: { tag: "공식 지자체 원문", external: true },
  calculator: { tag: "계산기", external: false },
};

const MIN_LINKS = 2;
const MAX_LINKS = 5;

const ITEM =
  "group flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-navy-100 bg-white px-4 py-3 text-[17px] font-bold text-navy-900 transition hover:border-hermes-400 hover:bg-hermes-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 지역 세금 연결 블록 — 지자체 허브에서 세금 문제 해결로 가는 출구, 링크 2~5건 (REG1-10) */
export function RegionTaxLinks({ links }: { links: RegionTaxLink[] }) {
  const headingId = useId();
  const shown = links.filter((l) => l.enabled !== false && Object.hasOwn(KIND, l.kind) && l.label.trim() && l.href.trim()).slice(0, MAX_LINKS);
  if (shown.length < MIN_LINKS) return null;

  return (
    <section data-ui="region-tax-links" aria-labelledby={headingId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <Eyebrow>NEXT STEP</Eyebrow>
      <h2 id={headingId} className="mt-3 text-[22px] font-black tracking-tight text-navy-900">
        이 지역의 세금 상황·도구
      </h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {shown.map((l) => {
          const kind = KIND[l.kind];
          const body = (
            <>
              <span className="text-[12px] font-bold tracking-wide text-hermes-800">{kind.tag}</span>
              <span>{l.label}</span>
            </>
          );
          return (
            <li key={`${l.kind}-${l.href}`}>
              {kind.external ? (
                <ExternalLink href={l.href} className={ITEM}>
                  {body}
                </ExternalLink>
              ) : (
                <a href={l.href} className={ITEM}>
                  {body}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
