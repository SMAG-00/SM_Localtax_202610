#!/usr/bin/env node
// 국세 미산출 저장소 검사 (01B TX-06 · PRD-00 원칙 17·18 · docs/dev/W3_설계.md 2.7) — 이 사이트는 국세(상속·증여·양도 세목) 금액을 만들지 않는다.
// 커밋 대상 파일(git ls-files — 추적 + 무시하지 않은 새 파일)을 읽어 아래 다섯 규칙을 본다. 문서(docs/·*.md)는 보지 않는다.
//  NT1 국세 세율표·계산 이름 — 이름 하나에 국세 세목 + 계산·세율 낱말이 함께 있거나, 영문 국세 세목 이름이 있는 줄(과 아래 3줄)에 세율·구간·공제 낱말이 있다
//  NT2 국세 세율 문구 — 한국어 국세 세목 바로 뒤(0~3글자)에 세율·과세표준·누진공제·산출세액·세액 계산·계산식
//  NT3 룰셋 국세 세목 — 룰셋 세목 칸(세목 키 이름·rulesets) 뒤 같은 문장(다음 ; 또는 빈 줄까지, 1,500자)과 룰셋 파일(rules/·packages/tax-engine/·이름에 ruleset)에 국세 세목 값
//  NT4 국세 계산 경로 — apps/web/app 아래 경로 조각이 국세 세목 이름이거나, calc 아래가 양도·상속·증여 경로
//  NT5 공개 화면 국세 입력 요소 — 공개 화면 소스(apps/web/app/(site)·components/site·packages/ui/src)의 입력 칸(input·select·textarea)·라벨에 국세 세목·금액 낱말
// 낱말 목록은 아래 상수 하나가 원본이다 — E2E(e2e/w3-home-points)가 같은 formControlHits로 렌더된 공개 HTML을 본다.
// 이 파일과 시험 파일도 검사 대상이다(예외 0) — 그래서 낱말은 조각을 이어 붙여 만든다.
// 사용: node scripts/check-national-tax.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_BYTES = 2 * 1024 * 1024;
const join = (...parts) => parts.join("");

/** 국세 세목 이름 (영문 — 소문자, 밑줄·하이픈을 지운 모양) */
export const NATIONAL_STEMS = [
  join("inheritance", "tax"),
  join("gift", "tax"),
  join("transfer", "tax"),
  join("transfer", "income"),
  join("transferlocal", "income"),
  join("localincome", "transfer"),
  join("capital", "gain"),
  join("yang", "do"),
  join("sang", "sok"),
  join("jeung", "yeo"),
];
/** 국세 세목 이름 (한국어) */
export const NATIONAL_KO = [join("상속", "세"), join("증여", "세"), join("양도", "세"), join("양도소득", "세"), join("양도소득", "분")];
/** 계산·세율 낱말 — 국세 세목과 한 이름에 붙으면 NT1 */
export const CALC_STEMS = ["rate", "bracket", "deduction", "table", "calc", "compute", "estimate", "amount", "liability", "payable", "rule", "engine", "formula", "simulat"];
/** 국세 세목 이름 줄 근처의 세율·구간·공제 낱말 (NT1 두 번째 모양) */
const NEAR_RATE = new RegExp(join("\\b(?:rates?|brackets?|deductions?|formula)\\b|", "세", "율|누진|과세", "표준"), "i");
const KO_RATE = new RegExp(`(?:${NATIONAL_KO.join("|")})[\\s_·]{0,3}(?:${join("세", "율")}|${join("과세", "표준")}|${join("누진", "공제")}|${join("산출", "세액")}|${join("세액", "[\\s_]?", "계산")}|${join("계산", "식")})`);
/** 룰셋 세목 칸 (NT3) */
const KIND_KEYS = new RegExp(join("\\b(?:tax_", "kind|tax", "Kind|Tax", "Kind|TAX_", "KIND|rule", "sets?|RULE", "SETS?)\\b"), "g");
/** 공개 화면 입력 칸에서 막는 금액 낱말 (NT5) — 국세 세목 이름 + 양도가액·양도차익·상속·증여 재산 */
const INPUT_STEMS = [...NATIONAL_STEMS, join("transfer", "price"), join("transfer", "gain")];
const INPUT_KO = [...NATIONAL_KO, join("양도", "소득"), join("양도", "가액"), join("양도", "차익"), join("상속", "재산"), join("증여", "재산"), join("증여", "가액")];

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sql", ".py", ".yaml", ".yml", ".toml", ".html", ".sh"]);
const UI_EXT = new Set([".tsx", ".jsx", ".html"]);
const RULE_FILE = /(^|\/)(rules|packages\/tax-engine)\//;
const PUBLIC_UI = /^(apps\/web\/app\/\(site\)\/|apps\/web\/components\/site\/|packages\/ui\/src\/)/;

