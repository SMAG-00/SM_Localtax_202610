import type { Metadata } from "next";
import Link from "next/link";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, TEXT_LINK } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { loadRevenue } from "@/lib/server/store/board";
import { parseDays } from "@/lib/store/rules";

// 스토어 수익 대시보드 (/admin/store/revenue - W8, PRD-01C BIZ-09, docs/dev/W8_설계.md 11장).
// 상품 x 위치 x 출처 기사별 카드 누름·주문 링크 누름 수. 봇·편집국 세션 제외, 측정 거부 방문자는 저장되지 않아 실제보다 작게 나옵니다. 금액·공헌이익은 1단계에 없습니다(결제 없음).
export const metadata: Metadata = { title: "스토어 수익 대시보드" };
export const dynamic = "force-dynamic";

const PLACEMENT_LABEL = { article: "기사 하단", home: "홈", store: "스토어" } as const;

export default async function StoreRevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  requirePage(await pageViewer(), "product.manage");
  const sp = await searchParams;
  const daysRaw = Array.isArray(sp.days) ? sp.days[0] : sp.days;
  const report = await loadRevenue(serviceDb(), parseDays(daysRaw));
  return (
    <>
      <PageTitle title="스토어 수익 대시보드" description="상품별 카드 누름과 주문 링크(문의) 누름 수를 출처 기사별로 봅니다. 금액·공헌이익은 결제가 생기는 2단계에서 더합니다." />
      <div className="space-y-8">
        <Panel id="rv-range" title="기간">
          <p className="flex flex-wrap gap-4 text-[15px]" data-testid="rv-range">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/admin/store/revenue?days=${d}`} className={TEXT_LINK} aria-current={report.days === d ? "true" : undefined}>
                {report.days === d ? `최근 ${d}일 (보는 중)` : `최근 ${d}일`}
              </Link>
            ))}
            <Link href="/admin/store" className={TEXT_LINK}>
              스토어 관리로
            </Link>
          </p>
        </Panel>
        <Panel id="rv-totals" title="상품별 합계">
          {report.totals.length === 0 ? (
            <EmptyNote>이 기간의 누름 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="상품별 누름 합계" head={["상품", "카드 누름", "주문 링크 누름"]}>
              {report.totals.map((t) => (
                <tr key={t.product_id} data-product-id={t.product_id}>
                  <td className={TD}>{t.product_title}</td>
                  <td className={`${TD} ${MONO}`} data-col="card">{t.card_clicks}</td>
                  <td className={`${TD} ${MONO}`} data-col="order">{t.order_clicks}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
        <Panel id="rv-rows" title="위치·출처 기사별">
          {report.rows.length === 0 ? (
            <EmptyNote>이 기간의 누름 기록이 없습니다.</EmptyNote>
          ) : (
            <DataTable caption="위치·출처 기사별 누름" head={["상품", "위치", "출처 기사", "카드 누름", "주문 링크 누름"]}>
              {report.rows.map((r, i) => (
                <tr key={i} data-product-id={r.product_id} data-placement={r.placement}>
                  <td className={TD}>{r.product_title}</td>
                  <td className={TD}>{PLACEMENT_LABEL[r.placement]}</td>
                  <td className={TD}>{r.article_id === null ? "-" : `${r.article_id} ${r.article_title ?? ""}`}</td>
                  <td className={`${TD} ${MONO}`} data-col="card">{r.card_clicks}</td>
                  <td className={`${TD} ${MONO}`} data-col="order">{r.order_clicks}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      </div>
    </>
  );
}
