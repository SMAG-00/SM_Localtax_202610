// 01B TX-06 · PRD-00 원칙 17·18 — 국세 미산출 저장소 검사 (docs/dev/W3_설계.md 2.7). 위반 파일을 임시 저장소에 넣어 검사가 실제로 잡는지 본다.
// 위반 견본 글자는 조각을 이어 붙여 만든다 — 이 시험 파일 자체도 저장소 검사 대상이다(예외 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { buildZones, formControlHits, prdMarkerHits, routeHit, scanFile, zoneOf } from "../check-national-tax.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-national-tax.mjs");
const j = (...parts) => parts.join("");
const GIFT = j("gift", "Tax");
const KO = { inh: j("상속", "세"), gift: j("증여", "세"), transfer: j("양도", "세") };

/** 위반 없는 저장소 — 지방세 이름·해석 원문 세목 칸·상속·증여 취득 원인·국세 미계산 안내 문구 */
const CLEAN = {
  "apps/web/lib/tax/acquisition.ts": 'export const ACQUISITION_CAUSES = ["PURCHASE", "INHERITANCE", "GIFT", "NEW_BUILD"] as const;\nexport const acquisitionRate = (x: number) => x;\n',
  "apps/web/lib/legal.ts": 'export interface Doc { tax_kinds: string[]; taxKinds: string[] }\n',
  "apps/web/components/site/Notice.tsx": `export const Notice = () => <p>${KO.inh}·${KO.gift}는 이 사이트에서 계산하지 않습니다</p>;\n`,
  "apps/web/components/site/Filter.tsx": 'export const F = () => <form><label htmlFor="t">세목</label><input id="t" name="tax" /></form>;\n',
  "apps/web/app/(site)/realestate/inheritance-gift/page.tsx": "export default function P() { return null; }\n",
  "apps/web/app/(site)/calc/page.tsx": "export default function P() { return null; }\n",
  "packages/db/supabase/migrations/0001.sql": "create table public.rulesets (id bigint, tax_kind text check (tax_kind in ('acquisition', 'holding')));\n",
  "e2e/sample.test.mjs": `const S = ["${KO.inh}와 취득세를 함께 따져야 한다.", "재산세 과세표준은 공시가격으로 정한다."];\n`,
  "README.md": `# ${KO.gift} 세율표는 문서에만\n`,
};

function check(extra = {}) {
  const repo = tempRepo({ ...CLEAN, ...extra });
  return { repo, ...runScript(SCRIPT, [repo.dir]) };
}

test("위반 없는 저장소는 통과 — 지방세 이름·해석 세목 칸·상속·증여 취득 원인·미계산 안내·문서는 위반이 아니다", () => {
  const r = check();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /국세 미산출 검사 통과/);
});

