import "server-only";
import { readAgentConfig } from "@/lib/agent/ask-config";
import { readRuntime } from "@/lib/server/agent/store";
import { db } from "@/lib/server/assistant/store";
import { hasEntitlementKey } from "@/lib/server/billing/service";
import { featureOn, readSetting } from "@/lib/server/brief/policy";
import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { copilotEnv } from "./env";
import { decideCopilotGate, parseMonthlyLimit, type GateReason } from "./logic";
import { peekRuns } from "./store";

// 화면용 공개 판정 - API(service.ts)와 같은 규칙(decideCopilotGate)을 쓴다. 기능 키가 꺼져 있으면 featureOn=false.
export interface PageGate {
  featureOn: boolean;
  loggedIn: boolean;
  open: boolean;
  reason: GateReason | null;
  used: number;
  limit: number;
}

export async function loadPageGate(): Promise<PageGate> {
  const admin = adminClient();
  const client = db();
  const closed: PageGate = { featureOn: false, loggedIn: false, open: false, reason: "feature_off", used: 0, limit: 0 };
  if (!admin || !client) return closed;
  const on = await featureOn(admin, "research_copilot").catch(() => false);
  if (!on) return closed;
  const viewer = await getViewer().catch(() => null);
  const cfg = readAgentConfig(copilotEnv());
  const rt = cfg.ok ? await readRuntime(client) : null;
  const limit = parseMonthlyLimit(await readSetting(admin, "copilot_monthly_limit").catch(() => undefined));
  const entitled = viewer ? await hasEntitlementKey(admin, viewer.userId, "copilot") : false;
  const gate = decideCopilotGate({ featureOn: true, modelConfigured: cfg.ok, stage: rt?.stage ?? "none", limit, internal: !!viewer && (viewer.isAdmin || viewer.roles.length > 0), loggedIn: !!viewer, entitled });
  const runs = viewer ? await peekRuns(admin, viewer.userId, limit) : { used: 0, limit: limit ?? 0 };
  return { featureOn: true, loggedIn: !!viewer, open: gate.open, reason: gate.open ? null : gate.reason, used: runs.used, limit: runs.limit };
}
