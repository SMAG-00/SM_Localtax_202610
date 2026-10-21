// 01B TX-06 · PRD-00 원칙 17·18 — 국세 미산출 저장소 검사 (docs/dev/W3_설계.md 2.7). 위반 파일을 임시 저장소에 넣어 검사가 실제로 잡는지 본다.
// 위반 견본 글자는 조각을 이어 붙여 만든다 — 이 시험 파일 자체도 저장소 검사 대상이다(예외 0).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { formControlHits, routeHit, scanFile } from "../check-national-tax.mjs";

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
