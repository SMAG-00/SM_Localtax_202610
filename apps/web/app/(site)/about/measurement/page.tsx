import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { DarkButton, Eyebrow } from "@ltr/ui";
import type { SearchParams } from "@/components/site/routes";
import { measurementState } from "@/lib/analytics/consent";
import { REFUSAL_COOKIE } from "@/lib/analytics/visit";
import { pageTitle, queryValue } from "@/lib/site/hub-view";
import { MEASUREMENT_EXPLANATION, MEASUREMENT_TITLE, measurementView } from "@/lib/site/measurement-view";

// 측정 거부 (GROW-01 '측정 거부(바닥글 설정)' · PRD-00 13장 — docs/dev/W2-c_설계.md 5.1). 지금 상태와 버튼 하나(반대 동작).
//  · 스크립트가 꺼져도 동작하는 폼 — POST /api/measurement가 쿠키를 쓰고 303으로 이 화면에 돌아온다
//  · 거부할 권리는 기능 키로 숨기지 않는다. 바닥글 [측정 거부] 링크는 W2-e(HELP-05 정책 링크)가 단다 [결정 안건 — 9장 #7 위치·문구]
export const metadata: Metadata = { title: pageTitle(MEASUREMENT_TITLE) };

export default async function MeasurementPage({ searchParams }: { searchParams: SearchParams }) {
  const [store, headerList, query] = await Promise.all([cookies(), headers(), searchParams]);
  const state = measurementState(store.get(REFUSAL_COOKIE)?.value === "1", headerList.get("sec-gpc")?.trim() === "1");
  const view = measurementView(state, queryValue(query.done));
  return (
    <section data-ui="measurement-page" data-state={state} className="mx-auto max-w-3xl px-4 py-20">
      <Eyebrow>MEASUREMENT</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[32px]">{MEASUREMENT_TITLE}</h1>
      {view.notice && (
        <p role="status" data-part="notice" className="mt-6 rounded-xl border border-navy-100 bg-white px-4 py-3 text-[15px] font-bold text-navy-900">
          {view.notice}
        </p>
      )}
      <p data-part="status" className="mt-6 text-[17px] font-bold text-navy-900">
        {view.status}
      </p>
      <ul className="mt-4 space-y-2 text-[17px] text-navy-700">
        {MEASUREMENT_EXPLANATION.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <form method="post" action="/api/measurement" className="mt-8">
        <input type="hidden" name="choice" value={view.button.choice} />
        <DarkButton type="submit" data-choice={view.button.choice}>
          {view.button.label}
        </DarkButton>
      </form>
    </section>
  );
}
