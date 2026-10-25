#!/usr/bin/env node
// 국세 미산출 저장소 검사 (01B TX-06 · PRD-00 원칙 17·18 · docs/dev/W3_설계.md 2.7 · docs/dev/3단계_설계.md 4.4) — 양도세 금액은 만들지 않고, 상속·증여세는 허용 구역에서만 다룬다.
// 커밋 대상 파일(git ls-files — 추적 + 무시하지 않은 새 파일)을 읽어 아래 규칙을 본다. 문서(docs/·*.md)는 보지 않는다.
//  NT1 국세 세율표·계산 이름 — 이름 하나에 국세 세목 + 계산·세율 낱말이 함께 있거나, 영문 국세 세목 이름이 있는 줄(과 아래 3줄)에 세율·구간·공제 낱말이 있다
//  NT2 국세 세율 문구 — 한국어 국세 세목 바로 뒤(0~3글자)에 세율·과세표준·누진공제·산출세액·세액 계산·계산식
//  NT3 룰셋 국세 세목 — 룰셋 세목 칸(세목 키 이름·rulesets) 뒤 같은 문장(다음 ; 또는 빈 줄까지, 1,500자)과 룰셋 파일(rules/·packages/tax-engine/·이름에 ruleset)에 국세 세목 값
//  NT4 국세 계산 경로 — apps/web/app 아래 경로 조각이 국세 세목 이름이거나, calc 아래가 양도·상속·증여 경로
//  NT5 공개 화면 국세 입력 요소 — 공개 화면 소스(apps/web/app/(site)·components/site·packages/ui/src)의 입력 칸(input·select·textarea)·라벨에 국세 세목·금액 낱말
//  NT6 PRD 개정 표식 — scripts/national-tax-zones.json에 prd_ref가 있는데 PRD_최종 §2.2 원칙 4 줄에 개정 표식이 없다 (그 줄만 본다)
//  NT7 허용 구역 안 금지 낱말 — 구역 안에서도 양도 묶음 낱말·부담부증여 이름(onerous·burden)·calc_cgt는 없어야 한다
//  NT8 두 엔진 동시 import — 지방세 엔진과 상속·증여 엔진을 한 파일에서 함께 불러오면 실패 (참조 파일 목록 제외)
//  NT9 AI·워크플로 경계 — packages/assistant·packages/agent·workflows가 상속·증여 엔진을 불러오면 실패
// 낱말은 두 묶음이다. 양도 묶음(transfer·양도 …)은 NT1~NT5를 저장소 전체에 적용한다(예외 0). 상속·증여 묶음(상속·증여 세목의 영문·한글 이름과 짧은 약칭 …)은
// 허용 구역(scripts/national-tax-zones.json) 밖에서만 NT1~NT5를 적용한다. 구역이 없으면(JSON 없음) 모든 파일이 구역 밖이다.
// 낱말 목록은 아래 상수 하나가 원본이다 — E2E(e2e/w3-home-points)가 같은 formControlHits로 렌더된 공개 HTML을 본다.
// 이 파일과 시험 파일도 검사 대상이다(예외 0) — 그래서 낱말은 조각을 이어 붙여 만든다.
// 사용: node scripts/check-national-tax.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { importsOf } from "./check-deps.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const join = (...parts) => parts.join("");

/** 양도 묶음 — 국세 세목 이름 (영문 — 소문자, 밑줄·하이픈을 지운 모양) */
export const TRANSFER_STEMS = [
  join("transfer", "tax"),
  join("transfer", "income"),
  join("transferlocal", "income"),
  join("localincome", "transfer"),
  join("capital", "gain"),
  join("yang", "do"),
];
/** 양도 묶음 — 한국어 */
export const TRANSFER_KO = [join("양도", "세"), join("양도소득", "세"), join("양도소득", "분")];
/** 상속·증여 묶음 — 영문 (짧은 약칭은 이름 조각 하나로 따로 본다: shortToken) */
export const INHGIFT_STEMS = [join("inheritance", "tax"), join("gift", "tax"), join("sang", "sok"), join("jeung", "yeo")];
/** 상속·증여 묶음 — 한국어 */
export const INHGIFT_KO = [join("상속", "세"), join("증여", "세")];
/** 국세 세목 이름 (영문) — 두 묶음 합친 목록 */
export const NATIONAL_STEMS = [...TRANSFER_STEMS, ...INHGIFT_STEMS];
/** 국세 세목 이름 (한국어) — 두 묶음 합친 목록 */
export const NATIONAL_KO = [...TRANSFER_KO, ...INHGIFT_KO];
/** 계산·세율 낱말 — 국세 세목과 한 이름에 붙으면 NT1 */
export const CALC_STEMS = ["rate", "bracket", "deduction", "table", "calc", "compute", "estimate", "amount", "liability", "payable", "rule", "engine", "formula", "simulat"];
/** 국세 세목 이름 줄 근처의 세율·구간·공제 낱말 (NT1 두 번째 모양) */
const NEAR_RATE = new RegExp(join("\\b(?:rates?|brackets?|deductions?|formula)\\b|", "세", "율|누진|과세", "표준"), "i");
/** 룰셋 세목 칸 (NT3) */
const KIND_KEYS = new RegExp(join("\\b(?:tax_", "kind|tax", "Kind|Tax", "Kind|TAX_", "KIND|rule", "sets?|RULE", "SETS?)\\b"), "g");

