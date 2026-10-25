import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AccuracyTable } from "@/components/site/calc/AccuracyTable";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { accuracyRows } from "@/lib/calc/accuracy-view";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 계산 정확도 검증 (/calc/accuracy — CALC-14 · FAM-07). 숫자는 마지막 대조 실행 결과(public_calc_gate 뷰)에서만 온다. 기능 키 calc_accuracy가 꺼져 있으면 404.
export const metadata: Metadata = { title: pageTitle("계산 정확도 검증"), description: "세목별·취득 원인별 공식 결과 대조 건수와 공개 상태입니다." };

export default async function AccuracyPage() {
  await connection();
  const tools = await readPublic("계산 정확도", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null || !tools.features.calc_accuracy) notFound();
  return <AccuracyTable rows={accuracyRows(tools.gateRows, tools.engineHash)} />;
}
