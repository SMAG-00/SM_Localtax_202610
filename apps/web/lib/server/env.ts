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

/** 법제처 국가법령정보 기관코드 (W10-c PIPE-01) — 서버 전용 비밀. 없으면 수집 작업은 요청 0으로 건너뛴다 */
export function lawApiOc(): string | undefined {
  return process.env.LAW_API_OC || undefined;
}

/** 공공데이터 인증키 (W10-h 분야 데이터 연동) — 서버 전용 비밀. 없으면 해당 수집은 요청 0으로 건너뛴다 */
export function dataApiKey(): string | undefined {
  return process.env.DATA_API_KEY || undefined;
}

/** DART 인증키 (W10-h DF-06) — 서버 전용 비밀 */
export function dataApiDartKey(): string | undefined {
  return process.env.DATA_API_DART_KEY || undefined;
}

export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || undefined;
}

/** 시도 횟수 해시 열쇠 (W2-e 4.1 — HMAC-SHA256). 없으면 시도 제한이 필요한 화면(로그인 등)은 닫힌다 — 안전한 쪽 */
export function guardSecret(): string | undefined {
  return process.env.GUARD_SECRET || undefined;
}

/** 메일 설정 (W2-e 8.1) — 이름을 하나씩 읽어 환경변수 검사(check-env)가 읽는 곳을 찾게 한다. 모양 검사는 mail/config.ts readMailConfig */
export function mailEnv(): Record<string, string | undefined> {
  return {
    MAIL_FROM: process.env.MAIL_FROM,
    MAIL_SMTP_HOST: process.env.MAIL_SMTP_HOST,
    MAIL_SMTP_PORT: process.env.MAIL_SMTP_PORT,
    MAIL_SMTP_USER: process.env.MAIL_SMTP_USER,
    MAIL_SMTP_PASSWORD: process.env.MAIL_SMTP_PASSWORD,
    MAIL_SMTP_SECURE: process.env.MAIL_SMTP_SECURE,
  };
}

/** 운영 배치 AI 설정 (W10-e AIOPS-04) — 사용자 경로 키(ANTHROPIC_API_KEY)와 분리된 키. 하나라도 없으면 운영 AI 호출 0 */
export function opsAiEnv(): { apiKey: string | undefined; model: string | undefined; effort: string | undefined; baseUrl: string | undefined } {
  return {
    apiKey: process.env.ANTHROPIC_API_KEY_OPS || undefined,
    model: process.env.AGENT_MODEL_OPS || undefined,
    effort: process.env.AGENT_EFFORT_OPS || undefined,
    baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
  };
}

/** 관리자 이메일 화이트리스트 (ACC-04 — 관리자 권한은 DB가 아니라 배포 환경변수). 쉼표로 나누고 대소문자를 가리지 않는다 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** 감사 기록 관리자(PO) 이메일 — 감사 기록 수정·삭제는 이 목록의 이메일만 (ADM-04). 관리자 목록(ADMIN_EMAILS)과 별개다 */
export function auditAdminEmails(): string[] {
  return (process.env.AUDIT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** 검색 노출 게이트 (PRD-01A 11장 운영 도메인 전환 — 권고값 off). `on`일 때만 색인 대상 화면(최소선 이상 지역 허브 — W4 11단계)이 index를 낸다. 그 밖 값·없음 = 꺼짐 */
export function siteIndexing(): boolean {
  return process.env.SITE_INDEXING?.trim() === "on";
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

/** 결제 설정 (W10-f) — 이름을 하나씩 읽어 환경변수 검사(check-env)가 읽는 곳을 찾게 한다. 해석·검증은 billing/config.ts readBillingConfig */
export function billingEnv(): Record<string, string | undefined> {
  return {
    PG_MODE: process.env.PG_MODE,
    PG_SECRET_KEY: process.env.PG_SECRET_KEY,
    PG_WEBHOOK_SECRET: process.env.PG_WEBHOOK_SECRET,
    PG_FAKE_URL: process.env.PG_FAKE_URL,
    NEXT_PUBLIC_PG_CLIENT_KEY: process.env.NEXT_PUBLIC_PG_CLIENT_KEY,
  };
}
