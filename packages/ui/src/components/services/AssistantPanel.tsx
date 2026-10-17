"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { cx, DarkButton, Eyebrow, PrimaryButton } from "../base";
import { AnswerCard, type AnswerCardProps } from "./AnswerCard";
import { ASSISTANT_TITLE } from "./AssistantLauncher";
import { ProgressStatus, type ProgressStatusProps } from "./ProgressStatus";
import { DateText, ExpertButtons, MONO, SiteLink, StateChip, type ExpertLinks } from "./parts";

export type AssistantLink = { label: string; href: string };

/** 패널 메시지 — 질문 · 답변 카드 · '하지 않음' 범위 안내 · '검색 결과만' (CHAT-05 · CHAT-10) */
export type AssistantMessage =
  | { id: string; kind: "question"; text: string }
  | { id: string; kind: "answer"; answer: Omit<AnswerCardProps, "experts"> }
  /** '하지 않음' 응답 — 범위 안내 카드 문법(한 줄 사유 + 갈 곳 2~3개 + 기준일 + 전문가 두 버튼). 고정 안내라 'AI 답변' 배지 0 */
  | { id: string; kind: "scope"; reason: string; links: readonly AssistantLink[]; basisDate: string }
  /** '검색 결과만' 모드 — AI 문장 없이 사이트 검색 상위 결과 + 전문가 버튼 (근거 부족 카드 문법) */
  | { id: string; kind: "search-only"; results: readonly AssistantLink[] };

export type AssistantPanelProps = {
  /** 머리의 생성형 AI 고지 한 줄 — 감수본 문구(`settings`) (CHAT-16) */
  aiNotice: string;
  /** 첫 사용 고지 항목 — 사이트 자료 안내·세무 자문 아님·국외 처리·보관 기간·개인정보와 계산 입력값 금지 (CHAT-08) */
  firstUseNotice: readonly string[];
  /** 브라우저에 고지 확인 기록이 있으면 true — 고지 상자 없이 연다 */
  defaultNoticeConfirmed?: boolean;
  /** 고지를 확인했을 때 (확인 기록은 부르는 쪽이 고지 버전과 함께 남긴다) */
  onNoticeConfirm?: () => void;
  /** 추천 질문 칩 */
  suggestions?: readonly string[];
  messages?: readonly AssistantMessage[];
  /** 진행 상태 한 줄 */
  progress?: ProgressStatusProps;
  /** 답변을 받는 중 — [보내기]를 끈다 */
  busy?: boolean;
  /** 전문가 연결 두 버튼 (CHAT-17) — 연락 요청이 닫혀 있으면 requestHref를 넘기지 않는다 */
  experts?: ExpertLinks;
  /** 질문 보내기 — 패널은 네트워크를 쓰지 않는다. 부르는 쪽이 서버로 보낸다 */
  onSubmit?: (question: string) => void;
  onClose?: () => void;
  /** 닫은 뒤 초점을 돌려줄 요소 (런처) */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** fixed = 데스크톱 우측 하단 카드·모바일 전체 화면, inline = 견본 등 흐름 안 */
  placement?: "fixed" | "inline";
  /** 열릴 때 패널 안으로 초점을 옮긴다 (기본 켬) */
  autoFocus?: boolean;
  id?: string;
};

const FIXED =
  "fixed inset-0 z-50 sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[36rem] sm:max-h-[calc(100dvh-3rem)] sm:w-[24rem] sm:rounded-2xl sm:border sm:border-navy-100 sm:shadow-[0_8px_40px_-20px_rgba(6,24,42,0.25)]";
const INLINE = "h-[36rem] w-full max-w-[24rem] rounded-2xl border border-navy-100 shadow-[0_8px_40px_-20px_rgba(6,24,42,0.25)]";
const SUGGESTION =
  "inline-flex min-h-11 items-center rounded-md border border-navy-100 bg-ivory px-3 text-[13px] font-bold text-navy-700 transition hover:border-hermes-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 disabled:cursor-not-allowed disabled:opacity-50";

function Message({ message, experts }: { message: AssistantMessage; experts?: ExpertLinks }) {
  switch (message.kind) {
    case "question":
      return (
        <div data-message="question" className="ml-auto max-w-[85%] rounded-2xl bg-navy-50 px-4 py-3 text-[15px] text-navy-900">
          <span className="sr-only">내 질문: </span>
          {message.text}
        </div>
      );
    case "answer":
      return (
        <div data-message="answer">
          <AnswerCard {...message.answer} experts={experts} />
        </div>
      );
    case "scope":
      return (
        <section data-message="scope" aria-label="도우미가 답하지 않는 질문" className="rounded-2xl border border-navy-100 bg-white p-5">
          <p className="text-[16px] font-bold text-navy-900">{message.reason}</p>
          <ul className="mt-2 space-y-0.5 text-[15px]">
            {message.links.map((l) => (
              <li key={l.href}>
                <SiteLink href={l.href} newWindowLabel="별도 사이트 · 새 창">
                  {l.label}
                </SiteLink>
              </li>
            ))}
          </ul>
          <p className={`mt-2 ${MONO}`}>
            기준일 <DateText value={message.basisDate} />
          </p>
          {experts && <ExpertButtons links={experts} />}
        </section>
      );
    case "search-only":
      return (
        <section data-message="search-only" aria-label="사이트 검색 결과" className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <StateChip tone="amber">검색 결과만</StateChip>
          <p className="mt-2 text-[15px] text-navy-800">지금은 사이트 검색 결과로 안내합니다.</p>
          <ul className="mt-2 space-y-0.5 text-[15px]">
            {message.results.map((r) => (
              <li key={r.href}>
                <SiteLink href={r.href}>{r.label}</SiteLink>
              </li>
            ))}
          </ul>
          {experts && <ExpertButtons links={experts} />}
        </section>
      );
  }
}