/** 낱말 묶음 — NT1~NT5가 한 번에 보는 낱말 모음. short는 약칭 조각, calcSub는 NT4의 calc 아래 경로 조각, input*은 NT5 금액 낱말 */
const TRANSFER_SCOPE = {
  stems: TRANSFER_STEMS,
  ko: TRANSFER_KO,
  short: false,
  calcSub: /^transfer/,
  inputStems: [join("transfer", "price"), join("transfer", "gain")],
  inputKo: [join("양도", "소득"), join("양도", "가액"), join("양도", "차익")],
};
const INHGIFT_SCOPE = {
  stems: INHGIFT_STEMS,
  ko: INHGIFT_KO,
  short: true,
  calcSub: /^(inheritance|gift)/,
  inputStems: [],
  inputKo: [join("상속", "재산"), join("증여", "재산"), join("증여", "가액")],
};
const mergeScope = (a, b) => ({
  stems: [...a.stems, ...b.stems],
  ko: [...a.ko, ...b.ko],
  short: a.short || b.short,
  calcSub: new RegExp(`${a.calcSub.source}|${b.calcSub.source}`),
  inputStems: [...a.inputStems, ...b.inputStems],
  inputKo: [...a.inputKo, ...b.inputKo],
});
/** 허용 구역 밖 — 두 묶음 모두 */
const ALL_SCOPE = mergeScope(TRANSFER_SCOPE, INHGIFT_SCOPE);

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sql", ".py", ".yaml", ".yml", ".toml", ".html", ".sh"]);
const JS_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const UI_EXT = new Set([".tsx", ".jsx", ".html"]);
const RULE_FILE = /(^|\/)(rules|packages\/tax-engine)\//;
const PUBLIC_UI = /^(apps\/web\/app\/\(site\)\/|apps\/web\/components\/site\/|packages\/ui\/src\/)/;

/** NT6 — 개정 표식(PRD_최종 §2.2 원칙 4 줄) */
export const PRD_MARKER = join("(2026-10-25 개정 ", "—", " W11-g)");
/** NT7 — 허용 구역 안에서도 막는 이름 (부담부증여·양도세 계산 파일 이름) */
const ZONE_BANNED = [join("onero", "us"), join("bur", "den"), join("calc", "cgt")];
/** NT8·NT9 — 패키지 이름 */
const SHORT = join("i", "gt");
const TAX_PKG = join("@ltr/tax", "-engine");
const INHGIFT_PKG = join("@ltr/", SHORT, "-engine");
/** NT9 — 상속·증여 엔진을 불러오면 안 되는 위치 */
const AI_DIRS = ["packages/assistant/", "packages/agent/", "workflows/"];
export const ZONES_FILE = "scripts/national-tax-zones.json";

/** 소문자 + 밑줄·하이픈·$ 지우기 (이름 비교용) */
const squash = (s) => s.toLowerCase().replace(/[_$-]/g, "");
/** 소문자 + 공백·밑줄·하이픈·가운뎃점·마침표 지우기 (글자 비교용) */
const squashText = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s_\-·.]/g, "");
/** 이름을 낱말 조각으로 쪼갠다 — 밑줄·하이픈·마침표·슬래시·낙타 표기 경계 (소문자) */
const nameParts = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
const shortToken = (s) => nameParts(s).includes(SHORT);

