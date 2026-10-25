// HOME-14 이름 규칙 저장소 검사 (W10-i) - 바로가기 이름 글자는 HEADER_SHORTCUTS 한 곳에만, 계산기 화면 제목·설명·aria-label에 'AI' 낱말 0
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { HEADER_SHORTCUTS } from "@ltr/ui";

const WEB = path.resolve(__dirname, "../..");
const UI = path.resolve(WEB, "../../packages/ui/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(path.resolve(WEB, "../.."), p).replaceAll("\\", "/");

describe("바로가기 이름 글자 (HOME-14)", () => {
  const sources = [...walk(path.join(WEB, "app")), ...walk(path.join(WEB, "components")), ...walk(path.join(WEB, "lib")), ...walk(UI)];
  // 재테크 포인트·법령 해석은 화면 제목·관리 메뉴 이름으로도 쓰이므로(같은 이름의 화면) 이 검사는 계산기·상담 요청 이름만 본다
  // 상담 요청 이름은 brand.productName으로 만들므로(제품 이름 글자는 brand.ts 한 곳) 소스에서는 고정 글자 조각 '전문가 상담요청'을 찾는다
  const sourceText = (s: (typeof HEADER_SHORTCUTS)[number]) => (s.key === "expert_request" ? "전문가 상담요청" : s.label);
  test.each(HEADER_SHORTCUTS.filter((s) => s.key === "calc" || s.key === "expert_request").map(sourceText))("'%s' 글자는 Header.tsx 한 곳에만 있다", (label) => {
    const found = sources.filter((f) => fs.readFileSync(f, "utf8").includes(label)).map(rel);
    expect(found).toEqual(["packages/ui/src/components/shell/Header.tsx"]);
  });
});

describe("계산기 화면 글자의 'AI' 낱말 0 (HOME-14)", () => {
  const AI = /(^|[^A-Za-z])AI([^A-Za-z]|$)/;
  const files = [...walk(path.join(WEB, "app/(site)/calc")), ...walk(path.join(WEB, "components/site/calc")), path.join(WEB, "lib/calc/copy.ts")].filter((f) => fs.existsSync(f));
  test("제목·설명·aria-label·라벨 줄에 AI 낱말이 없다", () => {
    const hits: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // 주석
        if (/(title|description|aria-label|label|ariaLabel)\s*[:=]/.test(line) && AI.test(line)) hits.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  test("'AI 계산' 같은 표현이 계산기 소스 어디에도 없다", () => {
    const hits = files.filter((f) => /AI\s*(세금\s*)?계산/.test(fs.readFileSync(f, "utf8"))).map(rel);
    expect(hits).toEqual([]);
  });
});
