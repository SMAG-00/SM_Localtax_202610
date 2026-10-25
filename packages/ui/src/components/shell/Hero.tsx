import type { ReactNode } from "react";
import { Eyebrow } from "../base";

/**
 * 강조할 낱말들을 hermes-400으로 칠한다 (PRD-00 8.4) — 낱말마다 나오는 곳을 모두, 긴 낱말부터 먼저 잡고 겹치는 곳은 칠하지 않는다.
 * 순수 함수라 시험이 직접 부른다. 칠할 곳이 없으면 글자 그대로 돌려준다
 */
export function highlightRanges(text: string, highlight?: string | readonly string[]): { text: string; marked: boolean }[] {
  const words = [...new Set((Array.isArray(highlight) ? highlight : [highlight]).map((w) => (typeof w === "string" ? w.trim() : "")).filter((w) => w !== ""))].sort(
    (a, b) => b.length - a.length,
  );
  const taken: [number, number][] = [];
  for (const word of words) {
    for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
      const end = at + word.length;
      if (!taken.some(([s, e]) => at < e && end > s)) taken.push([at, end]);
    }
  }
  taken.sort((a, b) => a[0] - b[0]);
  const out: { text: string; marked: boolean }[] = [];
  let cursor = 0;
  for (const [s, e] of taken) {
    if (s > cursor) out.push({ text: text.slice(cursor, s), marked: false });
    out.push({ text: text.slice(s, e), marked: true });
    cursor = e;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), marked: false });
  return out;
}

function withHighlight(text: string, highlight?: string | readonly string[]): ReactNode {
  const parts = highlightRanges(text, highlight);
  if (!parts.some((p) => p.marked)) return text;
  return parts.map((p, i) =>
    p.marked ? (
      <span key={i} className="text-hermes-400">
        {p.text}
      </span>
    ) : (
      p.text
    ),
  );
}

/** 제목 속 첫 줄표(—) 앞뒤 — 줄표 자리에서 두 덩어리로 나눈다 */
const DASH_SPLIT = /^(.+?)(\s*—\s*)(.+)$/s;

/**
 * 제목 그리기 — 줄표(—)가 있으면 앞뒤를 덩어리 둘로 나눈다. 앞 덩어리는 윗줄에 뒤 덩어리 글자 크기의 약 60%로 작게(PO 결정 2026-10-24),
 * 뒤 덩어리는 제목 크기 그대로 아랫줄에 둔다. 줄표는 화면에 보이지 않는다(display:none) — 글자 내용(textContent)은 원문과 같고 제목 요소는 하나(h1)다
 */
function renderTitle(title: string, highlight?: string | readonly string[]): ReactNode {
  const m = DASH_SPLIT.exec(title);
  if (!m) return withHighlight(title, highlight);
  return (
    <>
      <span data-part="title-lead" className="mb-2 block text-[1.2rem] leading-[1.3] sm:mb-3 sm:text-[1.65rem] lg:text-[2.25rem]">
        {withHighlight(m[1]!, highlight)}
      </span>
      <span className="hidden">{m[2]}</span>
      <span data-part="title-main" className="block">
        {withHighlight(m[3]!, highlight)}
      </span>
    </>
  );
}

export type HeroProps = {
  /** 제목 수준 — 기본 1(페이지 제목). 다른 제목 아래에 둘 때 2·3 (접근성 heading-order) */
  titleLevel?: 1 | 2 | 3;
  /** 영문 아이브로 (어두운 바탕 톤) */
  eyebrow?: string;
  /** 핵심 메시지 — settings 한 곳에서 온 문구 (HOME-01). 비면 제목 요소 0 — 페이지 제목(h1)은 쓰는 쪽이 따로 둔다 */
  title?: string;
  /** 제목 안에서 hermes-400으로 칠할 낱말 — 글자 하나 또는 여러 개 (낱말마다 나오는 곳을 모두, 긴 낱말 먼저) */
  highlight?: string | readonly string[];
  description?: ReactNode;
  /** 아래 자리 — 홈 큰 입력창 등 */
  children?: ReactNode;
  /** 배경 영상·그림 층 (apps/web HeroMedia — 부모를 가득 채우는 absolute 층). 있으면 화면 전체 높이 · 글자 쪽 어두운 막 · 빛번짐 없음. 없으면 지금 모양 그대로 */
  media?: ReactNode;
};

/**
 * 히어로 — SM 홈 히어로 그대로 (PRD-00 8.6). navy-700 → 800 → 900 대각 그라데이션 + 오렌지 빛번짐(bg-hermes-500/20 blur-3xl 원, R3 면적 계산에서 뺀다).
 * 그라데이션은 헤더·히어로·바닥글 파일에만 허용된다 (R5).
 */
export function Hero({ eyebrow, title, highlight, description, children, titleLevel = 1, media }: HeroProps) {
  const Title = `h${titleLevel}` as "h1" | "h2" | "h3";
  return (
    <section data-ui="hero" data-media={media ? "true" : undefined} className={`relative overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900${media ? " flex min-h-[calc(100svh-4.5rem)] items-center" : ""}`}>
      {media}
      {/* 배경 영상 위 글자 대비 — 글자가 있는 왼쪽을 더 어둡게 */}
      {media && <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-r from-navy-900/80 via-navy-900/40 to-transparent" />}
      {!media && (
        <>
          {/* 오른쪽 위 오렌지 광원 — 넓게 칠하지 않고 은은하게만 */}
          <div aria-hidden="true" className="pointer-events-none absolute -top-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-hermes-500/20 blur-3xl" />
          {/* 왼쪽 아래 옅은 광원 */}
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-hermes-400/10 blur-3xl" />
        </>
      )}
      {/* 아래로 갈수록 어두워져 다음 섹션(아이보리)과의 경계를 부드럽게 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-navy-900/60" />

      <div className={`relative mx-auto max-w-5xl px-4 py-20 sm:py-28${media ? " w-full" : ""}`}>
        {eyebrow && <Eyebrow tone="dark">{eyebrow}</Eyebrow>}
        {title?.trim() && (
          <Title className="mt-6 [word-break:keep-all] break-words text-[2rem] leading-[1.2] font-black tracking-tight text-white sm:text-[2.75rem] sm:leading-[1.15] lg:text-[3.75rem]">{renderTitle(title.trim(), highlight)}</Title>
        )}
        {description && <p className="mt-7 max-w-2xl text-[18px] leading-[1.75] text-navy-100">{description}</p>}
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
