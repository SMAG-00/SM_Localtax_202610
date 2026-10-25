"use client";

import { useEffect, useRef, useState } from "react";
import { HERO_AI_LABEL, HERO_PLAYBACK_LABELS, canPlayHeroVideo, pickHeroVideo, type ResolvedHeroMedia } from "./hero-media-logic";

// 히어로 배경 미디어 (PO 결정 2026-10-25) — 홈은 화면 전체, 분야 허브 머리는 절반 높이. 부모 요소(relative · overflow-hidden)를 가득 채우는 배경 층이다.
//  · 포스터 그림이 첫 화면 큰 그림(LCP) — 서버에서 바로 그린다 (fetchPriority=high). 영상은 마운트 뒤에 정해서 붙인다
//  · 동작 줄이기(prefers-reduced-motion)·데이터 절약(Save-Data)이면 영상 요청 0 — 포스터만. 영상 파일이 없어도 포스터만
//  · 영상은 장식 — 소리 없음·aria-hidden·초점 없음. 멈춤/재생 단추는 보이게 둔다 (WCAG 2.2.2) — 5초를 넘는 자동 재생 영상
//  · 화면 구석 'AI 생성 영상' 표시 (인공지능 기본법 — 설정 aiLabel로 끈다). 그림만 있을 때도 AI 생성 그림이라 같은 표시
//  · 글자가 읽히도록 어두운 막(navy-900)을 덮는다. 그라데이션은 허용 파일(Hero.tsx)에서만 쓰므로 여기는 단색 막이다

const IMAGE_TYPES: Record<string, string> = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const imageType = (src: string) => IMAGE_TYPES[src.split(".").pop()?.toLowerCase() ?? ""];

export function HeroMedia({ media, overlay = "bg-navy-900/50" }: { media: ResolvedHeroMedia; overlay?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(media.video || media.videoMobile);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    const decide = () => {
      const ok = canPlayHeroVideo({ hasVideo, reducedMotion: reduced.matches, saveData: connection?.saveData === true });
      setSrc(ok ? pickHeroVideo({ video: media.video, videoMobile: media.videoMobile }, window.innerWidth) : null);
      if (!ok) setPlaying(false);
    };
    decide();
    reduced.addEventListener("change", decide);
    return () => reduced.removeEventListener("change", decide);
  }, [hasVideo, media.video, media.videoMobile]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <>
      <div data-part="hero-media" data-video={src ? "on" : "off"} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden bg-navy-900">
        {media.poster && (
          <picture>
            {media.posterMobile && media.posterMobile !== media.poster && <source media="(max-width: 767px)" srcSet={media.posterMobile} type={imageType(media.posterMobile)} />}
            <img src={media.poster} alt="" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover object-center" />
          </picture>
        )}
        {src && (
          <video
            ref={ref}
            key={src}
            src={src}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            tabIndex={-1}
            onPlaying={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${playing ? "opacity-100" : "opacity-0"}`}
          />
        )}
        <div className={`absolute inset-0 ${overlay}`} />
      </div>
      {/* 구석 표시와 멈춤 단추 — 배경 막 위, 본문 글자보다 아래쪽 구석 */}
      {media.aiLabel && (
        <span data-part="hero-ai-label" className="absolute bottom-3 left-3 z-10 rounded bg-navy-900/70 px-2 py-0.5 text-[12px] leading-5 text-white sm:left-4">
          {HERO_AI_LABEL}
        </span>
      )}
      {src && (
        <button
          type="button"
          data-part="hero-playback"
          onClick={toggle}
          aria-label={playing ? HERO_PLAYBACK_LABELS.pause : HERO_PLAYBACK_LABELS.play}
          className="absolute right-3 bottom-3 z-10 inline-flex min-h-11 items-center rounded-lg bg-navy-900/70 px-4 text-[13px] font-bold text-white transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400 sm:right-4"
        >
          {playing ? "일시정지" : "재생"}
        </button>
      )}
    </>
  );
}
