import { brand } from "../../brand";
import { LinkCard } from "../base";
import { DateText, MONO, NewWindowIcon, TaxKindLabel } from "./parts";
import { pickOfficialLink, type OfficialLink } from "./official-link";

/** SM 부동산 세금 플랫폼 계산기 키 (TX-01, PRD-00 10.7) */
export type SmCalcKey = "acquisition" | "transfer" | "holding" | "oligopoly" | "compare";

export type SmCalculatorCardProps = {
  calcKey: SmCalcKey;
  /** `official_links` kind `sm_calculator`, calc_key 행 */
  link: OfficialLink;
  /** 점검 실패 때 같은 자리에 보이는 위택스 공식 안내 */
  fallback: OfficialLink;
  /** 이용 조건 한 줄 (SM 계산기는 승인 회원 전용 — 문구는 설정값) */
  usageNote: string;
};

const NAME: Record<SmCalcKey, string> = { acquisition: "취득세", transfer: "양도세", holding: "보유세", oligopoly: "과점주주", compare: "비교" };
const OPEN_LABEL = "새 창에서 별도 사이트 열기";

/**
 * SM 계산기 카드 — 외부 계산기 연결 카드 문법, 카드 전체가 하나의 새 창 링크 (TX-01 · TX-02 · TX-06).
 * 양도세는 SM 안의 '양도세 메뉴'로 보낸다(별도 계산기 아님) — '국세' 표시와 미계산 안내를 함께 둔다.
 */
export function SmCalculatorCard({ calcKey, link, fallback, usageNote }: SmCalculatorCardProps) {
  const picked = pickOfficialLink(link, fallback);
  if (!picked) return null;
  const { link: target, isFallback } = picked;
  const name = NAME[calcKey];
  const national = calcKey === "transfer";
  const destination = isFallback ? (target.label ?? "위택스 공식 안내") : brand.smCalculatorSiteName;
  const what = isFallback ? name : national ? "양도세 메뉴" : `${name} 계산기`;

  return (
    <div data-ui="sm-calculator-card" data-calc={calcKey} data-state={isFallback ? "fallback" : "primary"}>
      {/* 이름은 보이는 글자 + 화면 읽기 전용 안내 — aria-label로 덮어쓰지 않는다 (WCAG 2.5.3 Label in Name) */}
      <LinkCard href={target.url} external>
        <span className="flex">
          <TaxKindLabel kind={national ? "national" : "local"} />
        </span>
        <span data-part="title" className="mt-3 block text-[19px] font-black text-navy-900">
          {name}
        </span>
        {national && <span className="mt-1 block text-[15px] text-navy-600">이 사이트는 양도소득세·지방소득세(양도소득분)를 계산하지 않습니다</span>}
        <span className="mt-3 flex items-center gap-1.5 text-[14px] font-bold text-navy-700">
          <NewWindowIcon />
          {destination}(별도 사이트) · 새 창
        </span>
        <span className="mt-1 block text-[15px] text-navy-600">{isFallback ? "지금은 공식 안내로 연결합니다" : usageNote}</span>
        <span className={`mt-2 block ${MONO}`}>
          링크 확인일 <DateText value={target.checkedAt} />
        </span>
        <span className="sr-only">
          {" "}
          — {what}, {OPEN_LABEL}
        </span>
      </LinkCard>
    </div>
  );
}
