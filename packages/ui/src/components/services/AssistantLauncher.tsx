"use client";

import type { ReactNode, Ref } from "react";
import { cx } from "../base";

export type AssistantLauncherProps = {
  /** 패널이 열려 있는가 (기본 닫힘) */
  expanded?: boolean;
  /** 패널 id (aria-controls) */
  controls?: string;
  onClick?: () => void;
  /** hermes-500 포인트 픽토그램 하나 — 없으면 기본 말풍선 */
  icon?: ReactNode;
  /** fixed = 모든 공개 페이지 우측 하단 고정, inline = 견본 등 흐름 안 배치 */
  placement?: "fixed" | "inline";
  /** 패널을 닫을 때 초점을 돌려받는다 */
  ref?: Ref<HTMLButtonElement>;
};

export const ASSISTANT_TITLE = "무엇을 도와드릴까요?";

function BubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" className="h-5 w-5" focusable="false">
      <path d="M4 5h16v11H10l-5 4v-4H4z" />
      <circle cx="16" cy="10.5" r="1.75" stroke="none" className="fill-hermes-500" />
    </svg>
  );
}

/**
 * AI 도우미 런처 — 어두운 버튼 문법(rounded-xl bg-navy-900 text-white) + 포인트 아이콘 하나 + "무엇을 도와드릴까요?" (CHAT-01 · CHAT-02).
 * 글자는 360px에서도 지우지 않는다. 주 버튼이 아니다(R2). 자리를 고정해 레이아웃 이동 0. 검색 발췌 제외(data-nosnippet).
 */
export function AssistantLauncher({ expanded = false, controls, onClick, icon, placement = "fixed", ref }: AssistantLauncherProps) {
  return (
    <button
      ref={ref}
      type="button"
      data-ui="assistant-launcher"
      data-nosnippet=""
      aria-label={`${ASSISTANT_TITLE} AI 도우미 열기`}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={cx(
        placement === "fixed" && "fixed right-4 bottom-4 z-40 sm:right-6 sm:bottom-6",
        "inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 py-2.5 pr-5 pl-2.5 text-[15px] font-bold whitespace-nowrap text-white shadow-[0_8px_30px_-12px_rgba(6,24,42,0.35)] transition hover:bg-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
      )}
    >
      <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-navy-900">
        {icon ?? <BubbleIcon />}
      </span>
      <span>{ASSISTANT_TITLE}</span>
    </button>
  );
}
