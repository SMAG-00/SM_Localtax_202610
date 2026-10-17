import environments from "../config/environments.json";

// 배포 환경 ↔ DB 오연결 검사 (FND-02) — Production은 prod DB만, Preview·Development는 prod DB를 가리키면 안 된다.
// Vercel 밖(사내 서버 Docker·로컬)에서는 VERCEL_ENV가 없으므로 검사하지 않는다(skipped).

export type DeploymentCheck = "ok" | "fail" | "skipped";

const REFS = environments.supabaseRef;

/** https://<ref>.supabase.co → ref. Supabase 기본 주소가 아니면 null */
export function supabaseRefOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.co$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function checkDeployment(vercelEnv: string | undefined, supabaseUrl: string | undefined): DeploymentCheck {
  if (!vercelEnv) return "skipped";
  const ref = supabaseRefOf(supabaseUrl);
  if (vercelEnv === "production") return ref === REFS.production ? "ok" : "fail";
  // preview·development: 운영 DB를 가리키면 실패. staging·로컬은 통과
  return ref === REFS.production ? "fail" : "ok";
}