/** 묶음 안의 국세 세목 이름인가 — 영문 세목(밑줄·하이픈 무시) 또는 약칭 조각 */
const hasNationalId = (id, scope) => scope.stems.some((s) => squash(id).includes(s)) || (scope.short && shortToken(id));
/** 세목 이름을 뺀 나머지에 계산·세율 낱말이 있나 */
function hasCalcPart(id, scope) {
  let rest = squash(id).replace(new RegExp(scope.stems.join("|"), "g"), " ");
  if (scope.short && shortToken(id)) rest += ` ${nameParts(id).filter((p) => p !== SHORT).join(" ")}`;
  return CALC_STEMS.some((s) => rest.includes(s));
}

/** 국세 세목 값이 들어 있나 — 영문(밑줄·하이픈 무시)·한국어 */
export function hasNationalToken(text, scope = ALL_SCOPE) {
  const flat = squash(text);
  return scope.stems.some((s) => flat.includes(s)) || scope.ko.some((k) => text.includes(k)) || (scope.short && shortToken(text));
}

/** 이름(식별자) 목록 — 영문 이름과 경로 조각 */
const identifiers = (line) => line.match(/[A-Za-z_$][A-Za-z0-9_$-]*/g) ?? [];

const koRate = (scope) => new RegExp(`(?:${scope.ko.join("|")})[\\s_·]{0,3}(?:${join("세", "율")}|${join("과세", "표준")}|${join("누진", "공제")}|${join("산출", "세액")}|${join("세액", "[\\s_]?", "계산")}|${join("계산", "식")})`);

/** NT1·NT2 — 한 파일의 줄들 */
function nameHits(lines, scope) {
  const hits = [];
  const ko = koRate(scope);
  lines.forEach((line, i) => {
    const ids = identifiers(line);
    for (const id of ids) {
      if (hasNationalId(id, scope) && hasCalcPart(id, scope)) {
        hits.push({ line: i + 1, rule: "NT1", note: `국세 세율표·계산 이름 '${id}'` });
        return;
      }
    }
    // 영문 국세 세목 이름(예: 표 이름·객체 키)이 있는 줄과 아래 3줄 — 한국어 문장은 NT2(세목 바로 뒤 0~3글자)만 본다
    if (ids.some((id) => hasNationalId(id, scope)) && NEAR_RATE.test(lines.slice(i, i + 4).join("\n"))) {
      hits.push({ line: i + 1, rule: "NT1", note: "국세 세목 이름 근처에 세율·구간·공제 낱말" });
      return;
    }
    if (ko.test(line)) hits.push({ line: i + 1, rule: "NT2", note: "국세 세율·산출 문구" });
  });
  return hits;
}

/** NT3 — 룰셋 세목 칸 뒤 같은 문장(다음 ; 또는 빈 줄, 1,500자까지)에 국세 세목 값 */
function rulesetHits(text, scope) {
  const hits = [];
  for (const m of text.matchAll(KIND_KEYS)) {
    const rest = text.slice(m.index, m.index + 1500);
    const end = rest.search(/;|\n\s*\n/);
    const window = end === -1 ? rest : rest.slice(0, end);
    if (hasNationalToken(window, scope)) hits.push({ line: text.slice(0, m.index).split("\n").length, rule: "NT3", note: "룰셋 세목 칸에 국세 세목 값" });
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
export function routeHit(relPath, scope = ALL_SCOPE) {
  if (!relPath.startsWith("apps/web/app/")) return null;
  const segs = relPath
    .slice("apps/web/app/".length)
    .split("/")
    .slice(0, -1)
    .map((s) => safeDecode(s).replace(/^\((.*)\)$/, "$1").replace(/^\[+\.{0,3}(.*?)\]+$/, "$1").toLowerCase());
  for (let i = 0; i < segs.length; i++) {
    if (hasNationalId(segs[i], scope)) return `국세 계산 경로 '${segs.slice(0, i + 1).join("/")}'`;
    if (i > 0 && segs[i - 1] === "calc" && scope.calcSub.test(segs[i])) return `국세 계산 경로 '${segs.slice(0, i + 1).join("/")}' (calc 아래 양도·상속·증여 — PRD-00 9장)`;
  }
  return null;
}

/** NT5 — 입력 칸(input·select·textarea 시작 태그)과 라벨(내용 300자까지)의 국세 금액 낱말. 렌더된 HTML과 JSX 소스 모두 */
export function formControlHits(html, scope = ALL_SCOPE) {
  const hits = [];
  const inputStems = [...scope.stems, ...scope.inputStems];
  const inputKo = [...scope.ko, ...scope.inputKo];
  const check = (snippet, index, kind) => {
    const flat = squashText(snippet);
    const stem = inputStems.find((s) => flat.includes(s)) ?? inputKo.find((k) => flat.includes(squashText(k))) ?? (scope.short && shortToken(snippet));
    if (stem) hits.push({ line: html.slice(0, index).split("\n").length, rule: "NT5", note: `공개 화면 ${kind}에 국세 금액 낱말` });
  };
  for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) check(m[0], m.index, "입력 칸");
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]{0,300}?)<\/label>/gi)) check(m[0], m.index, "라벨");
  return hits;
}

