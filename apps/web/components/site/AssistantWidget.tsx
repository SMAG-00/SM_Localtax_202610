"use client";

import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantLauncher } from "@ltr/ui";
import { AGENT_OPEN_EVENT, type AgentOpenDetail, type AgentUiProps } from "@/lib/agent/entry";
import { assistantHiddenOn } from "@/lib/site/assistant-paths";

// 런처만 첫 화면 번들에 둔다 — 패널·대화 코드는 누를 때 불러온다 (CHAT-02).
const Chat = lazy(() => import("./AssistantChat"));
const Agent = lazy(() => import("./AgentPanel"));

// agent가 null이면(공개 판정 닫힘 또는 고지 문구 비어 있음) 모드 탭·진입 이벤트 처리 모두 0 - 기존 도우미 그대로 (CHAT-15)
export function AssistantWidget(props: { aiNotice: string; firstUseNotice: string[]; noticeVersion: string; agent?: AgentUiProps | null }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"assistant" | "agent">("assistant");
  const [prefill, setPrefill] = useState<AgentOpenDetail | null>(null);
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const agent = props.agent ?? null;
  useEffect(() => {
    if (!agent) return;
    const onOpen = (ev: Event) => {
      // 진입점: 창을 지방세봇 모드로 열고 질의만 채운다 - 전송·주소 변경·한도 차감 0
      setPrefill((ev as CustomEvent<AgentOpenDetail>).detail ?? null);
      setMode("agent");
      setLoaded(true);
      setOpen(true);
    };
    window.addEventListener(AGENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(AGENT_OPEN_EVENT, onOpen);
  }, [agent]);
  // 결제 화면에는 런처를 그리지 않는다 (PRD_최종 4.1 - 결제 화면 AI 도우미 런처 0)
  if (assistantHiddenOn(usePathname())) return null;
  const { agent: _agent, ...chatProps } = props;
  void _agent;
  return (
    <div data-nosnippet="" data-assistant-root="">
      <AssistantLauncher
        ref={launcher}
        expanded={open}
        controls={panelId}
        onClick={() => {
          setOpen((v) => !v);
          setLoaded(true);
        }}
      />
      {loaded && open && agent && (
        <div role="tablist" aria-label="도우미 모드" data-mode-switch="" className="fixed right-4 bottom-20 z-[60] flex overflow-hidden rounded-full border border-navy-200 bg-white text-[14px] shadow">
          {(["assistant", "agent"] as const).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`min-h-9 px-4 font-bold ${mode === m ? "bg-navy-900 text-white" : "text-navy-900"}`}>
              {m === "assistant" ? "도우미" : "지방세봇"}
            </button>
          ))}
        </div>
      )}
      {loaded && open && (
        <Suspense fallback={null}>
          {mode === "agent" && agent ? (
            <Agent id={panelId} ui={agent} prefill={prefill} onClose={() => setOpen(false)} />
          ) : (
            <Chat id={panelId} onClose={() => setOpen(false)} returnFocusRef={launcher} {...chatProps} />
          )}
        </Suspense>
      )}
    </div>
  );
}
