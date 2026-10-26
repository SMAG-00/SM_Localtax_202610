import Link from "next/link";
import { DOC_TYPE_NOUN } from "@/lib/law/related";
import { DECISION_KINDS, DECISION_LABELS, DOC_TYPES, PAGE_SIZE, type CaseDetailView, type CaseFilter, type CaseSearchView } from "@/lib/server/public/cases";
import { MeasureCase } from "./MeasureLaw";

// 해석 DB 화면 (CASE-01 · CASE-02 · TX-10) - 검색·원문은 로그인 없이. 필터는 GET 폼이라 JS가 꺼져도 동작한다.
// 글자는 DB의 문서 원문 그대로이고 이 파일에 해석 문장은 없다.

const SHELL = "mx-auto w-full max-w-[1100px] px-4 py-10";

/** 현재 필터에서 일부만 바꾼 주소 */
export function caseListHref(f: CaseFilter, over: Partial<Record<keyof CaseFilter, string | number | null>>): string {
  const merged: Record<string, string | number | null> = { q: f.q || null, type: f.type, tax: f.tax, decision: f.decision, from: f.from, to: f.to, law: f.law, article: f.article, page: f.page > 1 ? f.page : null, ...over };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return `/cases${s ? `?${s}` : ""}`;
}

export function CaseSearch({ view, keywordMapOpen = false }: { view: CaseSearchView; keywordMapOpen?: boolean }) {
  const f = view.filter;
  const pages = Math.max(1, Math.ceil(view.total / PAGE_SIZE));
  const anyFilter = Boolean(f.q || f.type || f.tax || f.decision || f.from || f.to || f.law);
  return (
    <main id="main" className={SHELL}>
      <h1 className="text-[28px] font-black text-navy-900">판례·해석 검색</h1>
      <p className="mt-2 text-[15px] text-navy-700">예규·통칙·유권해석·심판·판례 원문을 찾아봅니다. 로그인 없이 볼 수 있습니다.</p>
      {keywordMapOpen && (
        <p className="mt-3 text-[14px]" data-part="keyword-map-link">
          <Link href="/cases/keywords" className="font-bold underline underline-offset-4">
            키워드 맵으로 보기
          </Link>
        </p>
      )}
      <form method="get" action="/cases" role="search" data-part="filters" className="mt-6 space-y-3 text-[14px]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
            검색어
            <input name="q" defaultValue={f.q} maxLength={100} className="rounded-lg border border-navy-200 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            세목
            <input name="tax" defaultValue={f.tax ?? ""} maxLength={40} className="rounded-lg border border-navy-200 px-2 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            시작일
            <input type="date" name="from" defaultValue={f.from ?? ""} className="rounded-lg border border-navy-200 px-2 py-2 font-mono" />
          </label>
          <label className="flex flex-col gap-1">
            종료일
            <input type="date" name="to" defaultValue={f.to ?? ""} className="rounded-lg border border-navy-200 px-2 py-2 font-mono" />
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            법령 (이름)
            <input name="law" defaultValue={f.law ?? ""} maxLength={100} className="rounded-lg border border-navy-200 px-2 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            조 (예: 11, 11-2)
            <input name="article" defaultValue={f.article ?? ""} maxLength={10} className="rounded-lg border border-navy-200 px-2 py-2 font-mono" />
          </label>
          {f.type && <input type="hidden" name="type" value={f.type} />}
          {f.decision && <input type="hidden" name="decision" value={f.decision} />}
          <button type="submit" className="rounded-lg bg-navy-900 px-4 py-2 font-bold text-white">
            찾기
          </button>
        </div>
      </form>

      <div data-part="decision-chips" role="group" aria-label="결정 유형" className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <Link href={caseListHref(f, { decision: null, page: null })} aria-current={f.decision === null ? "true" : undefined} className={`rounded-full border px-3 py-1 font-bold ${f.decision === null ? "bg-navy-900 text-white" : "border-navy-200"}`}>
          결정 유형 전체
        </Link>
        {DECISION_KINDS.map((d) => (
          <Link key={d} href={caseListHref(f, { decision: d, page: null })} aria-current={f.decision === d ? "true" : undefined} data-decision={d} className={`rounded-full border px-3 py-1 font-bold ${f.decision === d ? "bg-navy-900 text-white" : "border-navy-200"}`}>
            {DECISION_LABELS[d]}
          </Link>
        ))}
      </div>
      <div data-part="type-filter" role="group" aria-label="문서 유형" className="mt-3 flex flex-wrap gap-2 text-[13px]">
        <Link href={caseListHref(f, { type: null, page: null })} aria-current={f.type === null ? "true" : undefined} className={`rounded-full border px-3 py-1 font-bold ${f.type === null ? "bg-navy-900 text-white" : "border-navy-200"}`}>
          전체 {view.typeCounts.reduce((s, c) => s + c.n, 0)}
        </Link>
        {DOC_TYPES.map((t) => {
          const n = view.typeCounts.find((c) => c.type === t)?.n ?? 0;
          return (
            <Link key={t} href={caseListHref(f, { type: t, page: null })} aria-current={f.type === t ? "true" : undefined} data-type={t} data-count={n} className={`rounded-full border px-3 py-1 font-bold ${f.type === t ? "bg-navy-900 text-white" : "border-navy-200"}`}>
              {DOC_TYPE_NOUN[t]} {n}건
            </Link>
          );
        })}
      </div>
      {view.provisionLabel && (
        <p data-part="provision-filter" className="mt-3 text-[14px] text-navy-700">
          조문 필터: {view.provisionLabel} (이 조문을 확인된 연결로 가리키는 문서만)
        </p>
      )}
      {view.provisionMissing && <p className="mt-3 text-[14px] text-navy-700">그 법령·조문을 찾지 못했습니다.</p>}

      <p data-part="count" className="mt-6 text-[14px] text-navy-700">
        {view.total}건
      </p>
      {view.items.length === 0 ? (
        <div data-part="empty" className="mt-4 rounded-2xl border border-navy-100 p-6 text-[15px] text-navy-700">
          <p>조건에 맞는 문서가 없습니다.</p>
          {anyFilter && (
            <p className="mt-2">
              <Link href="/cases" className="font-bold underline underline-offset-4">
                필터를 모두 풀기
              </Link>
              {" · "}
              <Link href="/law" className="font-bold underline underline-offset-4">
                법령 보기
              </Link>
            </p>
          )}
        </div>
      ) : (
        <ul data-part="case-list" className="mt-4 space-y-3">
          {view.items.map((d) => (
            <li key={d.id} data-doc-id={d.id} data-doc-type={d.doc_type} data-decision={d.decision_kind ?? ""} className="rounded-2xl border border-navy-100 bg-white p-4">
              <Link href={`/cases/${d.doc_type}/${d.id}?from=search`} className="text-[16px] font-black text-navy-900 underline underline-offset-4">
                {d.issuer} {d.doc_no}
              </Link>
              <p className="mt-1 text-[13px] text-navy-700">
                {DOC_TYPE_NOUN[d.doc_type]} · 결정일 <time dateTime={d.decided_on} className="font-mono">{d.decided_on}</time> · {d.tax_kinds.join(", ")}
                {d.decision_kind ? ` · ${DECISION_LABELS[d.decision_kind]}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav aria-label="쪽" data-part="pager" className="mt-6 flex items-center gap-3 text-[14px]">
          {f.page > 1 && (
            <Link href={caseListHref(f, { page: f.page - 1 })} className="underline underline-offset-4">
              이전
            </Link>
          )}
          <span className="font-mono">
            {f.page} / {pages}
          </span>
          {f.page < pages && (
            <Link href={caseListHref(f, { page: f.page + 1 })} className="underline underline-offset-4">
              다음
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}

const ORIGINS = ["search", "panel", "article"] as const;
const SUMMARY_RESULT_LABELS: Record<string, string> = { accepted: "받아들임", dismissed: "기각", partial: "일부 받아들임", inadmissible: "각하", other: "그 밖" };

export function CaseDetail({ view, from }: { view: CaseDetailView; from: string | undefined }) {
  const d = view.doc;
  const origin = ORIGINS.find((o) => o === from);
  return (
    <main id="main" className={SHELL}>
      {origin && <MeasureCase docType={d.doc_type} origin={origin} />}
      <p className="text-[14px]">
        <Link href="/cases" className="underline underline-offset-4">
          판례·해석 검색
        </Link>
      </p>
      <h1 className="mt-1 text-[26px] font-black text-navy-900">
        {d.issuer} {d.doc_no}
      </h1>
      <p data-part="legal-doc-meta" className="mt-2 text-[14px] text-navy-700">
        <span className="font-bold">{DOC_TYPE_NOUN[d.doc_type]}</span> · 결정일 <time dateTime={d.decided_on} className="font-mono">{d.decided_on}</time> · {d.tax_kinds.join(", ")}
        {d.decision_kind ? ` · ${DECISION_LABELS[d.decision_kind]}` : ""}
      </p>
      <p data-part="snapshot-dates" className="mt-1 font-mono text-[13px] text-navy-700">
        수집일 {d.collected_on} · 확인일 {d.checked_on} ·{" "}
        <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="font-sans underline underline-offset-4">
          출처 원문 (새 창)
        </a>
      </p>
      {view.summary && (
        <section data-part="case-summary" aria-label="결정례 요지" className="mt-6 rounded-md border border-navy-200 bg-navy-50 p-4">
          <h2 className="flex flex-wrap items-center gap-2 text-[17px] font-black text-navy-900">
            요지
            <span data-part="case-summary-badge" className="rounded bg-navy-900 px-2 py-0.5 text-[12px] font-bold text-white">검수 완료</span>
            <span className="text-[13px] font-normal text-navy-700">결론 {SUMMARY_RESULT_LABELS[view.summary.resultType] ?? "그 밖"} · 검수일 <time dateTime={view.summary.approvedOn} className="font-mono">{view.summary.approvedOn}</time></span>
          </h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] leading-7 text-navy-900">
            {view.summary.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          <p className="mt-2 text-[12px] text-navy-700">AI가 초안을 만들고 편집자가 원문과 대조해 승인한 요지입니다. 사건번호·결정일은 위 원문 정보를 따릅니다.</p>
        </section>
      )}
      <article data-part="doc-body" aria-label="원문" className="mt-6 space-y-3 text-[15px] leading-7 text-navy-900">
        {view.paragraphs.map((segs, i) => (
          <p key={i} className="whitespace-pre-wrap">
            {segs.map((s, j) =>
              s.href ? (
                <Link key={j} href={s.href} data-citation="article" className="font-bold underline underline-offset-4">
                  {s.text}
                </Link>
              ) : (
                <span key={j}>{s.text}</span>
              ),
            )}
          </p>
        ))}
      </article>
      {view.provisions.length > 0 && (
        <section data-part="doc-provisions" aria-label="연결된 조문" className="mt-8">
          <h2 className="text-[17px] font-black text-navy-900">연결된 조문</h2>
          <ul className="mt-2 space-y-1 text-[14px]">
            {view.provisions.map((p) => (
              <li key={p.linkId} data-link-id={p.linkId}>
                <Link href={p.href} className="font-bold underline underline-offset-4">
                  {p.label}
                </Link>{" "}
                <span className="text-[12px] text-navy-700">{p.origin === "auto" ? "자동 추출 · 편집자 확인" : "편집자 연결"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.articles.length > 0 && (
        <section data-part="doc-articles" aria-label="해설 기사" className="mt-8">
          <h2 className="text-[17px] font-black text-navy-900">이 문서를 다룬 기사</h2>
          <ul className="mt-2 space-y-1 text-[14px]">
            {view.articles.map((a) => (
              <li key={a.linkId} data-link-id={a.linkId}>
                <Link href={a.href} className="font-bold underline underline-offset-4">
                  {a.title}
                </Link>{" "}
                <span className="text-[12px] text-navy-700">{a.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
