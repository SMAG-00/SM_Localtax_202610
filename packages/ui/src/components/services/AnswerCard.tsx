"use client";

import { useState } from "react";
import { cx } from "../base";
import { ExpertButtons, SiteLink, TypeBadge, type ExpertLinks } from "./parts";

export type AnswerCitation = { title: string; href: string };
export type AnswerFeedback = "helpful" | "not-helpful";

export type AnswerCardProps = {
  /** 답변 문단 — 첫 문단이 결론 (8.7: 결론 먼저) */
  paragraphs: readonly string[];
  /** 인용 링크 — 검색 결과·`official_links` 안의 주소만 (CHAT-04, 서버가 거른다) */
  citations: readonly AnswerCitation[];
  /** 페이지·글 요약 답이면 'AI 요약' 배지 (CHAT-04) */
  summary?: boolean;
  onFeedback?: (value: AnswerFeedback) => void;
  /** [아니에요] 뒤 전문가 연결 두 버튼 (CHAT-17) */
  experts?: ExpertLinks;
};

/** 모델 문장이 있는 답마다 붙는 고지 (CHAT-16) */
export const AI_ANSWER_NOTICE = "AI가 작성한 안내이며 세무 자문이 아닙니다";

const FEEDBACK_BUTTON =
  "inline-flex min-h-11 items-center rounded-xl border px-4 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/**
 * 답변 카드 — 흰 카드, 결론 단락 왼쪽 hermes-500 2px 선 (RP-16).
 * 1단계 AI 도우미는 'AI 답변' 배지·인용 링크 목록·[도움됨]/[아니에요]만 둔다 — 금액·명세서 블록 없음.
 */
export function AnswerCard({ paragraphs, citations, summary = false, onFeedback, experts }: AnswerCardProps) {
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [conclusion, ...rest] = paragraphs;

  function choose(value: AnswerFeedback) {
    setFeedback(value);
    onFeedback?.(value);
  }

  return (
    <article data-ui="answer-card" className="rounded-2xl border border-navy-100 bg-white p-6">
      <div className="flex flex-wrap gap-2">
        <TypeBadge>AI 답변</TypeBadge>
        {summary && <TypeBadge>AI 요약</TypeBadge>}
      </div>
      {conclusion && <p className="mt-3 border-l-2 border-hermes-500 pl-3 text-[17px] font-bold text-navy-900">{conclusion}</p>}
      {rest.map((p, i) => (
        <p key={i} className="mt-2 text-[16px] text-navy-800">
          {p}
        </p>
      ))}
      {citations.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-navy-600">출처</p>
          <ol aria-label="인용 출처" className="mt-1 space-y-0.5 text-[15px]">
            {citations.map((c) => (
              <li key={c.href}>
                <SiteLink href={c.href}>{c.title}</SiteLink>
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-4 text-[13px] text-navy-600">{AI_ANSWER_NOTICE}</p>
      <div role="group" aria-label="이 답변이 도움이 되었나요?" className="mt-3 flex flex-wrap gap-2">
        {(
          [
            ["helpful", "도움됨"],
            ["not-helpful", "아니에요"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={feedback === value}
            onClick={() => choose(value)}
            className={cx(FEEDBACK_BUTTON, feedback === value ? "border-navy-900 bg-navy-50 text-navy-900" : "border-navy-100 bg-white text-navy-700 hover:border-navy-300")}
          >
            {label}
          </button>
        ))}
      </div>
      {feedback && (
        <p role="status" className="mt-2 text-[14px] text-navy-600">
          의견을 보내 주셔서 고맙습니다
        </p>
      )}
      {feedback === "not-helpful" && experts && <ExpertButtons links={experts} />}
    </article>
  );
}
