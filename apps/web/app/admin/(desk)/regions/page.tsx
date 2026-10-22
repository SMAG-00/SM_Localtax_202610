import type { Metadata } from "next";
import { EDITORIAL_FIELD_NAMES, EDITORIAL_JUDGEMENT_LABELS, SEPARATE_PRODUCT_STATUS_LABELS, type EditorialField, type EditorialJudgement, type SeparateProductStatus } from "@ltr/editorial";
import { CloseQueueItemForm } from "@/components/admin/SeparateProductControls";
import { EmptyNote, MONO, PageTitle, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { isoToKstDate, isoToKstDateTime } from "@/lib/admin/form-utils";
import { ARTICLE_STATUS_LABELS, CONTENT_TYPE_LABELS, EDITORIAL_STATUS_LABELS } from "@/lib/admin/labels";
import type { RegionalDeskRow } from "@/lib/admin/regional-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadRegionsBoard, type QueueItemView } from "@/lib/server/regions/board";

// 지역 기사 판정판 (/admin/regions, PRD-01B REG1-14·17 · W4 7·8단계 — docs/dev/W4_설계.md 5장 · 6장) — 편집 책임자·관리자(regional.judge).
//  · 별도 상품 검토 큐 — 여행 후기·맛집 추천·행사 홍보로 판정한 원고(열린 항목은 공개 0). 닫으려면 결정 사유를 적는다
//  · 편집 분야 승인 대기 — 공개 전 지역 기사 중 편집 승인 전 · 보류 — 편집 보류된 지역 기사
// 판정 자체는 기사 편집 화면의 '지역 기사 판정' 줄에서 한다. 시범 지역 최소선 리포트는 11단계가 이 화면에 더한다.
export const metadata: Metadata = { title: "지역 기사 판정" };
export const dynamic = "force-dynamic";

const label = <T extends string>(labels: Readonly<Record<T, string>>, v: string | null | undefined) => (v && v in labels ? labels[v as T] : (v ?? "—"));

function ArticleLink({ id, title }: { id: number; title: string | undefined }) {
  return (
    <a className={TEXT_LINK} href={`/admin/articles/${id}`}>
      {title ?? `기사 #${id}`}
    </a>
  );
}

function DeskList({ rows, testId, empty }: { rows: readonly RegionalDeskRow[]; testId: string; empty: string }) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>;
  return (
    <ul className="space-y-2 text-[15px] text-navy-800" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.id} data-article-id={r.id}>
          <ArticleLink id={Number(r.id)} title={r.title} /> · {label(ARTICLE_STATUS_LABELS, r.status)} · 편집 승인 {label(EDITORIAL_STATUS_LABELS, r.editorial_status)} · 편집 분야{" "}
          {r.editorial_field ? EDITORIAL_FIELD_NAMES[r.editorial_field as EditorialField] : "없음"}
          {r.editorial_judgement && ` · 판정 ${label(EDITORIAL_JUDGEMENT_LABELS, r.editorial_judgement)}`}
          <span className={`${MONO} ml-2 text-navy-600`}>{isoToKstDate(r.updated_at)}</span>
        </li>
      ))}
    </ul>
  );
}

function QueueHead({ item }: { item: QueueItemView }) {
  return (
    <>
      <p className="text-[15px] font-bold text-navy-900">
        <ToneChip tone={item.status === "open" ? "amber" : "navy"}>{label(SEPARATE_PRODUCT_STATUS_LABELS as Record<SeparateProductStatus, string>, item.status)}</ToneChip>{" "}
        {label(EDITORIAL_JUDGEMENT_LABELS as Record<EditorialJudgement, string>, item.judgement)} · <ArticleLink id={Number(item.article_id)} title={item.article?.title} />
      </p>
      <p className={`${MONO} mt-1 text-[14px] text-navy-600`}>
        항목 #{item.id} · 판정 {isoToKstDateTime(item.at)} · {item.judged_by}
        {item.article && ` · ${label(CONTENT_TYPE_LABELS, item.article.content_type)} · ${label(ARTICLE_STATUS_LABELS, item.article.status)}`}
      </p>
    </>
  );
}

export default async function RegionsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "regional.judge");
  const board = await loadRegionsBoard(serviceDb());

  return (
    <>
      <PageTitle
        title="지역 기사 판정"
        description="여행 후기·맛집 추천·행사 홍보로 판정한 원고는 별도 상품 검토 큐에 들어가고, 열린 동안은 어떤 화면에도 공개되지 않습니다. 판정은 기사 편집 화면에서 합니다."
      />
      <div className="space-y-8">
        <Panel id="separate-product-open" title={`별도 상품 검토 큐 — 열린 항목 ${board.open.length}건`} description="닫을 때 결정(광고·협찬 상품 전환·행사안내 등록·폐기 등)을 적습니다. 닫아도 보도기사·해설로는 발행되지 않습니다.">
          {board.open.length === 0 ? (
            <EmptyNote>열린 별도 상품 검토 항목이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="separate-product-open">
              {board.open.map((item) => (
                <li key={item.id} data-queue-id={item.id} data-article-id={item.article_id} data-judgement={item.judgement} className="rounded-xl border border-navy-100 p-4">
                  <QueueHead item={item} />
                  <CloseQueueItemForm id={Number(item.id)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="regional-awaiting" title={`편집 분야 승인 대기 ${board.awaiting.length}건`} description="공개 전 지역 기사 중 편집 승인(근거·관계·광고 독립성 3항목)을 아직 받지 않은 원고입니다.">
          <DeskList rows={board.awaiting} testId="regional-awaiting" empty="승인 대기 지역 기사가 없습니다." />
        </Panel>

        <Panel id="regional-held" title={`보류 ${board.held.length}건`} description="편집 보류된 지역 기사입니다. 판정 책임자가 없는 편집 분야의 원고도 발행 판정에서 보류로 보입니다.">
          <DeskList rows={board.held} testId="regional-held" empty="보류된 지역 기사가 없습니다." />
        </Panel>

        <Panel id="separate-product-closed" title="최근 닫힌 항목 20건">
          {board.closed.length === 0 ? (
            <EmptyNote>닫힌 항목이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-3 text-[14px] text-navy-800" data-testid="separate-product-closed">
              {board.closed.map((item) => (
                <li key={item.id} data-queue-id={item.id}>
                  <QueueHead item={item} />
                  <p className="text-navy-700">
                    <span className={MONO}>{isoToKstDateTime(item.closed_at)}</span> {item.closed_by} · {item.note}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
