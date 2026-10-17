import Link from "next/link";
import type { Metadata } from "next";
import { PlacementForm } from "@/components/admin/PlacementForm";
import { EmptyNote, PageTitle, TEXT_LINK } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { CONTENT_TYPE_LABELS, SECTION_LABELS, labelOf } from "@/lib/admin/labels";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { listPublished } from "@/lib/server/admin/queries";
import { serviceDb } from "@/lib/server/articles/service";

// 기사 배치 (/admin/placement) — 발행 기사의 HOT 고정·뉴스 전송 후보. 편집 책임자만 (편집국 외 역할·기자는 403, API도 403 + 감사 로그)
export const metadata: Metadata = { title: "기사 배치" };

export default async function PlacementPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "article.sort");
  const rows = await listPublished(serviceDb());
  const canHot = can(viewer, "article.hot");
  return (
    <>
      <PageTitle title="기사 배치" description="발행한 기사의 HOT 고정과 뉴스 전송 후보를 정합니다. 홈의 개정 트래커 하이라이트·해설 스토리는 홈 배치 화면(/admin/home)에서 정합니다." />
      {rows.length === 0 && <EmptyNote>발행한 기사가 없습니다.</EmptyNote>}
      <ul className="space-y-4">
        {rows.map((a) => (
          <li key={a.id} data-testid={`placement-${a.id}`} className="rounded-2xl border border-navy-100 bg-white p-6">
            <Link href={`/admin/articles/${a.id}`} className={`${TEXT_LINK} text-[17px] [overflow-wrap:anywhere]`}>
              {a.title}
            </Link>
            <p className="text-[14px] text-navy-600">
              {labelOf(SECTION_LABELS, a.section)} · {labelOf(CONTENT_TYPE_LABELS, a.content_type)} · 발행 {isoToKstDateTime(a.first_published_at)}
            </p>
            <div className="mt-3">
              <PlacementForm
                articleId={a.id}
                hotPinUntil={a.hot_pin_until}
                navCandidate={a.nav_candidate}
                canHot={canHot}
                navAllowed={a.content_type === "reported_news" && a.editorial_status === "approved"}
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
