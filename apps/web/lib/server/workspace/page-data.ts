import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/server/dal";
import { adminClient } from "@/lib/server/supabase";
import { MODE_COOKIE, parseMode, type Mode } from "./logic";
import { loadAccess, readPrefs, type Access } from "./store";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 워크스페이스 화면 공통 준비 - 기능 키 꺼짐 404, 비로그인은 로그인으로. 모드는 표시 밀도에만 쓰고 권한에는 넘기지 않는다 */
export async function preparePage(path: string): Promise<{ db: SupabaseClient; userId: string; access: Access; mode: Mode }> {
  const db = adminClient();
  if (!db) throw new Error("서버 설정이 끝나지 않았습니다");
  const viewer = await getViewer().catch(() => null);
  const access = await loadAccess(db, viewer?.userId ?? null);
  if (access.view === "closed") notFound();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(path)}`);
  const prefs = await readPrefs(db, viewer.userId).catch(() => null);
  const mode = prefs?.mode ?? parseMode((await cookies()).get(MODE_COOKIE)?.value);
  return { db, userId: viewer.userId, access, mode };
}
