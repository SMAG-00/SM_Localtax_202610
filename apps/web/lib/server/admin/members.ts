import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isStaffRole, type StaffRole } from "@/lib/access";
import { SUSPEND_DURATION, isSuspended } from "@/lib/admin/member-rules";
import { adminEmails, supabaseServiceRoleKey, supabaseUrl } from "../env";
import { HttpError, dbError } from "../http";

// 회원·편집국 계정 (ADM-02 조회·정지·역할 부여) — Supabase Auth 관리 API(service_role)와 staff_roles·people.
//  · 목록: 편집국 계정 = 서비스 역할(staff_roles)이 있거나 인물(people.staff_user_id)이 연결된 계정
//  · 검색: 이메일 일부로 Auth 계정 전체에서 찾는다 — 처음 역할을 받을 계정(역할·인물 없음)도 찾을 수 있다
//  · 정지: Auth ban(banned_until). 로그인 확인(DAL getViewer)이 banned_until을 보고 기존 토큰·쿠키 세션도 거부한다
// 부르는 쪽(관리자 API·화면)이 접근 판정을 먼저 통과해야 한다. 계정 수가 적은 편집국 기준이다(목록 200명 한도).

type Db = SupabaseClient;

export interface MemberView {
  userId: string;
  email: string | null;
  roles: StaffRole[];
  person: { id: number; name: string } | null;
  /** ADMIN_EMAILS에 있고 이메일 확인된 계정 */
  isAdmin: boolean;
  suspended: boolean;
  bannedUntil: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  /** 역할 또는 인물이 있는 편집국 계정 */
  isStaff: boolean;
}

const STAFF_LIMIT = 200;
const SEARCH_LIMIT = 50;

type AuthUser = Pick<User, "id" | "email" | "email_confirmed_at" | "last_sign_in_at" | "created_at"> & { banned_until?: string | null };

function view(user: AuthUser, roles: StaffRole[], person: { id: number; name: string } | null, now: number): MemberView {
  const email = user.email?.trim().toLowerCase() || null;
  return {
    userId: user.id,
    email,
    roles,
    person,
    isAdmin: email !== null && Boolean(user.email_confirmed_at) && adminEmails().includes(email),
    suspended: isSuspended(user.banned_until, now),
    bannedUntil: user.banned_until ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    createdAt: user.created_at ?? null,
    isStaff: roles.length > 0 || person !== null,
  };
}

async function staffLinks(db: Db, userIds?: readonly string[]) {
  let rolesQ = db.from("staff_roles").select("user_id, role").limit(5000);
  let peopleQ = db.from("people").select("id, name, staff_user_id").not("staff_user_id", "is", null).limit(5000);
  if (userIds) {
    rolesQ = rolesQ.in("user_id", [...userIds]);
    peopleQ = peopleQ.in("staff_user_id", [...userIds]);
  }
  const [r, p] = await Promise.all([rolesQ, peopleQ]);
  if (r.error) throw dbError(r.error, "staff_roles 읽기");
  if (p.error) throw dbError(p.error, "people 읽기");
  const roles = new Map<string, StaffRole[]>();
  for (const row of (r.data ?? []) as { user_id: string; role: unknown }[]) {
    if (!isStaffRole(row.role)) continue;
    roles.set(row.user_id, [...(roles.get(row.user_id) ?? []), row.role].sort());
  }
  const people = new Map<string, { id: number; name: string }>();
  for (const row of (p.data ?? []) as { id: number; name: string; staff_user_id: string }[]) people.set(row.staff_user_id, { id: row.id, name: row.name });
  return { roles, people };
}

async function getUser(db: Db, id: string): Promise<AuthUser | null> {
  const { data, error } = await db.auth.admin.getUserById(id);
  if (error) {
    if (error.status === 404) return null;
    console.error("[members] 계정 읽기 실패:", error.status, error.message);
    throw new HttpError(503, "계정 정보를 읽지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  return (data.user as AuthUser | null) ?? null;
}

/** Auth 계정 이메일 검색 — 인증 서버 관리 API의 filter(이메일 일부)를 쓴다. supabase-js에는 검색 인자가 없어 직접 부른다 */
async function searchUsers(q: string): Promise<AuthUser[]> {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const params = new URLSearchParams({ filter: q, page: "1", per_page: String(SEARCH_LIMIT) });
  const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/admin/users?${params}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[members] 계정 검색 실패:", res.status);
    throw new HttpError(503, "계정을 찾지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const body = (await res.json()) as { users?: AuthUser[] };
  // 인증 서버의 filter는 이름 칸도 본다 — 이메일에 검색어가 든 계정만 남긴다
  return (body.users ?? []).filter((u) => (u.email ?? "").toLowerCase().includes(q));
}

/** 편집국 계정 목록(q 없음) 또는 이메일 검색 결과(q). 편집국 계정이 앞, 이메일 순 */
export async function listMembers(db: Db, q: string | null): Promise<MemberView[]> {
  const now = Date.now();
  let users: AuthUser[];
  let links;
  if (q) {
    users = await searchUsers(q);
    links = await staffLinks(
      db,
      users.map((u) => u.id),
    );
  } else {
    links = await staffLinks(db);
    const ids = [...new Set([...links.roles.keys(), ...links.people.keys()])].slice(0, STAFF_LIMIT);
    users = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = await Promise.all(ids.slice(i, i + 10).map((id) => getUser(db, id)));
      users.push(...batch.filter((u): u is AuthUser => u !== null));
    }
  }
  return users
    .map((u) => view(u, links.roles.get(u.id) ?? [], links.people.get(u.id) ?? null, now))
    .sort((a, b) => Number(b.isStaff) - Number(a.isStaff) || (a.email ?? "").localeCompare(b.email ?? ""));
}

export async function loadMember(db: Db, userId: string): Promise<MemberView | null> {
  const user = await getUser(db, userId);
  if (!user) return null;
  const links = await staffLinks(db, [userId]);
  return view(user, links.roles.get(userId) ?? [], links.people.get(userId) ?? null, Date.now());
}

/** 정지(해제할 때까지) 또는 해제 — 바뀐 뒤의 계정 */
export async function setSuspended(db: Db, userId: string, suspend: boolean): Promise<MemberView> {
  const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: suspend ? SUSPEND_DURATION : "none" });
  if (error) {
    console.error("[members] 정지 처리 실패:", error.status, error.message);
    throw new HttpError(error.status === 404 ? 404 : 503, error.status === 404 ? "그런 계정이 없습니다" : "계정 정지를 처리하지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  const after = await loadMember(db, userId);
  if (!after) throw new HttpError(404, "그런 계정이 없습니다");
  return after;
}
