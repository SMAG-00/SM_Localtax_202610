"use client";

import { useState } from "react";
import { track } from "@/lib/analytics/client";

// 코파일럿 화면 (W13-e) - 4종 입력, 문단+인용 칩, "AI 초안" 표지, 스크랩·메모 저장. 안내·면책 문구는 여기에 쓰지 않는다(법률 검토 뒤 설정에서).
type Kind = "comparison" | "history" | "publications" | "issue_memo";
const KINDS: Array<{ kind: Kind; label: string; feature: "compare" | "history_summary" | "publication_summary" | "issue_memo" }> = [
  { kind: "comparison", label: "결정례 비교표", feature: "compare" },
  { kind: "history", label: "조문 연혁 요약", feature: "history_summary" },
  { kind: "publications", label: "관련 출판물 요약", feature: "publication_summary" },
  { kind: "issue_memo", label: "쟁점 메모 초안", feature: "issue_memo" },
];
interface Para {
  text: string;
  chips: string[];
}

const splitIds = (s: string) => [...new Set(s.split(/[\s,]+/u).map((x) => x.trim()).filter(Boolean))];

export function CopilotPanel({ open, reason, used, limit }: { open: boolean; reason: string | null; used: number; limit: number }) {
  const [kind, setKind] = useState<Kind>("comparison");
  const [ids, setIds] = useState("");
  const [ref, setRef] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [paras, setParas] = useState<Para[]>([]);
  const [runId, setRunId] = useState("");
  const [count, setCount] = useState(used);

  const idList = splitIds(ids);
  const countOk = kind === "comparison" ? idList.length >= 2 && idList.length <= 8 : idList.length >= 1 && idList.length <= 8;
  const inputOk = kind === "history" ? ref.trim().length >= 2 && !!from && !!to : kind === "publications" ? ref.trim().length >= 2 : countOk;
  const canRun = open && !busy && inputOk && count < limit;
  const feature = KINDS.find((k) => k.kind === kind)!;

  async function run() {
    setBusy(true);
    setMsg("");
    setParas([]);
    setRunId("");
    const body = kind === "comparison" ? { kind, ids: idList } : kind === "history" ? { kind, ref, from, to } : kind === "publications" ? { kind, ref } : { kind, ids: idList, note };
    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg(res.status === 429 ? "quota" : (j.error ?? "error"));
        return;
      }
      setRunId(res.headers.get("x-copilot-run") ?? "");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let answered = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const b of blocks) {
          const ev = /^event: (.+)$/mu.exec(b)?.[1];
          const data = /^data: (.+)$/mu.exec(b)?.[1];
          if (!ev || !data) continue;
          const d = JSON.parse(data) as { text?: string; citations?: Array<{ label?: string }> };
          if (ev === "paragraph") {
            answered = true;
            setParas((p) => [...p, { text: String(d.text ?? ""), chips: (d.citations ?? []).map((c) => String(c.label ?? "")) }]);
          } else if (ev === "fallback" || ev === "error" || ev === "clarify") setMsg(ev);
        }
      }
      if (answered) {
        setCount((c) => c + 1);
        // 실행 성공 뒤에만 보낸다 - 질문 원문·입력은 싣지 않는다 (events.ts copilot_used)
        void track("copilot_used", { section: null, props: { feature: feature.feature } });
      }
    } catch {
      setMsg("error");
    } finally {
      setBusy(false);
    }
  }

  const plain = paras.map((p) => p.text).join("\n\n");
  async function post(action: string, extra: Record<string, unknown>) {
    const res = await fetch("/api/workspace/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    setMsg(res.ok ? "saved" : "save_failed");
  }
  const title = `${feature.label} (AI 초안)`;

  return (
    <section className="mt-4" aria-label="리서치 코파일럿">
      <div role="tablist" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} role="tab" aria-selected={kind === k.kind} onClick={() => setKind(k.kind)} className={`min-h-11 rounded border px-3 ${kind === k.kind ? "bg-navy-900 text-white" : ""}`}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3">
        {(kind === "comparison" || kind === "issue_memo") && (
          <label className="grid gap-1">
            <span>{kind === "comparison" ? "결정례 번호 (2~8건, 쉼표나 줄바꿈으로 구분)" : "조문·결정례 번호 (1~8건)"}</span>
            <textarea value={ids} onChange={(e) => setIds(e.target.value)} rows={3} className="rounded border p-2" />
            <span aria-live="polite">{idList.length}건</span>
          </label>
        )}
        {(kind === "history" || kind === "publications") && (
          <label className="grid gap-1">
            <span>조문</span>
            <input value={ref} onChange={(e) => setRef(e.target.value)} maxLength={80} className="min-h-11 rounded border p-2" />
          </label>
        )}
        {kind === "history" && (
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1"><span>시작일</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 rounded border p-2" /></label>
            <label className="grid gap-1"><span>끝일</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 rounded border p-2" /></label>
          </div>
        )}
        {kind === "issue_memo" && (
          <label className="grid gap-1"><span>메모 (선택)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} className="rounded border p-2" /></label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={run} disabled={!canRun} className="min-h-11 rounded bg-navy-900 px-4 text-white disabled:opacity-40" data-testid="copilot-run">
            실행
          </button>
          {!open && <span data-testid="copilot-closed" data-reason={reason ?? ""} />}
          {limit > 0 && <span>{count}/{limit}</span>}
        </div>
      </div>
      <div role="status" aria-live="polite" data-testid="copilot-msg" data-msg={msg} />
      {paras.length > 0 && (
        <article className="mt-6" data-testid="copilot-result">
          <p className="inline-block rounded border px-2 py-1 text-sm">AI 초안</p>
          {paras.map((p, i) => (
            <div key={i} className="mt-3">
              <p>{p.text}</p>
              <ul className="mt-1 flex flex-wrap gap-2 text-sm">{p.chips.map((c, j) => <li key={j} className="rounded border px-2">{c}</li>)}</ul>
            </div>
          ))}
          <div className="mt-4 flex flex-wrap gap-3">
            {runId && <button type="button" className="min-h-11 rounded border px-3" onClick={() => post("scrap_add", { targetKind: "copilot_result", targetId: runId, label: title })}>스크랩</button>}
            <button type="button" className="min-h-11 rounded border px-3" onClick={() => post("note_save", { title, body: plain, aiDraft: true, ...(runId ? { targetKind: "copilot_result", targetId: runId } : {}) })}>내 메모로 저장</button>
          </div>
        </article>
      )}
    </section>
  );
}
