"use client";

import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { usePathname } from "next/navigation";
import { AssistantPanel, type AssistantMessage, type AnswerCardProps } from "@ltr/ui";

// 도우미 대화 (CHAT-01 · CHAT-06 · CHAT-08 · CHAT-16) — 서버 /api/assistant로 질문을 보낸다.
//  · 맥락은 경로·제목·분야 세 칸뿐 (쿼리·조각·폼 값 0). 고지 확인은 고지 버전과 함께 브라우저에 기록한다.
//  · 모델 문장이 있는 답에만 'AI 답변' 표시 — 답변 카드(AnswerCard)가 붙이고, 검색 결과만·고정 안내 카드에는 없다.
interface Reply {
  sessionId: string;
  mode: "ai" | "search_only" | "fixed" | "rate_limited";
  reason: string | null;
  paragraphs: Array<{ text: string }>;
  sources: Array<{ title: string; href: string }>;
  links: Array<{ label: string; href: string; external: boolean }>;
  experts: { findHref: string | null; requestHref: string | null } | null;
  summary: boolean;
  cardNotice: string | null;
}

const SECTIONS = ["tax", "realestate", "local", "finance"];
const SUGGESTIONS = ["구독은 어디서 해요?", "이 글 요약해 줘", "개정안 진행 단계가 궁금해요"];
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export default function AssistantChat(props: {
  id: string;
  aiNotice: string;
  firstUseNotice: string[];
  noticeVersion: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const storageKey = `assistant-notice:${props.noticeVersion}`;
  const [confirmed, setConfirmed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === "ok";
    } catch {
      return false;
    }
  });
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [experts, setExperts] = useState<Reply["experts"]>(null);
  const session = useRef<string | null>(null);
  const seq = useRef(0);
  const nextId = () => `m${++seq.current}`;

  const sendFeedback = useCallback((kind: string) => {
    if (!session.current) return;
    void fetch("/api/assistant/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.current, kind }) }).catch(() => undefined);
  }, []);

  const toMessage = useCallback(
    (r: Reply): AssistantMessage => {
      const id = `m${++seq.current}`;
      if (r.mode === "ai") {
        const answer: Omit<AnswerCardProps, "experts"> = {
          paragraphs: r.paragraphs.map((p) => p.text),
          citations: r.sources.map((s) => ({ title: s.title, href: s.href })),
          summary: r.summary,
          onFeedback: (v) => sendFeedback(v === "helpful" ? "helpful" : "not_helpful"),
        };
        return { id, kind: "answer", answer };
      }
      if (r.mode === "search_only") return { id, kind: "search-only", results: r.links.map((l) => ({ label: l.label, href: l.href })) };
      return {
        id,
        kind: "scope",
        reason: [r.reason ?? "", r.cardNotice ?? ""].filter(Boolean).join(" "),
        links: r.links.map((l) => ({ label: l.label, href: l.href })),
        basisDate: kstToday(),
      };
    },
    [sendFeedback],
  );

  const submit = useCallback(
    async (question: string) => {
      setBusy(true);
      setMessages((m) => [...m, { id: nextId(), kind: "question", text: question }]);
      const segment = pathname.split("/")[1] ?? "";
      const context = { path: pathname, title: document.title.slice(0, 120), ...(SECTIONS.includes(segment) ? { field: segment } : {}) };
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: question, sessionId: session.current ?? undefined, context, noticeVersion: props.noticeVersion }),
        });
        const reply = (await res.json()) as Reply & { error?: string };
        if (!res.ok && !reply.sessionId) throw new Error(reply.error ?? "요청 실패");
        session.current = reply.sessionId;
        setExperts(reply.experts);
        setMessages((m) => [...m, toMessage(reply)]);
      } catch {
        setMessages((m) => [...m, { id: `m${++seq.current}`, kind: "search-only", results: [{ label: "사이트 검색", href: "/search" }] }]);
      } finally {
        setBusy(false);
      }
    },
    [pathname, props.noticeVersion, toMessage],
  );

  const expertLinks = useMemo(
    () => (experts && experts.findHref ? { findHref: experts.findHref, ...(experts.requestHref ? { requestHref: experts.requestHref } : {}) } : undefined),
    [experts],
  );

  return (
    <div
      onClickCapture={(e) => {
        const a = (e.target as HTMLElement).closest("a");
        if (!a) return;
        const href = a.getAttribute("href") ?? "";
        sendFeedback(href.startsWith("/experts") ? "expert_click" : href.startsWith("/help") ? "support_click" : "link_click");
      }}
    >
      <AssistantPanel
        id={props.id}
        aiNotice={props.aiNotice}
        firstUseNotice={props.firstUseNotice}
        defaultNoticeConfirmed={confirmed}
        onNoticeConfirm={() => {
          setConfirmed(true);
          try {
            window.localStorage.setItem(storageKey, "ok");
          } catch {
            /* 저장을 못 해도 이번 대화는 계속 */
          }
        }}
        suggestions={SUGGESTIONS}
        messages={messages}
        busy={busy}
        experts={expertLinks}
        onSubmit={submit}
        onClose={props.onClose}
        returnFocusRef={props.returnFocusRef}
      />
    </div>
  );
}
