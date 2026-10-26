import Link from "next/link";
import { FigureToggle, TableToggle } from "./IssueMapClient";
import { KeywordNodes } from "./KeywordMapClient";
import { MeasureView } from "./Measure";
import { keywordHref, taxItemKey } from "@/lib/keyword-map/graph";
import { DOC_TYPE_NOUN } from "@/lib/law/related";
import type { KeywordMapView as View } from "@/lib/server/public/keyword-map";

// 키워드 맵 화면 (CASE-06). 글자는 DB 뷰 값이고 이 파일에 쟁점 태그 이름·세무 내용은 없다.
// 원(SVG)·노드 표·연결선 표는 같은 diagram에서 나오므로 원 수 = 노드 표 행 수, 선 수 = 연결선 표 행 수. 색만으로 고른 노드를 구분하지 않고 "선택됨" 글자를 둔다.
// 640px 미만은 표가 먼저이고 그림은 버튼으로 펼친다 (그림은 한 벌).
const SHELL = "mx-auto w-full max-w-[1100px] px-4 py-10";

export function KeywordMap({ view }: { view: View }) {
  const d = view.diagram;
  const taxItem = taxItemKey(view.tax);
  return (
    <main id="main" className={SHELL} data-part="keyword-map" data-tax={view.tax ?? ""}>
      <MeasureView name="keyword_map_viewed" section="tax" props={{ tax_item: taxItem }} />
      <p className="text-[14px] text-navy-500">
        <Link href="/cases" className="underline-offset-2 hover:underline">판례·해석 검색</Link> · 키워드 맵
      </p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">키워드 맵</h1>
      <p className="mt-2 text-[15px] text-navy-700">편집국이 승인한 쟁점 태그가 같은 결정례에 함께 붙은 관계입니다. 노드를 누르면 그 태그가 붙은 결정례로 목록이 좁혀지고, 여러 노드를 고르면 모두 붙은 결정례만 남습니다. 로그인 없이 볼 수 있습니다.</p>
      <nav aria-label="세목" className="mt-5 flex flex-wrap gap-2 text-[14px]" data-part="tax-tabs">
        {view.taxes.map((t) => (
          <Link key={t} href={keywordHref(t, [])} data-tax-tab={t} aria-current={t === view.tax ? "page" : undefined} className={`rounded-full border px-3 py-1 ${t === view.tax ? "border-navy-900 font-bold" : "border-navy-200"}`}>
            {t}
          </Link>
        ))}
      </nav>
      {view.tags.length > 0 && (
        <p className="mt-3 text-[14px] text-navy-700" data-part="selected">
          고른 노드 {view.tags.length}개 ·{" "}
          <Link href={keywordHref(view.tax, [])} className="font-bold underline underline-offset-4">모두 풀기</Link>
        </p>
      )}
      <div className="mt-6 flex flex-col gap-6 sm:flex-col-reverse">
        <section aria-labelledby="km-tables" data-part="tables" className="space-y-6">
          <TableToggle>
            <div className="space-y-6">
              <h2 id="km-tables" className="text-[20px] font-bold text-navy-900">같은 내용의 표</h2>
              <table className="w-full border-collapse text-left text-[14px]" data-part="node-table">
                <caption className="mb-1 text-left font-bold">태그 {d.nodeRows.length}개</caption>
                <thead>
                  <tr className="border-b border-navy-200">
                    <th scope="col" className="py-1 pr-3">번호</th>
                    <th scope="col" className="py-1 pr-3">태그</th>
                    <th scope="col" className="py-1 pr-3">결정례 수</th>
                    <th scope="col" className="py-1">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {d.nodeRows.map((n) => (
                    <tr key={n.tag_key} data-node-row={n.tag_key} data-count={n.n} className="border-b border-navy-100">
                      <td className="py-1 pr-3 font-mono">{n.no}</td>
                      <td className="py-1 pr-3">{n.label}</td>
                      <td className="py-1 pr-3 font-mono">{n.n}건</td>
                      <td className="py-1">{n.selected ? "선택됨" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full border-collapse text-left text-[14px]" data-part="edge-table">
                <caption className="mb-1 text-left font-bold">연결선 {d.edgeRows.length}건</caption>
                <thead>
                  <tr className="border-b border-navy-200">
                    <th scope="col" className="py-1 pr-3">번호</th>
                    <th scope="col" className="py-1 pr-3">태그</th>
                    <th scope="col" className="py-1 pr-3">태그</th>
                    <th scope="col" className="py-1">함께 붙은 결정례</th>
                  </tr>
                </thead>
                <tbody>
                  {d.edgeRows.map((e) => (
                    <tr key={e.no} data-edge-row={e.no} className="border-b border-navy-100">
                      <td className="py-1 pr-3 font-mono">{e.no}</td>
                      <td className="py-1 pr-3">{e.aLabel}</td>
                      <td className="py-1 pr-3">{e.bLabel}</td>
                      <td className="py-1 font-mono">{e.n}건</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TableToggle>
        </section>
        <figure data-part="figure">
          <FigureToggle>
            <KeywordNodes taxItem={taxItem} selectedCount={view.tags.length}>
              <svg role="group" aria-label={`${view.tax ?? ""} 키워드 맵`} viewBox={`0 0 ${d.width} ${d.height}`} className="h-auto w-full" data-keyword-svg>
                <title>{`${view.tax ?? ""} 키워드 맵`}</title>
                {d.lines.map((l) => (
                  <line key={`${l.a}>${l.b}`} data-edge={`${l.a}>${l.b}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="stroke-navy-200" strokeWidth={Math.min(1 + l.n, 8)} />
                ))}
                {d.circles.map((c) => (
                  <a key={c.tag_key} href={c.href} data-node={c.tag_key} data-count={c.n} aria-current={c.selected ? "true" : undefined} aria-label={`${c.label} ${c.n}건${c.selected ? " 선택됨" : ""}`}>
                    <circle cx={c.cx} cy={c.cy} r={c.r} className={c.selected ? "fill-navy-900 stroke-hermes-500" : "fill-white stroke-navy-500"} strokeWidth={c.selected ? 3 : 1.5} />
                    <text x={c.cx} y={c.cy + 4} textAnchor="middle" fontSize={12} fontWeight={700} className={c.selected ? "fill-white" : "fill-navy-900"}>
                      {c.n}
                    </text>
                    <text x={c.cx} y={c.cy + c.r + 14} textAnchor="middle" fontSize={12} className="fill-navy-900">
                      {c.label.length > 12 ? `${c.label.slice(0, 11)}…` : c.label}
                    </text>
                  </a>
                ))}
              </svg>
            </KeywordNodes>
          </FigureToggle>
          <figcaption className="mt-1 text-[13px] text-navy-500">원 크기와 안의 숫자는 결정례 수입니다. 방향키로 노드를 오가고 Enter로 고릅니다.</figcaption>
        </figure>
      </div>
      <p data-part="count" className="mt-8 text-[14px] text-navy-700">결정례 {view.total}건</p>
      {view.items.length === 0 ? (
        <p data-part="empty" className="mt-3 rounded-2xl border border-navy-100 p-6 text-[15px] text-navy-700">조건에 맞는 결정례가 없습니다.</p>
      ) : (
        <ul data-part="case-list" className="mt-3 space-y-2">
          {view.items.map((c) => (
            <li key={c.case_id} data-case={c.case_id} className="rounded-lg border border-navy-100 p-3 text-[14px]">
              <Link href={`/cases/${c.doc_type}/${c.case_id}?from=search`} className="font-bold text-navy-900 underline-offset-2 hover:underline">
                {c.issuer} {c.doc_no}
              </Link>
              <span className="ml-2 text-navy-500">{DOC_TYPE_NOUN[c.doc_type as keyof typeof DOC_TYPE_NOUN] ?? c.doc_type}</span>
              <span className="ml-2 font-mono text-navy-500">{c.decided_on}</span>
              <span className="ml-2">
                {c.tags.map((t) => (
                  <span key={t.tag_key} className="mr-1 rounded-full border border-navy-200 px-2 py-0.5 text-[13px]">{t.label}</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.pages > 1 && (
        <nav aria-label="쪽" className="mt-6 flex gap-3 text-[14px]" data-part="pager">
          {view.page > 1 && <Link href={keywordHref(view.tax, view.tags, view.page - 1)} className="underline underline-offset-4">이전</Link>}
          <span className="font-mono">{view.page} / {view.pages}</span>
          {view.page < view.pages && <Link href={keywordHref(view.tax, view.tags, view.page + 1)} className="underline underline-offset-4">다음</Link>}
        </nav>
      )}
    </main>
  );
}
