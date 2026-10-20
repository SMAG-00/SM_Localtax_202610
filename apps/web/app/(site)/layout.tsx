import type { ReactNode } from "react";
import { connection } from "next/server";
import { Footer } from "@ltr/ui";
import { maskEmailForDisplay } from "@/lib/policy/email";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteLinkProvider } from "@/components/site/SiteLinkProvider";
import { closedChrome, getSiteChrome, readPublic, type SiteChrome } from "@/lib/server/public";
import { FOOTER_DISCLAIMER, footerLinks, headerSubmenus, headerUtilityKeys } from "@/lib/site/chrome-view";

// 공개 화면 틀 (HOME-02 · HELP-05 · FND-09 · UX-06) — 건너뛰기 링크 · 헤더(상단 4대 분야와 하위 메뉴 + 공개 승인된 유틸 메뉴) · 본문 · 바닥글(공개 승인된 정책 링크).
//  · 사이트 안 링크는 Next.js 링크(새로고침 없는 화면 전환). 백오피스(/admin)·견본(/_design)은 이 틀 밖이라 공개 헤더·바닥글이 없다.
//  · 요청 때 그린다 — 빌드 때 DB를 읽지 않는다(Docker·CI 빌드에는 DB 접속값이 없다). 검색 노출 차단(noindex)은 루트 레이아웃 그대로.
//  · AI 도우미 런처(01C CHAT-01)는 그 작업이 패널과 함께 붙인다 — 지금은 누를 곳 없는 단추를 두지 않는다.
//  · 공개 데이터를 읽지 못하면 닫힌 틀(상단 메뉴만 — 유틸 메뉴·정책 링크 0)로 그린다(서버 로그 [public]). 그 밖의 본문 오류는 error.tsx.
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
      <SiteHeader utilities={headerUtilityKeys(c.utilities)} submenus={headerSubmenus(c.sections)} />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        {children}
      </main>
      <Footer disclaimer={FOOTER_DISCLAIMER} links={footerLinks(c.footerLinks)} info={c.company.map((r) => ({ label: r.label, value: maskEmailForDisplay(r.value) }))} />
    </SiteLinkProvider>
  );
}
