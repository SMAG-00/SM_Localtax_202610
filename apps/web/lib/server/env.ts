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
