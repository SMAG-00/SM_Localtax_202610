import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { PageTitle } from "@/components/admin/ui";
import { SeoView } from "@/components/admin/SeoView";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadSeoOverview, type SeoOverview } from "@/lib/server/seo/admin";

// 검색 최적화 (/admin/seo - OPT-01·07·08·09, docs/dev/W7_설계.md) - 편집 책임자·관리자(seo.read). 그 밖의 역할은 403 화면.
// ?month=YYYY-MM - AI 검색 표본으로 볼 달(기본 직전 완결 달)
export const metadata: Metadata = { title: "검색 최적화" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SeoPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "seo.read");
  const q = await searchParams;
  let data: SeoOverview | null = null;
  let failed: string | null = null;
  try {
    data = await loadSeoOverview(serviceDb(), new Date(), { month: queryValue(q.month).trim() || undefined });
  } catch (err) {
    console.error("[admin/seo] 읽기 실패:", err instanceof Error ? err.message : "알 수 없는 오류");
    failed = "검색 최적화 화면을 읽지 못했습니다 - 잠시 뒤 다시 열어 주세요.";
  }
  return (
    <>
      <PageTitle title="검색 최적화" description="색인 전환 점검, 법령 개정 신선도 검수, AI 검색 인용 표본을 한곳에서 봅니다 (OPT-01·07·08·09)." />
      {failed || !data ? (
        <Callout>
          <span data-part="load-error">{failed}</span>
        </Callout>
      ) : (
        <SeoView data={data} />
      )}
    </>
  );
}
