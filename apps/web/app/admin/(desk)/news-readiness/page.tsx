import type { Metadata } from "next";
import Link from "next/link";
import { Callout } from "@ltr/ui";
import { OUTLINE_BUTTON, PageTitle } from "@/components/admin/ui";
import { ReadinessView } from "@/components/admin/ReadinessView";
import { ReadinessMonthlyView } from "@/components/admin/ReadinessMonthlyView";
import { READINESS_NOTICE, REQUIREMENTS_PATH } from "@/lib/admin/readiness-view";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadReadinessDashboard, type ReadinessDashboard } from "@/lib/server/readiness/dashboard";
import { loadRecordsBoard, type RecordsBoard } from "@/lib/server/readiness/monthly";

// 기사 생산·제휴 준비 대시보드 (/admin/news-readiness — NAV-13 · NAV-14, PRD-01A 3장 '편집 책임자·관리자만', docs/dev/W2-c_설계.md 8.5).
// 3·6·12개월(설정 news_readiness_windows) 기간마다 공식 정의(확정된 규정 버전)와 내부 정의 숫자를 따로 보인다. 확정 버전이 없으면 '요건 미확정'.
// ?window=3|6|12 — 기사별 추적 표의 기간. 화면을 열 때마다 원본 표에서 다시 센다.
export const metadata: Metadata = { title: "기사 생산·제휴 준비" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewsReadinessPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "readiness.read");
  const q = await searchParams;
  let dash: ReadinessDashboard | null = null;
  let failed: string | null = null;
  let board: RecordsBoard | null = null;
  let boardFailed = false;
  try {
    board = await loadRecordsBoard(serviceDb(), new Date());
  } catch (err) {
    console.error("[admin/news-readiness] 월 마감·기록 읽기 실패:", err instanceof Error ? err.message : "알 수 없는 오류");
    boardFailed = true;
  }
  try {
    dash = await loadReadinessDashboard(serviceDb(), { window: queryValue(q.window) || undefined }, new Date());
  } catch (err) {
    console.error("[admin/news-readiness] 대시보드 읽기 실패:", err instanceof Error ? err.message : "알 수 없는 오류");
    failed = "대시보드 숫자를 읽지 못했습니다 — 잠시 뒤 다시 열어 주세요.";
  }

  return (
    <>
      <PageTitle
        title="기사 생산·제휴 준비"
        description="3·6·12개월 기사 생산과 근거·권리·감수·정정·유사도 경고·독자 반응을 봅니다. 공식 규정 정의와 편집국 내부 정의를 따로 셉니다 (NAV-13·14)."
      >
        <Link href={REQUIREMENTS_PATH} className={OUTLINE_BUTTON}>
          제휴 규정 버전
        </Link>
      </PageTitle>
      <Callout className="mb-6">
        <span data-part="notice">{READINESS_NOTICE}</span>
      </Callout>
      {failed || !dash ? (
        <Callout>
          <span data-part="load-error">{failed}</span>
        </Callout>
      ) : (
        <ReadinessView dash={dash} />
      )}
      {boardFailed || !board ? (
        <Callout className="mt-8">
          <span data-part="monthly-load-error">월 마감 지표와 기록을 읽지 못했습니다 - 잠시 뒤 다시 열어 주세요.</span>
        </Callout>
      ) : (
        <ReadinessMonthlyView board={board} />
      )}
    </>
  );
}
