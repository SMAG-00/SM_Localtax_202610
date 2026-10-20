import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp } from "@/lib/analytics/request";
import { parseAuthLimits, parseMemberSettings, type AuthLimits, type MemberSettings, type ThrottleScope, type ThrottleLimit } from "@/lib/auth/settings";
import { unconfirmedSignupDays } from "@/lib/auth/recovery";
import { loginKeys, throttleKey, type LoginKeys } from "@/lib/auth/throttle-key";
import { effectiveFeatures } from "@/lib/policy/feature-open";
import { parseFeatures } from "@/lib/server/public/settings";
import { guardSecret, mailEnv } from "./env";
import { HttpError } from "./http";
import { mailConfigured } from "./mail/config";

// 시도 제한과 계정 설정 읽기 (W2-e 설계 4.1) — 시도 횟수는 DB 표(request_throttles)로 센다(서버가 여러 대여도 우회되지 않는다).
//  · 열쇠(GUARD_SECRET)가 없거나 설정·DB를 읽지 못하면 로그인 같은 제한이 필요한 곳은 닫힌다(503) — 제한 없이 여는 쪽으로 실패하지 않는다
//  · 저장하는 것은 HMAC 해시와 횟수뿐이다. 이메일·IP 원문은 이 파일 밖으로 나가지 않고 기록하지도 않는다

export const TOO_MANY = "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요";
const UNAVAILABLE = "지금은 이 기능을 열 수 없습니다 — 서버 설정이 끝나지 않았습니다. 관리자에게 알려 주세요";

/** 해시 열쇠 — 없으면 503 */
export function requireGuardSecret(): string {
  const secret = guardSecret();
  if (!secret) {
    console.error("[auth] GUARD_SECRET이 없습니다 — 시도 제한을 쓸 수 없어 로그인 등을 닫습니다");
    throw new HttpError(503, UNAVAILABLE);
  }
  return secret;
}

/** 요청한 쪽 IP — 시도 횟수의 해시 입력으로만 쓴다(W2-c 수집 API와 같은 읽기). 저장·기록하지 않는다 */
export const requestIp = (request: Request): string => clientIp(request.headers);

async function readSetting(db: SupabaseClient, key: string): Promise<unknown> {
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) {
    console.error(`[auth] 설정 ${key} 읽기 실패:`, error.code, error.message);
    throw new HttpError(503, UNAVAILABLE);
  }
  return data?.value ?? null;
}

export async function readAuthLimits(db: SupabaseClient): Promise<AuthLimits> {
  const limits = parseAuthLimits(await readSetting(db, "auth_limits"));
  if (!limits) {
    console.error("[auth] 설정 auth_limits가 없거나 모양이 틀립니다 — 시도 제한을 쓸 수 없어 로그인 등을 닫습니다");
    throw new HttpError(503, UNAVAILABLE);
  }
  return limits;
}

export async function readMemberSettings(db: SupabaseClient): Promise<MemberSettings> {
  const member = parseMemberSettings(await readSetting(db, "member"));
  if (!member) {
    console.error("[auth] 설정 member가 없거나 모양이 틀립니다");
    throw new HttpError(503, UNAVAILABLE);
  }
  return member;
}

interface CheckResult {
  blocked: boolean;
  retry_after_seconds: number;
}
interface HitResult {
  allowed: boolean;
  count: number;
  retry_after_seconds: number;
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    console.error(`[auth] ${fn} 실패:`, error.code, error.message);
    throw new HttpError(503, UNAVAILABLE);
  }
  return data as T;
}

export async function throttleCheck(db: SupabaseClient, scope: ThrottleScope, keyHash: string, limit: ThrottleLimit): Promise<{ blocked: boolean; retryAfter: number }> {
  const r = await rpc<CheckResult>(db, "throttle_check", { p_scope: scope, p_key_hash: keyHash, p_window_seconds: limit.window, p_limit: limit.limit });
  return { blocked: r.blocked, retryAfter: r.retry_after_seconds };
}

export async function throttleHit(db: SupabaseClient, scope: ThrottleScope, keyHash: string, limit: ThrottleLimit): Promise<{ allowed: boolean; count: number; retryAfter: number }> {
  const r = await rpc<HitResult>(db, "throttle_hit", { p_scope: scope, p_key_hash: keyHash, p_window_seconds: limit.window, p_limit: limit.limit });
  return { allowed: r.allowed, count: r.count, retryAfter: r.retry_after_seconds };
}

export async function throttleClear(db: SupabaseClient, scope: ThrottleScope, keyHash: string): Promise<void> {
  await rpc<number>(db, "throttle_clear", { p_scope: scope, p_key_hash: keyHash });
}

