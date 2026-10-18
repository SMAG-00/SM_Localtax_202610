import type { Metadata } from "next";
import { PageTitle } from "@/components/admin/ui";
import { QueryTermsLoadError, QueryTermsView } from "@/components/admin/QueryTermsView";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { loadQueryTermsReport, type QueryTermsReport } from "@/lib/server/analytics/query-terms";
import { serviceDb } from "@/lib/server/articles/service";

// 검색어 집계 (/admin/query-terms — SRCH-03, docs/dev/W2-d_설계.md 8.3) — 편집 책임자·관리자(query_terms.read). 그 밖의 역할은 403 화면.
// 기간: ?days=7|30|90(기본 7) 또는 ?from=YYYY-MM-DD&to=YYYY-MM-DD (한국 날짜). 화면을 열 때마다 날 행을 다시 더한다. 검색어 원문은 어디에도 없다.
export const metadata: Metadata = { title: "검색어" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function QueryTermsPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "query_terms.read");
  const q = await searchParams;
  const pick = (k: string) => queryValue(q[k]).trim() || undefined;
  let report: QueryTermsReport | null = null;
  let failed: string | null = null;
  try {
    report = await loadQueryTermsReport(serviceDb(), { days: pick("days"), from: pick("from"), to: pick("to") }, new Date());
  } catch (err) {
    console.error("[admin/query-terms] 검색어 집계 읽기 실패:", err instanceof Error ? err.message : "알 수 없는 오류");
    failed = "검색어 집계를 읽지 못했습니다 — 잠시 뒤 다시 열어 주세요.";
  }

  return (
    <>
      <PageTitle
        title="검색어"
        description="독자가 사이트 검색에서 많이 찾은 말입니다 (SRCH-03). 편집 기획에 참고하고, 다르게 부르는 말은 옆에서 동의어 사전에 더합니다."
      />
      {failed || !report ? <QueryTermsLoadError message={failed ?? ""} /> : <QueryTermsView report={report} />}
    </>
  );
}
