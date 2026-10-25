import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// 교육 "연결" 방식 경계 (W10-g, 결정 #27) - 결제·수강 등록·수료증은 교육원 사이트가 맡는다. 이 사이트의 소스·표에 그런 것이 생기면 실패한다.
const WEB = path.resolve(__dirname, "../..");
const MIGRATION = fs.readFileSync(path.resolve(WEB, "../../packages/db/supabase/migrations/20261025000098_w10g_education.sql"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(WEB, p).split(path.sep).join("/");

describe("교육 라우트 경계 - 결제·수료증 라우트 0", () => {
  const routes = walk(path.join(WEB, "app")).map(rel).filter((p) => /\/(page|route)\.tsx?$/.test(p));

  test("교육 관련 라우트(/edu, /api/edu, /api/admin/education)가 실제로 있다 (빈 검사 방지)", () => {
    expect(routes).toEqual(expect.arrayContaining(["app/(site)/edu/page.tsx", "app/(site)/edu/quote/page.tsx", "app/api/edu/quotes/route.ts", "app/api/admin/education/route.ts"]));
  });

  test("/edu · /api/edu · /api/admin/education 아래에 결제·수강 등록·수료증 경로가 없다", () => {
    const edu = routes.filter((p) => /^app\/(\(site\)\/edu|api\/edu|api\/admin\/education)\//.test(p));
    expect(edu.length).toBeGreaterThanOrEqual(8);
    expect(edu.filter((p) => /(checkout|payment|pay\b|billing|enroll|register|certificate|receipt|refund|invoice)/i.test(p))).toEqual([]);
  });

  test("전 사이트 라우트 중 수료증·수강 등록 경로는 없다", () => {
    expect(routes.filter((p) => /(certificate|enroll)/i.test(p))).toEqual([]);
  });

  test("교육 소스(lib/education · 교육 화면 · 교육 API)가 결제 모듈(lib/server/billing)을 부르지 않는다", () => {
    const files = [
      ...walk(path.join(WEB, "lib/education")),
      ...routes.filter((p) => /^app\/(\(site\)\/edu|api\/edu|api\/admin\/education)\//.test(p)).map((p) => path.join(WEB, p)),
      path.join(WEB, "components/site/EducationViews.tsx"),
      path.join(WEB, "lib/server/public/education.ts"),
    ].filter((f) => !f.endsWith("boundary.test.ts"));
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, rel(f)).not.toMatch(/server\/billing|PgAdapter|createCheckout|tosspayments/i);
    }
  });
});

describe("교육 표 경계 - 결제 칸 0 · 수강 등록·수료증 표 0", () => {
  const tableBody = (name: string) => {
    const m = MIGRATION.match(new RegExp(`create table public\\.${name} \\(([\\s\\S]*?)\\n\\);`));
    if (!m) throw new Error(`${name} 표 정의를 찾지 못했습니다`);
    return m[1]!;
  };
  const columnsOf = (name: string) =>
    tableBody(name)
      .split("\n")
      .map((l) => l.trim().match(/^([a-z_]+)\s+(text|bigint|integer|boolean|date|timestamptz)\b/)?.[1])
      .filter((c): c is string => !!c);

  test.each(["courses", "course_sessions", "seminars", "training_quotes"])("%s - 칸 이름에 결제·카드·금액·정원 낱말이 없다", (table) => {
    const cols = columnsOf(table);
    expect(cols.length).toBeGreaterThan(5);
    expect(cols.filter((c) => /(pay|card|amount|price|fee|cost|order|capacity|seat|enroll|certificate)/i.test(c))).toEqual([]);
  });

  test("수강 등록(course_enrollments)·수료증(certificates) 표를 만들지 않는다", () => {
    expect(MIGRATION).not.toMatch(/create table public\.(course_enrollments|certificates)\b/);
  });
});
