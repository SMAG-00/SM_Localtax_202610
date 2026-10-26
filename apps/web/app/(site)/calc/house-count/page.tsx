import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { HouseCountTool } from "@/components/site/realestate/HouseCountTool";
import { CalcUnavailable } from "@/components/site/calc/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getHouseCountPage } from "@/lib/server/public/realestate-tools";
import { pageTitle } from "@/lib/site/hub-view";

// 주택 수 판정 도우미 (/calc/house-count - RE-03). 기능 키 house_count가 꺼져 있거나 서명(활성)된 판정표가 없으면 404. 판정표는 렌더 때 함께 내려가고 판정은 브라우저에서만 한다
export const metadata: Metadata = { title: pageTitle("주택 수 판정 도우미"), description: "보유 주택 목록으로 취득세 중과 판단용 주택 수를 확인합니다." };

export default async function Page() {
  await connection();
  const page = await readPublic("주택 수 판정", () => getHouseCountPage(), () => UNAVAILABLE);
  if (isUnavailable(page)) return <CalcUnavailable />;
  if (page === null) notFound();
  return <HouseCountTool tables={page.tables} />;
}
