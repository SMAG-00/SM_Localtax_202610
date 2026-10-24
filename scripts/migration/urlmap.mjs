// 옛 주소 → 새 주소 1:1 매핑표와 검사, redirects 데이터 SQL (docs/dev/W9_설계.md 3장 · PRD-01A MIG-02)
//  · 기사: /news/articleView.html?idxno=N → /news/<slug> (301) · 이관하지 않은 기사: 410(삭제)·404(비공개) + 사유
//  · 목록: 분류 코드별로 같은 주제의 새 목록 (홈으로 일괄 이동 금지) · 정적 쪽: STATIC_PAGES
//  · 검사: 미결정 0 · 연쇄 301 0 · 중복 옛 주소 0 · 옛 기사 주소가 '/'로 가는 행 0 · 404/410은 사유 필수
import { LEGACY_CATEGORIES, STATIC_PAGES } from "./format.mjs";

export const REDIRECT_STATUSES = [301, 308, 404, 410];

/**
 * @param {{migrated: {legacy_url: string, slug: string}[], excluded: {legacy_url: string, status: string, reason: string}[]}} input
 */
export function buildUrlMap({ migrated, excluded }) {
  const rows = [];
  for (const m of migrated) rows.push({ old_path: m.legacy_url, new_path: `/news/${m.slug}`, status: 301, reason: null, origin: "legacy_site", kind: "article" });
  for (const e of excluded) {
    const gone = e.status === "deleted";
    rows.push({ old_path: e.legacy_url, new_path: null, status: gone ? 410 : 404, reason: e.reason, origin: "legacy_site", kind: "article" });
  }
  for (const c of LEGACY_CATEGORIES) rows.push({ old_path: `/news/articleList.html?sc_section_code=${c.code}`, new_path: c.listPath, status: 301, reason: null, origin: "legacy_site", kind: "list" });
  rows.push({ old_path: "/news/articleList.html", new_path: "/news", status: 301, reason: null, origin: "legacy_site", kind: "list" });
  for (const p of STATIC_PAGES) {
    rows.push(p.newPath
      ? { old_path: p.old, new_path: p.newPath, status: 301, reason: null, origin: "legacy_site", kind: "static" }
      : { old_path: p.old, new_path: null, status: 404, reason: `미결정 — ${p.label} 쪽의 새 주소를 PO가 정해야 합니다`, origin: "legacy_site", kind: "static", undecided: true });
  }
  rows.sort((a, b) => (a.old_path < b.old_path ? -1 : a.old_path > b.old_path ? 1 : 0));
  return rows;
}

/** 매핑표 검사 — 문제 목록(빈 배열 = 통과) */
export function checkUrlMap(rows) {
  const problems = [];
  const olds = new Map();
  for (const r of rows) {
    if (!r.old_path || !r.old_path.startsWith("/")) problems.push({ old_path: r.old_path, problem: "옛 주소가 '/'로 시작하지 않습니다" });
    if (olds.has(r.old_path)) problems.push({ old_path: r.old_path, problem: "옛 주소 중복" });
    olds.set(r.old_path, r);
    if (!REDIRECT_STATUSES.includes(r.status)) problems.push({ old_path: r.old_path, problem: `상태 코드가 301·308·404·410이 아닙니다 (${r.status})` });
    if ([404, 410].includes(r.status) && !String(r.reason ?? "").trim()) problems.push({ old_path: r.old_path, problem: "404·410 행에 사유가 없습니다" });
    if ([301, 308].includes(r.status)) {
      if (!r.new_path || !r.new_path.startsWith("/")) problems.push({ old_path: r.old_path, problem: "새 주소가 없거나 '/'로 시작하지 않습니다" });
      else if (r.new_path === r.old_path) problems.push({ old_path: r.old_path, problem: "제자리 이동입니다" });
      else if (r.new_path === "/" && r.old_path !== "/") problems.push({ old_path: r.old_path, problem: "옛 주소가 새 홈('/')으로 갑니다 — 옛 홈 주소만 홈으로 갈 수 있습니다" });
    } else if (r.new_path) problems.push({ old_path: r.old_path, problem: "404·410 행에 새 주소가 있습니다" });
    if (r.undecided) problems.push({ old_path: r.old_path, problem: "새 주소 미결정" });
  }
  for (const r of rows) if ([301, 308].includes(r.status) && r.new_path && olds.has(r.new_path)) problems.push({ old_path: r.old_path, problem: `연쇄 이동입니다 (${r.new_path}도 옛 주소 행)` });
  return problems;
}

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

/** redirects 데이터 적재 SQL (전환 때 쓴다. 표 자체는 마이그레이션 20261025000077) — 여러 번 돌려도 같은 결과(on conflict) */
export function renderRedirectsSql(rows, chunk = 200) {
  const out = ["-- W9 옛 주소 이동표 적재 — 생성물 (scripts/migration/cli.mjs). 표는 마이그레이션 20261025000077_w9_redirects", "begin;"];
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk).map((r) => `  (${q(r.old_path)}, ${q(r.new_path)}, ${r.status}, ${q(r.reason)}, ${q(r.origin)})`);
    out.push("insert into public.redirects (old_path, new_path, status, reason, origin) values", `${part.join(",\n")}`, "on conflict (old_path) do update set new_path = excluded.new_path, status = excluded.status, reason = excluded.reason, origin = excluded.origin;");
  }
  out.push("commit;", "");
  return out.join("\n");
}
