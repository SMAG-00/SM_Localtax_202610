import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { SeatBoard } from "@/components/site/OrgForms";
import { SiteSection } from "@/components/site/SiteSection";
import { getViewer } from "@/lib/server/dal";
import { HttpError } from "@/lib/server/http";
import { UUID_SHAPE } from "@/lib/server/org/logic";
import { featureOn, orgBoard } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";
import { pageTitle } from "@/lib/site/hub-view";

// 기관 관리자 좌석 화면 (/org/[id]/seats - W11-f PAY-04). 기관 관리자만 - 비로그인은 로그인으로, 관리자가 아니면 기관이 있는지도 알리지 않고 404.
// 기능 키 꺼짐 = 404. 확인표가 승인되지 않으면 초대 버튼이 없다. 요청마다 그린다(공유 캐시 0).
export const metadata: Metadata = { title: pageTitle("기관 좌석 관리"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SeatsRoute({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const db = adminClient();
  if (!db || !UUID_SHAPE.test(id) || !(await featureOn(db, "institution_subscription"))) notFound();
  let userId: string | null = null;
  try {
    userId = (await getViewer())?.userId ?? null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  if (!userId) redirect(`/login?next=/org/${id}/seats`);
  const board = await orgBoard(db, userId, id);
  if (!board) notFound();
  return (
    <div data-ui="org-seats">
      <SiteSection id="org-seats" tone="ivory" first heading={{ eyebrow: "ORGANIZATION", title: board.org.name }} data={{ "data-org-part": "seats" }}>
        <SeatBoard board={board} />
      </SiteSection>
    </div>
  );
}
