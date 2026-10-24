// OPT-02 수용 기준 '페이지 코드에 JSON-LD 문자열 리터럴 0 (생성기 호출만 — 저장소 검색)' + 옛 분야 이름이 경로 표시에 남지 않았는지.
// 공개 화면 코드(app·components·lib)에서 `application/ld+json` 출력은 components/site/JsonLd.tsx 한 곳뿐이고, `@context`·`@type` 글자는 생성기 패키지 밖에 없다.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const WEB = path.resolve(__dirname, "../..");
const SKIP = /(^|[\\/])(node_modules|\.next)([\\/]|$)|\.(test|itest)\.[cm]?[jt]sx?$/;

function sources(): { rel: string; text: string }[] {
  const out: { rel: string; text: string }[] = [];
  for (const dir of ["app", "components", "lib"]) {
    for (const entry of fs.readdirSync(path.join(WEB, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.[tj]sx?$/.test(entry.name)) continue;
      const full = path.join(entry.parentPath, entry.name);
      const rel = path.relative(WEB, full).replaceAll("\\", "/");
      if (!SKIP.test(rel)) out.push({ rel, text: fs.readFileSync(full, "utf8") });
    }
  }
  return out;
}

const SOURCES = sources();

describe("구조화 데이터는 생성기와 한 출력 컴포넌트로만 낸다 (OPT-02)", () => {
  test("`application/ld+json` 글자는 components/site/JsonLd.tsx 한 곳에만 있다", () => {
    const where = SOURCES.filter((s) => s.text.includes("application/ld+json")).map((s) => s.rel);
    expect(where).toEqual(["components/site/JsonLd.tsx"]);
  });

  test("`@context`·`@type` 글자 리터럴이 화면·서버 코드에 없다 (생성기 패키지 밖에서 손으로 쓴 JSON-LD 0)", () => {
    const where = SOURCES.filter((s) => /["'`]@(context|type)["'`]/.test(s.text)).map((s) => s.rel);
    expect(where).toEqual([]);
  });

  test("공개 화면에서 JSON-LD를 내는 파일은 모두 JsonLd 컴포넌트를 부른다", () => {
    const users = SOURCES.filter((s) => /toJsonLdScriptContent\(/.test(s.text) && !s.rel.startsWith("lib/"));
    expect(users.length).toBeGreaterThan(5);
    for (const u of users) expect(u.text, u.rel).toContain("<JsonLd");
  });
});
