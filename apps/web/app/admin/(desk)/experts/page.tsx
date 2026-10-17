import type { Metadata } from "next";
import { OperationsPlaceholder } from "@/components/admin/OperationsPlaceholder";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";

// 전문가 등재 (/admin/experts) — 전문가 담당·관리자만. 화면은 01C W7c(전문가)에서 만든다
export const metadata: Metadata = { title: "전문가 등재" };

export default async function ExpertsPage() {
  requirePage(await pageViewer(), "expert.manage");
  return <OperationsPlaceholder title="전문가 등재" work="전문가 작업(PRD-01C W7c)" note="전문가 등재·자격 검증·연락 요청 처리" />;
}
