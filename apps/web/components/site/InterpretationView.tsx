import { UiLink } from "@ltr/ui";
import { LEGAL_DOC_TYPES, LEGAL_DOC_TYPE_LABELS } from "@/lib/admin/legal-doc-rules";
import type { InterpretationListView, LegalDocRow } from "@/lib/server/public";

// 해석 해설 화면 (TX-09 — docs/dev/W3_설계.md 5장). 필터는 URL 쿼리(GET 폼) — JS가 꺼져도 동작한다.
// 원문 블록(발행 기관이 낸 글)과 해설 블록(우리가 쓴 글)은 따로 그린다. 원문 글자는 원문 주소로 연결할 뿐 여기서 옮겨 쓰지 않는다.

export function LegalDocMeta({ doc }: { doc: LegalDocRow }) {
  return (
    <p data-part="legal-doc-meta" className="text-[14px] text-navy-700">
      <span className="font-bold">{LEGAL_DOC_TYPE_LABELS[doc.doc_type]}</span> · {doc.issuer} · {doc.doc_no} · 결정일 <time dateTime={doc.decided_on}>{doc.decided_on}</time> · {doc.tax_kinds.join(", ")}
      {doc.provisions.length > 0 && <> · {doc.provisions.join(", ")}</>}
    </p>
  );
}

/** 기사 상세의 원문 블록 — 해설 본문과 분리된 구역 */
export function LegalDocBlock({ subject, related }: { subject: readonly LegalDocRow[]; related: readonly LegalDocRow[] }) {
  if (subject.length === 0 && related.length === 0) return null;
  const group = (title: string, part: string, docs: readonly LegalDocRow[]) =>
    docs.length === 0 ? null : (
      <section data-part={part} aria-label={title} className="mt-4">
        <h2 className="text-[15px] font-black text-navy-900">{title}</h2>
        <ul className="mt-2 space-y-2">
          {docs.map((d) => (
            <li key={d.id} data-legal-doc={d.id}>
              <LegalDocMeta doc={d} />
              <a href={d.source_url} target="_blank" rel="noopener noreferrer" className="text-[14px] underline underline-offset-4">
                원문 보기 (새 창)
              </a>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <aside data-part="legal-docs" aria-label="해석 원문" className="mx-auto mt-6 w-full max-w-[860px] rounded-2xl border border-navy-100 bg-white px-6 py-4">
      <p className="text-[13px] font-bold text-hermes-800">해석 원문 (아래 해설의 대상)</p>
      {group("해설 대상 원문", "legal-doc-subject", subject)}
      {group("관련 원문", "legal-doc-related", related)}
    </aside>
  );
}

export function InterpretationList({ view }: { view: InterpretationListView }) {
  const f = view.filter;
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">해석 해설</h1>
      <p className="mt-2 text-[15px] text-navy-700">예규·유권해석·심판·판례 원문을 확인하고, 세무 감수를 거친 해설을 함께 봅니다.</p>
      <form method="get" action="/tax/interpretations" data-part="filters" className="mt-6 flex flex-wrap items-end gap-3 text-[14px]">
        <label className="flex flex-col gap-1">
          유형
          <select name="type" defaultValue={f.type ?? ""} className="rounded-lg border border-navy-200 px-2 py-1">
            <option value="">전체</option>
            {LEGAL_DOC_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEGAL_DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          세목
          <input name="tax" defaultValue={f.taxKind ?? ""} className="rounded-lg border border-navy-200 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          조문
          <input name="provision" defaultValue={f.provision ?? ""} className="rounded-lg border border-navy-200 px-2 py-1" />
        </label>
        <button type="submit" className="rounded-lg bg-navy-900 px-4 py-1.5 font-bold text-white">
          찾기
        </button>
      </form>
      {view.items.length === 0 ? (
        <p data-part="empty" className="mt-8 text-[15px] text-navy-500">
          조건에 맞는 해설이 아직 없습니다.
        </p>
      ) : (
        <ul data-part="interpretation-list" className="mt-8 space-y-4">
          {view.items.map((c) => (
            <li key={c.article.id} data-article={c.article.slug} className="rounded-2xl border border-navy-100 bg-white p-6">
              <h2 className="text-[19px] font-black text-navy-900">
                <UiLink href={c.article.href} className="underline-offset-4 hover:underline">
                  {c.article.title}
                </UiLink>
              </h2>
              {c.docs.map((d) => (
                <div key={d.id} className="mt-2">
                  <LegalDocMeta doc={d} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
