import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 결제·유료 본문 경계 검사 (W10-f, PAY-02·07, BIZ-04) - 소스 파일을 실제로 훑는다.
//  1. 유료 본문 표·함수·미리보기 뷰 이름은 결제 모듈 폴더와 관리 API 한 곳에만 나온다 (공개 읽기·검색·RSS·구조화 데이터·도우미 경로에 없음)
//  2. PG 주소·서버 키 이름은 결제 모듈 폴더(와 환경변수 읽기 모듈·브라우저 결제창 부품)에만 나온다 ("PG SDK·웹훅 처리 코드가 결제 모듈 한 곳")
//  3. AI 도우미·구조화 데이터·SEO 패키지는 유료 본문·권한·결제 이름을 모르는 채로 남는다
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
const sources = [...walk(path.join(ROOT, "apps/web")), ...walk(path.join(ROOT, "packages")), ...walk(path.join(ROOT, "workflows"))].filter(
  (p) => !rel(p).startsWith("packages/db/") ,
);

function filesWith(pattern: RegExp): string[] {
  return sources.filter((p) => pattern.test(fs.readFileSync(p, "utf8"))).map(rel).sort();
}

describe("결제·유료 본문 경계", () => {
  it("유료 본문 표·읽기 함수·미리보기 뷰 이름은 결제 모듈 폴더와 관리 API에만 있다", () => {
    const hits = filesWith(/paid_bodies|read_paid_body|public_paid_previews/);
    for (const f of hits) {
      expect(f.startsWith("apps/web/lib/server/billing/") || f === "apps/web/app/api/admin/billing/route.ts", `${f} 에서 유료 본문 이름을 읽는다`).toBe(true);
    }
    expect(hits.length).toBeGreaterThan(0);
  });

  it("권한 판정 함수 has_entitlement는 결제 모듈 폴더에서만 부른다", () => {
    for (const f of filesWith(/has_entitlement/)) expect(f.startsWith("apps/web/lib/server/billing/"), f).toBe(true);
  });

  it("PG 주소·서버 키 이름은 결제 모듈 폴더, 환경변수 읽기 모듈, 브라우저 결제창 부품에만 있다", () => {
    const allowed = (f: string) => f.startsWith("apps/web/lib/server/billing/") || f === "apps/web/lib/server/env.ts" || f === "apps/web/components/site/SubscribeForm.tsx";
    for (const f of filesWith(/tosspayments|PG_SECRET_KEY|PG_WEBHOOK_SECRET/i)) expect(allowed(f), `${f} 에 PG 코드가 있다`).toBe(true);
  });

  it("AI 도우미·구조화 데이터·SEO 패키지는 유료 본문·권한·결제 표 이름을 모른다", () => {
    const pkgs = sources.filter((p) => /^packages\/(assistant|structured-data|seo-lint|agent|similarity|editorial)\//.test(rel(p)));
    expect(pkgs.length).toBeGreaterThan(0);
    for (const p of pkgs) {
      expect(fs.readFileSync(p, "utf8"), rel(p)).not.toMatch(/paid_bodies|read_paid_body|has_entitlement|entitlements|public_paid_previews|payment_events|subscriptions/);
    }
  });

  it("공개 기사·RSS·사이트맵·검색 경로는 유료 본문 모듈을 불러오지 않는다", () => {
    const watch = sources.filter((p) => /^apps\/web\/(app\/(rss|sitemap|api\/search)|lib\/server\/(public|seo|assistant))/.test(rel(p)));
    expect(watch.length).toBeGreaterThan(0);
    for (const p of watch) expect(fs.readFileSync(p, "utf8"), rel(p)).not.toMatch(/server\/billing/);
  });
});
