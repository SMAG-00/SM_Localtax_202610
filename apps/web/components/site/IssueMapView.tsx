import Link from "next/link";
import { AgentEntry } from "./AgentEntry";
import { FigureToggle, MeasureIssueSources, TableToggle } from "./IssueMapClient";
import { MeasureView } from "./Measure";
import { DOC_TYPE_NOUN } from "@/lib/law/related";
import type { IssueCaseListView, IssueIndexView, IssuePageView } from "@/lib/server/public/issues";
import { ISSUE_HUB_LABEL, ISSUE_HUBS, type IssueEntry } from "@/lib/server/public/issues";

// 쟁점 연결 지도 화면 (LINK-01 · TRU-05 · RDV-08). 글자는 DB 원문 뷰 값이고 이 파일에 법령 문장·쟁점 이름은 없다.
// 그림(SVG)과 표는 같은 Diagram 객체에서 나오므로 상자 수 = 노드 표 행 수, 연결선 수 = 연결선 표 행 수. 색만으로 구분하지 않고 관계 라벨 글자를 선 위에 둔다.
// 640px 미만은 표를 먼저 보이고 그림은 뒤에 둔다 (flex 순서만 바꿈 - 그림 중복 0).
const SHELL = "mx-auto w-full max-w-[1100px] px-4 py-10";
export const ISSUE_MAP_NOTICE = "이 지도는 조문 사이의 관계를 보여 주는 참고 자료입니다. 개별 사안은 원문과 전문가 확인이 필요합니다.";

