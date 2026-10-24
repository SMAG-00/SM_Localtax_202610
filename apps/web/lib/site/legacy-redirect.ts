// 현 사이트(옛 주소) → 새 주소 이동의 판정 — 순수 모듈 (시험 legacy-redirect.test.ts). docs/dev/W9_설계.md 3장 · PRD-01A MIG-02.
//  · 기능 키 legacy_redirects(settings.feature_flags)가 켜져 있을 때만 일한다 — 기본 꺼짐. 꺼져 있으면 옛 주소는 지금처럼 화면이 그린다(404).
//    전환 당일(W9 실행) 켠다. 이 파일이 있다고 해서 지금 동작이 바뀌지 않는다.
//  · 옛 주소 표 redirects(마이그레이션 20261025000077 — service_role만 읽는다)에서 정규형 옛 주소 한 건을 찾는다.
//    301·308 = 새 주소로 이동(쿼리는 붙이지 않는다 — 옛 쿼리는 새 주소에 뜻이 없다), 410 = 사라진 글, 404 = 화면에 맡김, 표에 없으면 화면에 맡김
//  · 정규형 규칙은 scripts/migration/normalize.mjs와 같다 — 두 곳을 함께 고친다 (시험이 같은 표로 대조한다)
//  proxy가 불러오므로 서버 전용 모듈을 부르지 않는다.

export interface LegacyRoute {
  /** 정규형 옛 주소 — redirects.old_path와 같은 모양 */
  oldPath: string;
}

/** 옛 사이트가 쓰던 두 경로만 다룬다: 기사 /news/articleView.html?idxno=N · 목록 /news/articleList.html[?sc_section_code=S1Nx] */
export function legacyRoute(pathname: string, search: string): LegacyRoute | null {
  const path = pathname.replace(/\/+$/, "").toLowerCase();
  const params = new URLSearchParams(search);
  if (path === "/news/articleview.html") {
    const id = params.get("idxno");
    return id && /^[0-9]+$/.test(id) ? { oldPath: `/news/articleView.html?idxno=${String(Number(id))}` } : null;
  }
  if (path === "/news/articlelist.html") {
    const code = (params.get("sc_section_code") ?? "").toUpperCase();
    if (!code) return { oldPath: "/news/articleList.html" };
    return /^S[0-9]N[0-9]+$/.test(code) ? { oldPath: `/news/articleList.html?sc_section_code=${code}` } : null;
  }
  return null;
}

export type LegacyGateDecision = { kind: "pass" } | { kind: "redirect"; path: string; status: 301 | 308 } | { kind: "gone" } | { kind: "unavailable" };

/** 공개 표 읽기 — 행 목록, 읽지 못하면 null. key = anon(기능 키) · service(redirects) */
export type LegacyReader = (path: string, key: "anon" | "service") => Promise<unknown[] | null>;

export const legacyProbePaths = {
  flags: "/rest/v1/settings?select=value&key=eq.feature_flags&limit=1",
  redirect: (route: LegacyRoute) => `/rest/v1/redirects?select=new_path,status&old_path=eq.${encodeURIComponent(route.oldPath)}&limit=1`,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 기능 키 legacy_redirects — 없거나 true가 아니면 닫힘 */
export function legacyRedirectsOpen(flagRows: readonly unknown[]): boolean {
  const value = isObj(flagRows[0]) ? flagRows[0].value : null;
  return isObj(value) && value.legacy_redirects === true;
}

export async function legacyGateDecision(route: LegacyRoute, read: LegacyReader): Promise<LegacyGateDecision> {
  const flags = await read(legacyProbePaths.flags, "anon");
  if (!flags) return { kind: "unavailable" };
  if (!legacyRedirectsOpen(flags)) return { kind: "pass" };
  const rows = await read(legacyProbePaths.redirect(route), "service");
  if (!rows) return { kind: "unavailable" };
  const row = rows[0];
  if (!isObj(row)) return { kind: "pass" };
  const status = row.status;
  const target = typeof row.new_path === "string" ? row.new_path : null;
  if ((status === 301 || status === 308) && target && target.startsWith("/") && !target.startsWith("//")) return { kind: "redirect", path: target, status };
  if (status === 410) return { kind: "gone" };
  return { kind: "pass" };
}
