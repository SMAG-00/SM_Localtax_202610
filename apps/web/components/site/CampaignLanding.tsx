import { HEADER_SHORTCUTS } from "@ltr/ui";
import { MeasureOnce, StripQuery, TrackedLink } from "./MeasureShortcut";

// 캠페인 랜딩 화면 (GROW-03) - 제목 + 본문 + 주 버튼 1개 + 보조 링크 최대 1개. 입력 칸·다른 링크 0. 문구는 관리 화면에서 PO가 넣은 것(AI 작성 0).
type Dest = { href: string; target: string };
const labelOf = (target: string) => HEADER_SHORTCUTS.find((s) => s.key === target)?.label ?? "";

export function CampaignLanding({ campaign, title, body, primary, secondary, source, medium }: { campaign: string; title: string; body: string; primary: Dest; secondary: Dest | null; source: string; medium: string }) {
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 py-10" data-testid="campaign-landing" data-campaign={campaign}>
      <MeasureOnce name="campaign_landing_viewed" props={{ campaign, source, medium }} entry="campaign" />
      <StripQuery />
      <h1 className="text-[26px] leading-tight font-black text-navy-900">{title}</h1>
      <p className="mt-4 text-[16px] leading-relaxed text-navy-800">{body}</p>
      <p className="mt-8">
        <TrackedLink
          href={primary.href}
          name="campaign_cta_clicked"
          props={{ campaign, cta: "primary", destination: primary.target }}
          className="inline-flex min-h-11 items-center rounded-lg bg-hermes-500 px-5 text-[16px] font-bold text-navy-900 hover:bg-hermes-600"
        >
          {labelOf(primary.target)}
        </TrackedLink>
      </p>
      {secondary && (
        <p className="mt-4">
          <TrackedLink
            href={secondary.href}
            name="campaign_cta_clicked"
            props={{ campaign, cta: "secondary", destination: secondary.target }}
            className="inline-flex min-h-11 items-center text-[15px] font-semibold text-navy-700 underline underline-offset-2"
          >
            {labelOf(secondary.target)}
          </TrackedLink>
        </p>
      )}
    </div>
  );
}
