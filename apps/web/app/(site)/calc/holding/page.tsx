import type { Metadata } from "next";
import { readPublicSettings } from "@/lib/server/public/reads";
import { calcResultConsultHref } from "@/lib/site/next-step";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { HoldingCalculator } from "@/components/site/calc/HoldingCalculator";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { accuracyBadge } from "@/lib/calc/accuracy-view";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { groupOpen } from "@/lib/accuracy/gate";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { BUNDLE_NOTICE } from "@/lib/server/public/ruleset-bundle-logic";
import { buildRegionLinks } from "@/lib/calc/admin-helpers";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { readRegions } from "@/lib/server/public/reads";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 재산세·종합부동산세 계산기 (/calc/holding — CALC-02). 두 세목을 따로 공개한다: 하나라도 열려 있어야 이 화면이 열리고, 닫힌 세목의 금액은 만들지 않는다.
export const metadata: Metadata = { title: pageTitle("재산세·종합부동산세 계산"), description: "공시가격 등을 쉬운 질문으로 입력해 재산세·종합부동산세를 계산합니다." };

export default async function HoldingPage() {
  await connection();
  const tools = await readPublic("보유세 계산기", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null || !tools.ruleset || toolLinkFor("holding", null, tools.context).kind !== "self") notFound();
  const open = { property: groupOpen(tools.gateRows, "property", "ALL", tools.engineHash), comprehensive: groupOpen(tools.gateRows, "comprehensive", "ALL", tools.engineHash) };
  const badge = (t: "property" | "comprehensive") => accuracyBadge(tools.gateRows, t, "ALL", tools.engineHash)?.text ?? null;
  return <HoldingCalculator ruleset={tools.ruleset} consultHref={(await readPublicSettings()).features.expert_requests ? calcResultConsultHref("tax") : null}
      regionLinks={buildRegionLinks(await readRegions().catch(() => []), isoToKstDate(new Date().toISOString()))} open={open} badges={{ property: badge("property"), comprehensive: badge("comprehensive") }} wetax={tools.wetax} assumptions={{}} notice={tools.rulesetSource === "bundle" ? BUNDLE_NOTICE : null} wetaxScreen={open.property ? "property" : "comprehensive"} />;
}
