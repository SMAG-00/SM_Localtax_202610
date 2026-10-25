import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { InquiryForm } from "@/components/site/OrgForms";
import { SiteSection } from "@/components/site/SiteSection";
import { featureOn } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";
import { pageTitle } from "@/lib/site/hub-view";

// 기관 구독 안내·견적 요청 (/store/institution - W11-f BIZ-07). 기능 키 institution_subscription·institution_inquiry가 모두 켜져야 열린다(꺼짐 = 404).
// 가격·계약 조건·보안 안내 문구는 이 화면에 없다 - 계약서·확인표는 PO·법률이 정하는 빈 칸이고, 이 화면은 견적 요청만 받는다. 기관 결제 화면은 없다.
export const metadata: Metadata = { title: pageTitle("기관 구독 견적 요청"), robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InstitutionRoute() {
  await connection();
  const db = adminClient();
  if (!db) notFound();
  const [subscription, inquiry] = await Promise.all([featureOn(db, "institution_subscription"), featureOn(db, "institution_inquiry")]);
  if (!subscription || !inquiry) notFound();
  return (
    <div data-ui="institution-page">
      <SiteSection id="institution-inquiry" tone="ivory" first heading={{ eyebrow: "INSTITUTION", title: "기관 구독 견적 요청" }} data={{ "data-store-part": "institution" }}>
        <InquiryForm />
      </SiteSection>
    </div>
  );
}
