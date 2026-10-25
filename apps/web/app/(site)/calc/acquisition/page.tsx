import type { Metadata } from "next";
import { readPublicSettings } from "@/lib/server/public/reads";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { AcquisitionCause } from "@ltr/tax-engine";
import { AcquisitionCalculator } from "@/components/site/calc/AcquisitionCalculator";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { accuracyBadge } from "@/lib/calc/accuracy-view";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { causeGroupOf, causeOpen } from "@/lib/accuracy/gate";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { calcResultConsultHref } from "@/lib/site/next-step";
import { externalPair, isMemberNow, smAcquisitionPair } from "@/lib/server/public/calc-props";
import { BUNDLE_NOTICE } from "@/lib/server/public/ruleset-bundle-logic";
import { buildRegionLinks } from "@/lib/calc/admin-helpers";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { readRegions } from "@/lib/server/public/reads";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 취득세 계산기 (/calc/acquisition — CALC-01·11~13 · FAM-03·04·07). 상속·증여 전용 경로는 없다(원인 4종이 한 화면).
// 게이트(세목 기본 묶음)가 닫혔거나 활성 룰셋이 없거나 기능 키가 꺼져 있으면 404 - 그 세목은 /calc의 SM 카드가 맡는다. 계산은 브라우저에서만 한다.
export const metadata: Metadata = { title: pageTitle("취득세 계산"), description: "취득 원인·가액 등을 쉬운 질문으로 입력해 취득세를 계산합니다." };

const CAUSES: AcquisitionCause[] = ["PAID", "INHERITANCE", "GIFT", "ORIGINAL"];

export default async function AcquisitionPage() {
  await connection();
  const tools = await readPublic("취득세 계산기", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null || !tools.ruleset || toolLinkFor("acquisition", null, tools.context).kind !== "self") notFound();
  const open = Object.fromEntries(CAUSES.map((c) => [c, causeOpen(tools.gateRows, "acquisition", c, tools.engineHash)])) as Record<AcquisitionCause, boolean>;
  const badges = Object.fromEntries(CAUSES.map((c) => [c, accuracyBadge(tools.gateRows, "acquisition", causeGroupOf("acquisition", c), tools.engineHash)?.text ?? null])) as Record<AcquisitionCause, string | null>;
  return (
    <AcquisitionCalculator
      ruleset={tools.ruleset}
      regionLinks={buildRegionLinks(await readRegions().catch(() => []), isoToKstDate(new Date().toISOString()))}
      reductionTable={tools.reductionTable}
      causeOpen={open}
      badges={badges}
      wetax={tools.wetax}
      assumptions={{}}
      isMember={await isMemberNow()}
      consultHref={(await readPublicSettings()).features.expert_requests ? calcResultConsultHref("tax") : null}
      compareEnabled={tools.features.calc_compare}
      guideHref="/realestate/inheritance-gift"
      notice={tools.rulesetSource === "bundle" ? BUNDLE_NOTICE : null}
      external={externalPair(tools)}
      sm={smAcquisitionPair(tools)}
    />
  );
}