/** 소문자 + 밑줄·하이픈·$ 지우기 (이름 비교용) */
const squash = (s) => s.toLowerCase().replace(/[_$-]/g, "");
/** 소문자 + 공백·밑줄·하이픈·가운뎃점·마침표 지우기 (글자 비교용) */
const squashText = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s_\-·.]/g, "");
const hasNationalStem = (name) => NATIONAL_STEMS.some((s) => name.includes(s));
const hasCalcStem = (name) => CALC_STEMS.some((s) => name.includes(s));

/** 국세 세목 값이 들어 있나 — 영문(밑줄·하이픈 무시)·한국어 */
export function hasNationalToken(text) {
  const flat = squash(text);
  return hasNationalStem(flat) || NATIONAL_KO.some((k) => text.includes(k));
}

/** 이름(식별자) 목록 — 영문 이름과 경로 조각 */
const identifiers = (line) => line.match(/[A-Za-z_$][A-Za-z0-9_$-]*/g) ?? [];

/** NT1·NT2 — 한 파일의 줄들 */
function nameHits(lines) {
  const hits = [];
  lines.forEach((line, i) => {
    for (const id of identifiers(line)) {
      const n = squash(id);
      if (hasNationalStem(n) && hasCalcStem(n.replace(new RegExp(NATIONAL_STEMS.join("|"), "g"), " "))) {
        hits.push({ line: i + 1, rule: "NT1", note: `국세 세율표·계산 이름 '${id}'` });
        return;
      }
    }
    // 영문 국세 세목 이름(예: 표 이름·객체 키)이 있는 줄과 아래 3줄 — 한국어 문장은 NT2(세목 바로 뒤 0~3글자)만 본다
    const national = identifiers(line).some((id) => hasNationalStem(squash(id)));
    if (national && NEAR_RATE.test(lines.slice(i, i + 4).join("\n"))) {
      hits.push({ line: i + 1, rule: "NT1", note: "국세 세목 이름 근처에 세율·구간·공제 낱말" });
      return;
    }
    if (KO_RATE.test(line)) hits.push({ line: i + 1, rule: "NT2", note: "국세 세율·산출 문구" });
  });
  return hits;
}

