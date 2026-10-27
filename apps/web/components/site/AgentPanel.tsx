"use client";

import { useRef, useState } from "react";
import { parseSse } from "@/lib/agent/sse";
import type { AgentOpenDetail, AgentUiProps } from "@/lib/agent/entry";
import { FEEDBACK_REASONS } from "@/lib/agent/feedback";

// 지방세봇 모드 화면 (W12-d d2 - CHAT-15 · ASK-06 · ASK-11 · ASK-12 · COMPLY-01). 같은 창 안의 모드 - 주소·제목을 바꾸지 않는다.
// 고지·사유 이름 문구는 설정/목록에서 온다. 이 파일에는 법률 문구가 없다.
interface Chip {
  kind: string;
  label: string;
  sourceId: string;
  validFrom: string;
  live: boolean;
  unreviewed: boolean;
  fetchedAt: string | null;
}
interface Para {
  text: string;
  chips: Chip[];
}
interface Entry {
  id: number;
  question: string;
  status: string;
  paragraphs: Para[];
  clarify: Array<{ id?: string; text?: string }> | null;
  extras: Array<{ block: string; data: Record<string, unknown> }>;
  fallbackLine: string | null;
  fallbackResults: Array<{ sourceId: string; chip?: Chip }>;
  highRisk: boolean;
  error: string | null;
  quota: { next: string } | null;
  turn: number;
}

const REASON_LABEL: Record<(typeof FEEDBACK_REASONS)[number], string> = { wrong: "틀림", weak_evidence: "근거 부족", hard_to_understand: "이해 어려움", other: "기타" };