// ── 허용 구역 ─────────────────────────────────────────────

/** {a,b} 묶음을 펼친다 (한 단계씩 반복) */
function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1].split(",").flatMap((alt) => expandBraces(pattern.slice(0, m.index) + alt + pattern.slice(m.index + m[0].length)));
}
/** 글롭 → 정규식: ** 는 / 를 넘고, * 는 한 칸 안, 나머지는 글자 그대로 */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** 허용 구역 설정 읽기 — JSON이 없으면 null(구역 없음). 모양이 틀리면 오류 */
export function loadZones(root) {
  const full = path.join(root, ZONES_FILE);
  if (!fs.existsSync(full)) return null;
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  return buildZones(raw);
}
export function buildZones(raw) {
  const zones = (raw.allowedZones ?? []).flatMap(expandBraces).map(globToRegExp);
  return { zones, refs: new Set(raw.referenceFiles ?? []), prdRef: typeof raw.prd_ref === "string" ? raw.prd_ref : null };
}
/** 파일이 어느 구역인가 — zone(허용 구역) · ref(참조 파일) · none */
export function zoneOf(relPath, cfg) {
  if (!cfg) return "none";
  if (cfg.refs.has(relPath)) return "ref";
  return cfg.zones.some((re) => re.test(relPath)) ? "zone" : "none";
}

/** NT6 — PRD_최종 §2.2 원칙 4 줄 */
export function prdMarkerHits(prdText) {
  const lines = prdText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{2,4}\s*2\.2\b/.test(l));
  let principle4 = null;
  if (start !== -1) {
    for (let i = start + 1; i < lines.length && !/^#{1,4}\s/.test(lines[i]); i++) {
      if (/^4\.\s/.test(lines[i])) {
        principle4 = lines[i];
        break;
      }
    }
  }
  if (principle4 === null) return [{ line: 0, rule: "NT6", note: "PRD_최종 §2.2 원칙 4 줄을 찾지 못했습니다" }];
  if (!principle4.includes(PRD_MARKER)) return [{ line: lines.indexOf(principle4) + 1, rule: "NT6", note: `PRD_최종 원칙 4 줄에 개정 표식 '${PRD_MARKER}'이 없습니다 — PRD 개정이 먼저입니다` }];
  return [];
}

/** NT7 — 허용 구역 안 파일의 금지 낱말: 양도 묶음 낱말·부담부증여 이름·calc_cgt (경로와 글자) */
function zoneBannedHits(relPath, lines) {
  const hits = [];
  const banned = (id) => {
    const n = squash(id);
    if (TRANSFER_SCOPE.stems.some((s) => n.includes(s))) return "양도 묶음 낱말";
    if (nameParts(id).includes("transfer")) return "양도 묶음 낱말";
    const b = ZONE_BANNED.find((w) => n.includes(w));
    return b ? "부담부증여·양도세 계산 이름" : null;
  };
  for (const seg of relPath.split("/")) {
    const why = banned(seg.replace(/\.[^.]+$/, ""));
    if (why) hits.push({ line: 0, rule: "NT7", note: `허용 구역 안 경로 '${seg}'에 ${why}` });
  }
  lines.forEach((line, i) => {
    const why = identifiers(line).map(banned).find(Boolean) ?? (line.includes("양도") ? "양도 묶음 낱말" : null);
    if (why) hits.push({ line: i + 1, rule: "NT7", note: `허용 구역 안에 ${why}` });
  });
  return hits;
}

const hasPkg = (specs, pkg) => specs.some((s) => s === pkg || s.startsWith(`${pkg}/`));

