import type { Metadata } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { Footer } from "@ltr/ui";
import { maskEmailForDisplay } from "@/lib/policy/email";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteLinkProvider } from "@/components/site/SiteLinkProvider";
import { AssistantMount } from "@/components/site/AssistantMount";
import { PathBreadcrumbJsonLd } from "@/components/site/PathBreadcrumbJsonLd";
import { siteIndexing, siteUrl } from "@/lib/server/env";
import { defaultRobots } from "@/lib/seo/robots-meta";
import { closedChrome, getSiteChrome, readPublic, type SiteChrome } from "@/lib/server/public";
import { FOOTER_DISCLAIMER, footerLinks, headerSubmenus, headerUtilityKeys } from "@/lib/site/chrome-view";

// 공개 화면 틀 (HOME-02 · HELP-05 · FND-09 · UX-06) — 건너뛰기 링크 · 헤더(상단 4대 분야와 하위 메뉴 + 공개 승인된 유틸 메뉴) · 본문 · 바닥글(공개 승인된 정책 링크).
//  · 사이트 안 링크는 Next.js 링크(새로고침 없는 화면 전환). 백오피스(/admin)·견본(/_design)은 이 틀 밖이라 공개 헤더·바닥글이 없다.
//  · 요청 때 그린다 — 빌드 때 DB를 읽지 않는다(Docker·CI 빌드에는 DB 접속값이 없다). 검색 노출 차단(noindex)은 루트 레이아웃 그대로.
//  · AI 도우미 런처(01C CHAT-01, W7b)는 AssistantMount가 켜짐·공개 게이트를 판정해 붙인다 — 꺼짐·미공개 방문자에게는 런처 0.
//  · 공개 데이터를 읽지 못하면 닫힌 틀(상단 메뉴만 — 유틸 메뉴·정책 링크 0)로 그린다(서버 로그 [public]). 그 밖의 본문 오류는 error.tsx.
// 공개 화면 기본 robots (SEO-04) — SITE_INDEXING=on일 때만 색인 허용. 화면별 noindex(빈 지역·삭제·검색 결과 등)는 각 화면 metadata가 덮어쓴다. 공개 틀 밖(로그인·계정·관리)은 루트의 noindex 그대로
export function generateMetadata(): Metadata {
  return { robots: defaultRobots(siteIndexing()) };
}

const maskRows = (rows: SiteChrome["company"]["media"]) => rows.map((r) => ({ label: r.label, value: maskEmailForDisplay(r.value) }));

async function chrome(): Promise<SiteChrome> {
  return readPublic("화면 틀", () => getSiteChrome(), () => closedChrome());
}

export default async function SiteLayout({ children }: { children: ReactNode }) {
  await connection();
  const c = await chrome();
  return (
    <SiteLinkProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-lg focus:bg-white focus:px-4 focus:text-navy-900"
      >
        본문으로 건너뛰기
      </a>
      <PathBreadcrumbJsonLd site={siteUrl()} />
      <SiteHeader utilities={headerUtilityKeys(c.utilities)} submenus={headerSubmenus(c.sections)} />
      {/* 본문은 화면 한 장 높이 이상 — 짧은 화면에서도 바닥글(저작권·열린보도원칙 문단 등 긴 글)이 첫 화면에 들어오지 않는다 (R1 첫 화면 글자 수) */}
      <main id="main" tabIndex={-1} className="min-h-screen focus:outline-none">
        {children}
      </main>
      <Footer
        disclaimer={FOOTER_DISCLAIMER}
        links={footerLinks(c.footerLinks)}
        notices={c.company.notices.map(maskEmailForDisplay)}
        info={maskRows(c.company.media)}
        contact={maskRows(c.company.contact)}
      />
      <AssistantMount />
    </SiteLinkProvider>
  );
}