export default function AgentPanel(props: { id: string; ui: AgentUiProps; prefill: AgentOpenDetail | null; onClose: () => void }) {
  const noticeKey = `agent-mode-notice:${props.ui.noticeVersion}`;
  const [noticeOk, setNoticeOk] = useState(() => {
    try {
      return window.localStorage.getItem(noticeKey) === "ok";
    } catch {
      return false;
    }
  });
  const [text, setText] = useState(props.prefill?.prefill ?? "");
  const [tone, setTone] = useState<"general" | "expert">("general");
  const [saveOff, setSaveOff] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Chip | null>(null);
  const session = useRef<string | null>(null);
  const entryCtx = useRef<AgentOpenDetail | null>(props.prefill);
  const turns = useRef(0);

  const patch = (id: number, f: (e: Entry) => Entry) => setEntries((l) => l.map((e) => (e.id === id ? f(e) : e)));

  async function send() {
    const q = text.trim();
    if (q === "" || busy) return;
    const id = Date.now();
    const turn = (turns.current += 1);
    setBusy(true);
    setText("");
    setEntries((l) => [...l, { id, question: q, status: "searching", paragraphs: [], clarify: null, extras: [], fallbackLine: null, fallbackResults: [], highRisk: false, error: null, quota: null, turn }]);
    const first = turn === 1 ? entryCtx.current : null;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: q, mode: tone, saveOff, ...(session.current ? { sessionId: session.current } : {}), ...(first ? { entry: first.entry, entryId: first.entryId ?? undefined } : {}) }),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { next?: string };
        turns.current -= 1;
        patch(id, (e) => ({ ...e, status: "done", quota: { next: body.next ?? "tomorrow" } }));
        return;
      }
      if (!res.ok || !res.body) throw new Error("fail");
      session.current = res.headers.get("x-ask-session") ?? session.current;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const cut = buf.lastIndexOf("\n\n");
        if (cut < 0) continue;
        const ready = buf.slice(0, cut + 2);
        buf = buf.slice(cut + 2);
        for (const ev of parseSse(ready)) {
          const d = ev.data;
          if (ev.event === "status") patch(id, (e) => ({ ...e, status: String(d.phase ?? "") }));
          else if (ev.event === "paragraph") patch(id, (e) => ({ ...e, paragraphs: [...e.paragraphs, { text: String(d.text ?? ""), chips: Array.isArray(d.citations) ? (d.citations as Chip[]) : [] }] }));
          else if (ev.event === "clarify") patch(id, (e) => ({ ...e, clarify: Array.isArray(d.questions) ? (d.questions as Entry["clarify"]) : [] }));
          else if (ev.event === "calc" || ev.event === "benefits" || ev.event === "determination") patch(id, (e) => ({ ...e, extras: [...e.extras, { block: ev.event, data: d }] }));
          else if (ev.event === "fallback") patch(id, (e) => ({ ...e, fallbackLine: String(d.line ?? ""), fallbackResults: Array.isArray(d.results) ? (d.results as Entry["fallbackResults"]) : [] }));
          else if (ev.event === "done") patch(id, (e) => ({ ...e, status: "done", highRisk: d.highRisk === true }));
          else if (ev.event === "error") patch(id, (e) => ({ ...e, status: "done", error: "답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }));
        }
      }
      patch(id, (e) => (e.status === "done" ? e : { ...e, status: "done" }));
    } catch {
      patch(id, (e) => ({ ...e, status: "done", error: "답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요." }));
    } finally {
      setBusy(false);
    }
  }

  function feedback(turn: number, kind: string, reason: string | null) {
    if (!session.current) return;
    void fetch("/api/ask/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: session.current, turn, kind, reason }) }).catch(() => undefined);
  }

  return (
    <section id={props.id} role="dialog" aria-label="지방세봇" data-agent-panel="" className="fixed right-4 bottom-24 z-50 flex max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-2xl border border-navy-100 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
        <h2 className="text-[17px] font-black text-navy-900">지방세봇</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label="말투" className="flex overflow-hidden rounded-lg border border-navy-200 text-[14px]">
            {(["general", "expert"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tone === t} onClick={() => setTone(t)} className={`min-h-9 px-3 font-bold ${tone === t ? "bg-navy-900 text-white" : "bg-white text-navy-900"}`}>
                {t === "general" ? "일반" : "전문가"}
              </button>
            ))}
          </div>
          <button type="button" onClick={props.onClose} aria-label="닫기" className="min-h-9 min-w-9 text-[18px]">×</button>
        </div>
      </header>
      {!noticeOk ? (
        <div className="overflow-y-auto p-4" data-agent-part="mode-notice">
          <p className="text-[15px] leading-relaxed whitespace-pre-line text-navy-900">{props.ui.modeNotice}</p>
          <button
            type="button"
            className="mt-4 min-h-11 rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white"
            onClick={() => {
              setNoticeOk(true);
              try {
                window.localStorage.setItem(noticeKey, "ok");
              } catch {
                /* 저장을 못 해도 이번 대화는 계속 */
              }
            }}
          >
            확인
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {entries.length === 0 && <p className="text-[15px] text-navy-600">궁금한 점을 적고 보내기를 눌러 주세요. 창을 여는 것만으로는 질문 횟수가 줄지 않습니다.</p>}
            {entries.map((e) => (
              <article key={e.id} data-agent-answer="" className="space-y-2">
                <p className="rounded-xl bg-navy-50 px-3 py-2 text-[15px] font-bold text-navy-900">{e.question}</p>
                {e.status !== "done" && <p className="text-[14px] text-navy-600">{e.status === "searching" ? "근거를 찾는 중입니다" : e.status === "writing" ? "답변을 쓰는 중입니다" : "확인 중입니다"}</p>}
                {e.paragraphs.map((p, i) => (
                  <div key={i} data-block="paragraph">
                    <p className="text-[16px] leading-relaxed text-navy-900">{p.text}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.chips.map((c, j) => (
                        <button key={j} type="button" onClick={() => setPanel(c)} className="min-h-8 rounded-full border border-navy-200 px-3 text-[13px] font-bold text-navy-900">
                          {c.kind} {c.label}
                          {c.live && <span aria-label="실시간"> ●</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {e.clarify && e.clarify.length > 0 && (
                  <ul data-block="clarify" className="list-disc pl-5 text-[15px] text-navy-900">
                    {e.clarify.map((q, i) => <li key={i}>{q.text ?? ""}</li>)}
                  </ul>
                )}
                {e.extras.map((x, i) => <div key={i} data-block={x.block} />)}
                {e.fallbackLine && (
                  <div data-block="fallback">
                    <p className="text-[15px] text-navy-900">{e.fallbackLine}</p>
                    <ul className="mt-1 text-[14px] text-navy-700">
                      {e.fallbackResults.map((r, i) => <li key={i}>{r.chip ? `${r.chip.kind} ${r.chip.label}` : r.sourceId}</li>)}
                    </ul>
                  </div>
                )}
                {e.quota && (
                  <p role="status" data-block="quota" className="text-[15px] font-bold text-navy-900">
                    {e.quota.next === "signup" ? "오늘 질문 횟수를 모두 썼습니다. 가입하면 더 질문할 수 있습니다." : "오늘 질문 횟수를 모두 썼습니다. 내일 다시 이용해 주세요."}
                    {e.quota.next === "signup" && <a href="/signup" className="ml-2 underline">가입하기</a>}
                  </p>
                )}
                {e.error && <p role="alert" className="text-[15px] text-rose-800">{e.error}</p>}
                {e.status === "done" && !e.error && !e.quota && (
                  <footer className="space-y-1">
                    {props.ui.answerFooter && <p data-block="answer-footer" className="text-[13px] text-navy-600">{props.ui.answerFooter}</p>}
                    <div className="flex flex-wrap items-center gap-2" data-block="feedback">
                      <button type="button" className="min-h-8 rounded-lg border border-navy-200 px-2 text-[13px]" onClick={() => feedback(e.turn, "helpful", null)}>도움이 됐어요</button>
                      <label className="text-[13px]">
                        <span className="sr-only">아쉬운 이유</span>
                        <select className="min-h-8 rounded-lg border border-navy-200 px-1 text-[13px]" defaultValue="" onChange={(ev) => ev.target.value && feedback(e.turn, "not_helpful", ev.target.value)}>
                          <option value="">아쉬워요</option>
                          {FEEDBACK_REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                        </select>
                      </label>
                      <button type="button" className="min-h-8 rounded-lg border border-navy-200 px-2 text-[13px]" onClick={() => feedback(e.turn, "error_report", "other")}>오류 신고</button>
                    </div>
                  </footer>
                )}
              </article>
            ))}
          </div>
          {panel && (
            <div role="region" aria-label="원문 정보" data-block="source-panel" className="border-t border-navy-100 bg-navy-50 px-4 py-2 text-[13px] text-navy-900">
              <p className="font-bold">{panel.kind} {panel.label}</p>
              <p>시행일 {panel.validFrom}</p>
              {panel.live && <p>실시간 · 미검수 · 조회 시각 {panel.fetchedAt ?? "확인 필요"}</p>}
              <button type="button" className="underline" onClick={() => setPanel(null)}>닫기</button>
            </div>
          )}
          <form className="border-t border-navy-100 p-3" onSubmit={(ev) => { ev.preventDefault(); void send(); }}>
            <label className="sr-only" htmlFor={`${props.id}-q`}>질문</label>
            <textarea id={`${props.id}-q`} value={text} onChange={(ev) => setText(ev.target.value)} rows={2} maxLength={500} className="block w-full rounded-xl border border-navy-200 px-3 py-2 text-[16px]" />
            <div className="mt-2 flex items-center justify-between">
              <label className="text-[13px] text-navy-700">
                <input type="checkbox" checked={saveOff} disabled={turns.current > 0} onChange={(ev) => setSaveOff(ev.target.checked)} /> 이 대화를 서버에 저장하지 않기
              </label>
              <button type="submit" disabled={busy || text.trim() === ""} className="min-h-11 rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white disabled:opacity-50">
                보내기
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
