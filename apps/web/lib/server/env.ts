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

/** 시도 횟수 해시 열쇠 (W2-e 4.1 — HMAC-SHA256). 없으면 시도 제한이 필요한 화면(로그인 등)은 닫힌다 — 안전한 쪽 */
export function guardSecret(): string | undefined {
  return process.env.GUARD_SECRET || undefined;
}

/** 관리자 이메일 화이트리스트 (ACC-04 — 관리자 권한은 DB가 아니라 배포 환경변수). 쉼표로 나누고 대소문자를 가리지 않는다 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** 사이트 절대 주소 (canonical·구조화 데이터). 없으면 canonical을 만들지 않는다 — 발행 점검이 막는다 (OPT-11) */
export function siteUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : undefined;
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
