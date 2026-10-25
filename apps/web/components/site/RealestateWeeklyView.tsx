import { Eyebrow, UiLink } from "@ltr/ui";
import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import { weekLabel, type WeeklyIssue } from "@/lib/server/public/realestate-weekly-logic";
import { NEXT_STEPS } from "@/lib/site/next-step";
import { JsonLd } from "./JsonLd";
import { MeasureOnce, TrackedLink } from "./MeasureShortcut";

// 이번 주 재테크 포인트 (PR-15) - 이번 주 부동산재테크 기사 3~7건 + 기사마다 세금 관점 한 줄. 투자 권유·가격·수익률 칸 없음.
// 끝에 '다음 한 걸음' 계산 링크(금액 없음). 계산기가 닫혀 있으면(calcOpen false) 링크 0.
/** 화면에 보이는 제목·주소·항목과 같은 값으로 CollectionPage를 만든다 (생성기 호출만 - OPT-02) */
export function weeklyJsonLdContent(issue: WeeklyIssue, site: string): string {
  return toJsonLdScriptContent(
    pageJsonLd({
      kind: "collection",
      collection: {
        url: `${site}/realestate/weekly/${issue.week}`,
        name: `이번 주 재테크 포인트 ${weekLabel(issue.week) ?? issue.week}`,
        datePublished: issue.publishedAt.slice(0, 10),
        items: issue.items.map((it) => ({ name: it.title, url: `${site}${it.href}` })),
      },
    }),
  );
}

export function RealestateWeeklyView({ issue, calcOpen, site }: { issue: WeeklyIssue; calcOpen: boolean; /** 사이트 주소(절대 주소 기준) - 없으면 구조화 데이터를 내지 않는다 */ site: string | null | undefined }) {
  const label = weekLabel(issue.week) ?? issue.week;
  const step = NEXT_STEPS.read_to_calc;
  return (
    <div className="mx-auto w-full max-w-[780px] px-4 py-8" data-testid="realestate-weekly" data-issue-id={issue.issueId}>
      {site && <JsonLd content={weeklyJsonLdContent(issue, site)} part="weekly-collection" />}
      <MeasureOnce name="realestate_weekly_viewed" props={{ issue_id: issue.issueId }} />
      <Eyebrow>{label}</Eyebrow>
      <h1 className="mt-2 text-[28px] leading-tight font-black text-navy-900">이번 주 재테크 포인트</h1>
      <p className="mt-2 text-[15px] text-navy-700">이번 주 부동산재테크 기사와, 기사마다 세금 관점의 한 줄입니다. 투자 권유나 가격 전망이 아닙니다.</p>
      <ol className="mt-6 space-y-4" data-part="weekly-items">
        {issue.items.map((it) => (
          <li key={it.articleId} className="rounded-lg border border-navy-100 bg-white p-4" data-part="weekly-item">
            <UiLink href={it.href} className="text-[17px] font-bold text-navy-900 underline-offset-2 hover:underline">
              {it.title}
            </UiLink>
            <p className="mt-2 text-[15px] text-navy-800">{it.point}</p>
            <p className="mt-1 text-[13px] text-navy-500">관련 세목: {it.taxItems.join(" · ")}</p>
          </li>
        ))}
      </ol>
      {calcOpen && (
        <p className="mt-8" data-part="next-step">
          <TrackedLink
            href={step.href}
            name="shortcut_clicked"
            props={{ placement: "home", shortcut: step.shortcut }}
            className="inline-flex min-h-11 items-center rounded-lg bg-hermes-500 px-4 text-[15px] font-bold text-navy-900 hover:bg-hermes-600"
          >
            {step.label}
          </TrackedLink>
        </p>
      )}
    </div>
  );
}
