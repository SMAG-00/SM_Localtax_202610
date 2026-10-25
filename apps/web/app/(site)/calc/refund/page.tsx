import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RefundDiagnosis } from "@/components/site/calc/RefundDiagnosis";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 환급 자가진단 (/calc/refund — CALC-04). 서명된(활성) 환급 판정표가 없으면 404 - 판정표 감수 서명 전에는 공개하지 않는다.
export const metadata: Metadata = { title: pageTitle("환급 자가진단"), description: "몇 가지 질문으로 돌려받을 수 있는 세금이 있는지 살펴봅니다." };

export default async function RefundPage() {
  await connection();
  const tools = await readPublic("환급 자가진단", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null || !tools.refundTable || toolLinkFor("refund", null, tools.context).kind !== "self") notFound();
  return <RefundDiagnosis table={tools.refundTable} wetax={tools.wetax} />;
}
