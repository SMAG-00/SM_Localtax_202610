import type { Metadata } from "next";
import { SituationForm } from "@/components/admin/SituationForm";
import { PageTitle } from "@/components/admin/ui";
import { emptySituationForm } from "@/lib/admin/situation-rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";

// 새 상황 카드 (/admin/situations/new — UX-05) — 기자·편집 책임자·관리자. 만든 상황은 비공개로 시작하고, 세무 감수 서명 뒤 편집 책임자가 공개한다.
export const metadata: Metadata = { title: "새 상황 카드" };

export default async function NewSituationPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "situation.edit");
  return (
    <>
      <PageTitle title="새 상황 카드" description="비공개로 만들어집니다. 세무 감수 서명을 받은 뒤 편집 책임자가 공개하고 허브에 넣습니다." />
      <SituationForm mode="create" initial={emptySituationForm()} />
    </>
  );
}
