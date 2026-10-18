import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { PhotoListView } from "@/components/site/MediaListViews";
import type { SearchParams } from "@/components/site/routes";
import { getPhotoList, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, parsePage } from "@/lib/site/hub-view";
import { PHOTO_LIST_COPY } from "@/lib/site/media-view";

// 포토 목록 (/news/photo — ART-09 · PRD-01A 3장 '기사 카드(포토 형식 배지) 그리드'). `photo`는 기사 주소로 쓸 수 없는 예약 이름이다(ART-01).
// 형식이 포토인 공개 기사만. 목록 끝을 넘긴 쪽은 404. 공개 데이터를 읽지 못하면 머리 + 안내 한 줄 (200)
export const metadata: Metadata = { title: pageTitle(PHOTO_LIST_COPY.title) };

export default async function PhotoListPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const page = parsePage((await searchParams).page);
  const data = await readPublic("포토 목록", () => getPhotoList({ page }), () => UNAVAILABLE);
  if (isUnavailable(data)) return <PhotoListView data={{ items: [], page: 1, total: 0, hasMore: false }} unavailable />;
  if (page > 1 && data.items.length === 0) notFound();
  return <PhotoListView data={data} />;
}
