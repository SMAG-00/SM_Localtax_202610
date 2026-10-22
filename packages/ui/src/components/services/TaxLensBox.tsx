import { useId } from "react";
import { Chip, Eyebrow } from "../base";
import { MONO, SiteLink } from "./parts";
import { hasAmount, isBlank, isCleanExternalUrl, nonBlank } from "./format";

export type TaxLensLinkKind = "explainer" | "smCalculator" | "product" | "experts";
export type TaxLensLink = { href: string; /** 기능이 열렸는가 — 닫힌 기능은 링크 0 */ enabled: boolean };

export type TaxLensBoxProps = {
  /** 관련 세목 칩 */
  taxes: readonly string[];
  /** 핵심 포인트 1~3줄 (R8) — 세액·개별 결론 없음 */
  points: readonly string[];
  /** 링크 4종 이하 — 열린 기능만 보인다 */
  links: Partial<Record<TaxLensLinkKind, TaxLensLink>>;
  /** 감수자 */
  reviewer: string;
  /** 법령 기준일 */
  basisDate: string;
  /** 한 화면에 박스가 여럿일 때 구별하는 이름 (화면 읽기용 — 제목 뒤에 숨은 글자로 붙는다. 예: 단계 이름 — PR-08) */
  label?: string;
};

const MAX_POINTS = 3;
const ORDER: readonly TaxLensLinkKind[] = ["explainer", "smCalculator", "product", "experts"];
const LABEL: Record<TaxLensLinkKind, string> = {
  explainer: "해설 읽기",
  smCalculator: "SM 취득세 계산기",
  product: "관련 도서 · 자사 상품",
  experts: "전문가 찾기",
};

function openLinks(links: TaxLensBoxProps["links"]) {
  return ORDER.flatMap((kind) => {
    const link = links[kind];
    if (!link?.enabled || isBlank(link.href)) return [];
    // SM 계산기는 바깥 사이트 — 쿼리·조각 없는 설정 주소만 (TX-02)
    if (kind === "smCalculator" && !isCleanExternalUrl(link.href)) return [];
    return [{ kind, href: link.href }];
  });
}

/**
 * 「지방세로 읽기」 박스 — 부동산·개발금융·지자체 기사 끝 흰 카드 (CORE-01 · PR-08).
 * 저장 규칙(세목 1개 이상 · 포인트 1~3줄 · 링크 1개 이상 · 세액 표현 0)을 어긴 값은 박스 HTML 0으로 막는다.
 */
export function TaxLensBox({ taxes, points, links, reviewer, basisDate, label }: TaxLensBoxProps) {
  const headingId = useId();
  const taxChips = nonBlank(taxes);
  const lines = nonBlank(points);
  const shown = openLinks(links);
  if (taxChips.length === 0 || lines.length === 0 || lines.length > MAX_POINTS || lines.some(hasAmount) || shown.length === 0 || isBlank(reviewer) || isBlank(basisDate)) {
    return null;
  }

  return (
    <section data-ui="tax-lens-box" aria-labelledby={headingId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <div data-part="lens-body" className="border-l-2 border-hermes-500 pl-4">
        <Eyebrow>LOCAL TAX LENS</Eyebrow>
        <h2 id={headingId} className="mt-2 text-[19px] font-black text-navy-900">
          지방세로 읽기
          {!isBlank(label ?? "") && <span className="sr-only"> — {label}</span>}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="관련 세목">
          {taxChips.map((t) => (
            <li key={t}>
              <Chip>{t}</Chip>
            </li>
          ))}
        </ul>
        <ul data-list="points" className="mt-4 list-disc space-y-1 pl-5 text-[17px] text-navy-900">
          {lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <ul className="mt-4 flex flex-wrap gap-x-5 text-[15px]">
          {shown.map((l) => (
            <li key={l.kind}>
              <SiteLink href={l.href} newWindowLabel="별도 사이트 · 새 창">
                {LABEL[l.kind]}
              </SiteLink>
            </li>
          ))}
        </ul>
        <p className={`mt-3 ${MONO}`}>
          감수 {reviewer} · 기준일 {basisDate}
        </p>
      </div>
    </section>
  );
}
