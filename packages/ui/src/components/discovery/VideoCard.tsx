"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chip } from "../base";
import { UiLink } from "../link";

/** 임베드 주소 — youtube-nocookie.com만 (ART-08: 그 밖의 주소는 저장 불가) */
export type VideoEmbedUrl = `https://www.youtube-nocookie.com/embed/${string}`;

const EMBED_HOST = "www.youtube-nocookie.com";
/** /embed/<영상번호 11자> — 저장 검사(@ltr/editorial parseYoutubeEmbed)와 같은 모양만 플레이어로 연다 */
const EMBED_PATH = /^\/embed\/[A-Za-z0-9_-]{11}$/;

type Common = {
  title: string;
  /** 요약 텍스트 — 필수 (8.9 · ART-08: 요약 없이 발행 불가) */
  summary: string;
  /** 썸네일 — `media`의 16:9 이미지. 원본 비율 그대로 줄이고 자르지 않는다. 크기를 알면 넘긴다(자리 확보 — 화면 밀림 0) */
  thumbnail: { src: string; width?: number; height?: number; alt?: string };
  /** 재생 시간(초) — 모르면 빼면 표기하지 않는다 */
  durationSeconds?: number;
  /** 편집자가 확인한 자막 여부 — true면 "자막 있음" 칩 */
  captions: boolean;
  /** 배지 자리 — 기사 유형 배지·제휴 배지 (목록 카드·기사 상세와 같은 표기, ART-10) */
  badges?: ReactNode;
};

export type VideoCardProps =
  | (Common & {
      /** 누르면 이 자리에 플레이어를 불러온다 (누르기 전 유튜브 도메인 요청 0) */
      embedUrl: VideoEmbedUrl;
      /** 재생을 누른 때 한 번 — 분석 이벤트 video_played 연결용 */
      onPlay?: () => void;
      href?: undefined;
    })
  | (Common & {
      /** 동영상 기사 상세로 가는 링크형 (목록) */
      href: string;
      embedUrl?: undefined;
      onPlay?: undefined;
    });

/** 초 → "m:ss" / "h:mm:ss" 표기와 ISO 8601 기간. 음수·숫자 아님은 null (표기하지 않는다) */
export function formatDuration(seconds: number): { text: string; iso: string } | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  const iso = h > 0 ? `PT${h}H${m}M${s}S` : m > 0 ? `PT${m}M${s}S` : `PT${s}S`;
  return { text, iso };
}

/** 누른 뒤 여는 플레이어 주소 — 저장 검사를 지난 모양(https · www.youtube-nocookie.com · /embed/<11자>, 포트·사용자 정보 없음)만, 아니면 null */
export function playableSrc(embedUrl: string | undefined): string | null {
  if (!embedUrl) return null;
  try {
    const url = new URL(embedUrl);
    if (url.protocol !== "https:" || url.hostname !== EMBED_HOST || url.port !== "" || url.username !== "" || url.password !== "" || !EMBED_PATH.test(url.pathname)) return null;
    url.hash = "";
    url.searchParams.set("autoplay", "1");
    return url.toString();
  } catch {
    return null;
  }
}

function PlayMark() {
  // 재생 표시 — 글자가 아닌 표시(R4: 사진 위 글자 금지). navy-900 원 + hermes-500 삼각형
  return (
    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
      <svg viewBox="0 0 48 48" width="56" height="56" className="fill-navy-900/85 transition group-hover:fill-navy-900">
        <circle cx="24" cy="24" r="24" />
        <path d="M19 15 L34 24 L19 33 Z" className="fill-hermes-500" />
      </svg>
    </span>
  );
}

/**
 * 동영상 카드 — 16:9 썸네일(원본 비율) · 재생 시간 · "자막 있음" 칩 · 요약 텍스트 (PRD-00 8.6, RP-04 · RP-26, ART-08)
 * 썸네일 위에는 글자를 얹지 않는다(R4) — 재생 시간·칩은 썸네일 아래 줄에 둔다.
 * 누르기 전에는 썸네일(사이트의 media 이미지)과 재생 단추뿐 — 유튜브·구글 주소로 가는 요청 0. 누르면 그 자리에 youtube-nocookie 플레이어를 열고 초점을 옮긴다
 */
export function VideoCard(props: VideoCardProps) {
  const { title, summary, thumbnail, durationSeconds, captions, badges } = props;
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  const src = playableSrc(props.embedUrl);
  const duration = durationSeconds === undefined ? null : formatDuration(durationSeconds);

  // 재생 단추가 플레이어로 바뀌면 키보드 초점을 플레이어로 (단추가 사라져 초점을 잃지 않게)
  useEffect(() => {
    if (playing) player.current?.focus();
  }, [playing]);

  const image = (
    <img
      src={thumbnail.src}
      alt={thumbnail.alt ?? ""}
      {...(thumbnail.width && thumbnail.height ? { width: thumbnail.width, height: thumbnail.height } : {})}
      loading="lazy"
      decoding="async"
      className="block h-auto w-full"
    />
  );

  let media;
  if (src && playing) {
    media = (
      <div data-video-player className="aspect-video w-full overflow-hidden rounded-xl bg-navy-900">
        <iframe
          ref={player}
          src={src}
          title={title}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  } else if (src) {
    media = (
      <button
        type="button"
        aria-label={`동영상 재생: ${title}`}
        data-thumbnail-frame
        data-video-facade
        onClick={() => {
          setPlaying(true);
          props.onPlay?.();
        }}
        className="group relative block w-full overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
      >
        {image}
        <PlayMark />
      </button>
    );
  } else {
    media = (
      <div data-thumbnail-frame className="overflow-hidden rounded-xl">
        {image}
      </div>
    );
  }

  return (
    <article data-ui="video-card" className="relative flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-6">
      {media}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {badges}
        {duration && (
          <>
            <span className="sr-only">재생 시간 </span>
            <time dateTime={duration.iso} className="font-mono text-[13px] tracking-wide text-navy-600">
              {duration.text}
            </time>
          </>
        )}
        {captions && <Chip>자막 있음</Chip>}
      </div>
      <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900 [overflow-wrap:anywhere]">
        {props.href !== undefined ? (
          <UiLink
            href={props.href}
            className="after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-hermes-500"
          >
            {title}
          </UiLink>
        ) : (
          title
        )}
      </h3>
      <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-navy-600 [overflow-wrap:anywhere]">{summary}</p>
    </article>
  );
}
