import "server-only";
import { agentUiProps, type AgentUiProps } from "@/lib/agent/entry";
import { db } from "@/lib/server/assistant/store";
import { viewerIsInternal } from "@/lib/server/assistant/service";
import { getViewer } from "@/lib/server/dal";
import { readModeGate } from "./d-store";

// 이 방문자에게 지방세봇 모드 버튼·진입점을 그릴지 (W12-d d1). 공개 판정 함수 한 번 + 계정 종류. 닫혀 있거나 읽기 실패면 null(렌더 0).
export async function resolveAgentUi(): Promise<AgentUiProps | null> {
  try {
    const client = db();
    if (!client) return null;
    const [gate, internal, viewer] = await Promise.all([readModeGate(client), viewerIsInternal(), getViewer().catch(() => null)]);
    return agentUiProps(gate, internal ? "internal" : viewer ? "member" : "guest");
  } catch {
    return null;
  }
}
