import type { Metadata } from "next";
import { randomBytes } from "node:crypto";
import { forbidden, notFound } from "next/navigation";
import { NewArticleForm } from "@/components/admin/NewArticleForm";
import { PageTitle } from "@/components/admin/ui";
import { idOrNull } from "@/lib/admin/form-utils";
import { isTemplateId, suggestSlug, templateById, templateForMethod, templatesFor } from "@/lib/admin/templates";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { listCategories, listPartners, loadAssignment } from "@/lib/server/admin/queries";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";

// 새 기사 (/admin/articles/new) — 템플릿 5종(정량형 보도·정성형 보도·세법 해설·해결 사례·광고·협찬). 광고·협찬은 광고 담당만.
// ?assignment=<기획 번호>면 그 기획의 분야·취재 방식으로 시작하고 기사를 기획에 잇는다 ("이 기획으로 기사 쓰기")
export const metadata: Metadata = { title: "새 기사" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewArticlePage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "article.create");
  const templates = templatesFor(viewer);
  if (templates.length === 0) forbidden();

  const sp = await searchParams;
  const db = serviceDb();
  const assignmentId = idOrNull(queryValue(sp.assignment));
  let assignment = null;
  if (assignmentId !== null) {
    requirePage(viewer, "assignment.read");
    assignment = await loadAssignment(db, assignmentId);
    if (!assignment) notFound();
  }
  const fromMethod = assignment ? templateForMethod(assignment.method) : null;
  const requested = queryValue(sp.template);
  const wanted = isTemplateId(requested) ? requested : fromMethod?.templateId;
  // 기본은 세법 해설 — 전문기자·회계사·세무사가 쓰는 글이 대부분이다 (간편 발행 2026-10-31). 기획·주소로 고른 템플릿이 있으면 그것
  const templateId = templates.find((t) => t.id === wanted)?.id ?? templates.find((t) => t.id === "explainer")?.id ?? templates[0]!.id;
  const template = templateById(templateId);
  const [categories, partners] = await Promise.all([listCategories(db), listPartners(db)]);

  return (
    <>
      <PageTitle title="새 기사" description="템플릿을 고르면 필요한 칸이 미리 놓입니다. 초안을 만든 뒤 편집 화면에서 채웁니다." />
      <NewArticleForm
        templates={templates}
        categories={categories}
        partners={partners}
        today={kstDate(nowIso())}
        assignment={assignment ? { id: assignment.id, hypothesis: assignment.hypothesis ?? "" } : null}
        initial={{
          templateId,
          title: "",
          slug: suggestSlug(new Date(), randomBytes(2).toString("hex")),
          summary: "",
          section: assignment?.section ?? template.defaultSection ?? "",
          categoryId: "",
          reportingMethod: fromMethod && template.contentType === "reported_news" ? fromMethod.reportingMethod : (template.reportingMethod ?? ""),
          legalBasisDate: "",
          label: template.needsLabel ? "" : "none",
          partnerId: "",
          storyAssignmentId: assignment?.id ?? null,
        }}
      />
    </>
  );
}
