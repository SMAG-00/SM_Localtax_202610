import { findJob } from "@ltr/workflows";
import { isAuthorizedCron, jobTrigger } from "@/lib/server/cron-auth";
import { jobServices } from "@/lib/server/jobs";
import { revalidatePublicData } from "@/lib/server/public/cache";
import { adminClient } from "@/lib/server/supabase";

// 배치 작업 실행 (FND-07) — Vercel Cron(GET)과 사내 스케줄러(POST)가 같은 함수를 부른다.
// CRON_SECRET 인증 → 작업 찾기 → agent_runs에 실행 기록(running → succeeded/failed).
// 작업에는 서버 기능(lib/server/jobs.ts — service_role)을 넘긴다. 결과가 공개 화면 값을 바꿨으면(revalidatePublic) 공개 데이터 캐시를 바로 비운다.
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
  // 시작·끝 시각을 같은 시계(이 서버)로 적는다 — DB 기본값 now()와 섞으면 두 시계 차이만큼 끝이 시작보다 앞설 수 있다
  const { data: started, error: startError } = await db
    .from("agent_runs")
    .insert({ job: name, trigger, started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (startError || !started) return json({ error: "run record failed" }, 503);

  try {
    const result = await job({ now: new Date(), services: jobServices(db) });
    await db
      .from("agent_runs")
      .update({ status: "succeeded", finished_at: new Date().toISOString(), detail: result.detail ?? null })
      .eq("id", started.id);
    if (result.revalidatePublic) revalidatePublicData();
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
