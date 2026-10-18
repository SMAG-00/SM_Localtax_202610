import type { Metadata } from "next";
import { connection } from "next/server";
import { PopularView } from "@/components/site/PopularView";
import { getPopularList, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";
import { POPULAR_TITLE } from "@/lib/site/popular-view";

// 많이 본 기사 (/news/popular — ART-11). `popular`는 기사 주소로 쓸 수 없는 예약 이름이다(ART-01 — DB가 막는다).
// 요청 때 그린다 — 순위는 1시간 집계가 바꾸고, 집계가 끝나면 공개 데이터 캐시를 비운다(/api/jobs/popular-hourly).
// 공개 데이터를 읽지 못하면 머리 + 안내 한 줄 (200 — 다른 목록 화면과 같다)
export const metadata: Metadata = { title: pageTitle(POPULAR_TITLE) };

export default async function PopularPage() {
  await connection();
  const data = await readPublic("많이 본 기사", () => getPopularList(), () => UNAVAILABLE);
  if (isUnavailable(data)) return <PopularView data={{ items: [], computedAt: null, windowHours: 0 }} unavailable />;
  return <PopularView data={data} />;
}
