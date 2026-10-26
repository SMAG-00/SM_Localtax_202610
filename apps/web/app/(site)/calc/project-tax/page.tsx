import type { Metadata } from "next";
import { connection } from "next/server";
import { DeterminationPage } from "@/components/site/tax-guide/DeterminationPage";
import type { SearchParams } from "@/components/site/routes";
import { PROJECT_TAX_TYPES } from "@/lib/tax-guide/determination-run";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// 정비·신탁 세금 판정 (/calc/project-tax — PR-12). 판정 종류 6가지(정비 4·신탁 2) 중 활성 판정표가 있는 것만 고른다. 없으면 404.
// ?type=<판정 종류>&stage=<단계 값>은 값 목록 검사를 거친 단계·종류만 미리 채운다 (프로젝트 ID·입력값은 받지 않음).
export const metadata: Metadata = { title: pageTitle("정비·신탁 세금 판정"), description: "정비사업 단계와 신탁 이전·보유 상황의 지방세 처리를 판정표로 살펴봅니다." };

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  return (
    <DeterminationPage
      title="정비·신탁 세금 판정"
      intro="판정 종류를 고르고 질문에 답하면 판정표에 따른 지방세 처리를 알려 드립니다. 금액이 필요하면 지방세 계산기를 이용하세요."
      allowedTypeIds={PROJECT_TAX_TYPES.map((t) => t.id)}
      type={queryValue(sp.type)}
      stage={queryValue(sp.stage)}
    />
  );
}
