import { checkDeployment } from "@/lib/deployment-check";
import { anonClient } from "@/lib/server/supabase";
import { supabaseUrl, vercelEnv } from "@/lib/server/env";

// 상태 확인 (FND-06) — 항목별 결과. 하나라도 실패하면 503과 실패 항목 이름. 키·접속 주소·ref는 응답에 넣지 않는다.
//  db  — DB 응답(health_ping)
//  env — 배포 환경과 DB의 짝 (FND-02: Production은 prod DB만, Preview·Development는 prod DB 금지). Vercel 밖에서는 skipped
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 3000;

async function checkDb(): Promise<boolean> {
  const client = anonClient();
  if (!client) return false;
  try {
    const { data, error } = await client.rpc("health_ping").abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function GET() {
  const checks = {
    db: (await checkDb()) ? "ok" : "fail",
    env: checkDeployment(vercelEnv(), supabaseUrl()),
  } as const;
  const failed = Object.entries(checks)
    .filter(([, v]) => v === "fail")
    .map(([k]) => k);
  return Response.json(
    { status: failed.length ? "fail" : "ok", checks, failed, at: new Date().toISOString() },
    { status: failed.length ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
