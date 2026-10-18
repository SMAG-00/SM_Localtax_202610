"use client";

import { useRef, type ReactNode } from "react";
import { VideoCard, type VideoEmbedUrl } from "@ltr/ui";
import { track } from "@/lib/analytics/client";
import type { SectionKey } from "@/lib/server/public/constants";
import { videoPlayedProps } from "@/lib/site/media-view";

// 기사 본문의 동영상 (ART-08) — 누르기 전에는 사이트의 썸네일(media)과 재생 단추뿐이고 유튜브·구글 주소로 가는 요청이 0이다.
// 누르면 그 자리에 youtube-nocookie 플레이어를 열고 video_played(기사 번호) 1건을 보낸다 — 측정 거부·GPC면 track()이 보내지 않는다(GROW-01).
// 주소는 저장 검사(youtube-nocookie 임베드만)와 공개 데이터 함수(publicBlocks)를 지난 값이다
export function VideoPlayer({
  articleId,
  section,
  title,
  summary,
  embedUrl,
  thumbnail,
  durationSeconds,
  captions,
  badges,
}: {
  articleId: number;
  section: SectionKey;
  title: string;
  summary: string;
  embedUrl: string;
  thumbnail: { src: string; width?: number; height?: number };
  durationSeconds: number | null;
  captions: boolean;
  badges?: ReactNode;
}) {
  const played = useRef(false);
  return (
    <VideoCard
      title={title}
      summary={summary}
      thumbnail={thumbnail}
      {...(durationSeconds === null ? {} : { durationSeconds })}
      captions={captions}
      badges={badges}
      embedUrl={embedUrl as VideoEmbedUrl}
      onPlay={() => {
        if (played.current) return;
        played.current = true;
        void track("video_played", { section, props: videoPlayedProps(articleId) });
      }}
    />
  );
}
