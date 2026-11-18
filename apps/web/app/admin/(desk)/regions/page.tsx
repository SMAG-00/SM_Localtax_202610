import { redirect } from "next/navigation";

// 지역 기사 판정판(별도 상품 검토 큐·편집 분야 승인 대기·보류)은 2026-11-18 PO 결정으로 걷어냈다 — 지자체뉴스는 지자체뉴스일 뿐이다.
// 옛 주소(/admin/regions)는 남은 지역 화면인 시범 지역 최소선 리포트로 보낸다.
export const dynamic = "force-dynamic";

export default function RegionsPage(): never {
  redirect("/admin/regions/report");
}
