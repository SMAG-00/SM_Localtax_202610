import { FieldHubHead, PopularArticles } from "@ltr/ui";
import type { PopularList } from "@/lib/server/public";
import { POPULAR_EMPTY, POPULAR_EYEBROW, POPULAR_TITLE, computedLine, popularClickItems, windowLabel } from "@/lib/site/popular-view";
import { MeasureClicks } from "./Measure";
import { SiteSection } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 많이 본 기사 (/news/popular — ART-11 · PRD-01A 3장 '많이 본 기사 목록 20 · "최근 7일" 기준과 집계 시각(고정폭)')
//  · 순위는 1시간 집계(popular-hourly)가 매긴다 — 최근 popular_rules.window_hours시간 사람 조회(봇·편집국 제외, 같은 방문자 30분 안 반복 1회)
//  · 건수는 popular_rules.list_size(씨앗 20). 비공개·삭제된 기사는 순위 표 공개 범위(RLS)에서 바로 빠진다
//  · 목록을 누르면 popular_article_clicked(기사 번호·순위·위치 list) 1건
//  · 공개 데이터를 읽지 못하면(unavailable) 머리 + 안내 한 줄만 (응답 200 — 낡은 목록 0)

export function PopularView({ data, unavailable = false }: { data: PopularList; unavailable?: boolean }) {
  const line = computedLine(data.computedAt);
  const label = data.windowHours > 0 ? windowLabel(data.windowHours) : null;
  return (
    <div data-ui="popular-page">
      <SiteSection id="popular-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead
          field="news"
          eyebrow={POPULAR_EYEBROW}
          title={POPULAR_TITLE}
          intro={label ? `${label} 동안 독자가 많이 읽은 기사입니다. 1시간마다 다시 셉니다.` : undefined}
        />
        {unavailable && <UnavailableNotice />}
      </SiteSection>
      {!unavailable && (
        <SiteSection id="popular-items" tone="ivory-dark" data={{ "data-hub-part": "latest" }}>
          {line && (
            <p data-part="computed-at" className="font-mono text-[13px] tracking-wide text-navy-600">
              {label ? `${label} 기준 · ${line}` : line}
            </p>
          )}
          {data.items.length > 0 ? (
            <div className="mt-6">
              <MeasureClicks name="popular_article_clicked" items={popularClickItems(data.items, "list")}>
                <PopularArticles items={data.items.map((a) => ({ href: a.href, title: a.title }))} limit={data.items.length} />
              </MeasureClicks>
            </div>
          ) : (
            <p data-part="empty-guide" className="mt-6 text-[17px] text-navy-700">
              {POPULAR_EMPTY}
            </p>
          )}
        </SiteSection>
      )}
    </div>
  );
}
