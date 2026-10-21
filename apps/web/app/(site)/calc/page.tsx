import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalcCards } from "@/components/site/OfficialLinkCard";
import { getCalcView, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 세금 계산기 연결 (/calc — TX-01·FAM-08, docs/dev/W3_설계.md 5장). 기능 키 calc가 꺼져 있으면 404.
// 세액을 계산하지 않고 SM 부동산 세금 플랫폼·외부 계산기로 연결만 한다 — 주소는 관리자가 입력한 설정값(official_links), 비어 있으면 카드는 없다.
// 요청 때 그린다 — 주소·점검 상태는 배포 없이 바뀐다.
export const metadata: Metadata = {
  title: pageTitle("세금 계산기"),
  description: "SM 부동산 세금 플랫폼 계산기와 외부 계산기로 이동하는 연결입니다.",
};

export default async function CalcPage() {
  await connection();
  const view = await readPublic("세금 계산기 연결", () => getCalcView(), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <h1 className="text-[28px] font-black text-navy-900">세금 계산기</h1>
        <p className="mt-4 text-[15px] text-navy-500">지금은 연결을 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <CalcCards view={view} />;
}
