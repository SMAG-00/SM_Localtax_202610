import Link from "next/link";
import { splitProvision } from "@/lib/law/anchors";
import { articleLabel, articleSegment, lawHref, lawThreeHref } from "@/lib/law/article-ref";
import { upcomingBadge } from "@/lib/law/as-of";
import { compareBlocks } from "@/lib/law/compare";
import type { ArticlePageView, LawIndexView, LawPageView } from "@/lib/server/public/law";
import { MeasureLaw } from "./MeasureLaw";
import { RelatedPanel } from "./RelatedPanel";

// 법령 뷰어 화면 (LAW-01~04 · LAW-06) - 글자는 DB의 조문 그대로이고 이 파일에 법령 문장은 없다.
// 기준일은 GET 폼(?date=) - JS가 꺼져도 동작한다. 항·호·목에 앵커(#p1 ...)를 붙여 같은 시점·위치로 열 수 있다.

const SHELL = "mx-auto w-full max-w-[1100px] px-4 py-10";
const TIER_LABEL = { statute: "법률", decree: "시행령", rule: "시행규칙" } as const;

export function LawIndex({ view }: { view: LawIndexView }) {
  return (
    <main id="main" className={SHELL}>
      <h1 className="text-[28px] font-black text-navy-900">법령</h1>
      <p className="mt-2 text-[15px] text-navy-700">지방세 법령의 조문을 시행일 기준으로 찾아봅니다. 로그인 없이 볼 수 있습니다.</p>
      {view.laws.length === 0 ? (
        <p data-part="empty" className="mt-8 text-[15px] text-navy-500">
          지금 볼 수 있는 법령이 없습니다.
        </p>
      ) : (
        <ul data-part="law-list" className="mt-8 grid gap-3 md:grid-cols-2">
          {view.laws.map((l) => (
            <li key={l.id} data-law-id={l.id} className="rounded-2xl border border-navy-100 bg-white p-4">
              <Link href={lawHref(l.name)} className="text-[17px] font-black text-navy-900 underline underline-offset-4">
                {l.name}
              </Link>
              <p className="mt-1 text-[13px] text-navy-700">
                {TIER_LABEL[l.tier]}
                {l.currentEffectiveOn && <> · 시행 <time dateTime={l.currentEffectiveOn} className="font-mono">{l.currentEffectiveOn}</time></>}
                {l.upcomingOn && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">{upcomingBadge(l.upcomingOn)}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function AsOfForm({ action, date, hidden }: { action: string; date: string; hidden?: Record<string, string> }) {
  return (
    <form method="get" action={action} data-part="as-of" className="mt-4 flex flex-wrap items-end gap-3 text-[14px]">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="flex flex-col gap-1">
        기준일
        <input type="date" name="date" defaultValue={date} className="rounded-lg border border-navy-200 px-2 py-1 font-mono" />
      </label>
      <button type="submit" className="rounded-lg bg-navy-900 px-4 py-1.5 font-bold text-white">
        이 날짜로 보기
      </button>
    </form>
  );
}

function VersionLine({ view }: { view: Pick<LawPageView, "current" | "upcoming" | "asOf"> }) {
  return (
    <div data-part="version-line" className="mt-3 text-[14px] text-navy-700">
      {view.current && (
        <p>
          {view.asOf.date} 기준 · 시행 <time dateTime={view.current.effective_on} className="font-mono">{view.current.effective_on}</time> · 공포 {view.current.promulgation_no} (<time dateTime={view.current.promulgated_on} className="font-mono">{view.current.promulgated_on}</time>)
        </p>
      )}
      {view.upcoming.map((u) => (
        <p key={u.id} data-part="upcoming-badge" className="mt-1">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-900">{upcomingBadge(u.effective_on)}</span> 공포 {u.promulgation_no}
        </p>
      ))}
    </div>
  );
}

function NoText({ view }: { view: Pick<LawPageView, "law" | "earliest" | "asOf"> }) {
  return (
    <div data-part="no-text" className="mt-8 rounded-2xl border border-navy-100 p-6">
      <p className="text-[17px] font-black text-navy-900">이 날짜의 원문이 없어요</p>
      {view.earliest && (
        <p className="mt-2 text-[14px] text-navy-700">
          가장 이른 원문은{" "}
          <Link href={lawHref(view.law.name, { date: view.earliest.effective_on })} className="font-bold underline underline-offset-4">
            {view.earliest.effective_on} 시행본
          </Link>
          입니다.
        </p>
      )}
    </div>
  );
}

export function Blocks({ body }: { body: string }) {
  return (
    <div className="mt-2 space-y-1 text-[15px] leading-7 text-navy-900">
      {splitProvision(body).map((b) => (
        <p key={b.id} id={b.id} data-block={b.id} className={`scroll-mt-24 whitespace-pre-wrap ${b.level === "item" ? "pl-5" : b.level === "subitem" ? "pl-10" : ""}`}>
          {b.text}
        </p>
      ))}
    </div>
  );
}

function History({ view }: { view: Pick<LawPageView, "law" | "versions" | "current"> }) {
  return (
    <section data-part="history" aria-label="연혁" className="mt-10">
      <h2 className="text-[17px] font-black text-navy-900">연혁</h2>
      <ul className="mt-2 space-y-1 text-[14px]">
        {view.versions.map((v) => (
          <li key={v.id} data-version-id={v.id}>
            <Link href={lawHref(view.law.name, { date: v.effective_on })} className={`underline underline-offset-4 ${view.current?.id === v.id ? "font-black" : ""}`}>
              시행 {v.effective_on}
            </Link>{" "}
            · 공포 {v.promulgation_no} ({v.promulgated_on}){v.revision_kind ? ` · ${v.revision_kind}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 법령 전문 (조문 목차 + 조문) */
export function LawBody({ view }: { view: LawPageView }) {
  const date = view.asOf.date;
  return (
    <main id="main" className={SHELL}>
      <MeasureLaw lawId={view.law.id} asOfUsed={view.asOf.explicit} view="single" />
      <h1 className="text-[28px] font-black text-navy-900">{view.law.name}</h1>
      <AsOfForm action={lawHref(view.law.name)} date={date} />
      <VersionLine view={view} />
      {view.threeStatuteName && (
        <p className="mt-3 text-[14px]">
          <Link href={lawThreeHref(view.threeStatuteName, view.asOf.explicit ? date : null)} className="font-bold underline underline-offset-4">
            법률·시행령·시행규칙 3단 보기
          </Link>
        </p>
      )}
      {!view.current ? (
        <NoText view={view} />
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[240px_1fr]">
          <nav data-part="toc" aria-label="조문 목차" className="text-[14px] lg:sticky lg:top-24 lg:max-h-[70vh] lg:self-start lg:overflow-y-auto">
            <ol className="space-y-1">
              {view.articles.map((a) => (
                <li key={a.id}>
                  <a href={`#a${articleSegment(a.article_no, a.branch_no)}`} className="underline underline-offset-4">
                    {articleLabel(a.article_no, a.branch_no)}
                    {a.title ? ` ${a.title}` : ""}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div data-part="articles">
            {view.articles.map((a) => {
              const seg = articleSegment(a.article_no, a.branch_no);
              return (
                <section key={a.id} id={`a${seg}`} data-article={seg} className="scroll-mt-24 border-b border-navy-100 py-4">
                  <h2 className="text-[17px] font-black text-navy-900">
                    <Link href={lawHref(view.law.name, { article: { no: a.article_no, branch: a.branch_no }, date: view.asOf.explicit ? date : null })} className="underline underline-offset-4">
                      {articleLabel(a.article_no, a.branch_no)}
                    </Link>
                    {a.title ? <span className="ml-2 font-bold">({a.title})</span> : null}
                  </h2>
                  <Blocks body={a.body} />
                </section>
              );
            })}
          </div>
        </div>
      )}
      <History view={view} />
    </main>
  );
}

const STATUS_LABEL = { same: "같음", changed: "바뀜", added: "새로 생김", removed: "없어짐" } as const;

/** 조문 하나 (기준일 개정판 + 신구조문 대비 + 관련 자료 패널) */
export function LawArticle({ view }: { view: ArticlePageView }) {
  const date = view.asOf.date;
  const label = articleLabel(view.ref.no, view.ref.branch);
  const rows = view.article && view.previous?.article ? compareBlocks(splitProvision(view.previous.article.body), splitProvision(view.article.body)) : [];
  return (
    <main id="main" className={SHELL}>
      <MeasureLaw lawId={view.law.id} asOfUsed={view.asOf.explicit} view="single" />
      <p className="text-[14px]">
        <Link href={lawHref(view.law.name, { date: view.asOf.explicit ? date : null })} className="underline underline-offset-4">
          {view.law.name}
        </Link>
      </p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">
        {label}
        {view.article?.title ? <span className="ml-2 text-[20px] font-bold">({view.article.title})</span> : null}
      </h1>
      <AsOfForm action={lawHref(view.law.name, { article: view.ref })} date={date} />
      <VersionLine view={view} />
      {!view.current ? (
        <NoText view={view} />
      ) : !view.article ? (
        <p data-part="no-article" className="mt-8 text-[15px] text-navy-700">
          이 시점의 {view.law.name}에는 {label}가 없습니다.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6 lg:flex-row">
          <article data-part="article-body" className="min-w-0 flex-1">
            <Blocks body={view.article.body} />
          </article>
          <div className="lg:w-[360px]">
            <RelatedPanel items={view.related} asOf={date} place="law_view" searchHref={`/cases?law=${encodeURIComponent(view.law.name)}&article=${articleSegment(view.ref.no, view.ref.branch)}`} />
          </div>
        </div>
      )}
      {view.previous && view.article && (
        <section data-part="compare" aria-label="신구조문 대비" className="mt-10">
          <h2 className="text-[17px] font-black text-navy-900">신구조문 대비</h2>
          <p className="mt-1 text-[13px] text-navy-700">
            구: 시행 {view.previous.version.effective_on} · 신: 시행 {view.current?.effective_on}
          </p>
          {view.previous.article === null ? (
            <p className="mt-2 text-[14px] text-navy-700">이전 시행본에는 이 조문이 없습니다.</p>
          ) : (
            <table className="mt-3 w-full table-fixed border-collapse text-[14px]">
              <thead>
                <tr className="bg-navy-50 text-left">
                  <th scope="col" className="w-1/2 border border-navy-100 p-2">
                    구
                  </th>
                  <th scope="col" className="w-1/2 border border-navy-100 p-2">
                    신
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-block={r.id} data-status={r.status}>
                    <td className="whitespace-pre-wrap border border-navy-100 p-2 align-top">{r.old ?? "(없음)"}</td>
                    <td className="whitespace-pre-wrap border border-navy-100 p-2 align-top">
                      {r.now ?? "(없음)"} <span className="ml-1 rounded-full border border-navy-200 px-2 py-0.5 text-[12px]">{STATUS_LABEL[r.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <History view={view} />
    </main>
  );
}
