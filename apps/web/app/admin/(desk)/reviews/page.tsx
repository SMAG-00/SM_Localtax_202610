import Link from "next/link";
import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { DataTable, EmptyNote, PageTitle, TD, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { CONTENT_TYPE_LABELS, REPORTING_METHOD_LABELS, labelOf } from "@/lib/admin/labels";
import { ownArticleNote, reviewKindsFor } from "@/lib/admin/review-form";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { peopleNames, reviewQueues, type ArticleListRow } from "@/lib/server/admin/queries";
import { personForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";

// 검토·발행 대기 (/admin/reviews) — 편집 승인 대기(편집 책임자, 본인 기사는 다른 편집자가) · 발행 대기 · 세무 감수 대기(세무 감수위원).
// 편집국 외 역할·기자는 403.
export const metadata: Metadata = { title: "검토·발행" };

export default async function ReviewsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["review.desk_edit", "review.tax_review"]);
  const kinds = reviewKindsFor(viewer);
  const db = serviceDb();
  const [queues, person] = await Promise.all([reviewQueues(db), personForUser(db, viewer.userId)]);
  const names = await peopleNames(db, [...queues.desk, ...queues.approved, ...queues.tax].map((a) => a.author_id));

  return (
    <>
      <PageTitle title="검토·발행" description="검토를 요청받은 기사를 승인·반려·보류합니다. 승인과 발행은 작성자와 다른 사람이 합니다." />
      <div className="space-y-10">
        {kinds.includes("desk_edit") && (
          <>
            <Queue id="desk" title="편집 승인 대기" rows={queues.desk} names={names} viewerPersonId={person?.id ?? null} checkOwn />
            <Queue id="approved" title="발행 대기 (편집 승인됨)" rows={queues.approved} names={names} viewerPersonId={person?.id ?? null} checkOwn={false} />
          </>
        )}
        {kinds.includes("tax_review") && <Queue id="tax" title="세무 감수 대기" rows={queues.tax} names={names} viewerPersonId={null} checkOwn={false} />}
        {!kinds.includes("desk_edit") && <Callout>편집 승인과 발행은 편집 책임자가 합니다. 세무 감수 서명만 할 수 있습니다.</Callout>}
      </div>
    </>
  );
}

function Queue({
  id,
  title,
  rows,
  names,
  viewerPersonId,
  checkOwn,
}: {
  id: string;
  title: string;
  rows: readonly ArticleListRow[];
  names: Record<number, string>;
  viewerPersonId: number | null;
  checkOwn: boolean;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <h2 id={`${id}-title`} className="mb-3 text-[19px] font-black text-navy-900">
        {title} <span className="font-mono text-[15px] text-navy-600">{rows.length}건</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyNote>대기 중인 기사가 없습니다.</EmptyNote>
      ) : (
        <DataTable caption={title} head={["제목", "작성 기자", "유형", "버전", "요청 시각", "비고"]}>
          {rows.map((a) => {
            const own = checkOwn ? ownArticleNote(a.author_id, viewerPersonId) : null;
            return (
              <tr key={a.id} data-testid={`${id}-row-${a.id}`}>
                <td className={TD}>
                  {own ? (
                    <Link href={`/admin/articles/${a.id}`} className={`${TEXT_LINK} [overflow-wrap:anywhere]`}>
                      {a.title}
                    </Link>
                  ) : (
                    <Link href={`/admin/reviews/${a.id}`} className={`${TEXT_LINK} [overflow-wrap:anywhere]`}>
                      {a.title}
                    </Link>
                  )}
                </td>
                <td className={TD}>{a.author_id ? (names[a.author_id] ?? `인물 ${a.author_id}`) : "없음"}</td>
                <td className={TD}>
                  {labelOf(CONTENT_TYPE_LABELS, a.content_type)}
                  {a.reporting_method && ` · ${labelOf(REPORTING_METHOD_LABELS, a.reporting_method)}`}
                </td>
                <td className={`${TD} font-mono`}>{a.version}</td>
                <td className={`${TD} font-mono text-[13px]`}>{isoToKstDateTime(a.updated_at)}</td>
                <td className={TD}>{own ? <ToneChip tone="amber">{own}</ToneChip> : ""}</td>
              </tr>
            );
          })}
        </DataTable>
      )}
    </section>
  );
}
