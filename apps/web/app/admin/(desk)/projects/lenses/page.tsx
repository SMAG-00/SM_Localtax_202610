import type { Metadata } from "next";
import Link from "next/link";
import { StageLensItem } from "@/components/admin/ProjectLensControls";
import { EmptyNote, PageTitle, Panel, TEXT_LINK } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { lensBoard } from "@/lib/admin/project-lens-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadProjectSettings } from "@/lib/server/projects/board";
import { loadLensRows } from "@/lib/server/projects/lenses";

// 단계별 「지방세로 읽기」 템플릿 (/admin/projects/lenses — W4 16단계, PRD-01B PR-08 · 7장 4 '편집국 초안 → PO 서명').
// 사업 유형 × 단계마다 템플릿 하나 — 그 유형을 쓰는 모든 프로젝트의 그 단계에 같은 박스가 붙는다. 편집 책임자·관리자는 초안을 쓰고(project.manage),
// 세무 감수위원은 서명한다(review.tax_review). 서명 전·재감수 필요 템플릿은 공개 화면에 박스가 없다('준비 중' 0).
export const metadata: Metadata = { title: "단계별 지방세로 읽기" };
export const dynamic = "force-dynamic";

export default async function ProjectLensesPage() {
  const viewer = await pageViewer();
  requirePage(viewer, ["project.manage", "review.tax_review"]);
  const db = serviceDb();
  const settings = await loadProjectSettings(db);
  const board = lensBoard(settings.types, settings.lists, await loadLensRows(db));
  const canEdit = can(viewer, "project.manage");
  const canReview = can(viewer, "review.tax_review");
  return (
    <>
      <PageTitle
        title="단계별 「지방세로 읽기」"
        description="사업 유형 × 단계 템플릿입니다. 세목·핵심 포인트 3줄까지·해설·도서·전문가 링크·법령 기준일이 필요하고, 세액·감면 단정은 쓰지 않습니다. 세무 감수 서명 뒤에만 공개되고, 고치면 서명이 지워집니다(재감수 필요)."
      >
        {canEdit && (
          <Link className={TEXT_LINK} href="/admin/projects">
            프로젝트 목록으로
          </Link>
        )}
      </PageTitle>
      <div className="space-y-8" data-testid="lens-board">
        {board.length === 0 ? (
          <EmptyNote>사업 유형·단계 목록이 아직 없습니다 — 운영 설정 project_types·project_stage_lists가 들어오면 단계마다 템플릿을 씁니다.</EmptyNote>
        ) : (
          board.map((t) => (
            <Panel key={t.key} id={`lens-type-${t.key}`} title={t.label} description={`사업 유형 ${t.key} — 단계 ${t.stages.length}개`}>
              <ol className="space-y-4">
                {t.stages.map((s) => (
                  <StageLensItem key={s.key} projectType={t.key} stage={s.key} stageLabel={s.label} row={s.row} canEdit={canEdit} canReview={canReview} />
                ))}
              </ol>
            </Panel>
          ))
        )}
      </div>
    </>
  );
}
