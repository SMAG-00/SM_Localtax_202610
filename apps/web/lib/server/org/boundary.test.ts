import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 기관·리포트 경계 검사 (W11-f, BIZ-07·PAY-04) - 소스 파일을 실제로 훑는다.
//  1. 기관 모듈은 결제 모듈(billing/)·PG를 부르지 않는다 (기관 온라인 결제 없음 - PO 기본값 #13)
//  2. 리포트 본문을 읽는 이름(read_premium_report·public_premium_report_previews)은 기관 모듈·리포트 화면 경로·관리 API에만 있다
//     (공개 읽기·RSS·사이트맵·검색·구조화 데이터·도우미·패키지 경로에 없다)
//  3. 기관 화면·API는 클라이언트가 보낸 좌석·등급 값을 판정에 쓰지 않는다 (요청 본문에서 seats·tier·plan 칸을 읽지 않음)
const ROOT = path.resolve(__dirname, "../../../../..");
const SKIP = /(^|[\\/])(node_modules|\.next|dist|coverage|\.turbo)([\\/]|$)/;
const CODE = /\.(ts|tsx|mjs|js)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (CODE.test(e.name) && !/\.(test|itest)\.(ts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).replaceAll("\\", "/");
const sources = [...walk(path.join(ROOT, "apps/web")), ...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "workflows"))].filter((p) => !rel(p).startsWith("packages/db/"));
const read = (p: string) => fs.readFileSync(p, "utf8");
const filesWith = (pattern: RegExp) => sources.filter((p) => pattern.test(read(p))).map(rel).sort();

describe("기관·리포트 경계", () => {
  it("기관 모듈과 기관 API는 결제 모듈·PG·결제 함수 이름을 모른다", () => {
    const org = sources.filter((p) => /^apps\/web\/(lib\/server\/org|app\/api\/(org|institution)|components\/site\/(OrgForms|ReportViews))/.test(rel(p)));
    expect(org.length).toBeGreaterThan(5);
    for (const p of org) expect(read(p), rel(p)).not.toMatch(/server\/billing|billing_|tosspayments|PG_SECRET_KEY|PgAdapter|createCheckout/);
  });

  it("리포트 본문 읽기 함수·공개 미리보기 뷰 이름은 허용된 파일에만 있다", () => {
    const allowed = (f: string) => f === "apps/web/lib/server/org/reports.ts";
    const hits = filesWith(/read_premium_report|public_premium_report_previews/);
    expect(hits.length).toBeGreaterThan(0);
    for (const f of hits) expect(allowed(f), `${f} 에서 리포트 본문 읽기 이름을 쓴다`).toBe(true);
  });

  it("공개 기사·RSS·사이트맵·검색·도우미·패키지는 리포트 표·권한 이름을 모른다", () => {
    const watch = sources.filter((p) => /^apps\/web\/(app\/(rss|sitemap|api\/search)|lib\/server\/(public|seo|assistant))/.test(rel(p)) || /^packages\/(assistant|structured-data|seo-lint|agent|similarity|editorial)\//.test(rel(p)));
    expect(watch.length).toBeGreaterThan(0);
    for (const p of watch) expect(read(p), rel(p)).not.toMatch(/org_seats|org_contracts|org\/service|org\/reports|premium_report(?!s)/);
  });

  it("기관 API는 요청 본문의 좌석 수·등급·요금제 값을 읽지 않는다", () => {
    const apis = sources.filter((p) => /^apps\/web\/app\/api\/org\//.test(rel(p)));
    expect(apis.length).toBeGreaterThanOrEqual(2);
    for (const p of apis) expect(read(p), rel(p)).not.toMatch(/body\.(seats|tier|plan|grade|level|entitlement)/);
  });

  it("리포트 화면은 본문을 HTML로 해석하지 않고 문단 글자로만 그린다", () => {
    const view = read(path.join(ROOT, "apps/web/components/site/ReportViews.tsx"));
    expect(view).not.toMatch(/dangerouslySetInnerHTML/);
    const pages = sources.filter((p) => /^apps\/web\/app\/\(site\)\/finance\/reports\//.test(rel(p)));
    expect(pages.length).toBe(2);
    for (const p of pages) {
      expect(read(p), rel(p)).toContain('robots: { index: false, follow: false }');
      expect(read(p), rel(p)).toContain('export const dynamic = "force-dynamic"');
    }
  });
});
