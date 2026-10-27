import { resolveAgentUi } from "@/lib/server/agent/exposure";
import type { Entry } from "@/lib/agent/request";
import { AgentEntryButton } from "./AgentEntryButton";

// 지방세봇 진입점 (W12-d d3 - ASK-13 · HOME-10). 모드가 닫혀 있으면 아무것도 그리지 않는다(렌더 0). 눌러도 창만 열고 질의를 채울 뿐 전송하지 않는다.
export async function AgentEntry(props: { entry: Entry; entryId?: string | null; prefill?: string; label?: string; variant?: "card" | "inline" }) {
  const ui = await resolveAgentUi();
  if (!ui) return null;
  return <AgentEntryButton entry={props.entry} entryId={props.entryId ?? null} prefill={props.prefill ?? ""} label={props.label ?? "지방세봇에게 이 질문 묻기"} variant={props.variant ?? "inline"} />;
}
