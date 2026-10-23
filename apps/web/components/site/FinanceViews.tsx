import { UiLink } from "@ltr/ui";
import { FINANCE_COPY, REGULATION_STATUS, STRUCTURE_TYPE_NAMES, layoutDiagram, relationRows, type DiagramData } from "@/lib/server/public/finance-logic";
import type { CaseView, StructureCard, StructureView, TrackerView } from "@/lib/server/public/finance";
import { SiteSection } from "./SiteSection";

// 개발금융 공개 화면 조각 (W5 — DF-01 · DF-03 · DF-04). 모두 기능 키 finance 뒤 — 데이터가 없으면 호출하는 쪽이 그리지 않는다.
// 구조도는 인라인 SVG(글자는 SVG 안 text, 그림 파일 0)이고 같은 내용의 표가 함께 나온다. 수익률 순위·가입 링크·추천 요소 0.

const LINK =
  "inline-flex min-h-11 items-center font-bold text-navy-900 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
const TH = "border-b border-navy-200 px-3 py-2 text-left text-[13px] font-bold text-navy-700";
const TD = "border-b border-navy-100 px-3 py-2 align-top text-[15px] text-navy-800 [overflow-wrap:anywhere]";

/** 구조도 SVG + 같은 내용의 표 */
export function StructureDiagram({ diagram }: { diagram: DiagramData }) {
  const layout = layoutDiagram(diagram);
  const rows = relationRows(diagram);
  return (
    <div data-part="structure-diagram">
      <figure className="overflow-x-auto rounded-2xl border border-navy-100 bg-white p-4">
        <svg role="img" aria-label={diagram.alt} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} className="max-w-none">
          <defs>
            <marker id="fin-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" className="fill-navy-700" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => (
            <g key={`e${i}`}>
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="stroke-navy-700" strokeWidth="1.5" markerEnd="url(#fin-arrow)" />
              {e.label !== "" && (
                <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 4} textAnchor="middle" fontSize="12" className="fill-navy-700">
                  {e.label}
                </text>
              )}
            </g>
          ))}
          {layout.nodes.map((n) => (
            <g key={n.key}>
              <rect x={n.x} y={n.y} width={150} height={44} rx={8} className="fill-white stroke-navy-900" strokeWidth="1.5" />
              <text x={n.x + 75} y={n.y + 27} textAnchor="middle" fontSize="14" fontWeight="700" className="fill-navy-900">
                {n.label}
              </text>
            </g>
          ))}
        </svg>
      </figure>
      <table data-part="relation-table" className="mt-4 w-full border-collapse">
        <caption className="mb-2 text-left text-[13px] font-bold text-navy-600">{FINANCE_COPY.relationCaption}</caption>
        <thead>
          <tr>
            {FINANCE_COPY.relationHead.map((h) => (
              <th key={h} scope="col" className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className={`${TD} font-bold`}>
                {r.from}
              </th>
              <td className={TD}>{r.label}</td>
              <td className={TD}>{r.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /finance/trust-pf 위쪽의 구조 해설 목록 */
export function StructureCards({ cards }: { cards: StructureCard[] }) {
  if (cards.length === 0) return null;
  return (
    <SiteSection id="finance-structures" tone="ivory" data={{ "data-finance-part": "structures" }}>
      <h2 className="text-[24px] font-black text-navy-900">{FINANCE_COPY.structuresTitle}</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-navy-700">{FINANCE_COPY.structuresLead}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.slug} data-structure-slug={c.slug} className="rounded-2xl border border-navy-100 bg-white p-4">
            <p className="text-[13px] font-bold text-navy-600">{STRUCTURE_TYPE_NAMES[c.type] ?? c.type}</p>
            <UiLink href={`/finance/trust-pf/${c.slug}`} className={LINK}>
              {c.title}
            </UiLink>
            {c.summary && <p className="mt-1 text-[15px] text-navy-700">{c.summary}</p>}
          </li>
        ))}
      </ul>
    </SiteSection>
  );
}

export function StructureDetail({ view }: { view: StructureView }) {
  return (
    <div data-ui="finance-structure" data-structure-slug={view.slug}>
      <SiteSection id="finance-structure-head" tone="ivory" first data={{ "data-finance-part": "structure-head" }}>
        <nav aria-label="현재 위치" className="text-[15px]">
          <UiLink href="/finance" className={LINK}>
            부동산개발금융
          </UiLink>{" "}
          ›{" "}
          <UiLink href="/finance/trust-pf" className={LINK}>
            신탁·PF 구조
          </UiLink>
        </nav>
        <p className="mt-4 text-[13px] font-bold text-navy-600">{STRUCTURE_TYPE_NAMES[view.type] ?? view.type}</p>
        <h1 className="mt-2 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">{view.title}</h1>
        {view.summary && <p className="mt-3 max-w-2xl text-[17px] text-navy-700">{view.summary}</p>}
        <p data-part="review-line" className="mt-3 text-[14px] text-navy-600">
          세무 감수 {view.taxSignedOn} · 법률 확인 {view.legalCheckedOn}
        </p>
      </SiteSection>
      <SiteSection id="finance-structure-body" tone="ivory-dark" data={{ "data-finance-part": "structure-body" }}>
        <StructureDiagram diagram={view.diagram} />
        {view.notes.map((n, i) => (
          <p key={i} data-part="structure-note" className="mt-4 max-w-2xl text-[16px] text-navy-800">
            {n}
          </p>
        ))}
        {view.lens && (
          <aside data-part="tax-lens" aria-label={FINANCE_COPY.lensTitle} className="mt-6 rounded-2xl border border-navy-100 bg-white p-5">
            <h2 className="text-[18px] font-black text-navy-900">{FINANCE_COPY.lensTitle}</h2>
            <p className="mt-1 text-[13px] text-navy-600">{view.lens.topics.join(" · ")}</p>
            <ul className="mt-2 list-disc pl-5 text-[15px] text-navy-800">
              {view.lens.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <ul className="mt-2 flex flex-wrap gap-4">
              {view.lens.links.map((l) => (
                <li key={l.kind}>
                  <UiLink href={l.url} className={LINK}>
                    {l.label}
                  </UiLink>
                </li>
              ))}
            </ul>
          </aside>
        )}
        {!view.lens && view.lensOmitReason && (
          <p data-part="lens-omitted" className="mt-6 text-[14px] text-navy-600">
            「지방세로 읽기」 생략 사유: {view.lensOmitReason}
          </p>
        )}
        <p data-part="finance-notice" className="mt-6 text-[14px] text-navy-600">
          {FINANCE_COPY.notice}
        </p>
      </SiteSection>
    </div>
  );
}

/** /finance 허브의 규제·통계 트래커 — 규제는 단계·시행 예정일·원문, 통계는 값·기준일·수집일·원자료. 모두 표 + 출처 줄 */
export function TrackerBlock({ tracker }: { tracker: TrackerView }) {
  return (
    <SiteSection id="finance-tracker" tone="ivory-dark" data={{ "data-finance-part": "tracker" }}>
      <h2 className="text-[24px] font-black text-navy-900">{FINANCE_COPY.trackerTitle}</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-navy-700">{FINANCE_COPY.trackerLead}</p>
      {tracker.regulations.length > 0 && (
        <div className="mt-6 overflow-x-auto" data-part="regulations">
          <table className="w-full border-collapse">
            <caption className="mb-2 text-left text-[16px] font-bold text-navy-900">{FINANCE_COPY.regulationsTitle}</caption>
            <thead>
              <tr>
                {["항목", "단계", "시행 예정일", "상태", "원문"].map((h) => (
                  <th key={h} scope="col" className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracker.regulations.map((g) => (
                <tr key={g.key} data-reg-key={g.key} data-in-force={String(g.latest.in_force)}>
                  <th scope="row" className={`${TD} font-bold`}>
                    {g.latest.title}
                  </th>
                  <td className={TD}>{g.latest.stage}</td>
                  <td className={`${TD} font-mono`}>{g.latest.effective_on}</td>
                  <td className={TD}>{g.latest.in_force ? REGULATION_STATUS.inForce : REGULATION_STATUS.planned}</td>
                  <td className={TD}>
                    <a className={LINK} href={g.latest.source_url} target="_blank" rel="noopener noreferrer">
                      {g.latest.provider}
                      <span className="sr-only"> 원문 (새 창)</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tracker.indicators.length > 0 && (
        <div className="mt-6 overflow-x-auto" data-part="indicators">
          <table className="w-full border-collapse">
            <caption className="mb-2 text-left text-[16px] font-bold text-navy-900">{FINANCE_COPY.indicatorsTitle}</caption>
            <thead>
              <tr>
                {["지표", "값", "기준일", "수집일", "정의", "원자료"].map((h) => (
                  <th key={h} scope="col" className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tracker.indicators.flatMap((g) =>
                [g.latest, ...g.history].map((r, i) => (
                  <tr key={String(r.id)} data-indicator-key={g.key} data-latest={String(i === 0)}>
                    <th scope="row" className={`${TD} font-bold`}>
                      {i === 0 ? g.label : <span className="text-[13px] font-normal text-navy-600">{FINANCE_COPY.historyTitle}</span>}
                    </th>
                    <td className={`${TD} font-mono`}>
                      {String(r.value)} {r.unit}
                    </td>
                    <td className={`${TD} font-mono`}>{r.as_of}</td>
                    <td className={`${TD} font-mono`}>{r.collected_on}</td>
                    <td className={TD}>{i === 0 ? r.definition : ""}</td>
                    <td className={TD}>
                      <a className={LINK} href={r.source_url} target="_blank" rel="noopener noreferrer">
                        {r.provider}
                        <span className="sr-only"> 원자료 (새 창)</span>
                      </a>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </SiteSection>
  );
}

const REBUTTAL_LINE: Record<string, string> = { answered: "답변을 받아 반영했습니다", no_response: "요청했으나 답변이 없었습니다", declined: "답변을 거절했습니다" };

/** 사례 기사 머리 아래 구조 블록 — 구조 유형·쟁점·결과. 미공개 조건 칸은 데이터에 없다 */
export function CaseBlock({ view }: { view: CaseView | null }) {
  if (!view) return null;
  return (
    <aside data-part="finance-case" aria-label={FINANCE_COPY.caseTitle} className="mx-auto mt-6 w-full max-w-[860px] rounded-2xl border border-navy-100 bg-white px-6 py-4">
      <h2 className="text-[18px] font-black text-navy-900">{FINANCE_COPY.caseTitle}</h2>
      <p className="mt-1 text-[14px] text-navy-600">
        {STRUCTURE_TYPE_NAMES[view.type] ?? view.type} · {FINANCE_COPY.caseLead}
      </p>
      {view.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-[15px] text-navy-800">
          {view.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {view.outcome && <p className="mt-2 text-[15px] text-navy-800">{view.outcome}</p>}
      {view.named && view.rebuttalStatus && (
        <p data-part="rebuttal-line" className="mt-2 text-[14px] text-navy-600">
          반론 요청 결과: {REBUTTAL_LINE[view.rebuttalStatus] ?? ""}
        </p>
      )}
    </aside>
  );
}
