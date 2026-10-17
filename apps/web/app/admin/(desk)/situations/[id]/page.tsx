import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@ltr/ui";
import { SituationReviewButton } from "@/components/admin/SituationControls";
import { SituationForm } from "@/components/admin/SituationForm";
import { MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { SECTION_LABELS, labelOf } from "@/lib/admin/labels";
import { situationToForm } from "@/lib/admin/situation-rules";
import { orNotFound, pageId, pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { describeSituation, loadSituation, reviewerNames } from "@/lib/server/admin/situations";
import { serviceDb } from "@/lib/server/articles/service";
import { readChecklist, readChecks } from "@/lib/server/public/situation-logic";

// 상황 카드 하나 (/admin/situations/[id] — UX-05 · FAM-02). 위: 지금 상태(공개·허브 자리·감수 기록). 세무 감수위원은 감수할 문장을 읽고 서명한다.
// 쓰는 사람(기자·편집 책임자·관리자)은 아래 폼으로 고친다 — 감수 대상 문장을 고치면 감수 기록이 지워진다(저장 뒤 알림).
export const metadata: Metadata = { title: "상황 카드" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SituationPage({ params, searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, ["situation.edit", "situation.publish", "review.tax_review"]);
  const id = pageId((await params).id);
  const created = queryValue((await searchParams).created) === "1";
  const db = serviceDb();
  const row = await orNotFound(loadSituation(db, id));
  const names = await reviewerNames(db, row.reviewer_id === null ? [] : [row.reviewer_id]);
  const item = describeSituation(row, names);
  const checks = readChecks(row.checks);
  const checklist = readChecklist(row.checklist);

  return (
    <>
      <PageTitle title={row.title} description={`${labelOf(SECTION_LABELS, row.section)} · /situations/${row.slug}`}>
        <Link href="/admin/situations" className={TEXT_LINK}>
          상황 카드 목록
        </Link>
      </PageTitle>
      <div className="space-y-8">
        {created && <Callout>상황 카드를 만들었습니다 — 비공개입니다. 세무 감수 서명을 받은 뒤 공개할 수 있습니다.</Callout>}
        <Panel id="situation-state" title="지금 상태">
          <div className="flex flex-wrap gap-2" data-testid="situation-state">
            <ToneChip tone={item.visible ? "emerald" : "plain"}>{item.visible ? "공개" : "비공개"}</ToneChip>
            <ToneChip tone={item.review ? "navy" : "amber"}>
              <span data-testid="situation-review">{item.review ? `감수 ${isoToKstDateTime(item.review.at)}${item.review.by ? ` · ${item.review.by}` : ""}` : "감수 전"}</span>
            </ToneChip>
            {item.hubSlot !== null && <ToneChip>{`허브 ${item.hubSlot}번`}</ToneChip>}
          </div>
          <p className="text-[14px] text-navy-600">
            마지막 수정 <span className={MONO}>{isoToKstDateTime(row.updated_at)}</span>
            {item.publicHref && (
              <>
                {" · "}
                <a href={item.publicHref} className={TEXT_LINK} target="_blank" rel="noopener noreferrer">
                  공개 화면 보기<span className="sr-only"> (새 창)</span>
                </a>
              </>
            )}
          </p>
        </Panel>
        {can(viewer, "review.tax_review") && (
          <Panel id="situation-review" title="세무 감수" description="아래 문장이 공개 화면에 그대로 나갑니다. 확인한 뒤 서명합니다 — 서명 뒤 문장이 바뀌면 감수 기록이 지워집니다.">
            <ol className="list-decimal space-y-1 pl-5 text-[15px] text-navy-800" data-testid="review-checks">
              {checks.map((c, i) => (
                <li key={i}>
                  <span className="font-bold">{c.title}</span>
                  {c.when && <> · {c.when}</>}
                  {c.note && <> — {c.note}</>}
                </li>
              ))}
            </ol>
            {checklist && (
              <div className="text-[15px] text-navy-800">
                <p className="font-bold">일반적인 체크리스트</p>
                <ul className="list-disc pl-5">
                  {checklist.items.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
                <p className="text-navy-600">{checklist.notice}</p>
              </div>
            )}
            {row.mistakes.length > 0 && (
              <div className="text-[15px] text-navy-800">
                <p className="font-bold">자주 틀리는 점</p>
                <ul className="list-disc pl-5">
                  {row.mistakes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <SituationReviewButton id={row.id} updatedAt={row.updated_at} reviewed={item.review !== null} />
          </Panel>
        )}
        {can(viewer, "situation.edit") && (
          <Panel id="situation-edit" title="고치기">
            <SituationForm mode="patch" id={row.id} initial={situationToForm(row)} reviewed={item.review !== null} visible={row.visible} />
          </Panel>
        )}
      </div>
    </>
  );
}
