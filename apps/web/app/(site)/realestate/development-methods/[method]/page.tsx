import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { DevMethodDetail } from "@/components/site/DevMethodsView";
import { PlacedGuides } from "@/components/site/tax-guide/PlacedGuides";
import { IssueMapEntry, StageTimeline } from "@/components/site/tax-guide/TaxEntries";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getDevMethod } from "@/lib/server/public/dev-methods";
import { DEV_METHODS_TITLE, isMethodSlug, projectTypeKeys } from "@/lib/server/public/dev-methods-logic";
import { pageTitle } from "@/lib/site/hub-view";

// 개발방법 상세 (/realestate/development-methods/[method] — W4 19단계 · PR-09). 기능 키가 꺼져 있거나 공개 전·모르는 방법·모양 밖 주소면 404.
const load = cache(async (slug: string) => {
  await connection();
  if (!isMethodSlug(slug)) return null;
  return readPublic("개발방법 상세", () => getDevMethod(slug), () => UNAVAILABLE);
});

export async function generateMetadata({ params }: { params: Promise<{ method: string }> }): Promise<Metadata> {
  const view = await load((await params).method);
  if (!view || isUnavailable(view)) return { title: pageTitle(DEV_METHODS_TITLE) };
  return { title: pageTitle(view.method.name), description: view.method.summary };
}

export default async function Page({ params }: { params: Promise<{ method: string }> }) {
  const view = await load((await params).method);
  if (view === null || isUnavailable(view)) notFound();
  // W11-c c5 (RDV-01·02·03): 3단계 세금 칸 - 단계 타임라인·방법별 세금 가이드. 서명·기능 키가 없으면 아무것도 그리지 않는다
  return (
    <>
      <DevMethodDetail view={view} />
      <StageTimeline methodSlug={view.method.slug} projectTypes={projectTypeKeys(view.method)} />
      <PlacedGuides surface="dev_method" targetKey={view.method.slug} id="dev-method-tax" heading={{ eyebrow: "정비 세금", title: "이 사업 방식의 세금" }} />
      <div className="mx-auto max-w-5xl px-4 pb-10">
        <IssueMapEntry hub="redevelopment" />
      </div>
    </>
  );
}
