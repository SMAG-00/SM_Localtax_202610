import { TaxKindBadge } from "@ltr/ui";
import { isNationalTaxLink, type LinkKind } from "@/lib/links/rules";
import type { CalcView, OfficialLinkCard as Card } from "@/lib/server/public/calc";
import { MeasureCalculatorCards } from "./Measure";

// 바깥 연결 카드 (TX-01·FAM-08 · W3 1단계) — /calc가 쓰고, 「지방세로 읽기」·상황 페이지가 같은 컴포넌트를 재사용한다.
// 이동은 새 창이고 noreferrer라 Referer도 없다. 주소에는 쿼리·조각을 더하지 않는다(입력값·표식 값 비전달) — 저장 주소 그대로.
// 끊김(broken)으로 확인된 연결은 이동 링크 대신 안내 문구와 대체 안내로 바꾼다.
// 국세로 가는 연결(상속·증여 외부 계산기·SM 양도세 메뉴·국세청 안내 — isNationalTaxLink)에는 '국세' 배지와 미계산 안내를 붙인다 (TX-06 · W3 9단계).
// 이동 링크 누름은 화면마다 MeasureCalculatorCards 하나가 calculator_card_clicked(카드 키·화면·차례)로 센다 (W3 10단계) — rank = 그 화면 안 카드 차례.

/** 카드의 사이트 표시 — 연결 종류별 */
export function linkSiteLabel(kind: LinkKind): string {
  if (kind === "sm_calculator") return "SM 부동산 세금 플랫폼(별도 사이트) · 새 창";
  if (kind === "external_calculator") return "외부 사이트 · 새 창 · 이 사이트의 결과와 합산하지 않습니다";
  return "공식 안내 · 새 창";
}

function Checked({ card }: { card: Card }) {
  return (
    <p data-part="checked-on" className="mt-2 font-mono text-[13px] tracking-wide text-navy-500">
      {card.checkedOn ? `링크 확인일 ${card.checkedOn}` : "링크 확인 전"}
    </p>
  );
}

export function OfficialLinkCard({ card, site, fallbacks, rank }: { card: Card; site: string; fallbacks: Card[]; rank: number }) {
  const broken = card.status === "broken";
  const national = isNationalTaxLink(card);
  return (
    <li data-link-card={card.key} data-link-rank={rank} data-link-status={card.status} data-tax-kind={national ? "national" : "local"} className="rounded-2xl border border-navy-100 bg-white p-6">
      {national && (
        <p className="mb-2">
          <TaxKindBadge kind="national" />
        </p>
      )}
      <h2 className="text-[19px] font-black text-navy-900">{card.label}</h2>
      <p className="mt-1 text-[13px] text-navy-500">{site}</p>
      {national && (
        <p data-part="national-note" className="mt-2 text-[14px] leading-6 text-navy-700">
          이 사이트는 국세 금액을 계산하지 않습니다 — 별도 사이트로 연결만 합니다.
        </p>
      )}
      {card.termsNote && (
        <p data-part="terms-note" className="mt-2 text-[14px] leading-6 text-navy-700">
          {card.termsNote}
        </p>
      )}
      {broken ? (
        <div data-part="broken-note" className="mt-3 text-[15px] text-navy-800">
          <p>지금은 연결을 확인할 수 없습니다.</p>
          {fallbacks.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-3">
              {fallbacks.map((f) => (
                <li key={f.id}>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                    {f.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3">
          <a href={card.url} target="_blank" rel="noopener noreferrer" data-part="go" className="font-bold text-navy-900 underline underline-offset-4">
            {card.label} 열기 (새 창)
          </a>
        </p>
      )}
      <Checked card={card} />
    </li>
  );
}

export function CalcCards({ view }: { view: CalcView }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
      {/* 카드 이동 링크 누름 → calculator_card_clicked (W3 10단계). 그리는 것 0 */}
      <MeasureCalculatorCards screen="calc" section={null} />
      <h1 className="text-[28px] font-black text-navy-900">세금 계산기</h1>
      <p className="mt-2 text-[15px] text-navy-700">이 사이트는 세액을 계산하지 않습니다. 아래는 별도 사이트로 이동하는 연결이며, 이 사이트에서 입력한 값은 넘기지 않습니다.</p>
      {view.sm.length > 0 && (
        <ul data-part="sm-cards" className="mt-8 grid gap-4 sm:grid-cols-2">
          {view.sm.map((c, i) => (
            <OfficialLinkCard key={c.id} card={c} site={linkSiteLabel(c.kind)} fallbacks={view.fallbacks} rank={i + 1} />
          ))}
        </ul>
      )}
      {view.external.length > 0 && (
        <section aria-labelledby="calc-external" className="mt-10">
          <h2 id="calc-external" className="text-[17px] font-black text-navy-900">
            다른 사이트의 계산기
          </h2>
          <ul data-part="external-cards" className="mt-3 grid gap-4 sm:grid-cols-2">
            {view.external.map((c, i) => (
              <OfficialLinkCard key={c.id} card={c} site={linkSiteLabel(c.kind)} fallbacks={view.fallbacks} rank={view.sm.length + i + 1} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
