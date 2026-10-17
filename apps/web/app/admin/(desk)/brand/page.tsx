import type { Metadata } from "next";
import { OperationsPlaceholder } from "@/components/admin/OperationsPlaceholder";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";

// 브랜드 관리 (/admin/brand) — 브랜드 관리 담당·관리자만. 화면은 01C 브랜드 작업(BR)에서 만든다
export const metadata: Metadata = { title: "브랜드 관리" };

export default async function BrandPage() {
  requirePage(await pageViewer(), "brand.manage");
  return <OperationsPlaceholder title="브랜드 관리" work="브랜드 작업(PRD-01C BR)" note="인물 페이지·표준 약력·증빙·동의 기록" />;
}
