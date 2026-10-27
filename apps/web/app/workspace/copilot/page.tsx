import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { CopilotPanel } from "@/components/workspace/CopilotPanel";
import { loadPageGate } from "@/lib/server/copilot/page-gate";

// 리서치 코파일럿 (W13-e, RES-01~05). 기능 키 research_copilot 꺼짐이면 404. 실행 버튼은 게이트(공개 단계·권한·월 한도 값)가 열려야만 켜진다.
export const metadata: Metadata = { title: "리서치 코파일럿", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CopilotPage() {
  await connection();
  const gate = await loadPageGate();
  if (!gate.featureOn) notFound();
  if (!gate.loggedIn) redirect("/login?next=%2Fworkspace%2Fcopilot");
  return (
    <main id="main" className="mx-auto w-full max-w-[960px] px-4 py-8">
      <h1 className="text-[26px] font-black text-navy-900">리서치 코파일럿</h1>
      <CopilotPanel open={gate.open} reason={gate.reason} used={gate.used} limit={gate.limit} />
    </main>
  );
}
