import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CompareCalculator } from "@/components/site/calc/CompareCalculator";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import type { CompareTax } from "@/lib/calc/compare";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { isMemberNow } from "@/lib/server/public/calc-props";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 시나리오 비교 (/calc/compare — CALC-05). 회원 전용 기능: 비회원은 첫 조건까지 입력해 볼 수 있고 [조건 바꿔 비교하기]에서 가입 안내를 본다.
// 공개 게이트를 통과한 세목만 열에 넣을 수 있다 - 열 수 있는 세목이 없으면 404.
export const metadata: Metadata = { title: pageTitle("조건 바꿔 비교"), description: "조건을 바꿔 두세 가지를 나란히 계산해 비교합니다." };

export default async function ComparePage() {
  await connection();
  const tools = await readPublic("시나리오 비교", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null || !tools.ruleset || !tools.features.calc_compare) notFound();
  const openTaxes: CompareTax[] = (["acquisition", "property"] as const).filter((t) => toolLinkFor(t, null, tools.context).kind === "self");
  if (openTaxes.length === 0) notFound();
  return <CompareCalculator ruleset={tools.ruleset} openTaxes={openTaxes} isMember={await isMemberNow()} />;
}
