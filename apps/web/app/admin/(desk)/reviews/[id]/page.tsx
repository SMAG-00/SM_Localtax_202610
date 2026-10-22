import Link from "next/link";
import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { ArticleHeader, ReviewHistory } from "@/components/admin/ArticleRecords";
import { ArticlePreview } from "@/components/admin/ArticlePreview";
import { CheckPanelLive } from "@/components/admin/CheckPanelLive";
import { ReviewDecisionForm } from "@/components/admin/ReviewDecisionForm";
import { MONO, Panel, TEXT_LINK, ToneChip } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { EVIDENCE_TYPE_LABELS, SOURCE_KIND_LABELS, VERIFICATION_LABELS, labelOf } from "@/lib/admin/labels";
import { isRegionalRow, ownArticleNote, reviewKindsFor } from "@/lib/admin/review-form";
import { orNotFound, pageId, pageViewer, requirePage } from "@/lib/server/admin/pages";
import { peopleNames } from "@/lib/server/admin/queries";
import { loadEditorView } from "@/lib/server/articles/editor-view";
import { articleResource, loadArticle, personForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";

// 검토·발행 화면 (/admin/reviews/[id]) — 원고·출처·취재 근거 요약 + 최적화 점검 패널(발행 버튼) + 편집 승인·세무 감수 결정.
// 편집 승인은 작성 기자와 다른 편집 책임자만(NAV-12), 세무 감수는 세무 감수위원만. 편집국 외 역할·기자는 403.
export const metadata: Metadata = { title: "검토·발행" };

type Props = { params: Promise<{ id: string }> };

export default async function ReviewArticlePage({ params }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, ["review.desk_edit", "review.tax_review"]);
  const id = pageId((await params).id);
  const db = serviceDb();
  const row = await orNotFound(loadArticle(db, id));
  const resource = await articleResource(db, row);
  requirePage(viewer, "article.read", resource);

  const [view, person] = await Promise.all([loadEditorView(db, row), personForUser(db, viewer.userId)]);
  const names = await peopleNames(db, [row.author_id, ...view.reviews.map((r) => r.reviewer_id)]);
  const kinds = reviewKindsFor(viewer);
  const own = ownArticleNote(row.author_id, person?.id ?? null);
  const closed = row.status === "published" || row.status === "deleted";

  return (
    <>
      <ArticleHeader view={view} authorName={row.author_id !== null ? (names[row.author_id] ?? null) : null} />
      <p className="mb-4">
        <Link href={`/admin/articles/${id}`} className={TEXT_LINK}>
          편집 화면에서 원고 고치기
        </Link>
      </p>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
        <div className="min-w-0 space-y-6">
          <ArticlePreview view={view} />
          <Panel id="review-sources" title="출처·취재 근거">
            <ul className="space-y-1 text-[15px] text-navy-800">
              {view.sources.map((s) => (
                <li key={`s${s.id}`} className="[overflow-wrap:anywhere]">
                  <span className={MONO}>src:{s.id}</span> {labelOf(SOURCE_KIND_LABELS, s.kind)} · {s.title ?? "제목 없음"} · {s.source_name ?? "발표기관 없음"}
                  {s.last_verified_at ? ` · 확인 ${isoToKstDate(s.last_verified_at)}` : ""}
                </li>
              ))}
              {view.evidence.map((e) => (
                <li key={`e${e.id}`} className="[overflow-wrap:anywhere]">
                  <span className={MONO}>ev:{e.id}</span> {labelOf(EVIDENCE_TYPE_LABELS, e.evidence_type)} ·{" "}
                  <ToneChip tone={e.verification_status === "verified" ? "emerald" : "amber"}>{labelOf(VERIFICATION_LABELS, e.verification_status)}</ToneChip>
                </li>
              ))}
            </ul>
          </Panel>
          <ReviewHistory view={view} names={names} />
        </div>
        <aside aria-label="점검·결정" className="mt-6 space-y-4 lg:mt-0">
          <CheckPanelLive
            articleId={id}
            status={row.status}
            canPublishRole={can(viewer, "article.publish")}
            blockTypes={view.article.body.blocks.map((b) => b.type)}
            refreshKey={`${row.version}-${row.status}-${view.reviews.length}`}
          />
          {kinds.includes("desk_edit") && !closed && (
            <Panel id="desk-edit" title="편집 승인">
              {own ? <Callout>{own}</Callout> : <ReviewDecisionForm articleId={id} kind="desk_edit" reportingMethod={row.reporting_method} version={row.version} regional={isRegionalRow(row)} />}
            </Panel>
          )}
          {kinds.includes("tax_review") && !closed && (
            <Panel id="tax-review" title="세무 감수" description={row.tax_review_status === "not_required" ? "이 기사는 세무 감수 대상이 아닙니다." : undefined}>
              <ReviewDecisionForm articleId={id} kind="tax_review" reportingMethod={row.reporting_method} version={row.version} />
            </Panel>
          )}
        </aside>
      </div>
    </>
  );
}