test("NT1 국세 세율표 이름·계산 함수를 넣으면 실패하고, 빼면 다시 통과", () => {
  const rates = j("const ", GIFT, "Rates = [0.1, 0.2];\n");
  let r = check({ "apps/web/lib/x.ts": rates });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /apps\/web\/lib\/x\.ts:1 NT1/);

  r = check({ "packages/tax-engine/src/a.ts": j("export function calc", j("Transfer", "Tax"), "(price: number) { return price; }\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /packages\/tax-engine\/src\/a\.ts:1 NT1/);

  r = check({ "workflows/src/b.py": j("def compute_", "inheritance", "_tax(v):\n    return v\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /workflows\/src\/b\.py:1 NT1/);

  // 객체 키 + 아래 줄 세율 (여러 줄 세율표)
  r = check({ "apps/web/lib/table.ts": j("export const T = {\n  ", GIFT, ": [\n    { upTo: 100, rate: 0.1 },\n  ],\n};\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /apps\/web\/lib\/table\.ts:2 NT1/);

  const { repo } = r;
  repo.write("apps/web/lib/table.ts", "export const T = { acquisition: [{ upTo: 100, rate: 0.1 }] };\n");
  repo.git("add", "-A");
  r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});

test("NT1 파일 이름이 국세 계산이면 실패 (내용과 상관없이)", () => {
  const r = check({ [j("packages/tax-engine/src/", "gift-tax", "-calculator.ts")]: "export {};\n" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NT1 국세 계산 파일 이름/);
});

test("NT2 한국어 국세 세율 문구 — 세목 바로 뒤 세율·과세표준·산출세액은 실패, 떨어진 문장은 통과", () => {
  for (const text of [j(KO.gift, " 세율표"), j(KO.inh, "_", "과세", "표준"), j(KO.transfer, "산출", "세액"), j(KO.transfer, " 세액 계산")]) {
    const r = check({ "apps/web/lib/ko.ts": `export const K = "${text}";\n` });
    assert.equal(r.code, 1, `${text} ${r.out}`);
    assert.match(r.out, /apps\/web\/lib\/ko\.ts:1 NT2/);
  }
  const far = check({ "apps/web/lib/ko.ts": `export const K = "${KO.inh}는 별도 사이트에서 확인하고, 취득세 세율은 지방세법을 따릅니다";\n` });
  assert.equal(far.code, 0, far.out);
});

test("NT3 rulesets 국세 tax_kind — SQL 여러 줄 제약·시드 행·TS 세목 타입·룰셋 파일", () => {
  const sql = j("create table public.rulesets (\n  id bigint,\n  tax_", "kind text check (tax_", "kind in (\n    'acquisition',\n    '", "gift", "_tax'\n  ))\n);\n");
  let r = check({ "packages/db/supabase/migrations/0002.sql": sql });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /0002\.sql:\d+ NT3/);

  r = check({ "packages/db/supabase/migrations/0003.sql": j("insert into public.rule", "sets (version, tax_", "kind) values ('2026.10', '", "transfer", "_tax');\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /0003\.sql:1 NT3/);

  r = check({ "apps/web/lib/kinds.ts": j("export type Tax", "Kind =\n  | \"acquisition\"\n  | \"", "inheritance", "_tax\";\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /kinds\.ts:1 NT3/);

  r = check({ "rules/2026.10.json": j('{ "version": "2026.10", "items": [{ "kind": "', "transfer", '-tax" }] }\n') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /rules\/2026\.10\.json NT3 룰셋 파일/);
});

test("NT4 국세 계산 경로 — /calc/transfer·/calc/inheritance-acquisition·국세 세목 이름 경로·API", () => {
  for (const p of [
    "apps/web/app/(site)/calc/transfer/page.tsx",
    "apps/web/app/(site)/calc/inheritance-acquisition/page.tsx",
    "apps/web/app/(site)/calc/gift-acquisition/page.tsx",
    j("apps/web/app/(site)/", "gift", "-tax/page.tsx"),
    j("apps/web/app/api/", "capital", "-gains/route.ts"),
  ]) {
    const r = check({ [p]: "export default function P() { return null; }\n" });
    assert.equal(r.code, 1, `${p} ${r.out}`);
    assert.match(r.out, /NT4 국세 계산 경로/);
  }
  assert.equal(routeHit("apps/web/app/(site)/realestate/inheritance-gift/page.tsx"), null, "상속·증여 안내 페이지는 계산 경로가 아니다");
  assert.equal(routeHit("apps/web/app/(site)/calc/page.tsx"), null);
  assert.equal(routeHit("apps/web/app/%5Fdesign/page.tsx"), null);
});

test("NT5 공개 화면 입력 칸·라벨에 국세 금액 낱말 — 소스(JSX)와 렌더된 HTML 모두", () => {
  const jsx = j('export const F = () => <form><input name="', "transfer", '_price" type="number" /></form>;\n');
  let r = check({ "apps/web/components/site/Calc.tsx": jsx });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /components\/site\/Calc\.tsx:1 NT5/);

  r = check({ "packages/ui/src/components/In.tsx": `export const L = () => <label htmlFor="a">${j("증여", "재산")} 가액</label>;\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NT5 공개 화면 라벨/);

  // 백오피스·시험 파일은 공개 화면이 아니다 (NT5 대상 아님)
  r = check({ "apps/web/components/admin/X.tsx": `export const X = () => <label>${KO.gift} 안내 문구</label>;\n` });
  assert.equal(r.code, 0, r.out);

  assert.equal(formControlHits(`<form action="/search"><input name="q" placeholder="검색어"><select name="tax"><option>${KO.gift}</option></select></form>`).length, 0, "검색 칸·해설 세목 거르개는 금액 입력이 아니다");
  assert.equal(formControlHits(`<label for="v">${j("양도", " 가액")}</label><input id="v" inputmode="numeric">`).length, 1, "띄어 쓴 금액 낱말도 잡는다");
  assert.equal(formControlHits(j('<input aria-label="', KO.inh, ' 금액">')).length, 1);
});

test("커밋 대상이 아닌 파일(.gitignore)과 문서(.md·docs/)는 보지 않는다", () => {
  const repo = tempRepo({ ...CLEAN, ".gitignore": "scratch/\n", "docs/dev/note.txt": j(GIFT, "Rates\n") });
  repo.write("scratch/x.ts", j("const ", GIFT, "Rates = [];\n"));
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});

test("scanFile — 위반마다 규칙 번호와 줄을 돌려준다 (E2E·화면이 같은 함수를 쓴다)", () => {
  const hits = scanFile("apps/web/lib/a.ts", j("// ok\nconst ", GIFT, "Amount = 1;\n"));
  assert.deepEqual(hits.map((h) => [h.rule, h.line]), [["NT1", 2]]);
  assert.deepEqual(scanFile("apps/web/lib/b.ts", "export const acquisitionTaxAmount = 1;\n"), [], "지방세 계산 이름은 위반이 아니다");
});

// ── W11-g CI 재설계 (3단계 설계 4.4): 두 낱말 묶음 · 허용 구역 · NT6~NT9 ─────────────
const SHORT = j("i", "gt");
const MARK = j("(2026-10-25 개정 ", "—", " W11-g)");
const ZONES = {
  prd_ref: "docs/PRD/PRD_최종.md",
  allowedZones: [
    `packages/${SHORT}-engine/**`,
    `rules-${SHORT}/**`,
    "apps/web/app/(site)/calc/{gift-tax,inheritance-tax}/**",
    `apps/web/components/site/${SHORT}/**`,
    `apps/web/lib/${SHORT}/**`,
    "packages/db/supabase/migrations/*_w11g_*.sql",
    "packages/db/tests/w11g-*",
    "e2e/w11g-*",
  ],
  referenceFiles: ["apps/web/lib/calc/tool-link.ts", "scripts/national-tax-zones.json"], // 구역 설정 파일 자신도 구역 이름을 적으므로 참조 파일
};
const PRD_OK = `# PRD\n\n### 2.2 불변 원칙\n\n1. 가\n2. 나\n4. ${MARK} 원칙 4 본문\n5. 다\n\n### 2.3 다음\n`;
const PRD_NO_MARK = "# PRD\n\n### 2.2 불변 원칙\n\n1. 가\n4. 국세 금액은 만들지 않고 연결합니다\n5. 다\n\n### 2.3 다음\n";
const zoned = (extra = {}, { zones = ZONES, prd = PRD_OK } = {}) => {
  const files = { ...CLEAN, ...extra };
  if (zones) files["scripts/national-tax-zones.json"] = zones;
  if (prd !== null) files["docs/PRD/PRD_최종.md"] = prd;
  const repo = tempRepo(files);
  return { repo, ...runScript(SCRIPT, [repo.dir]) };
};
const GIFT_RATES = j("export const ", "gift", "TaxRates = [0.1, 0.2];\n");
const ZONE_GIFT_FILE = `packages/${SHORT}-engine/src/rates.ts`;
const ENGINE_SHORT = j("@ltr/", SHORT, "-engine");
const ENGINE_TAX = j("@ltr/tax", "-engine");

test("허용 구역 경계 — 상속·증여 묶음은 구역 안에서만 NT1을 면제받고, 구역 바로 밖이면 그대로 실패", () => {
  assert.equal(zoned({ [ZONE_GIFT_FILE]: GIFT_RATES }).code, 0, "구역 안 증여 세율 이름은 통과");
  assert.equal(zoned({ [`rules-${SHORT}/2026.01.json`]: '{ "version": "2026.01" }\n' }).code, 0, "구역 안 룰셋 폴더는 통과");
  assert.equal(zoned({ [`packages/${SHORT}-engines/src/rates.ts`]: GIFT_RATES }).code, 1, "packages/…-engines/ 는 구역이 아니다");
  assert.equal(zoned({ "apps/web/lib/rates.ts": GIFT_RATES }).code, 1, "구역 밖 같은 내용은 실패");
  // 구역 JSON이 없으면 같은 경로도 구역이 아니다
  const r = zoned({ [ZONE_GIFT_FILE]: GIFT_RATES }, { zones: null, prd: null });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NT1/);
});

test("허용 구역 경계 — 증여·상속 계산 경로 두 개만 NT4 면제, 비슷한 이름·양도 경로는 실패", () => {
  const page = "export default function P() { return null; }\n";
  for (const p of ["apps/web/app/(site)/calc/gift-tax/page.tsx", "apps/web/app/(site)/calc/inheritance-tax/result/page.tsx"]) assert.equal(zoned({ [p]: page }).code, 0, p);
  for (const p of ["apps/web/app/(site)/calc/gift-taxes/page.tsx", "apps/web/app/(site)/calc/gift-acquisition/page.tsx", "apps/web/app/(site)/calc/transfer/page.tsx"]) {
    const r = zoned({ [p]: page });
    assert.equal(r.code, 1, `${p} ${r.out}`);
    assert.match(r.out, /NT4 국세 계산 경로/);
  }
  // 구역 안의 양도 경로 조각은 NT7이 잡는다
  const inner = zoned({ "apps/web/app/(site)/calc/gift-tax/transfer/page.tsx": page });
  assert.equal(inner.code, 1, inner.out);
  assert.match(inner.out, /NT7 허용 구역 안 경로/);
});

test("허용 구역 경계 — 마이그레이션·DB 시험·E2E 이름 패턴과 구역 판정(zoneOf)", () => {
  const cfg = buildZones(ZONES);
  const zone = [
    `packages/db/supabase/migrations/0136_w11g_${SHORT}_tables.sql`,
    "packages/db/tests/w11g-rls.test.mjs",
    "e2e/w11g-accept.test.mjs",
    `apps/web/components/site/${SHORT}/Form.tsx`,
    `apps/web/lib/${SHORT}/calc.ts`,
    `rules-${SHORT}/2026.01.json`,
  ];
  const none = [
    "packages/db/supabase/migrations/0136_w11h_x.sql",
    "packages/db/supabase/migrations/w11g_x.txt",
    "packages/db/tests/w11-rls.test.mjs",
    "e2e/w11g/accept.test.mjs",
    "e2e/w11-accept.test.mjs",
    `rules-${SHORT}2/a.json`,
    `apps/web/components/${SHORT}/Form.tsx`,
  ];
  for (const f of zone) assert.equal(zoneOf(f, cfg), "zone", f);
  for (const f of none) assert.equal(zoneOf(f, cfg), "none", f);
  assert.equal(zoneOf("apps/web/lib/calc/tool-link.ts", cfg), "ref");
  assert.equal(zoneOf(ZONE_GIFT_FILE, null), "none");
});

test("구역 안이라도 양도 묶음 NT1~NT5는 그대로 — 양도 세율 이름·양도 금액 입력·양도 세금 문구", () => {
  let r = zoned({ [ZONE_GIFT_FILE]: j("export const ", "transfer", "TaxRates = [0.1];\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /rates\.ts:1 NT1/);

  r = zoned({ [`apps/web/components/site/${SHORT}/F.tsx`]: j('export const F = () => <input name="', "transfer", '_price" />;\n') });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /F\.tsx:1 NT5/);

  // 상속·증여 금액 입력 칸은 구역 안에서 허용, 구역 밖 공개 화면에서는 NT5
  const giftInput = j('export const F = () => <input name="', "gift", 'Tax_amount" />;\n');
  assert.equal(zoned({ [`apps/web/components/site/${SHORT}/F.tsx`]: giftInput }).code, 0);
  r = zoned({ "apps/web/components/site/Other.tsx": giftInput });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Other\.tsx:1 NT5/);

  r = zoned({ [ZONE_GIFT_FILE]: `export const K = "${j(KO.transfer, " 세율")}";\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /rates\.ts:1 NT2/);
  assert.equal(zoned({ [ZONE_GIFT_FILE]: `export const K = "${j(KO.gift, " 세율")}";\n` }).code, 0, "구역 안 증여 세목 문구는 통과");
  assert.equal(zoned({ "apps/web/lib/k.ts": `export const K = "${j(KO.gift, " 세율")}";\n` }).code, 1, "구역 밖은 실패");
});

test("약칭 이름 조각은 구역 밖에서 NT1 — 약칭 + 계산 낱말 이름, 이름에 약칭이 들어 있는 다른 낱말은 통과", () => {
  let r = zoned({ "apps/web/lib/x.ts": j("export const ", SHORT, "Table = [];\n") });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /x\.ts:1 NT1/);
  r = zoned({ [`apps/web/lib/${SHORT}-calculator.ts`]: "export {};\n" });
  assert.equal(r.code, 1, "약칭이 들어간 계산 파일 이름은 실패");
  assert.match(r.out, /NT1 국세 계산 파일 이름/);
  // 'bigtable'에는 i-g-t 세 글자가 붙어 있지만 이름 조각이 아니다
  r = zoned({ "apps/web/lib/big.ts": "export const bigtable = 1;\nexport const rate = 2;\n" });
  assert.equal(r.code, 0, r.out);
});

test("NT6 PRD 개정 표식 — 원칙 4 줄에 있으면 통과, 없거나 다른 줄에만 있으면 실패, prd_ref 없으면 검사 안 함", () => {
  assert.equal(zoned().code, 0);

  let r = zoned({}, { prd: PRD_NO_MARK });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs\/PRD\/PRD_최종\.md:6 NT6/);

  // 표식이 원칙 4 줄이 아닌 곳(다른 원칙·다른 절)에 있으면 인정하지 않는다
  const elsewhere = `# PRD\n\n### 2.1 앞 절\n\n4. ${MARK} 다른 절의 4번\n\n### 2.2 불변 원칙\n\n1. ${MARK}\n4. 국세 금액은 만들지 않고 연결합니다\n5. 다\n`;
  r = zoned({}, { prd: elsewhere });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NT6/);

  // 구 형식 표식(하이픈)도 정확한 글자가 아니면 실패
  r = zoned({}, { prd: PRD_OK.replace("—", "-") });
  assert.equal(r.code, 1, r.out);

  r = zoned({}, { prd: "# PRD\n\n내용 없음\n" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /원칙 4 줄을 찾지 못했습니다/);

  r = zoned({}, { prd: null });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /PRD 파일이 없습니다/);

  // prd_ref가 없는 구역 JSON = W11-g 전 → 표식이 없어도 통과
  const { prd_ref: _omit, ...noRef } = ZONES;
  assert.equal(zoned({}, { zones: noRef, prd: PRD_NO_MARK }).code, 0);
});

test("prdMarkerHits — 표식 있는 줄은 위반 0, 없는 줄은 줄 번호와 함께 NT6", () => {
  assert.deepEqual(prdMarkerHits(PRD_OK), []);
  assert.deepEqual(prdMarkerHits(PRD_NO_MARK).map((h) => [h.rule, h.line]), [["NT6", 6]]);
});

test("NT7 허용 구역 안 금지 낱말 — 양도 낱말·부담부증여 이름·calc_cgt는 구역 안에서만 NT7, 구역 밖은 NT7 대상 아님", () => {
  const cases = {
    [j("const ", "onerous", "Gift = 1;\n")]: "부담부증여 이름",
    [j("const ", "burden", "Share = 1;\n")]: "부담부증여 이름",
    [j("export function ", "calc", "_cgt() {}\n")]: "calc_cgt",
    [j("// ", "양도", " 소득 안내\n")]: "양도 묶음 낱말",
    [j("const ", "transfer", " = 1;\n")]: "양도 묶음 낱말",
  };
  for (const body of Object.keys(cases)) {
    const r = zoned({ [`apps/web/lib/${SHORT}/a.ts`]: body });
    assert.equal(r.code, 1, `${body} ${r.out}`);
    assert.match(r.out, /apps\/web\/lib\/\S+\/a\.ts:1 NT7/);
    // 같은 글자가 구역 밖 일반 파일에 있어도 NT7은 아니다(그 파일은 다른 규칙만 본다)
    const out = zoned({ "apps/web/lib/plain.ts": body });
    assert.doesNotMatch(out.out, /NT7/, body);
  }
  // 경로 이름에도 적용
  const r = zoned({ [`packages/${SHORT}-engine/src/${j("onerous", "-gift")}.ts`]: "export {};\n" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /NT7 허용 구역 안 경로/);
  // 깨끗한 구역 파일은 통과 (transport 같은 비슷한 낱말은 NT7 아님)
  assert.equal(zoned({ [`apps/web/lib/${SHORT}/ok.ts`]: "export const transportMode = 1;\nexport const result = 2;\n" }).code, 0);
});

test("NT8 두 엔진 동시 import — 한 파일에서 함께 불러오면 실패(하위 경로 포함), 하나씩이면 통과, 참조 파일은 면제", () => {
  const both = `import { a } from "${ENGINE_TAX}";\nimport { b } from "${ENGINE_SHORT}";\n`;
  let r = zoned({ [`apps/web/lib/${SHORT}/mix.ts`]: both });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /mix\.ts NT8/);

  r = zoned({ "apps/web/lib/other.ts": `import { a } from "${ENGINE_TAX}/rules";\nconst x = require("${ENGINE_SHORT}/sub");\n` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /other\.ts NT8/);

  assert.equal(zoned({ [`apps/web/lib/${SHORT}/one.ts`]: `import { b } from "${ENGINE_SHORT}";\n`, "apps/web/lib/tax-one.ts": `import { a } from "${ENGINE_TAX}";\n` }).code, 0, "한 파일에 하나씩은 통과");
  assert.equal(zoned({ "apps/web/lib/calc/tool-link.ts": both }).code, 0, "참조 파일은 NT8 면제");
  assert.equal(zoned({ "apps/web/lib/calc/tool-link.ts": both }, { zones: { ...ZONES, referenceFiles: [] } }).code, 1, "참조 목록에서 빼면 같은 파일이 실패");
});

test("NT9 AI·워크플로 경계 — assistant·agent·workflows가 상속·증여 엔진을 import 하거나 의존하면 실패", () => {
  const imp = `import { calc } from "${ENGINE_SHORT}";\n`;
  for (const f of ["packages/assistant/src/a.ts", "packages/agent/src/a.ts", "workflows/src/a.ts"]) {
    const r = zoned({ [f]: imp });
    assert.equal(r.code, 1, `${f} ${r.out}`);
    assert.match(r.out, new RegExp(`${f.replace(/\//g, "\\/")} NT9`));
  }
  const dep = zoned({ "packages/agent/package.json": JSON.stringify({ name: "@ltr/agent", dependencies: { [ENGINE_SHORT]: "workspace:*" } }) });
  assert.equal(dep.code, 1, dep.out);
  assert.match(dep.out, /packages\/agent\/package\.json NT9/);

  // W12-0 — 웹 앱 안의 도우미·지방세봇·운영 AI 코드도 같은 경계
  for (const f of ["apps/web/lib/assistant/a.ts", "apps/web/lib/server/assistant/a.ts", "apps/web/lib/server/ops-ai/a.ts", "apps/web/lib/agent/a.ts", "apps/web/lib/server/agent/a.ts", "apps/web/lib/server/copilot/a.ts", "apps/web/lib/server/workspace/a.ts", "apps/web/lib/server/library/a.ts"]) {
    const r = zoned({ [f]: imp });
    assert.equal(r.code, 1, `${f} ${r.out}`);
    assert.match(r.out, new RegExp(`${f.replace(/\//g, "\/")} NT9`));
  }
  // 같은 웹 앱의 AI 경로가 아닌 곳(계산·화면 코드)과 폴더 이름만 비슷한 곳은 통과
  assert.equal(zoned({ [`apps/web/lib/${SHORT}/agent-extra.ts`]: imp, [`apps/web/lib/${SHORT}/assistant-ui.ts`]: imp, [`apps/web/lib/${SHORT}/copilot-ui.ts`]: imp }).code, 0);
  // 같은 import가 구역 안(웹 화면 쪽)이거나 AI 경로가 아니면 NT9 아님
  const ok = zoned({ [`apps/web/lib/${SHORT}/use.ts`]: imp, "packages/assistant/src/b.ts": 'import { x } from "@ltr/tax-engine";\n' });
  assert.equal(ok.code, 0, ok.out);
  // 폴더 이름만 비슷한 곳(workflows-extra)은 AI 경계가 아니다
  const near = zoned({ [`apps/web/lib/${SHORT}/workflows-extra.ts`]: imp });
  assert.equal(near.code, 0, near.out);
});

test("실제 저장소 구역 설정 — prd_ref·구역 11개·참조 파일이 들어 있고 구역 경로가 전부 구역으로 판정된다", async () => {
  const fs = await import("node:fs");
  const real = JSON.parse(fs.readFileSync(path.join(path.dirname(SCRIPT), "national-tax-zones.json"), "utf8"));
  assert.equal(real.prd_ref, "docs/PRD/PRD_최종.md");
  assert.equal(real.allowedZones.length, 11);
  const cfg = buildZones(real);
  assert.equal(zoneOf("apps/web/app/admin/(desk)/igt/page.tsx", cfg), "zone");
  assert.equal(zoneOf("apps/web/app/api/admin/igt/route.ts", cfg), "zone");
  assert.equal(zoneOf(`packages/${SHORT}-engine/src/a.ts`, cfg), "zone");
  assert.equal(zoneOf("apps/web/app/(site)/calc/inheritance-tax/page.tsx", cfg), "zone");
  assert.equal(zoneOf("apps/web/app/(site)/calc/transfer/page.tsx", cfg), "none");
  assert.equal(zoneOf("apps/web/lib/server/public/constants.ts", cfg), "ref");
  assert.equal(zoneOf("apps/web/lib/calc/tool-link.ts", cfg), "ref");
});
