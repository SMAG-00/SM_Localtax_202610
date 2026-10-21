import { UiLink } from "@ltr/ui";
import type { ThenNowView } from "@/lib/server/public";

// 「그때와 지금」 비교 항목 (W3 8단계 — PRD-01C BR-04 '과거 수치·제도는 출처·기준연도가 있을 때만 렌더') — 공개 뷰가 둘 다 있는 줄만 주고,
// 여기서도 둘 중 하나라도 빈 줄은 그리지 않는다. 글자는 편집국 입력값 — 이 파일에 내용 글자 0.
export function ThenNowBlock({ items }: { items: readonly ThenNowView[] }) {
  const rows = items.filter((i) => i.source.trim() !== "" && Number.isInteger(i.baseYear));
  if (rows.length === 0) return null;
  return (
    <section data-part="then-now" aria-labelledby="then-now-title" className="mx-auto mt-6 w-full max-w-[860px] rounded-2xl border border-navy-100 bg-white px-6 py-5">
      <h2 id="then-now-title" className="text-[19px] font-black text-navy-900">
        그때와 지금 비교
      </h2>
      <ol className="mt-4 space-y-4">
        {rows.map((i) => (
          <li key={i.position} data-part="then-now-item" data-base-year={i.baseYear} className="rounded-xl bg-ivory px-4 py-3 [overflow-wrap:anywhere]">
            {i.label && <p className="text-[15px] font-bold text-navy-900">{i.label}</p>}
            <dl className="mt-1 grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-[13px] font-bold text-navy-600">{`그때 (${i.baseYear}년 기준)`}</dt>
                <dd className="text-[16px] text-navy-800">{i.thenText}</dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-navy-600">지금</dt>
                <dd className="text-[16px] text-navy-800">{i.nowText}</dd>
              </div>
            </dl>
            <p data-part="then-now-source" className="mt-2 text-[14px] text-navy-700">
              출처{" "}
              {i.sourceUrl ? (
                <UiLink href={i.sourceUrl} rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
                  {i.source}
                </UiLink>
              ) : (
                i.source
              )}
              {` · 기준연도 ${i.baseYear}년`}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
