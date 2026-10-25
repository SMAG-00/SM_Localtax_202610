import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AcceptPanel } from "@/components/site/OrgForms";
import { SiteSection } from "@/components/site/SiteSection";
import { getViewer } from "@/lib/server/dal";
import { HttpError } from "@/lib/server/http";
import { TOKEN_SHAPE } from "@/lib/server/org/logic";
import { featureOn } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";
import { pageTitle } from "@/lib/site/hub-view";

// 좌석 초대 수락 (/org/accept?token= - W11-f PAY-04). 로그인한 회원만. 토큰 모양이 아니면 404. 수락 판정(확인표·계약·만료)은 누르는 순간 서버 DB 함수가 한다.
export const metadata: Metadata = { title: pageTitle("기관 좌석 초대 수락"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AcceptRoute({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await connection();
  const { token } = await searchParams;
  const db = adminClient();
  if (!db || typeof token !== "string" || !TOKEN_SHAPE.test(token) || !(await featureOn(db, "institution_subscription"))) notFound();
  let userId: string | null = null;
  try {
    userId = (await getViewer())?.userId ?? null;
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
  }
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/org/accept?token=${token}`)}`);
  return (
    <div data-ui="org-accept">
      <SiteSection id="org-accept" tone="ivory" first heading={{ eyebrow: "ORGANIZATION", title: "기관 좌석 초대" }} data={{ "data-org-part": "accept" }}>
        <AcceptPanel token={token} />
      </SiteSection>
    </div>
  );
}
