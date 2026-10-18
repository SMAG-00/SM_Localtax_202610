import type { Metadata } from "next";
import Link from "next/link";
import { Pictogram } from "@ltr/ui";
import { SituationPlacement } from "@/components/admin/SituationControls";
import { EmptyNote, MONO, OUTLINE_BUTTON, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { SECTION_LABELS } from "@/lib/admin/labels";
import { SITUATION_SECTIONS, hubRows, nextFreeSlot } from "@/lib/admin/situation-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { describeSituation, hubLimit, listSituationRows, reviewerNames, type SituationItem } from "@/lib/server/admin/situations";
import { serviceDb } from "@/lib/server/articles/service";
import { isPictogram } from "@/lib/server/public/situation-logic";

// 상황 카드 (/admin/situations — UX-05 · PRD-01A 3장 백오피스 '상황 카드'). 분야(4대 분야)마다 허브 카드 줄(자리 순, 상한까지)과 허브 밖 상황.
// 쓰기는 기자·편집 책임자·관리자, 공개·허브 배치·순서는 편집 책임자, 감수 서명은 세무 감수위원(상황 화면에서).
// 공개 상황은 감수 서명이 있어야 하고, 감수 대상 문장을 고치면 감수 기록이 지워진다 (DB 규칙).
export const metadata: Metadata = { title: "상황 카드" };

function StatusChips({ item }: { item: SituationItem }) {
  return (
    <>
      <ToneChip tone={item.visible ? "emerald" : "plain"}>
        <span data-testid="situation-visibility">{item.visible ? "공개" : "비공개"}</span>
      </ToneChip>
      {item.review ? (
        <ToneChip tone="navy">
          <span data-testid="situation-review">{`감수 ${isoToKstDate(item.review.at)}${item.review.by ? ` · ${item.review.by}` : ""}`}</span>
        </ToneChip>
      ) : (
        <ToneChip tone="amber">
          <span data-testid="situation-review">감수 전</span>
        </ToneChip>
      )}
      {item.hubSlot !== null && <ToneChip>{`허브 ${item.hubSlot}번`}</ToneChip>}
    </>
  );
}

export default async function SituationsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["situation.edit", "situation.publish", "review.tax_review"]);
  const db = serviceDb();
  const [rows, limit] = await Promise.all([listSituationRows(db), hubLimit(db)]);
  const names = await reviewerNames(db, rows.flatMap((r) => (r.reviewer_id === null ? [] : [r.reviewer_id])));
  const canEdit = can(viewer, "situation.edit");
  const canPublish = can(viewer, "situation.publish");

  return (
    <>
      <PageTitle
        title="상황 카드"
        description={`분야 허브의 상황 카드 줄(분야마다 ${limit}장까지)과 상황 페이지입니다. 먼저 확인할 것 3가지는 세무 감수 서명을 받은 뒤 공개합니다.`}
      >
        {canEdit && (
          <Link href="/admin/situations/new" className={OUTLINE_BUTTON}>
            상황 카드 만들기
          </Link>
        )}
      </PageTitle>
      <div className="space-y-8">
        {SITUATION_SECTIONS.map((section) => {
          const mine = rows.filter((r) => r.section === section);
          const hub = hubRows(mine, section);
          const hubIds = hub.map((r) => r.id);
          const others = mine.filter((r) => r.hub_slot === null);
          const free = nextFreeSlot(mine, section, limit);
          const item = (r: (typeof mine)[number]) => {
            const d = describeSituation(r, names);
            return (
              <li key={r.id} data-testid={`situation-${r.id}`} className="space-y-3 rounded-xl border border-navy-100 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {isPictogram(r.pictogram) && <Pictogram name={r.pictogram} label={r.title} showLabel={false} />}
                  <Link href={`/admin/situations/${r.id}`} className={`${TEXT_LINK} text-[17px] [overflow-wrap:anywhere]`}>
                    {r.title}
                  </Link>
                  <StatusChips item={d} />
                </div>
                <p className="text-[14px] text-navy-600">
                  <span className={MONO}>/situations/{r.slug}</span> · 먼저 확인할 것 {d.checksCount}개 · <span data-testid={`alias-count-${r.id}`}>검색 별칭 {d.aliasCount}개</span>
                  {d.publicHref && (
                    <>
                      {" · "}
                      <a href={d.publicHref} className={TEXT_LINK} target="_blank" rel="noopener noreferrer">
                        공개 화면 보기<span className="sr-only"> (새 창)</span>
                      </a>
                    </>
                  )}
                </p>
                {canPublish && (
                  <SituationPlacement
                    item={{ id: r.id, title: r.title, section: r.section, visible: r.visible, hubSlot: r.hub_slot, reviewed: r.reviewed_at !== null }}
                    hubIds={hubIds}
                    freeSlot={free}
                    limit={limit}
                  />
                )}
              </li>
            );
          };
          return (
            <Panel
              key={section}
              id={`situations-${section}`}
              title={SECTION_LABELS[section]}
              description={
                <>
                  허브 카드 <span className={MONO} data-testid={`hub-count-${section}`}>{`${hub.length}/${limit}`}</span> · 허브 밖 상황 {others.length}개
                </>
              }
            >
              {mine.length === 0 ? (
                <EmptyNote>이 분야의 상황 카드가 없습니다.</EmptyNote>
              ) : (
                <>
                  {hub.length > 0 && (
                    <ol aria-label={`${SECTION_LABELS[section]} 허브 카드`} className="space-y-3">
                      {hub.map(item)}
                    </ol>
                  )}
                  {others.length > 0 && (
                    <ul aria-label={`${SECTION_LABELS[section]} 허브 밖 상황`} className="space-y-3">
                      {others.map(item)}
                    </ul>
                  )}
                </>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
