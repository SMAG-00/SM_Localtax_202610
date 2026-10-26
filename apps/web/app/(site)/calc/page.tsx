import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalcHub } from "@/components/site/calc/CalcHub";
import { ownCardState } from "@/components/site/igt/OwnCards";
import { ComingSoon } from "@/components/site/ComingSoon";
import { OfficialLinkCard, linkSiteLabel } from "@/components/site/OfficialLinkCard";
import { getCalcClosedView } from "@/lib/server/public/calc";
import { shortcutLabel } from "@/lib/server/public/shortcuts-logic";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { visibleGuides } from "@/lib/calc/guide";
import { toolLinkFor } from "@/lib/calc/tool-link";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getCalcTools } from "@/lib/server/public/calc-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 계산기 허브 (/calc — TX-01·FAM-08 · W10-b TX-04). 세목마다 카드는 정확히 1장: 게이트를 통과한 세목은 자체 계산기, 아닌 세목은 SM 연결 카드, 상속·증여는 외부 카드.
// 어느 쪽인지는 toolLinkFor 하나가 공개 게이트 뷰에서 계산한다(수동 켜기 경로 0). 기능 키 calc가 꺼져 있으면 404. 요청 때 그린다 - 주소·점검 상태·게이트는 배포 없이 바뀐다.
export const metadata: Metadata = {
  title: pageTitle("세금 계산기"),
  description: "지방세 계산기와 별도 사이트 계산기 연결입니다.",
};

export default async function CalcPage() {
  await connection();
  const tools = await readPublic("세금 계산기", () => getCalcTools(), () => UNAVAILABLE);
  if (isUnavailable(tools)) return <CalcUnavailable />;
  if (tools === null) {
    // 바로가기(메뉴)가 켜져 있으면 계산기 키가 꺼져 있어도 404 대신 준비 중 안내 + (있으면) SM 계산기 카드 (PO 2026-10-26)
    const closed = await readPublic("세금 계산기 준비 중", () => getCalcClosedView(), () => UNAVAILABLE);
    if (isUnavailable(closed) || closed === null) notFound();
    return (
      <ComingSoon title={shortcutLabel("calc")} notice="계산기를 준비하고 있습니다." links={[{ href: "/", label: "홈으로 가기" }]}>
        {closed.sm.length > 0 && (
          <ul data-part="tool-cards" className="mt-8 grid gap-4 sm:grid-cols-2">
            {closed.sm.map((c, i) => (
              <OfficialLinkCard key={c.id} card={c} site={linkSiteLabel(c.kind)} fallbacks={closed.fallbacks} rank={i + 1} />
            ))}
          </ul>
        )}
      </ComingSoon>
    );
  }
  const ctx = tools.context;
  return (
    <CalcHub
      view={tools.links}
      acquisition={toolLinkFor("acquisition", null, ctx)}
      holding={toolLinkFor("holding", null, ctx)}
      refund={toolLinkFor("refund", null, ctx)}
      own={ownCardState(ctx)}
      compare={tools.features.calc_compare && (toolLinkFor("acquisition", null, ctx).kind === "self" || toolLinkFor("property", null, ctx).kind === "self")}
      accuracy={tools.features.calc_accuracy}
      rulesetVersion={tools.ruleset?.version ?? null}
      guides={visibleGuides(tools.guides)}
    />
  );
}
