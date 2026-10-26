// 패키지 경계 시험 (W11-g g3 / CI NT7·NT9 와 짝) - 내보내기 함수 2개, 네트워크·AI·환경변수·파일·시계 접근 0, 출처 해시 일치, 초안 룰셋 모양
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "../src/index";

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(dir, "..");
const read = (p: string) => fs.readFileSync(path.join(pkg, p));
const srcFiles = fs.readdirSync(path.join(pkg, "src")).filter((f) => f.endsWith(".ts"));

const j = (...p: string[]) => p.join(""); // 금지 낱말은 조각으로 적는다 (CI 낱말 검사 대상 파일)

describe("공개 진입점", () => {
  it("내보내는 값은 함수 둘뿐이다 (증여세 계산 · 상속세 계산)", () => {
    expect(Object.keys(api).sort()).toEqual(["calcGift", "calcInheritance"]);
    expect(typeof api.calcGift).toBe("function");
    expect(typeof api.calcInheritance).toBe("function");
  });
  it("package.json 에 실행 의존 패키지가 없다", () => {
    const j = JSON.parse(read("package.json").toString("utf8"));
    expect(j.name).toBe("@ltr/igt-engine");
    expect(j.dependencies).toBeUndefined();
  });
});

describe("순수성 - src 에는 외부 접근 낱말이 없다", () => {
  const banned: Array<[string, RegExp]> = [
    ["네트워크", /\bfetch\s*\(|XMLHttpRequest|WebSocket|node:(http|https|net|dns|child_process)|\baxios\b/],
    ["AI SDK", /@anthropic-ai|anthropic|openai|generative-ai|@ltr\/(assistant|agent)/i],
    ["환경변수", /process\.env|import\.meta\.env|\bDeno\.env\b/],
    ["파일·시계·난수", /node:fs|\brequire\s*\(|\bimport\s*\(|Date\.now|new Date\(|Math\.random|performance\.now/],
    ["브라우저 저장소", /localStorage|sessionStorage|indexedDB|document\.cookie|navigator\./],
    ["다른 세목 묶음", new RegExp([j("양", "도"), j("trans", "fer"), j("oner", "ous"), j("bur", "den"), j("부담", "부"), j("calc_?", "cgt"), "@ltr\/tax-engine"].join("|"), "i")],
  ];
  for (const f of srcFiles) {
    for (const [label, re] of banned) {
      it(`${f}: ${label} 0`, () => {
        // 주석은 설명 글이라 코드 줄만 본다
        const code = read(`src/${f}`).toString("utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
        expect(code.match(re)).toBeNull();
      });
    }
  }
  it("src 의 import 는 같은 폴더 상대 경로뿐이다", () => {
    for (const f of srcFiles) {
      const imports = [...read(`src/${f}`).toString("utf8").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const i of imports) expect(i.startsWith("./")).toBe(true);
    }
  });
});

describe("출처 고정 (SOURCE.json)", () => {
  const source = JSON.parse(read("SOURCE.json").toString("utf8"));
  it("사본 파일의 SHA-256 이 기록과 같다 - 사본을 고치면 실패", () => {
    expect(source.files).toHaveLength(7);
    for (const f of source.files) {
      const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "../../..", f.copy))).digest("hex");
      expect(sha, f.copy).toBe(f.sha256);
    }
  });
  it("engineFiles 해시가 src 실제 파일과 같다 - 엔진을 고치면 SOURCE.json 도 같이 고쳐야 한다 (엔진 해시 -> 게이트 재닫힘)", () => {
    expect(source.engineFiles.map((f: { copy: string }) => path.basename(f.copy)).sort()).toEqual(srcFiles.slice().sort());
    for (const f of source.engineFiles) {
      const sha = crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, "../../..", f.copy))).digest("hex");
      expect(sha, f.copy).toBe(f.copySha256);
    }
  });
  it("룰셋 버전과 복사 날짜가 있다", () => {
    expect(source.source.rulesetVersion).toBe("2026.07.12-v1");
    expect(source.source.copiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("복사하지 않기로 한 파일이 reference 에 없다", () => {
    const names: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : names.push(e.name));
    };
    walk(path.join(pkg, "reference"));
    for (const banned of ["simulate_igt.py", j("calc_", "cgt.py"), "filing_draft.py", "explain_report.py", "analyze_impact.py", "approve.py", "tax_rules_current.json"]) {
      expect(names).not.toContain(banned);
    }
    expect(names.some((n) => /^scenario_/.test(n))).toBe(false);
  });
});

describe("rules-igt 초안 룰셋 모양", () => {
  const rs = JSON.parse(fs.readFileSync(path.join(dir, "../../../rules-igt/2026.07.json"), "utf8")) as Record<string, unknown>;
  it("최상위 칸은 허용 목록 안이고 네 묶음이 모두 있다", () => {
    const allowed = ["version", "status", "effective_from", "source", "source_laws", "common", "gift", "inheritance", "payment"];
    expect(Object.keys(rs).filter((k) => !allowed.includes(k))).toEqual([]);
    for (const k of ["common", "gift", "inheritance", "payment"]) expect(typeof rs[k]).toBe("object");
  });
  it("draft 이고 서명·승인 기록이 없으며 다른 세목 묶음 낱말이 없다", () => {
    expect(rs.status).toBe("draft");
    expect(JSON.stringify(rs)).not.toMatch(new RegExp([j("양", "도"), j("부담", "부"), j("trans", "fer"), j("oner", "ous"), j("bur", "den"), j("calc_?", "cgt")].join("|"), "i"));
  });
});
