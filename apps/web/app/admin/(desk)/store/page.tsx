import type { Metadata } from "next";
import { OperationsPlaceholder } from "@/components/admin/OperationsPlaceholder";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";

// 스토어·구독 (/admin/store) — 스토어·구독 담당·관리자만. 화면은 01C W8(스토어·광고·수익)에서 만든다
export const metadata: Metadata = { title: "스토어·구독" };

export default async function StorePage() {
  requirePage(await pageViewer(), "product.manage");
  return <OperationsPlaceholder title="스토어·구독" work="스토어·광고·수익 작업(PRD-01C W8)" note="자사 상품·주문 경로·구독 운영" />;
}
