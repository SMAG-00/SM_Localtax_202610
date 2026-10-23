import { authorize, requireViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { readConfig } from "@/lib/server/assistant/env";

// 도우미 현황 (CHAT-13 · CHAT-14) — 오늘 사용량, 기간 지표(해결률·사람 연결률·대화당 비용), 최근 평가 실행, 공개 게이트 상태. 읽기만.
// 관리자·직원 화면용이라 service role을 쓴다(도우미 요청 경로가 아니다). 질문 원문은 DB에 없으므로 나올 수 없다.
export const dynamic = "force-dynamic";

const day = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "metrics.read", "assistant");
  if (denied) return denied;
  const db = adminClient();
  if (!db) return Response.json({ error: "server not configured" }, { status: 503 });

  const now = new Date();
  const [usage, metrics, runs, notice] = await Promise.all([
    db.from("assistant_usage_daily").select("*").eq("day", day(now)).maybeSingle(),
    db.rpc("assistant_metrics", { p_from: day(new Date(now.getTime() - 29 * 86400_000)), p_to: day(now), p_include_internal: false }),
    db.from("assistant_eval_runs").select("id, started_at, model_answer, model_router, item_set_version, gate_passed, report").order("id", { ascending: false }).limit(5),
    db.from("settings").select("value").eq("key", "assistant_notice").maybeSingle(),
  ]);
  const cfg = readConfig();
  const m = (metrics.data ?? {}) as { sessions?: number; resolved?: number; handoff?: number; unresolved?: number; cost?: number };
  const sessions = Number(m.sessions ?? 0);
  return Response.json(
    {
      config: cfg.ok ? { enabled: true, public_flag: cfg.config.publicFlag, daily_token_budget: cfg.config.dailyTokenBudget } : { enabled: false, reason: cfg.reason },
      usage_today: usage.data ?? null,
      last_30_days: {
        ...m,
        resolved_rate: sessions > 0 ? Number(m.resolved ?? 0) / sessions : null,
        handoff_rate: sessions > 0 ? Number(m.handoff ?? 0) / sessions : null,
        cost_per_session: sessions > 0 ? Number(m.cost ?? 0) / sessions : null,
      },
      eval_runs: runs.data ?? [],
      notice_approved: ((notice.data?.value ?? {}) as { approved?: boolean }).approved === true,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