/** NT3 — 룰셋 세목 칸 뒤 같은 문장(다음 ; 또는 빈 줄, 1,500자까지)에 국세 세목 값 */
function rulesetHits(text) {
  const hits = [];
  for (const m of text.matchAll(KIND_KEYS)) {
    const rest = text.slice(m.index, m.index + 1500);
    const end = rest.search(/;|\n\s*\n/);
    const window = end === -1 ? rest : rest.slice(0, end);
    if (hasNationalToken(window)) hits.push({ line: text.slice(0, m.index).split("\n").length, rule: "NT3", note: "룰셋 세목 칸에 국세 세목 값" });
  }
  return hits;
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** NT4 — 경로 조각 (Next.js 경로 묶음 괄호·%5F를 푼 이름) */
export function routeHit(relPath) {
  if (!relPath.startsWith("apps/web/app/")) return null;
  const segs = relPath
    .slice("apps/web/app/".length)
    .split("/")
    .slice(0, -1)
    .map((s) => safeDecode(s).replace(/^\((.*)\)$/, "$1").replace(/^\[+\.{0,3}(.*?)\]+$/, "$1").toLowerCase());
  for (let i = 0; i < segs.length; i++) {
    const flat = squash(segs[i]);
    if (hasNationalStem(flat)) return `국세 계산 경로 '${segs.slice(0, i + 1).join("/")}'`;
    if (i > 0 && segs[i - 1] === "calc" && /^(transfer|inheritance|gift)/.test(segs[i])) return `국세 계산 경로 '${segs.slice(0, i + 1).join("/")}' (calc 아래 양도·상속·증여 — PRD-00 9장)`;
  }
  return null;
}

/** NT5 — 입력 칸(input·select·textarea 시작 태그)과 라벨(내용 300자까지)의 국세 금액 낱말. 렌더된 HTML과 JSX 소스 모두 */
export function formControlHits(html) {
  const hits = [];
  const check = (snippet, index, kind) => {
    const flat = squashText(snippet);
    const stem = INPUT_STEMS.find((s) => flat.includes(s)) ?? INPUT_KO.find((k) => flat.includes(squashText(k)));
    if (stem) hits.push({ line: html.slice(0, index).split("\n").length, rule: "NT5", note: `공개 화면 ${kind}에 국세 금액 낱말` });
  };
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) check(m[0], m.index, "입력 칸");
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]{0,300}?)<\/label>/gi)) check(m[0], m.index, "라벨");
  return hits;
}

/** 파일 하나 — 경로(저장소 기준, / 구분)와 글자 → 위반 목록 */
export function scanFile(relPath, text) {
  const hits = [];
  const ext = path.extname(relPath).toLowerCase();
  const route = routeHit(relPath);
  if (route) hits.push({ line: 0, rule: "NT4", note: route });
  for (const seg of relPath.split("/")) {
    const n = squash(seg.replace(/\.[^.]+$/, ""));
    if (hasNationalStem(n) && hasCalcStem(n.replace(new RegExp(NATIONAL_STEMS.join("|"), "g"), " "))) hits.push({ line: 0, rule: "NT1", note: `국세 계산 파일 이름 '${seg}'` });
  }
  if (!CODE_EXT.has(ext)) return hits;
  const lines = text.split(/\r?\n/);
  hits.push(...nameHits(lines), ...rulesetHits(text));
  if ((RULE_FILE.test(relPath) || /ruleset/i.test(relPath)) && hasNationalToken(text)) hits.push({ line: 0, rule: "NT3", note: "룰셋 파일에 국세 세목 값" });
  if (UI_EXT.has(ext) && PUBLIC_UI.test(relPath) && !/\.test\.[a-z]+$/.test(relPath)) hits.push(...formControlHits(text));
  return hits;
}

/** 저장소 전체 — git이 아는 파일(추적 + 무시하지 않은 새 파일), 문서 제외 */
export function scanRepo(root) {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/") && !f.toLowerCase().endsWith(".md") && f !== "pnpm-lock.yaml");
  const hits = [];
  let scanned = 0;
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full) || fs.statSync(full).size > MAX_BYTES) continue;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue; // 바이너리
    scanned++;
    for (const h of scanFile(f, buf.toString("utf8"))) hits.push({ file: f, ...h });
  }
  return { scanned, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { scanned, hits } = scanRepo(root);
  if (hits.length) {
    console.error(`국세 미산출 검사 실패 ${hits.length}건 — 이 사이트는 국세(상속·증여·양도 세목) 금액을 만들지 않습니다 (TX-06, 설계 2.7)`);
    for (const h of hits) console.error(` - ${h.file}${h.line ? `:${h.line}` : ""} ${h.rule} ${h.note}`);
    process.exit(1);
  }
  console.log(`국세 미산출 검사 통과 — 파일 ${scanned}개 (NT1~NT5 위반 0)`);
}
