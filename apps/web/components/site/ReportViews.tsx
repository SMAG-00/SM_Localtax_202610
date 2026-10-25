import { UiLink } from "@ltr/ui";
import { paragraphsOf } from "@/lib/server/org/logic";
import type { ReportPreview, ReportState } from "@/lib/server/org/reports";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 프리미엄 리포트 공개 화면 (W11-f, BIZ-07). 리포트 글자는 이 파일에 없다 - 데이터(미리보기·본문)만 문단으로 그린다.
//  · 본문이 없으면(비회원·비좌석) 미리보기 + 잠금 표시만. 본문은 HTML로 해석하지 않고 글자 그대로 문단에 넣는다.
//  · 투자 권유·수익률 순위·가입 링크는 이 화면에 없다 (DF-05). 기준일·출처 목록·감수 서명은 항상 보인다.

function Basis({ r }: { r: ReportPreview }) {
  return (
    <dl data-part="report-basis" className="mt-4 grid gap-1 text-[16px] text-navy-800">
      <div><dt className="inline font-bold">기준일 </dt><dd className="inline">{r.asOf}</dd></div>
      <div><dt className="inline font-bold">세무 감수 </dt><dd className="inline">{r.taxReviewer} ({r.taxReviewedOn})</dd></div>
      <div>
        <dt className="font-bold">출처</dt>
        <dd>
          <ul data-part="report-sources" className="list-disc pl-5">
            {r.sources.map((s, i) => <li key={`${s.title}-${i}`}>{s.url ? <a href={s.url} rel="noopener noreferrer nofollow" target="_blank" className={TEXT_LINK}>{s.title}</a> : s.title}</li>)}
          </ul>
        </dd>
      </div>
    </dl>
  );
}

export function ReportListPage({ items }: { items: ReportPreview[] }) {
  return (
    <div data-ui="report-list">
      <SiteSection id="report-list" tone="ivory" first heading={{ eyebrow: "REPORTS", title: "프리미엄 리포트" }} data={{ "data-report-part": "list" }}>
        <ul className="mt-4 grid gap-4">
          {items.map((r) => (
            <li key={r.slug} data-part="report-item" className="rounded-xl border border-navy-200 bg-white px-4 py-4">
              <p className="text-[15px] font-bold text-navy-800">{r.periodLabel}</p>
              <UiLink href={`/finance/reports/${r.slug}`} className={`${TEXT_LINK} inline-flex min-h-11 items-center text-[19px] font-bold`}>{r.title}</UiLink>
              <p className="mt-1 text-[17px] text-navy-800">{r.preview}</p>
            </li>
          ))}
        </ul>
      </SiteSection>
    </div>
  );
}

export function ReportDetailPage({ state }: { state: ReportState }) {
  const { preview, body, loggedIn } = state;
  return (
    <div data-ui="report-detail">
      <SiteSection id="report-detail" tone="ivory" first heading={{ eyebrow: preview.periodLabel, title: preview.title }} data={{ "data-report-part": "detail" }}>
        <Basis r={preview} />
        {body !== null ? (
          <div data-part="report-body" className="mt-6 grid gap-4 text-[17px] leading-8 text-navy-900">
            {paragraphsOf(body).map((p, i) => <p key={i}>{p}</p>)}
          </div>
        ) : (
          <div data-part="report-locked">
            <p data-part="report-preview" className="mt-6 text-[17px] leading-8 text-navy-900">{preview.preview}</p>
            <p role="note" data-part="report-lock" className="mt-4 rounded-xl border border-navy-200 bg-white px-4 py-3 text-[17px] font-bold text-navy-900">
              전문은 기관 구독 좌석 회원에게만 열립니다.
            </p>
            {!loggedIn && (
              <p className="mt-4">
                <a className={`${TEXT_LINK} inline-flex min-h-11 items-center`} href={`/login?next=/finance/reports/${preview.slug}`}>로그인</a>
              </p>
            )}
            <p className="mt-2">
              <UiLink href="/store/institution" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>기관 구독 안내</UiLink>
            </p>
          </div>
        )}
      </SiteSection>
    </div>
  );
}
