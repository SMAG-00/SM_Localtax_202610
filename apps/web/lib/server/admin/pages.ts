import "server-only";
import { headers } from "next/headers";
import { forbidden, notFound, redirect } from "next/navigation";
import { check, type Action, type Resource, type Viewer } from "@/lib/access";
import { ADMIN_PATH_HEADER } from "@/lib/admin/headers";
import { safeNextPath } from "@/lib/admin/next-path";
import { getViewer } from "../dal";
import { HttpError } from "../http";

// 백오피스 화면(서버 컴포넌트)의 로그인 확인과 접근 판정 — PRD-00 6장 "미들웨어(proxy.ts)와 서버 컴포넌트 두 곳에서 막는다".
// 로그인 확인은 DAL(getViewer) 하나, 허용 여부는 접근 판정 한 함수(check)만 쓴다. 거부면 403 화면(forbidden), 없는 기사는 404.

/** 로그인한 사람 — 아니면 로그인 화면으로 (돌아올 주소는 proxy.ts가 넘긴 경로, safeNextPath로 거른다) */
export async function pageViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) {
    const path = (await headers()).get(ADMIN_PATH_HEADER);
    redirect(`/admin/login?next=${encodeURIComponent(safeNextPath(path))}`);
  }
  return viewer;
}

/** 화면 접근 판정 — 작업 중 하나라도 허용이면 통과, 아니면 403 화면 */
export function requirePage(viewer: Viewer, actions: Action | readonly Action[], resource?: Resource): void {
  const list: readonly Action[] = typeof actions === "string" ? [actions] : actions;
  if (!list.some((a) => check(viewer, a, resource).allowed)) forbidden();
}

/** 저장소 함수의 404(HttpError) → Next 404 화면 */
export async function orNotFound<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
}

/** 경로의 번호 — 숫자가 아니면 404 */
export function pageId(raw: string): number {
  if (!/^[1-9]\d{0,15}$/.test(raw)) notFound();
  return Number(raw);
}

/** 쿼리 값 하나 (목록이면 첫 값) */
export function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
