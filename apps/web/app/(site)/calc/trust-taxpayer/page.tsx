import type { Metadata } from "next";
import { connection } from "next/server";
import { DeterminationPage } from "@/components/site/tax-guide/DeterminationPage";
import { pageTitle } from "@/lib/site/hub-view";

// 신탁 보유세 납세의무자 판정 도우미 (/calc/trust-taxpayer — TRU-03). 판정표 trust_taxpayer(감수 서명 + 승인)가 활성이고 기능 키 trust_tax_guide가 켜졌을 때만 열린다.
// /calc/project-tax의 신탁 보유세 판정과 같은 판정표·같은 함수라 같은 사실 → 같은 결론·같은 판정표 버전이다.
export const metadata: Metadata = { title: pageTitle("신탁 보유세 납세의무자 판정"), description: "신탁 부동산의 보유세 납세의무자를 몇 가지 질문으로 살펴봅니다." };

export default async function Page() {
  await connection();
  return <DeterminationPage title="신탁 보유세 납세의무자 판정" intro="질문에 답하면 판정표에 따라 납세의무자와 물적납세의무 해당 여부를 알려 드립니다. 모르는 항목은 모르겠어요를 고르세요." allowedTypeIds={["trust_holding"]} />;
}
