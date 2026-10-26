import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SecurityPage } from "@/components/site/SecurityView";
import { parseSecurityEntry } from "@/lib/security/items";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getSecurityPage } from "@/lib/server/public/security";
import { pageTitle } from "@/lib/site/hub-view";

// 보안 정책 (/security - SEC-01). 기능 키 security_page가 꺼져 있거나 7개 항목 게시·자가 점검 1회가 안 되면 404 (준비 중 쪽 0).
export const metadata: Metadata = { title: pageTitle("보안 정책") };

export default async function SecurityRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const view = await readPublic("보안 정책", () => getSecurityPage(), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">보안 정책</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 내용을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <SecurityPage view={view} entry={parseSecurityEntry(typeof sp.from === "string" ? sp.from : null)} />;
}
