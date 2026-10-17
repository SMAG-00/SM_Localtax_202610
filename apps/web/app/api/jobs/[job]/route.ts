import { findJob } from "@ltr/workflows";
import { isAuthorizedCron, jobTrigger } from "@/lib/server/cron-auth";
import { adminClient } from "@/lib/server/supabase";

// 배치 작업 실행 (FND-07) — Vercel Cron(GET)과 사내 스케줄러(POST)가 같은 함수를 부른다.
// CRON_SECRET 인증 → 작업 찾기 → agent_runs에 실행 기록(running → succeeded/failed).
export const dynamic = "force-dynamic";

const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function run(request: Request, params: Promise<{ job: string }>) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) return json({ error: "unauthorized" }, 401);
  const { job: name } = await params;
  const job = findJob(name);
  if (!job) return json({ error: "unknown job" }, 404);
  const db = adminClient();
  if (!db) return json({ error: "server not configured" }, 503);

  const trigger = jobTrigger(request.headers);
  const { data: started, error: startError } = await db
    .from("agent_runs")
    .insert({ job: name, trigger })
    .select("id")
    .single();
  if (startError || !started) return json({ error: "run record failed" }, 503);

  try {
    const result = await job({ now: new Date() });
    await db
      .from("agent_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), detail: result.detail ?? null })
      .eq("id", started.id);
    return json({ runId: started.id, status: "succeeded" }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("agent_runs").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", started.id);
    return json({ runId: started.id, status: "failed" }, 500);
  }
}

export function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  return run(request, params);
}

export function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  return run(request, params);
}
