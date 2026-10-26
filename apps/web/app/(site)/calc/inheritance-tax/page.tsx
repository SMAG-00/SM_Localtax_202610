import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IgtCalculator } from "@/components/site/igt/IgtCalculator";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { getIgtTool } from "@/lib/igt/tools";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 상속세 계산 (/calc/inheritance-tax — FAM-11). 기능 키가 꺼져 있거나 상속 게이트가 닫혀 있거나 서명된 활성 룰셋이 없으면 404 - 외부 계산기 카드가 그대로 남는다.
// 증여 게이트와 따로 판정한다. 계산은 브라우저에서만 한다(서버 계산 API 없음). 가족관계·상속재산 입력은 저장·전송하지 않는다.
export const metadata: Metadata = { title: pageTitle("상속세 계산"), description: "상속받은 재산의 상속세를 이 화면 안에서 계산해 봅니다. 입력한 값은 저장되지 않습니다." };

export default async function InheritanceTaxPage() {
  await connection();
  const tool = await readPublic("상속세 계산", () => getIgtTool("inheritance"), () => UNAVAILABLE);
  if (isUnavailable(tool)) return <CalcUnavailable />;
  if (tool === null) notFound();
  return <IgtCalculator kind="inheritance" ruleset={tool.ruleset} rulesetVersion={tool.rulesetVersion} engineHash={tool.engineHash} />;
}
