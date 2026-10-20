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

// ── 회원 탭 (W2-e 3-B) — 역할·인물이 없는 계정 ──────────────────────────────
export const MEMBER_PAGE_SIZE = 50;
/** 목록은 인증 서버에서 200명씩 이 쪽수까지만 읽는다(회원 규모가 커지면 DB 함수로 옮긴다) */
const MEMBER_SCAN_PAGES = 10;
const SCAN_PER_PAGE = 200;

export interface RegularMemberView {
  userId: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
  suspended: boolean;
  isAdmin: boolean;
  interestCount: number;
  regionCount: number;
  /** 철회되지 않은 수신 동의 종류 (receive·marketing) */
  consents: string[];
}

export interface RegularMemberPage {
  members: RegularMemberView[];
  page: number;
  hasNext: boolean;
}

type ListedUser = AuthUser;

async function scanUsers(page: number): Promise<ListedUser[]> {
  const url = supabaseUrl();
  const key = supabaseServiceRoleKey();
  if (!url || !key) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const params = new URLSearchParams({ page: String(page), per_page: String(SCAN_PER_PAGE) });
  const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/admin/users?${params}`, { headers: { apikey: key, authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) {
    console.error("[members] 회원 목록 읽기 실패:", res.status);
    throw new HttpError(503, "회원 목록을 읽지 못했습니다 — 잠시 뒤 다시 시도하세요");
  }
  return ((await res.json()) as { users?: ListedUser[] }).users ?? [];
}

/** 역할·인물이 없는 계정 한 쪽(50명, 가입일 최신순). q가 있으면 이메일 일부 검색(최대 50명, 쪽 1만) */
export async function listRegularMembers(db: Db, q: string | null, page: number): Promise<RegularMemberPage> {
  const links = await staffLinks(db);
  const isStaffId = (id: string) => links.roles.has(id) || links.people.has(id);
  let pool: ListedUser[] = [];
  if (q) {
    pool = (await searchUsers(q)).filter((u) => !isStaffId(u.id));
  } else {
    const need = page * MEMBER_PAGE_SIZE + 1;
    for (let p = 1; p <= MEMBER_SCAN_PAGES && pool.length < need; p += 1) {
      const batch = await scanUsers(p);
      pool.push(...batch.filter((u) => !isStaffId(u.id)));
      if (batch.length < SCAN_PER_PAGE) break;
    }
  }
  pool.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id.localeCompare(a.id));
  const start = q ? 0 : (page - 1) * MEMBER_PAGE_SIZE;
  const slice = pool.slice(start, start + MEMBER_PAGE_SIZE);
  const ids = slice.map((u) => u.id);
  const [pr, cs] = ids.length
    ? await Promise.all([
        db.from("profiles").select("id, interests, interest_region_codes").in("id", ids),
        db.from("consents").select("user_id, kind").in("user_id", ids).is("revoked_at", null).in("kind", ["receive", "marketing"]),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (pr.error) throw dbError(pr.error, "profiles 읽기");
  if (cs.error) throw dbError(cs.error, "consents 읽기");
  const profile = new Map((pr.data as { id: string; interests: string[]; interest_region_codes: string[] }[]).map((r) => [r.id, r]));
  const consent = new Map<string, string[]>();
  for (const r of cs.data as { user_id: string; kind: string }[]) consent.set(r.user_id, [...(consent.get(r.user_id) ?? []), r.kind].sort());
  const now = Date.now();
  const members = slice.map((u): RegularMemberView => {
    const email = u.email?.trim().toLowerCase() || null;
    const p = profile.get(u.id);
    return {
      userId: u.id,
      email,
      createdAt: u.created_at ?? null,
      lastSignInAt: u.last_sign_in_at ?? null,
      emailConfirmed: Boolean(u.email_confirmed_at),
      suspended: isSuspended(u.banned_until, now),
      isAdmin: email !== null && Boolean(u.email_confirmed_at) && adminEmails().includes(email),
      interestCount: p?.interests.length ?? 0,
      regionCount: p?.interest_region_codes.length ?? 0,
      consents: consent.get(u.id) ?? [],
    };
  });
  return { members, page, hasNext: !q && pool.length > start + MEMBER_PAGE_SIZE };
}
