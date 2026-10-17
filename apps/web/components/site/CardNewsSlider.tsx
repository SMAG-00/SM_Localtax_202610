"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { SlideView } from "@/lib/server/public";

// 카드뉴스 (ART-03) — 5~7장 세로(4:5) 장을 가로로 넘긴다. 장 글자는 이미지가 아니라 HTML 글자다(검색·화면 읽기).
//  · 모바일은 손가락으로 밀어 넘긴다(가로 스크롤 맞춤 — scroll-snap). 키보드 ← → 로 한 장씩, [이전 장]·[다음 장] 버튼(44px)
//  · 장마다 대체 텍스트가 장 이름이 된다 ("2 / 5 — 장 설명"). 지금 장은 aria-current, 몇 번째 장인지 화면 읽기 프로그램에 알린다
//  · 모든 장이 처음부터 HTML에 있다 — 스크립트가 꺼져도 밀어서 다 읽는다. 움직임 줄이기 설정이면 미끄러지지 않고 바로 옮긴다
//  · 장 색은 navy 바탕 흰 글자(대비 15:1), 오렌지는 번호 선 한 줄만 (R3)

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-navy-200 bg-white px-4 text-[15px] font-bold text-navy-900 transition hover:border-navy-400 disabled:cursor-not-allowed disabled:text-navy-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

export function CardNewsSlider({ slides, title }: { slides: readonly SlideView[]; title: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const statusId = useId();
  const trackId = useId();
  const total = slides.length;

  const go = useCallback(
    (index: number) => {
      const track = trackRef.current;
      const next = Math.max(0, Math.min(total - 1, index));
      setCurrent(next);
      if (!track) return;
      const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const target = track.children[next] as HTMLElement | undefined;
      track.scrollTo({ left: target ? target.offsetLeft - track.offsetLeft : next * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
    },
    [total],
  );

  // 손가락으로 밀었을 때 — 가장 가까운 장을 지금 장으로
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        let best = 0;
        let distance = Number.POSITIVE_INFINITY;
        [...track.children].forEach((child, i) => {
          const d = Math.abs((child as HTMLElement).offsetLeft - track.offsetLeft - track.scrollLeft);
          if (d < distance) {
            distance = d;
            best = i;
          }
        });
        setCurrent(best);
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
    };
  }, [total]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(current + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(total - 1);
    }
  }

  if (total === 0) return null;
  return (
    <section data-ui="card-news" data-slide-count={total} aria-roledescription="카드뉴스" aria-label={`${title} — 카드뉴스 ${total}장`} onKeyDown={onKeyDown} className="mt-8">
      <div
        ref={trackRef}
        id={trackId}
        tabIndex={0}
        role="group"
        data-part="slide-track"
        aria-label="카드뉴스 장 — 좌우 화살표 키로 넘깁니다"
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain rounded-2xl pb-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hermes-500 motion-safe:scroll-smooth"
      >
        {slides.map((s, i) => (
          <div
            key={s.number}
            data-slide={s.number}
            role="group"
            aria-roledescription="장"
            aria-label={`${s.number} / ${total} — ${s.alt}`}
            aria-current={i === current ? "true" : undefined}
            className="flex aspect-[4/5] w-full max-w-[28rem] shrink-0 snap-center flex-col rounded-2xl bg-navy-900 p-6 text-white sm:p-8"
          >
            <p className="border-l-2 border-hermes-500 pl-3 font-mono text-[13px] tracking-wide text-navy-100">{`${s.number} / ${total}`}</p>
            {s.title && <h2 className="mt-6 text-[24px] leading-snug font-black sm:text-[28px]">{s.title}</h2>}
            <div className="mt-4 space-y-3 text-[17px] leading-relaxed text-navy-50">
              {s.lines.map((line, j) => (
                <p key={j}>{line}</p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className={BUTTON} onClick={() => go(current - 1)} disabled={current === 0} aria-label="이전 장" aria-controls={trackId}>
          이전
        </button>
        <p id={statusId} aria-live="polite" data-part="slide-status" className="font-mono text-[13px] tracking-wide text-navy-600">
          {`${current + 1} / ${total}`}
        </p>
        <button type="button" className={BUTTON} onClick={() => go(current + 1)} disabled={current === total - 1} aria-label="다음 장" aria-controls={trackId}>
          다음
        </button>
      </div>
    </section>
  );
}
