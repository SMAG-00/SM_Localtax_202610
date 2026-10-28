import type { Metadata } from "next";
import { CONTENT_TYPES } from "@ltr/editorial";
import { ArticleHeader, CorrectionsList, ReviewHistory, RevisionList } from "@/components/admin/ArticleRecords";
import { ArticleWorkspace } from "@/components/admin/ArticleWorkspace";
import { CorrectionDecisionForm, CorrectionRequestForm } from "@/components/admin/CorrectionForms";
import { PlacementForm } from "@/components/admin/PlacementForm";
import { PublishSteps } from "@/components/admin/PublishSteps";
import { Panel, TEXT_LINK } from "@/components/admin/ui";
import type { EditorPermissions } from "@/components/admin/editor/types";
import { can } from "@/lib/access";
import { publishSteps } from "@/lib/admin/publish-steps";
import { orNotFound, pageId, pageViewer, requirePage } from "@/lib/server/admin/pages";
import { listCategories, listMedia, listPartners, peopleNames, pendingCorrectionRequests } from "@/lib/server/admin/queries";
import { loadEditorView } from "@/lib/server/articles/editor-view";
import { articleResource, loadArticle, loadArticleGraph, personForUser } from "@/lib/server/articles/repository";
import { gateReport } from "@/lib/server/articles/report";
import { kstDate } from "@/lib/server/articles/gate";
import { gateFor, nowIso, serviceDb } from "@/lib/server/articles/service";

// 기사 편집 (/admin/articles/[id]) — 원고·출처·비공개 취재 근거·확인 목록·「지방세로 읽기」 + 최적화 점검 패널.
// 발행된 기사는 정정 요청(기자)·정정 결정(편집 책임자)·배치(편집 책임자)를 함께 보인다. 접근 판정은 기사별(작성자·유형·발행 여부)로 한다.
export const metadata: Metadata = { title: "기사 편집" };

type Props = { params: Promise<{ id: string }> };

export default async function ArticleEditorPage({ params }: Props) {
  const viewer = await pageViewer();
  const id = pageId((await params).id);
  const db = serviceDb();
  const row = await orNotFound(loadArticle(db, id));
  const resource = await articleResource(db, row);
  requirePage(viewer, "article.read", resource);

  const [view, categories, partners, media] = await Promise.all([loadEditorView(db, row), listCategories(db), listPartners(db), listMedia(db)]);
  const names = await peopleNames(db, [row.author_id, ...view.reviews.map((r) => r.reviewer_id)]);
  const published = row.first_published_at !== null;
  const perms: EditorPermissions = {
    canEdit: can(viewer, "article.edit", resource),
    canSkipTaxLens: can(viewer, "article.tax_lens_skip"),
    canSubmit: can(viewer, "article.submit", resource) && !published,
    canPublish: can(viewer, "article.publish"),
    canReview: can(viewer, "review.desk_edit") || can(viewer, "review.tax_review"),
    canRequestCorrection: can(viewer, "correction.request"),
    canDecideCorrection: can(viewer, "correction.decide"),
    canPlace: can(viewer, "article.sort"),
    canHot: can(viewer, "article.hot"),
    canReadPartners: can(viewer, "partner.read"),
    canJudgeRegional: can(viewer, "regional.judge"),
    contentTypes: CONTENT_TYPES.filter((t) => can(viewer, "article.edit", { ...resource, contentType: t })),
  };
  // 발행까지 할 일 — GET check와 같은 판정(gateFor)을 서버에서 한 번 읽는다. 발행·삭제된 기사는 단계표가 필요 없다
  const stepsShown = row.status !== "published" && row.status !== "deleted" && !published;
  let steps: ReturnType<typeof publishSteps> | null = null;
  if (stepsShown) {
    const [gate, person] = await Promise.all([gateFor(db, await loadArticleGraph(db, row), nowIso()), personForUser(db, viewer.userId)]);
    const report = gateReport(gate);
    steps = publishSteps({
      articleId: id,
      articleStatus: row.status,
      canPublish: report.canPublish,
      failed: report.failed,
      findings: report.findings,
      taxReviewReasons: report.taxReviewReasons,
      viewer: {
        canEdit: perms.canEdit,
        canSubmit: perms.canSubmit,
        canConfirmRights: can(viewer, "media.rights"),
        canDeskEdit: can(viewer, "review.desk_edit"),
        canTaxReview: can(viewer, "review.tax_review"),
        canPublish: perms.canPublish,
        isAuthor: person !== null && person.id === row.author_id,
      },
    });
  }
  const requests = published && perms.canDecideCorrection ? await pendingCorrectionRequests(db, id) : [];

  return (
    <>
      <ArticleHeader view={view} authorName={row.author_id !== null ? (names[row.author_id] ?? null) : null} />
      {steps && <PublishSteps steps={steps} />}
      <ArticleWorkspace view={view} categories={categories} partners={partners} media={media} perms={perms} today={kstDate(nowIso())} />

      <div className="mt-8 space-y-6">
        {published && row.status !== "deleted" && (perms.canRequestCorrection || perms.canDecideCorrection) && (
          <Panel id="correction" title="정정·반론" description="발행된 기사의 정정·반론·추후보도·삭제·제목 변경은 이유와 전후 버전을 남깁니다 (NAV-06).">
            {perms.canDecideCorrection ? (
              <CorrectionDecisionForm articleId={id} original={{ title: view.article.title, summary: view.article.summary, body: view.article.body }} requests={requests} />
            ) : (
              <CorrectionRequestForm articleId={id} />
            )}
          </Panel>
        )}
        {row.status === "published" && perms.canPlace && (
          <Panel id="placement" title="배치" description="정렬·HOT·뉴스 전송 후보는 편집 책임자만 정합니다.">
            <PlacementForm
              articleId={id}
              hotPinUntil={row.hot_pin_until}
              navCandidate={row.nav_candidate}
              canHot={perms.canHot}
              navAllowed={row.content_type === "reported_news" && row.editorial_status === "approved"}
            />
          </Panel>
        )}
        {row.status !== "deleted" && can(viewer, "regional_link.confirm") && (
          <Panel id="regional-links" title="지역 연결" description="이 기사에서 프로젝트·지역 허브·다른 기사·공식 자료로 가는 연결입니다. 확인된 연결만 공개 화면에 나옵니다 (REG1-10).">
            <a className={TEXT_LINK} href={`/admin/regions/links?from=article:${id}`} data-testid="regional-links-link">
              이 기사의 지역 연결 열기
            </a>
          </Panel>
        )}
        <CorrectionsList view={view} />
        <ReviewHistory view={view} names={names} />
        <RevisionList view={view} />
      </div>
    </>
  );
}