/** 로그인 세 겹의 키 — 이메일+IP 짝 · 이메일 전체 · IP (설계 4.1) */
export const loginKeysFor = (email: string, request: Request): LoginKeys => loginKeys(requireGuardSecret(), email, requestIp(request));

/** 한 겹이라도 막혀 있으면 막힘 — 기다릴 시간은 막힌 겹 가운데 가장 긴 것 */
export async function loginGate(db: SupabaseClient, keys: LoginKeys, limits: AuthLimits): Promise<{ blocked: false } | { blocked: true; retryAfter: number }> {
  const results = await Promise.all([
    throttleCheck(db, "login_pair", keys.pair, limits.login_pair),
    throttleCheck(db, "login_account", keys.account, limits.login_account),
    throttleCheck(db, "login_ip", keys.ip, limits.login_ip),
  ]);
  const blocked = results.filter((r) => r.blocked);
  return blocked.length === 0 ? { blocked: false } : { blocked: true, retryAfter: Math.max(...blocked.map((r) => r.retryAfter)) };
}

/** 실패 — 세 겹 모두 센다 */
export async function loginFailed(db: SupabaseClient, keys: LoginKeys, limits: AuthLimits): Promise<void> {
  await Promise.all([
    throttleHit(db, "login_pair", keys.pair, limits.login_pair),
    throttleHit(db, "login_account", keys.account, limits.login_account),
    throttleHit(db, "login_ip", keys.ip, limits.login_ip),
  ]);
}

/** 성공 — 짝·계정 횟수를 초기화한다(IP 횟수는 그대로: 한 IP에서 여러 계정을 돌려 보는 시도는 계속 센다) */
export async function loginSucceeded(db: SupabaseClient, keys: LoginKeys): Promise<void> {
  await Promise.all([throttleClear(db, "login_pair", keys.pair), throttleClear(db, "login_account", keys.account)]);
}

/** 비밀번호 바꾸기 시도 키 — 계정(번호) 기준 */
export const passwordChangeKey = (userId: string): string => throttleKey(requireGuardSecret(), "password_change", userId);

/** 설정 privacy_retention의 미확인 가입 보존 일수 — 없거나 모양이 틀리면 예외(아무것도 지우지 않는다) */
export async function readUnconfirmedSignupDays(db: SupabaseClient): Promise<number> {
  const days = unconfirmedSignupDays(await readSetting(db, "privacy_retention"));
  if (days === null) throw new Error("설정 privacy_retention이 없거나 모양이 틀립니다 — 미확인 가입을 정리하지 않습니다");
  return days;
}

/** 게시본이 있는 정책 문서 (service 클라이언트로 읽는다 — 가입 같은 서버 판정용) */
export async function publishedDocKeys(db: SupabaseClient): Promise<ReadonlySet<string>> {
  const { data, error } = await db.from("policy_versions").select("doc_key").eq("status", "published");
  if (error) {
    console.error("[auth] 정책 게시본 읽기 실패:", error.code, error.message);
    throw new HttpError(503, UNAVAILABLE);
  }
  return new Set((data ?? []).map((r: { doc_key: string }) => r.doc_key));
}

/** 기존 회원의 메일 기능(비밀번호 찾기·확인 메일 다시 받기)이 열려 있나 — `members` 기능 키 + 메일 설정만 본다 (설계 2.3 · 4.2).
 *  정책 게시본 조건은 새 가입에만 건다 — 약관을 내렸다고 이미 가입한 회원이 비밀번호를 못 찾으면 안 된다 */
export async function memberAuthOpen(db: SupabaseClient): Promise<boolean> {
  if (!mailConfigured(mailEnv())) return false;
  return parseFeatures(await readSetting(db, "feature_flags")).members === true;
}

/** 브리핑 사전 알림이 열려 있나 — `brief` 기능 키 + 개인정보처리방침 게시본 + 메일 설정 (설계 2.3 · 7.5) */
export async function briefOpen(db: SupabaseClient): Promise<boolean> {
  const mailReady = mailConfigured(mailEnv());
  if (!mailReady) return false;
  const raw = parseFeatures(await readSetting(db, "feature_flags"));
  if (!raw.brief) return false;
  return effectiveFeatures(raw, await publishedDocKeys(db), mailReady).brief;
}

/** 가입이 열려 있나 — `members` 기능 키가 켜져 있고 이용약관·개인정보처리방침 게시본과 메일 설정이 있을 때만 (설계 2.3 · 6.3) */
export async function signupOpen(db: SupabaseClient): Promise<boolean> {
  const mailReady = mailConfigured(mailEnv());
  if (!mailReady) return false;
  const raw = parseFeatures(await readSetting(db, "feature_flags"));
  if (!raw.members) return false;
  return effectiveFeatures(raw, await publishedDocKeys(db), mailReady).members;
}
