import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ExpertCalculator } from "@/components/site/calc/expert/ExpertCalculator";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getExpertPage } from "@/lib/server/public/expert-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 전문가 계산기 (과점주주 간주취득세 - W13-f). 기능 키·공개 게이트·룰셋·고정 안내 문구 중 하나라도 없으면 404. 계산은 브라우저에서만 하고 입력값은 저장·전송하지 않는다.
export const metadata: Metadata = { title: pageTitle("과점주주 간주취득세"), description: "입력한 값은 저장되지 않으며 계산은 이 화면 안에서만 이루어집니다." };

export default async function Page() {
  await connection();
  const page = await readPublic("과점주주 간주취득세", () => getExpertPage("oligopoly"), () => UNAVAILABLE);
  if (isUnavailable(page)) return <CalcUnavailable />;
  if (page === null) notFound();
  return <ExpertCalculator page={page} />;
}