/**
 * AI 도우미 패널 — 화면만 (CHAT-01 · CHAT-08 · CHAT-16 · CHAT-17). 질문은 onSubmit으로 넘기고 네트워크를 쓰지 않는다.
 * 첫 사용 고지를 확인해야 입력창이 열린다. 주 버튼은 [보내기] 하나. Esc로 닫고 초점은 런처로 돌아간다.
 * 모드 탭(안내·지방세봇)은 4단계 평가 통과 뒤에 생긴다 — 1단계에는 탭 HTML 0 (그 값을 받는 속성도 없다).
 */
export function AssistantPanel({
  aiNotice,
  firstUseNotice,
  defaultNoticeConfirmed = false,
  onNoticeConfirm,
  suggestions = [],
  messages = [],
  progress,
  busy = false,
  experts,
  onSubmit,
  onClose,
  returnFocusRef,
  placement = "fixed",
  autoFocus = true,
  id,
}: AssistantPanelProps) {
  const titleId = useId();
  const inputId = useId();
  const [confirmedHere, setConfirmedHere] = useState(false);
  // 확인 기록이 늦게 도착해도(브라우저 기록 읽기) 고지 상자를 다시 묻지 않는다
  const confirmed = confirmedHere || defaultNoticeConfirmed;
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLElement>(null);
  const focusInputNext = useRef(false);

  // 열릴 때 초점을 패널 안으로 — 확인 기록이 있으면 입력창, 없으면 고지 확인 버튼 (8.9)
  useEffect(() => {
    if (!autoFocus) return;
    if (defaultNoticeConfirmed) inputRef.current?.focus();
    else noticeRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [autoFocus, defaultNoticeConfirmed]);

  useEffect(() => {
    if (confirmed && focusInputNext.current) {
      focusInputNext.current = false;
      inputRef.current?.focus();
    }
  }, [confirmed]);

  function confirmNotice() {
    focusInputNext.current = true;
    setConfirmedHere(true);
    onNoticeConfirm?.();
  }

  function close() {
    onClose?.();
    returnFocusRef?.current?.focus();
  }

  function send(text: string) {
    const q = text.trim();
    if (!confirmed || busy || !q) return;
    onSubmit?.(q);
    setQuestion("");
  }

  function onFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send(question);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <section
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      data-ui="assistant-panel"
      data-nosnippet=""
      onKeyDown={onKeyDown}
      className={cx("flex flex-col overflow-hidden bg-white", placement === "fixed" ? FIXED : INLINE)}
    >
      <header className="border-b border-navy-100 px-5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>ASSISTANT</Eyebrow>
            <h2 id={titleId} className="mt-1 text-[19px] font-black text-navy-900">
              {ASSISTANT_TITLE}
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-navy-100 px-3 text-[14px] font-semibold text-navy-700 transition hover:border-navy-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
          >
            닫기
          </button>
        </div>
        <p className="mt-1 text-[13px] text-navy-600">{aiNotice}</p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!confirmed && (
          <section ref={noticeRef} aria-label="처음 쓰기 전에 확인해 주세요" className="rounded-2xl border border-navy-100 bg-ivory p-5">
            <p className="text-[16px] font-black text-navy-900">처음 쓰기 전에 확인해 주세요</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] text-navy-800">
              {firstUseNotice.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <DarkButton className="mt-4" onClick={confirmNotice}>
              확인했습니다
            </DarkButton>
          </section>
        )}

        {suggestions.length > 0 && (
          <ul aria-label="추천 질문" className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" disabled={!confirmed || busy} onClick={() => send(s)} className={SUGGESTION}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div role="log" aria-live="polite" aria-label="대화" className="space-y-4">
          {messages.map((m) => (
            <Message key={m.id} message={m} experts={experts} />
          ))}
        </div>
      </div>

      <div className="border-t border-navy-100 px-5 pt-3 pb-4">
        {progress && (
          <div className="mb-2">
            <ProgressStatus {...progress} />
          </div>
        )}
        <form onSubmit={onFormSubmit} className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            질문
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            autoComplete="off"
            disabled={!confirmed}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="궁금한 점을 적어 주세요"
            className="min-h-11 w-0 min-w-0 flex-1 rounded-xl border border-navy-100 bg-white px-4 text-[16px] text-navy-900 placeholder:text-navy-400 focus-visible:border-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 disabled:cursor-not-allowed disabled:bg-navy-50"
          />
          <PrimaryButton type="submit" disabled={!confirmed || busy}>
            보내기
          </PrimaryButton>
        </form>
      </div>
    </section>
  );
}
