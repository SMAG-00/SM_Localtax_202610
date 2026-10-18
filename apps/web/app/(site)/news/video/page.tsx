import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { VideoListView } from "@/components/site/MediaListViews";
import type { SearchParams } from "@/components/site/routes";
import { getVideoList, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle, parsePage } from "@/lib/site/hub-view";
import { VIDEO_LIST_COPY } from "@/lib/site/media-view";

// 동영상 목록 (/news/video — ART-08 · PRD-01A 3장 '동영상 카드 그리드 1열 → 2열 → 3열'). `video`는 기사 주소로 쓸 수 없는 예약 이름이다(ART-01 — DB가 막는다).
// 기능 키 video_list가 꺼져 있으면 404 — 동영상 채널 결정 전에는 동영상 목록을 숨긴다(PRD-01A 1.3 · 13장, W2-c 설계 9장). 메뉴 링크는 아직 없다.
// 목록 끝을 넘긴 쪽은 404. 공개 데이터를 읽지 못하면 머리 + 안내 한 줄 (200 — 다른 목록 화면과 같다)
export const metadata: Metadata = { title: pageTitle(VIDEO_LIST_COPY.title) };

export default async function VideoListPage({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const page = parsePage((await searchParams).page);
  const data = await readPublic("동영상 목록", () => getVideoList({ page }), () => UNAVAILABLE);
  if (isUnavailable(data)) return <VideoListView data={{ items: [], page: 1, total: 0, hasMore: false }} unavailable />;
  if (data === null) notFound();
  if (page > 1 && data.items.length === 0) notFound();
  return <VideoListView data={data} />;
}
