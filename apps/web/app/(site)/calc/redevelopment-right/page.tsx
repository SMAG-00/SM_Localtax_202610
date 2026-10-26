import type { Metadata } from "next";
import { connection } from "next/server";
import { UiLink } from "@ltr/ui";
import { DeterminationPage } from "@/components/site/tax-guide/DeterminationPage";
import { pageTitle } from "@/lib/site/hub-view";

// 입주권 취득세 (/calc/redevelopment-right — RDV-04). 승계취득의 과세 대상(멸실 전·후)을 판정표 redevelopment_right로 살펴보고,
// 금액이 필요하면 취득세 계산기(조합원 경로 membershipDetail)로 잇는다. 이 화면은 세액을 만들지 않으며 새 세법 코드가 없다.
export const metadata: Metadata = { title: pageTitle("입주권 취득세"), description: "입주권 승계취득의 과세 대상을 살펴보고 취득세 계산기로 이어갑니다." };

export default async function Page() {
  await connection();
  return (
    <DeterminationPage title="입주권 취득세" intro="입주권을 승계취득할 때 과세 대상이 되는지 판정표로 살펴봅니다. 금액은 취득세 계산기에서 확인하세요." allowedTypeIds={["right_succession"]}>
      <p className="mt-8 text-[15px] text-navy-800" data-part="to-calculator">
        <UiLink href="/calc/acquisition" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
          취득세 계산기로 이동
        </UiLink>
      </p>
    </DeterminationPage>
  );
}
