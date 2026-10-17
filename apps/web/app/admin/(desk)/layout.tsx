import type { ReactNode } from "react";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { AdminNav } from "@/components/admin/AdminNav";
import { adminMenu } from "@/lib/admin/menu";
import { pageViewer } from "@/lib/server/admin/pages";

// 백오피스 화면 틀 — 로그인 확인(DAL) 뒤 역할별 메뉴(ADM-01). 메뉴 항목은 허용 작업(allowedActions)에서만 나온다.
// 각 화면은 다시 접근 판정을 하고, 쓸 수 없는 화면이면 403(forbidden.tsx)을 보인다.
export const dynamic = "force-dynamic";

export default async function DeskLayout({ children }: { children: ReactNode }) {
  const viewer = await pageViewer();
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-navy-900"
      >
        본문으로 건너뛰기
      </a>
      <AdminHeader viewer={viewer} />
      <AdminNav items={adminMenu(viewer)} />
      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8">
        {children}
      </main>
    </>
  );
}