export function IssueIndex({ view }: { view: IssueIndexView }) {
  return (
    <main id="main" className={SHELL}>
      <h1 className="text-[28px] font-black text-navy-900">쟁점 연결 지도</h1>
      <p className="mt-2 text-[15px] text-navy-700">한 쟁점에 걸린 조문을 관계와 함께 보고, 연결된 결정례·해석의 원문으로 이동합니다.</p>
      <nav aria-label="허브 필터" className="mt-5 flex flex-wrap gap-2 text-[14px]" data-part="hub-filter">
        <Link href="/realestate/issues" aria-current={view.hub === null ? "page" : undefined} className={`rounded-full border px-3 py-1 ${view.hub === null ? "border-navy-900 font-bold" : "border-navy-200"}`}>
          전체
        </Link>
        {ISSUE_HUBS.filter((h) => h !== "inheritance_gift").map((h) => (
          <Link key={h} href={`/realestate/issues?hub=${h}`} aria-current={view.hub === h ? "page" : undefined} className={`rounded-full border px-3 py-1 ${view.hub === h ? "border-navy-900 font-bold" : "border-navy-200"}`}>
            {ISSUE_HUB_LABEL[h]}
          </Link>
        ))}
        {view.hub && (
          <Link href={`/realestate/issues/cases/${view.hub}`} data-part="cases-link" className="rounded-full border border-navy-200 px-3 py-1">
            {ISSUE_HUB_LABEL[view.hub]} 판례·해석 모음
          </Link>
        )}
      </nav>
      {view.items.length > 0 && (
        <ul className="mt-6 space-y-3" data-part="issue-list">
          {view.items.map((i) => (
            <li key={i.slug} data-slug={i.slug} className="rounded-xl border border-navy-100 p-4">
              <Link href={`/realestate/issues/${i.slug}?from=hub`} className="text-[18px] font-bold text-navy-900 underline-offset-2 hover:underline">
                {i.title}
              </Link>
              <span className="ml-2 rounded-full border border-navy-200 px-2 py-0.5 text-[13px]">{ISSUE_HUB_LABEL[i.hub] ?? i.hub}</span>
              {i.stale && <span className="ml-2 rounded-full border border-hermes-500 px-2 py-0.5 text-[13px] font-bold">개정 반영 검토 중</span>}
              {i.summary && <p className="mt-1 text-[14px] text-navy-700">{i.summary}</p>}
              <p className="mt-1 font-mono text-[13px] text-navy-500">
                기준일 {i.as_of ?? "-"} · 지도 버전 {i.version} · 감수일 {i.last_reviewed_at.slice(0, 10)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function IssueMapPage({ view, entry }: { view: IssuePageView; entry: IssueEntry }) {
  const d = view.diagram;
  const link = (id: string) => view.links.find((l) => l.id === id);
  const href = (id: string) => link(id)?.href ?? null;
  const src = (id: string) => {
    const l = link(id);
    return l?.lawId && l.relation ? { "data-source-law": l.lawId, "data-source-relation": l.relation } : {};
  };
  return (
    <main id="main" className={SHELL} data-part="issue-map" data-slug={view.slug}>
      <MeasureView name="issue_map_viewed" section="realestate" props={{ issue: view.slug, entry }} />
      <MeasureIssueSources issue={view.slug} />
      <p className="text-[14px] text-navy-500">
        <Link href="/realestate/issues" className="underline-offset-2 hover:underline">목록</Link> · {ISSUE_HUB_LABEL[view.hub] ?? view.hub}
      </p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">{view.title}</h1>
      <AgentEntry entry="issue_map" entryId={view.slug} label="이 쟁점에 대해 지방세봇에게 묻기" />
      {view.stale && (
        <p role="status" data-part="stale-badge" className="mt-3 inline-block rounded-lg border-2 border-hermes-500 px-3 py-1 text-[14px] font-bold text-navy-900">
          개정 반영 검토 중
        </p>
      )}
      {view.summary && <p className="mt-2 text-[15px] text-navy-700">{view.summary}</p>}
      <p className="mt-2 font-mono text-[13px] text-navy-500" data-part="map-meta">
        기준일 {view.as_of ?? "-"} · 지도 버전 {view.version} · 감수일 {view.last_reviewed_at.slice(0, 10)}
      </p>
      <p className="mt-2 text-[14px] text-navy-700" data-part="notice">{ISSUE_MAP_NOTICE}</p>
      <div className="mt-6 flex flex-col gap-6 sm:flex-col-reverse">
        <section aria-labelledby="map-tables" data-part="tables" className="space-y-6">
          <TableToggle>
          <div className="space-y-6">
          <h2 id="map-tables" className="text-[20px] font-bold text-navy-900">같은 내용의 표</h2>
          <table className="w-full border-collapse text-left text-[14px]" data-part="node-table">
            <caption className="mb-1 text-left font-bold">조문·결정례 {d.nodeRows.length}건</caption>
            <thead>
              <tr className="border-b border-navy-200">
                <th scope="col" className="py-1 pr-3">번호</th>
                <th scope="col" className="py-1 pr-3">구분</th>
                <th scope="col" className="py-1 pr-3">대상</th>
                <th scope="col" className="py-1">시행일·결정일</th>
              </tr>
            </thead>
            <tbody>
              {d.nodeRows.map((n) => (
                <tr key={n.id} data-node-row={n.id} className="border-b border-navy-100">
                  <td className="py-1 pr-3 font-mono">{n.id}</td>
                  <td className="py-1 pr-3">{n.kind === "law_article" ? "조문" : "결정례·해석"}</td>
                  <td className="py-1 pr-3">
                    {href(n.id) ? (
                      <Link href={href(n.id) as string} className="underline underline-offset-2" data-part="source-link" {...src(n.id)}>
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </td>
                  <td className="py-1 font-mono">{n.sub}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full border-collapse text-left text-[14px]" data-part="edge-table">
            <caption className="mb-1 text-left font-bold">연결선 {d.edgeRows.length}건</caption>
            <thead>
              <tr className="border-b border-navy-200">
                <th scope="col" className="py-1 pr-3">번호</th>
                <th scope="col" className="py-1 pr-3">관계</th>
                <th scope="col" className="py-1 pr-3">에서</th>
                <th scope="col" className="py-1 pr-3">으로</th>
                <th scope="col" className="py-1">설명</th>
              </tr>
            </thead>
            <tbody>
              {d.edgeRows.map((e) => (
                <tr key={e.no} data-edge-row={e.no} className="border-b border-navy-100">
                  <td className="py-1 pr-3 font-mono">{e.no}</td>
                  <td className="py-1 pr-3 font-bold">{e.label}</td>
                  <td className="py-1 pr-3">{e.fromTitle}</td>
                  <td className="py-1 pr-3">{e.toTitle}</td>
                  <td className="py-1">{e.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </TableToggle>
        </section>
        <figure data-part="figure">
          <FigureToggle>
          <svg role="img" aria-label={`${view.title} 쟁점 연결 지도`} viewBox={`0 0 ${d.width} ${d.height}`} className="h-auto w-full" data-issue-svg>
            <title>{view.title}</title>
            {d.lines.map((l, i) => (
              <g key={i} data-edge={`${l.from}>${l.to}`}>
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="stroke-navy-200" strokeWidth={2} />
                <rect x={l.mx - 22} y={l.my - 11} width={44} height={22} rx={11} className="fill-white stroke-navy-200" />
                <text x={l.mx} y={l.my + 5} textAnchor="middle" fontSize={13} fontWeight={700} className="fill-navy-900">
                  {l.label}
                </text>
              </g>
            ))}
            <g data-role="issue">
              <rect x={d.center.x} y={d.center.y} width={d.center.w} height={d.center.h} rx={12} className="fill-white stroke-hermes-500" strokeWidth={2} />
              <text x={d.center.x + d.center.w / 2} y={d.center.y + d.center.h / 2 + 5} textAnchor="middle" fontSize={16} fontWeight={700} className="fill-navy-900">
                {d.center.title.length > 18 ? `${d.center.title.slice(0, 17)}…` : d.center.title}
              </text>
            </g>
            {d.boxes.map((b) => {
              const to = href(b.id);
              const body = (
                <g data-node={b.id} data-kind={b.kind}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={`fill-white ${b.kind === "case" ? "stroke-navy-500" : "stroke-navy-200"}`} strokeWidth={1.5} />
                  <text x={b.x + 10} y={b.y + 26} fontSize={13} fontWeight={700} className="fill-navy-900">
                    {b.title.length > 20 ? `${b.title.slice(0, 19)}…` : b.title}
                  </text>
                  <text x={b.x + 10} y={b.y + 48} fontSize={12} className="fill-navy-700">
                    {b.sub}
                  </text>
                </g>
              );
              return to ? (
                <a key={b.id} href={to} aria-label={b.title} {...src(b.id)}>
                  {body}
                </a>
              ) : (
                <g key={b.id}>{body}</g>
              );
            })}
          </svg>
          </FigureToggle>
          <figcaption className="mt-1 text-[13px] text-navy-500">실선은 관계 라벨(위임·준용·요건·판례)로 구분합니다. 색이 아니라 글자로 읽을 수 있습니다.</figcaption>
        </figure>
      </div>
      {view.guides.length > 0 && (
        <section className="mt-8" data-part="guides">
          <h2 className="text-[20px] font-bold text-navy-900">관련 가이드</h2>
          <ul className="mt-2 list-disc pl-5 text-[14px]">
            {view.guides.map((g) => (
              <li key={`${g.slug}#${g.anchor ?? ""}`}>
                {g.title ?? g.slug}
                {g.anchor ? <span className="ml-1 font-mono text-navy-500">#{g.anchor}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

export function IssueCaseList({ view }: { view: IssueCaseListView }) {
  const label = ISSUE_HUB_LABEL[view.hub];
  return (
    <main id="main" className={SHELL} data-part="issue-cases" data-hub={view.hub}>
      <p className="text-[14px] text-navy-500">
        <Link href={`/realestate/issues?hub=${view.hub}`} className="underline-offset-2 hover:underline">쟁점 연결 지도</Link> · {label}
      </p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">{label} 판례·해석 모음</h1>
      <p className="mt-2 text-[15px] text-navy-700">편집국이 쟁점 태그를 붙이고 승인한 결정례·해석만 모았습니다.</p>
      <nav aria-label="쟁점 태그" className="mt-4 flex flex-wrap gap-2 text-[14px]" data-part="tag-filter">
        <Link href={`/realestate/issues/cases/${view.hub}`} aria-current={view.tagKey === null ? "page" : undefined} className={`rounded-full border px-3 py-1 ${view.tagKey === null ? "border-navy-900 font-bold" : "border-navy-200"}`}>
          전체
        </Link>
        {view.tags.map((t) => (
          <Link key={t.tag_key} href={`/realestate/issues/cases/${view.hub}?tag=${t.tag_key}`} aria-current={view.tagKey === t.tag_key ? "page" : undefined} data-tag={t.tag_key} className={`rounded-full border px-3 py-1 ${view.tagKey === t.tag_key ? "border-navy-900 font-bold" : "border-navy-200"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      {view.items.length > 0 && (
        <ul className="mt-6 space-y-2" data-part="case-list">
          {view.items.map((c) => (
            <li key={c.id} data-case={c.id} className="rounded-lg border border-navy-100 p-3 text-[14px]">
              <Link href={`/cases/${c.doc_type}/${c.id}`} className="font-bold text-navy-900 underline-offset-2 hover:underline">
                {c.issuer} {c.doc_no}
              </Link>
              <span className="ml-2 text-navy-500">{DOC_TYPE_NOUN[c.doc_type as keyof typeof DOC_TYPE_NOUN] ?? c.doc_type}</span>
              <span className="ml-2 font-mono text-navy-500">{c.decided_on}</span>
              <span className="ml-2">
                {c.tags.map((t) => (
                  <span key={t.tag_key} className="mr-1 rounded-full border border-navy-200 px-2 py-0.5 text-[13px]">
                    {t.label}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
