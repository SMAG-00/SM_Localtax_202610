import "server-only";

// 서버 전용 환경변수 읽기 — 이 모듈을 클라이언트 컴포넌트가 불러오면 빌드가 실패한다 (ENV-03, server-only 표식)

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

export function supabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
}

export function supabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || undefined;
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

/** Vercel이 주는 배포 환경 (production · preview · development). Vercel 밖에서는 없다 */
export function vercelEnv(): string | undefined {
  return process.env.VERCEL_ENV || undefined;
}

/** 배포된 커밋 앞 7자리 (Vercel이 준다). 배포 후 점검이 새 배포가 반영됐는지 확인할 때 쓴다 — 비밀 아님 */
export function deployedVersion(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : null;
}
