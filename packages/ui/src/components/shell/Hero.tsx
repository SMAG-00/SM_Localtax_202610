import type { ReactNode } from "react";
import { Eyebrow } from "../base";

/** 강조 단어(처음 나온 곳 하나)만 hermes-400으로 칠한다 (PRD-00 8.4) */
function withHighlight(title: string, highlight?: string): ReactNode {
  const word = highlight?.trim();
  const at = word ? title.indexOf(word) : -1;
  if (!word || at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <span className="text-hermes-400">{word}</span>
      {title.slice(at + word.length)}
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
  /** 제목 안에서 hermes-400으로 칠할 단어 */
  highlight?: string;
  description?: ReactNode;
  /** 아래 자리 — 홈 큰 입력창 등 */
  children?: ReactNode;
};

/**
 * 히어로 — SM 홈 히어로 그대로 (PRD-00 8.6). navy-700 → 800 → 900 대각 그라데이션 + 오렌지 빛번짐(bg-hermes-500/20 blur-3xl 원, R3 면적 계산에서 뺀다).
 * 그라데이션은 헤더·히어로·바닥글 파일에만 허용된다 (R5).
 */
export function Hero({ eyebrow, title, highlight, description, children, titleLevel = 1 }: HeroProps) {
  const Title = `h${titleLevel}` as "h1" | "h2" | "h3";
  return (
    <section data-ui="hero" className="relative overflow-hidden bg-gradient-to-br from-navy-700 via-navy-800 to-navy-900">
      {/* 오른쪽 위 오렌지 광원 — 넓게 칠하지 않고 은은하게만 */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-hermes-500/20 blur-3xl" />
      {/* 왼쪽 아래 옅은 광원 */}
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-hermes-400/10 blur-3xl" />
      {/* 아래로 갈수록 어두워져 다음 섹션(아이보리)과의 경계를 부드럽게 */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-navy-900/60" />

      <div className="relative mx-auto max-w-5xl px-4 py-20 sm:py-28">
        {eyebrow && <Eyebrow tone="dark">{eyebrow}</Eyebrow>}
        {title?.trim() && (
          <Title className="mt-6 text-[2.6rem] leading-[1.15] font-black tracking-tight text-white sm:text-[3.75rem]">{withHighlight(title.trim(), highlight)}</Title>
        )}
        {description && <p className="mt-7 max-w-2xl text-[18px] leading-[1.75] text-navy-100">{description}</p>}
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
