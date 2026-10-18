// NAV-13 · NAV-16 수용 기준 '코드와 설정 기본값에 심사 점수·기사 수 기준 상수 0 (저장소 검색)' — docs/dev/W2-c_설계.md 8.5.
// 규정의 숫자(합격선·배점·기사 수·비율)는 담당자가 원문을 확인해 규정 버전(news_partner_requirements.requirements)에만 적는다.
// 이 시험은 화면·서버·패키지·마이그레이션·작업 코드를 읽어 그런 숫자가 코드나 설정 씨앗에 박혀 있지 않은지 본다(시험 파일은 견본을 일부러 담으므로 뺀다).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const SCAN = ["apps/web/lib", "apps/web/app", "apps/web/components", "packages", "workflows/src"];
const CODE = /\.(ts|tsx|mjs|js|sql|json)$/;
const SKIP = /(^|[\\/])(node_modules|\.next|dist|tests|__tests__|fixtures)([\\/]|$)|\.(test|itest)\.[cm]?[jt]sx?$|package(-lock)?\.json$|tsconfig[^\\/]*\.json$/;

function files(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  for (const dir of SCAN) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !CODE.test(entry.name)) continue;
      const full = path.join(entry.parentPath, entry.name);
      const rel = path.relative(ROOT, full);
      if (SKIP.test(rel)) continue;
      out.push({ rel, text: fs.readFileSync(full, "utf8") });
    }
  }
  return out;
}

const SOURCES = files();
const hits = (re: RegExp) => SOURCES.flatMap(({ rel, text }) => [...text.matchAll(re)].map((m) => `${rel}: ${m[0]}`));

describe("규정 숫자 기준은 코드·설정 기본값에 0 (NAV-13 저장소 검사)", () => {
  test("검사 대상이 실제로 있다 — 대시보드·규정 규칙·마이그레이션을 읽는다", () => {
    const rels = SOURCES.map((s) => s.rel.replaceAll("\\", "/"));
    for (const must of ["apps/web/lib/readiness/requirements.ts", "apps/web/lib/readiness/production.ts", "packages/db/supabase/migrations/20261018000018_w2c_news_readiness.sql"]) {
      expect(rels).toContain(must);
    }
    expect(rels.some((r) => r.endsWith(".test.ts"))).toBe(false);
  });

  test("심사 점수 글자(예: 80점·90점·50점·10점) 0 — '0점 위험' 같은 0점 표시는 기준이 아니다", () => {
    expect(hits(/(?<![0-9.])[1-9][0-9]*(?:\.[0-9]+)?\s?점(?![검수])/g)).toEqual([]);
  });

  test("합격선·배점·통과 기준 칸에 숫자를 넣은 코드 0", () => {
    expect(hits(/(pass_?lines?|passLines?|pass_?score|합격선|배점|cut_?off)["']?\s*[:=]\s*["']?[\d{[]/gi)).toEqual([]);
  });

  test("요건 기준(criterion) 숫자를 미리 채운 코드 0 — 기준은 화면에서 담당자가 적는다", () => {
    expect(hits(/criterion["']?\s*[:=]\s*\{[^}]*value["']?\s*:\s*\d/g)).toEqual([]);
  });

  test("규정 버전을 넣는 마이그레이션 씨앗 0", () => {
    expect(hits(/insert\s+into\s+public\.news_partner_requirements/gi)).toEqual([]);
  });
});
