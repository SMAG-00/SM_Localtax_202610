import type { Metadata } from "next";
import { briefOpen } from "@/lib/server/auth-guard";
import { adminClient } from "@/lib/server/supabase";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ComingSoon } from "@/components/site/ComingSoon";
import { ExpertRequestPageView } from "@/components/site/ExpertViews";
import { readPublicSettings } from "@/lib/server/public/reads";
import { shortcutLabel } from "@/lib/server/public/shortcuts-logic";
import type { SearchParams } from "@/components/site/routes";
import { UnavailablePage } from "@/components/site/Unavailable";
import { REQUEST_SOURCES } from "@/lib/experts/logic";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getExpertRequestForm } from "@/lib/server/public/experts";
import { pageTitle, queryValue } from "@/lib/site/hub-view";

// SM 전문가 연락 요청 양식 (/experts/request - W7c EXPL-13). 기능 키 expert_requests 꺼짐은 404(빈 링크 0). 개인 정보가 들어가는 화면이라 색인하지 않는다.
// 진입 출처는 ?source=(assistant·experts·article·calc_result·campaign·shortcut) - 모르는 값은 experts
export const metadata: Metadata = { title: pageTitle("SM 전문가 연락 요청"), robots: { index: false, follow: false } };

export default async function ExpertRequestPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("전문가 연락 요청 양식", () => getExpertRequestForm(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) {
    // 바로가기(메뉴)가 켜져 있으면 양식이 아직 닫혀 있어도 404 대신 준비 중 안내 (PO 2026-10-26)
    const features = (await readPublicSettings()).features;
    if (!features.shortcuts) notFound();
    return (
      <ComingSoon
        title={shortcutLabel("expert_request")}
        notice="상담 요청 접수를 준비하고 있습니다."
        links={features.experts ? [{ href: "/experts", label: "전문가 소개 보기" }, { href: "/", label: "홈으로 가기" }] : [{ href: "/", label: "홈으로 가기" }]}
      />
    );
  }
  const source = queryValue(sp.source) ?? "";
  const admin = adminClient();
  const subscribeOpen = admin ? await briefOpen(admin).catch(() => false) : false;
  return (
    <ExpertRequestPageView
      view={view}
      subscribeOpen={subscribeOpen}
      source={(REQUEST_SOURCES as readonly string[]).includes(source) ? source : "experts"}
      query={{ sent: queryValue(sp.sent), e: queryValue(sp.e), field: queryValue(sp.field), withdrawn: queryValue(sp.withdrawn) }}
    />
  );
}
