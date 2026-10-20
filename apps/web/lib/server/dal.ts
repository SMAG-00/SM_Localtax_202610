import "server-only";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { AUDITED_DENIALS, check, isStaffRole, type Action, type Resource, type Viewer } from "@/lib/access";
import { isSuspended } from "@/lib/admin/member-rules";
import { actorOf, writeAudit } from "./audit";
import { adminEmails, auditAdminEmails, siteUrl, supabaseAnonKey, supabaseUrl } from "./env";
import { HttpError, errorJson } from "./http";
import { cookieSessionClient } from "./session";
import { adminClient } from "./supabase";

// 데이터 접근 계층 (Next.js 인증 안내의 DAL) — 로그인 확인과 접근 판정을 여기 한 곳에 모은다 (PRD-00 6장 "접근 판정은 한 함수").
// · 세션: @supabase/ssr 쿠키 또는 `Authorization: Bearer <access token>`. 둘 다 Supabase Auth 서버에 getUser로 확인한다
//   (서명을 확인하지 않은 JWT 내용은 믿지 않는다). 서버 컴포넌트(백오피스 화면)는 요청 객체 없이 쿠키 세션으로 부른다.
// · 역할: staff_roles(service_role로 읽음)에서만. 가입 메타데이터(user_metadata·app_metadata)는 보지 않는다 (ACC-04).
// · 관리자: ADMIN_EMAILS 화이트리스트(대소문자 무시) + 이메일 확인된 계정.
// · 정지된 계정(Supabase Auth banned_until이 지금보다 뒤)은 로그인 안 한 것으로 본다 — 정지 전에 받은 토큰·쿠키 세션도 거부한다 (ADM-02).

const NO_PERSIST = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } } as const;

interface AuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
}

function bearerToken(request: Request): string | null | undefined {
  const header = request.headers.get("authorization");
  if (header === null) return undefined; // 머리글 없음 → 쿠키 세션
  const m = header.match(/^Bearer\s+(\S+)$/);
  return m ? m[1]! : null; // 형식이 틀린 머리글은 로그인 아님
}

async function userFromToken(token: string, url: string, anonKey: string): Promise<AuthUser | null> {
  const client = createClient(url, anonKey, NO_PERSIST);
  const { data, error } = await client.auth.getUser(token);
  return error || !data.user ? null : data.user;
}

/** 쿠키 세션 — 토큰을 새로 받으면 라우트 처리기에서는 응답 쿠키에 다시 쓴다 (lib/server/session.ts) */
async function userFromCookies(): Promise<AuthUser | null> {
  const client = await cookieSessionClient();
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : data.user;
}

/**
 * 로그인한 사람 (없으면 null). 같은 요청 안에서는 한 번만 확인한다.
 * request를 주면(라우트 처리기) Bearer 머리글도 보고, 안 주면(서버 컴포넌트) 쿠키 세션만 본다.
 */
export const getViewer = cache(async (request?: Request): Promise<Viewer | null> => {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  const db = adminClient();
  if (!url || !anonKey || !db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");

  const token = request ? bearerToken(request) : undefined;
  if (token === null) return null;
  const user = token === undefined ? await userFromCookies() : await userFromToken(token, url, anonKey);
  if (!user) return null;
  if (isSuspended(user.banned_until, Date.now())) return null;

  const { data, error } = await db.from("staff_roles").select("role").eq("user_id", user.id);
  if (error) {
    console.error("[dal] 역할 읽기 실패:", error.code, error.message);
    throw new HttpError(503, "권한 정보를 읽지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const roles = [...new Set((data ?? []).map((r: { role: unknown }) => r.role).filter(isStaffRole))].sort();
  const email = user.email?.trim().toLowerCase() || null;
  const isAdmin = email !== null && Boolean(user.email_confirmed_at) && adminEmails().includes(email);
  const isAuditAdmin = email !== null && Boolean(user.email_confirmed_at) && auditAdminEmails().includes(email);
  return { userId: user.id, email, isAdmin, roles, isAuditAdmin };
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 쿠키 세션으로 바꾸는 요청은 같은 사이트에서 온 것만 받는다 (CSRF 방어 — Bearer 토큰 요청은 브라우저가 저절로 붙이지 않으므로 보지 않는다).
 * Origin 머리글이 있으면 요청 주소 또는 사이트 주소(NEXT_PUBLIC_SITE_URL — 사내 서버 프록시 뒤)와 호스트가 같아야 한다.
 */
export function isSameSiteRequest(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase()) || request.headers.get("authorization") !== null) return true;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const host = new URL(origin).host;
    const allowed = [new URL(request.url).host, request.headers.get("host"), siteUrl() ? new URL(siteUrl()!).host : null];
    return allowed.includes(host);
  } catch {
    return false;
  }
}

/** 로그인 필수 — 아니면 401 응답을 돌려준다 */
export async function requireViewer(request: Request): Promise<Viewer | Response> {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  try {
    const viewer = await getViewer(request);
    return viewer ?? errorJson(401, "로그인이 필요합니다");
  } catch (err) {
    if (err instanceof HttpError) return errorJson(err.status, err.message);
    throw err;
  }
}

/** 403 응답 — 감사 대상 작업(기사 승인·정렬·발행·역할 부여)이면 거부 시도를 감사 로그에 남긴다 (NAV-06) */
export async function forbid(viewer: Viewer, action: Action, reason: string, target: string): Promise<Response> {
  if (AUDITED_DENIALS.has(action)) {
    const db = adminClient();
    if (db) {
      await writeAudit(db, {
        actor: actorOf(viewer),
        action: `${action}.denied`,
        target,
        before: null,
        after: { roles: viewer.roles, isAdmin: viewer.isAdmin },
        reason,
      });
    }
  }
  return errorJson(403, reason, { action });
}

/** 접근 판정 — 허용이면 null, 거부면 403 응답(감사 기록 포함) */
export async function authorize(viewer: Viewer, action: Action, target: string, resource?: Resource): Promise<Response | null> {
  const decision = check(viewer, action, resource);
  return decision.allowed ? null : forbid(viewer, action, decision.reason, target);
}