/** 파일 하나 — 경로(저장소 기준, / 구분)와 글자 → 위반 목록. options.zones는 buildZones/loadZones 결과(없으면 구역 없음) */
export function scanFile(relPath, text, options = {}) {
  const hits = [];
  const ext = path.extname(relPath).toLowerCase();
  const kind = zoneOf(relPath, options.zones ?? null);
  // 구역·참조 파일은 양도 묶음만, 구역 밖은 두 묶음 모두
  const scope = kind === "none" ? ALL_SCOPE : TRANSFER_SCOPE;
  const route = routeHit(relPath, scope);
  if (route) hits.push({ line: 0, rule: "NT4", note: route });
  for (const seg of relPath.split("/")) {
    const stem = seg.replace(/\.[^.]+$/, "");
    if (hasNationalId(stem, scope) && hasCalcPart(stem, scope)) hits.push({ line: 0, rule: "NT1", note: `국세 계산 파일 이름 '${seg}'` });
  }
  const isCode = CODE_EXT.has(ext);
  const lines = isCode ? text.split(/\r?\n/) : [];
  if (kind === "zone") hits.push(...zoneBannedHits(relPath, lines));
  if (!isCode) return hits;
  hits.push(...nameHits(lines, scope), ...rulesetHits(text, scope));
  if ((RULE_FILE.test(relPath) || /ruleset/i.test(relPath)) && hasNationalToken(text, scope)) hits.push({ line: 0, rule: "NT3", note: "룰셋 파일에 국세 세목 값" });
  if (UI_EXT.has(ext) && PUBLIC_UI.test(relPath) && !/\.test\.[a-z]+$/.test(relPath)) hits.push(...formControlHits(text, scope));
  if (JS_EXT.has(ext)) {
    const specs = importsOf(text);
    if (kind !== "ref" && hasPkg(specs, TAX_PKG) && hasPkg(specs, INHGIFT_PKG)) hits.push({ line: 0, rule: "NT8", note: "지방세 엔진과 상속·증여 엔진을 한 파일에서 함께 불러옵니다" });
    if (AI_DIRS.some((d) => relPath.startsWith(d)) && hasPkg(specs, INHGIFT_PKG)) hits.push({ line: 0, rule: "NT9", note: "AI·워크플로 쪽이 상속·증여 엔진을 불러옵니다 (AI는 국세 금액을 만들지 않습니다)" });
  } else if (path.basename(relPath) === "package.json" && AI_DIRS.some((d) => relPath.startsWith(d)) && text.includes(INHGIFT_PKG)) {
    hits.push({ line: 0, rule: "NT9", note: "AI·워크플로 쪽 package.json이 상속·증여 엔진에 의존합니다" });
  }
  return hits;
}

/** 저장소 전체 — git이 아는 파일(추적 + 무시하지 않은 새 파일), 문서 제외 */
export function scanRepo(root) {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.startsWith("docs/") && !f.toLowerCase().endsWith(".md") && f !== "pnpm-lock.yaml");
  const zones = loadZones(root);
  const hits = [];
  if (zones?.prdRef) {
    const prd = path.join(root, zones.prdRef);
    if (!fs.existsSync(prd)) hits.push({ file: zones.prdRef, line: 0, rule: "NT6", note: "prd_ref가 가리키는 PRD 파일이 없습니다" });
    else for (const h of prdMarkerHits(fs.readFileSync(prd, "utf8"))) hits.push({ file: zones.prdRef, ...h });
  }
  let scanned = 0;
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    const st = fs.statSync(full);
    if (st.isDirectory() || st.size > MAX_BYTES) continue; // 다른 작업 트리(.claude/worktrees)가 폴더 한 줄로 잡힐 때 건너뜀
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue; // 바이너리
    scanned++;
    for (const h of scanFile(f, buf.toString("utf8"), { zones })) hits.push({ file: f, ...h });
  }
  return { scanned, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { scanned, hits } = scanRepo(root);
  if (hits.length) {
    console.error(`국세 미산출 검사 실패 ${hits.length}건 — 양도세 금액은 만들지 않고, 상속·증여세는 허용 구역에서만 다룹니다 (TX-06, 설계 2.7·3단계 설계 4.4)`);
    for (const h of hits) console.error(` - ${h.file}${h.line ? `:${h.line}` : ""} ${h.rule} ${h.note}`);
    process.exit(1);
  }
  console.log(`국세 미산출 검사 통과 — 파일 ${scanned}개 (NT1~NT9 위반 0)`);
}
