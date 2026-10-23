// W2-a 씨앗 데이터 — 분야(categories)·기존 카테고리 대응표(legacy_category_map)·운영 설정(settings).
// 분야 수·이름을 코드에 적지 않는다 (CAT-01): PRD-00 5.3 표를 읽어 DB 초기 데이터와 대조한다.
// 금지 표현·공포 표현 사전은 PRD-00 8.8·PRD-01A UX-01·UX-03의 문구를 읽어 대조한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs");
const PRD00 = fs.readFileSync(path.join(DOCS, "PRD", "PRD-00_공통기반.md"), "utf8");
const PRD01A = fs.readFileSync(path.join(DOCS, "PRD", "PRD-01A_1단계_기반_편집_유입.md"), "utf8");

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

/** md 표 한 줄 → 칸 배열 (양 끝 | 제거) */
const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

/** start 문구 다음에 나오는 첫 md 표의 데이터 행 (머리·구분 줄 제외) */
function tableAfter(md, start) {
  const from = md.indexOf(start);
  assert.ok(from >= 0, `문서에서 '${start}'를 찾지 못했다`);
  const lines = md.slice(from).split("\n");
  const first = lines.findIndex((l) => l.trim().startsWith("|"));
  const rows = [];
  for (let i = first; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(cells(lines[i]));
  return rows.slice(2); // 머리 줄 · 구분 줄
}

/** PRD-00 5.3 분야 표 → [{ section, sectionName, name, stage1 }] (표 순서 그대로) */
function prdCategories() {
  return tableAfter(PRD00, "**4대 분야와 하위 분야**").map((c) => {
    const m = c[0].match(/^(.+?)\s*\(`([a-z]+)`\)$/);
    assert.ok(m, `분야 칸 형식이 다르다: ${c[0]}`);
    return { sectionName: m[1], section: m[2], name: c[1], stage1: c[3] };
  });
}

/** PRD-00 5.3 "기존 8개 카테고리 대응" 표 → [{ legacy, section, category }] — 분야 이름은 위 표에서 코드로 바꾼다 */
function prdLegacyMap() {
  const cats = prdCategories();
  const sectionCode = new Map(cats.map((c) => [c.sectionName, c.section]));
  return tableAfter(PRD00, "**기존 8개 카테고리 대응**").map(([legacy, target]) => {
    // 가장 먼저 나오는 분야 이름 (같은 위치면 긴 이름 — '부동산' / '부동산개발금융')
    let best = null;
    for (const [name, code] of sectionCode) {
      const at = target.indexOf(name);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && name.length > best.name.length)) best = { at, name, code };
    }
    assert.ok(best, `대응 칸에서 분야를 찾지 못했다: ${target}`);
    const sub = cats.find((c) => c.section === best.code && target.includes(`${best.name} > ${c.name}`));
    return { legacy, section: best.code, category: sub ? sub.name : null };
  });
}

test("문서 파싱 견본 — 분야 표는 4대 분야를 모두 담고, 대응표는 8행이다", () => {
  const cats = prdCategories();
  assert.deepEqual([...new Set(cats.map((c) => c.section))].sort(), ["finance", "local", "realestate", "tax"]);
  assert.ok(cats.length > 4);
  assert.equal(prdLegacyMap().length, 8);
});

test("categories 초기 데이터가 PRD-00 5.3 분야 표와 같다 (분야·이름 집합, 분야 안 순서)", async () => {
  const want = prdCategories();
  // W4 21단계가 더한 하위 분야 realestate/columns(PR-14 부동산 칼럼)는 PRD-00 5.3 표 밖의 01B 추가분이다
  const { rows } = await client.query("select section, name, sort from public.categories where not (section = 'realestate' and slug = 'columns') order by section, sort, id");
  assert.deepEqual(
    rows.map((r) => `${r.section}/${r.name}`).sort(),
    want.map((c) => `${c.section}/${c.name}`).sort(),
  );
  for (const section of new Set(want.map((c) => c.section))) {
    assert.deepEqual(
      rows.filter((r) => r.section === section).map((r) => r.name),
      want.filter((c) => c.section === section).map((c) => c.name),
      `${section} 분야 안 순서가 표와 다르다`,
    );
  }
});

test("1단계 칸이 있는 분야는 모두 공개(visible)로 시작한다 (CAT-01)", async () => {
  const stage1 = prdCategories().filter((c) => c.stage1 && c.stage1 !== "—");
  const { rows } = await client.query("select section, name, visible from public.categories");
  for (const c of stage1) {
    const row = rows.find((r) => r.section === c.section && r.name === c.name);
    assert.equal(row?.visible, true, `${c.section}/${c.name}`);
  }
});

