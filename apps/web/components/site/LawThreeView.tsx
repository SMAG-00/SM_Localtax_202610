import Link from "next/link";
import { PrintButton } from "./PrintButton";
import { articleLabel, articleSegment, lawHref, lawThreeHref } from "@/lib/law/article-ref";
import type { ProvRef } from "@/lib/law/three";
import type { LawArticleRow, ThreeColumn, ThreePageView } from "@/lib/server/public/law";
import { Blocks } from "./LawView";
import { MeasureLaw } from "./MeasureLaw";
import { RelatedPanel } from "./RelatedPanel";
import { ThreeTabs } from "./ThreeTabs";

// 3단 보기 (LAW-05 · TX-11) - 법률·시행령·시행규칙 3열, 위임 조문 가로 정렬, 열 머리 고정, 기준일(?date=) 공통, 모바일은 탭 3개.
// 3열은 같은 기준일로 각각 그 시점 개정판을 고른다. 하위 규정이 없는 조문은 '위임 조문 없음'. 오른쪽 열은 고른 조문의 관련 해석(LAW-06 해석 탭).

const keyOf = (r: ProvRef) => `${r.lawId}:${r.no}:${r.branch}`;

function Head({ col, label, idx }: { col: ThreeColumn | null; label: string; idx: number }) {
  return (
    <div data-col={idx} className="border border-navy-100 bg-navy-50 p-2 text-[14px]">
      <p className="font-black text-navy-900">
        {label}
        {col ? ` · ${col.law.name}` : ""}
      </p>
      <p className="font-mono text-[12px] text-navy-700">{col ? (col.version ? `시행 ${col.version.effective_on}` : "이 날짜의 원문이 없어요") : "해당 법령 없음"}</p>
    </div>
  );
}

function Cell({ refs, col, idx }: { refs: ProvRef[]; col: ThreeColumn | null; idx: number }) {
  const rows = refs.flatMap((r) => {
    const a = col?.articles.find((x) => x.article_no === r.no && x.branch_no === r.branch);
    return a ? [a] : [];
  });
  return (
    <div data-col={idx} data-cell="child" className="border border-navy-100 p-2">
      {rows.length === 0 ? (
        <p className="text-[13px] text-navy-500">위임 조문 없음</p>
      ) : (
        rows.map((a: LawArticleRow) => (
          <div key={a.id} className="mb-3 last:mb-0">
            <p className="text-[13px] font-bold">
              <Link href={col ? lawHref(col.law.name, { article: { no: a.article_no, branch: a.branch_no }, date: null }) : "#"} className="underline underline-offset-4">
                {articleLabel(a.article_no, a.branch_no)}
              </Link>
              {a.title ? ` (${a.title})` : ""}
            </p>
            <Blocks body={a.body} />
          </div>
        ))
      )}
    </div>
  );
}

export function LawThree({ view }: { view: ThreePageView }) {
  const date = view.asOf.date;
  const dateArg = view.asOf.explicit ? date : null;
  const sel = view.selected;
  return (
    <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-10">
      <MeasureLaw lawId={view.statute.law.id} asOfUsed={view.asOf.explicit} view="three" />
      <h1 className="text-[28px] font-black text-navy-900">{view.statute.law.name} 3단 보기</h1>
      <style>{`@page { size: A4 landscape; margin: 12mm; } @media print { [data-part="interpretation-column"], [data-part="as-of"], header, nav, footer { display: none !important; } [data-part="print-head"] { display: block !important; position: fixed; top: 0; left: 0; right: 0; } [data-part="three-grid"] { margin-top: 10mm; } [data-part="three-grid"] section { break-inside: avoid; display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); } [data-part="three-head"] { position: static !important; display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); } main { max-width: none !important; padding: 0 !important; } }`}</style>
      <p data-part="print-head" className="hidden text-[11px]">{view.statute.law.name} · 기준일 {view.asOf.date}</p>
      <div className="mt-2 print:hidden"><PrintButton /></div>
      <form method="get" action={lawThreeHref(view.statute.law.name)} data-part="as-of" className="mt-4 flex flex-wrap items-end gap-3 text-[14px]">
        {sel && <input type="hidden" name="article" value={articleSegment(sel.no, sel.branch)} />}
        <label className="flex flex-col gap-1">
          기준일 (세 법령 공통)
          <input type="date" name="date" defaultValue={date} className="rounded-lg border border-navy-200 px-2 py-1 font-mono" />
        </label>
        <button type="submit" className="rounded-lg bg-navy-900 px-4 py-1.5 font-bold text-white">
          이 날짜로 보기
        </button>
      </form>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <ThreeTabs labels={["법률", "시행령", "시행규칙"]}>
            <div data-part="three-grid">
              <div data-part="three-head" className="sticky top-0 z-10 grid bg-white md:grid-cols-3">
                <Head col={view.statute} label="법률" idx={0} />
                <Head col={view.decree} label="시행령" idx={1} />
                <Head col={view.rule} label="시행규칙" idx={2} />
              </div>
              {view.rows.map((row) => {
                const a = view.statute.articles.find((x) => x.article_no === row.statute.no && x.branch_no === row.statute.branch);
                if (!a) return null;
                const seg = articleSegment(a.article_no, a.branch_no);
                const picked = sel && sel.no === a.article_no && sel.branch === a.branch_no;
                return (
                  <section key={keyOf(row.statute)} id={`r${seg}`} data-row={seg} data-selected={picked ? "true" : "false"} className={`grid scroll-mt-24 md:grid-cols-3 ${picked ? "bg-navy-50/50" : ""}`}>
                    <div data-col={0} data-cell="statute" className="border border-navy-100 p-2">
                      <p className="text-[13px] font-bold">
                        {articleLabel(a.article_no, a.branch_no)}
                        {a.title ? ` (${a.title})` : ""}{" "}
                        <Link href={`${lawThreeHref(view.statute.law.name, dateArg, { no: a.article_no, branch: a.branch_no })}#r${seg}`} className="ml-1 text-[12px] underline underline-offset-4">
                          관련 해석 보기
                        </Link>
                      </p>
                      <Blocks body={a.body} />
                    </div>
                    <Cell refs={row.decree} col={view.decree} idx={1} />
                    <Cell refs={row.rule} col={view.rule} idx={2} />
                  </section>
                );
              })}
              {view.statute.articles.length === 0 && (
                <p data-part="no-text" className="mt-6 text-[15px] text-navy-700">
                  이 날짜의 원문이 없어요
                </p>
              )}
            </div>
          </ThreeTabs>
        </div>
        <div data-part="interpretation-column">
          <p className="mb-2 text-[14px] font-black text-navy-900">{sel ? `${articleLabel(sel.no, sel.branch)} 관련 해석` : "관련 해석"}</p>
          <RelatedPanel
            items={view.related}
            asOf={date}
            place="three_view"
            mode="column"
            emptyText="이 조문에 연결된 해석이 없어요"
            searchLabel="해석 DB 검색"
            searchHref={sel ? `/cases?law=${encodeURIComponent(view.statute.law.name)}&article=${articleSegment(sel.no, sel.branch)}` : "/cases"}
          />
        </div>
      </div>
    </main>
  );
}