test("「지방세로 읽기」 필수 표시는 부동산·개발금융·지자체뉴스 분야에만 (CORE-01)", async () => {
  const { rows } = await client.query("select section, name, needs_tax_lens from public.categories");
  for (const r of rows) assert.equal(r.needs_tax_lens, r.section !== "tax", `${r.section}/${r.name}`);
});

test("기존 8개 카테고리가 모두 새 분야 하나에 대응한다 — 대응표가 PRD-00 5.3과 같다 (대응 누락 0)", async () => {
  const want = prdLegacyMap();
  const { rows } = await client.query(`
    select m.legacy_name, m.section, c.name as category, c.section as category_section
    from public.legacy_category_map m left join public.categories c on c.id = m.category_id
    order by m.legacy_name`);
  assert.deepEqual(
    rows.map((r) => ({ legacy: r.legacy_name, section: r.section, category: r.category })).sort((a, b) => a.legacy.localeCompare(b.legacy)),
    want.sort((a, b) => a.legacy.localeCompare(b.legacy)),
  );
  for (const r of rows) {
    assert.ok(r.section, r.legacy_name);
    if (r.category) assert.equal(r.category_section, r.section, `${r.legacy_name}: 하위 분야가 다른 분야에 있다`);
  }
});

test("'부동산 정보'·'전문가 칼럼'은 이관 뒤 재분류 큐, '교육 및 포럼'은 교육 태그 (PRD-00 5.3 · MIG-01)", async () => {
  const { rows } = await client.query("select legacy_name, needs_reclassify, tag from public.legacy_category_map");
  const by = new Map(rows.map((r) => [r.legacy_name, r]));
  assert.equal(by.get("부동산 정보").needs_reclassify, true);
  assert.equal(by.get("전문가 칼럼").needs_reclassify, true);
  assert.equal(by.get("교육 및 포럼").tag, "교육");
  assert.equal(by.get("판례 분석").needs_reclassify, false);
});

test("하위 분야를 다른 분야의 것으로 대응시키면 거부 (분야·하위 분야 짝 외래 키)", async () => {
  await client.query("begin");
  try {
    await assert.rejects(
      client.query(
        "insert into public.legacy_category_map (legacy_name, section, category_id) select '시험 대응', 'local', id from public.categories where section = 'tax' limit 1",
      ),
      /foreign key|violates/,
    );
  } finally {
    await client.query("rollback");
  }
});

test("금지 표현 사전 — PRD-00 8.8 금지 표현 전부와 '현지 1위'·'절세 보장'을 담는다 (UX-01)", async () => {
  const line = PRD00.split("\n").find((l) => l.startsWith("- 금지 표현:"));
  const head = line.split(". ")[0]; // 뒤 문장(SM 소속 전문가 안내)은 빼고
  const phrases = [...head.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(phrases.length >= 10, "8.8 금지 표현 목록을 찾지 못했다");
  const { rows } = await client.query("select value from public.settings where key = 'forbidden_phrases'");
  assert.equal(rows.length, 1);
  const dict = rows[0].value.phrases;
  assert.ok(Array.isArray(dict));
  for (const p of [...phrases, "현지 1위", "절세 보장"]) assert.ok(dict.includes(p), `금지 표현 사전에 '${p}'가 없다`);
  assert.equal(new Set(dict).size, dict.length, "중복 표현");
  assert.ok(rows[0].value.version, "사전 버전");
});

test("공포 표현 사전 — UX-03 예시('세금 폭탄'·'큰일'·'놓치면 끝')를 담는다", async () => {
  const m = PRD01A.match(/공포 표현 사전\(예: ([^)]+)\)/);
  assert.ok(m, "UX-03 예시를 찾지 못했다");
  const examples = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(examples, ["세금 폭탄", "큰일", "놓치면 끝"]);
  const { rows } = await client.query("select value from public.settings where key = 'fear_phrases'");
  for (const p of examples) assert.ok(rows[0].value.phrases.includes(p), p);
});

test("점검 엔진 내부 기준 — 문장 유사 0.9 이상·기사 비율 0.6 초과·인용 비율 0.3 초과 (OPT-06 초기값)", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'similarity_internal'");
  const v = rows[0].value;
  assert.equal(v.sentenceSimilarity, 0.9);
  assert.equal(v.sentenceComparator, "gte");
  assert.equal(v.articleRatio, 0.6);
  assert.equal(v.articleComparator, "gt");
  assert.equal(v.quoteRatio, 0.3);
  assert.equal(v.quoteComparator, "gt");
  assert.ok(v.version);
});

test("개정 '확정' 기준 단계는 공포(promulgated)로 시작한다 (TX-08 초기값)", async () => {
  const { rows } = await client.query("select value from public.settings where key = 'amendment_confirmed_stage'");
  assert.equal(rows[0].value, "promulgated");
});
