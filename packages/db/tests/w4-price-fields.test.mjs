// W4 12단계 DB — 가격 칸 검사 (PRD-01B PR-05 · docs/dev/W4_설계.md 1장 12단계 · 2.10, 스크립트 scripts/check-price-fields.mjs)
//  · 사전 = 설계 2.10 낱말 16개 · 대상 표 = 2.10 표 4개 (시험이 설계 문서 줄을 읽는다)
//  · 실제 DB — projects·project_events·project_stage_lenses(16단계)와 그 표를 읽는 뷰(현재 단계·공개 뷰들)를 보고 위반 0건
//  · 시험 마이그레이션(트랜잭션 안에서 적용 → 되돌림) — 사전 낱말이 든 칸 이름·대소문자·밑줄 무시·칸 설명·아직 없는 대상 표·여러 겹 뷰를 검사가 실제로 잡는다
//  · 명령 — 위반 0이면 종료 코드 0
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { PRICE_TABLES, PRICE_WORDS, priceFieldHits, priceWordsIn, scanPriceFields } from "../scripts/check-price-fields.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const lines = DESIGN.split("\n");
const headIdx = lines.findIndex((l) => l.startsWith("### 2.10 가격 칸 검사 사전"));
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

test("사전·대상 표 = 설계 2.10 (낱말 16개 · 표 4개)", () => {
  assert.ok(headIdx >= 0, "설계 문서에 2.10 머리가 없다");
  const body = lines.slice(headIdx + 1).find((l) => l.startsWith("낱말("));
  assert.ok(body, "2.10 낱말 줄이 없다");
  const words = ticks(body.split("시험은")[0]);
  assert.deepEqual(words, [...PRICE_WORDS]);
  assert.equal(words.length, 16);
  assert.deepEqual(ticks(lines[headIdx]).filter((w) => !w.includes(" ") && w !== "information_schema"), [...PRICE_TABLES]);
});

test("낱말 맞추기 — 소문자·밑줄 무시·일부 일치, 사전 밖 칸은 0", () => {
  assert.deepEqual(priceWordsIn("Sale_Amount"), ["sale_amount"]);
  assert.deepEqual(priceWordsIn("saleamount_total"), ["sale_amount"], "밑줄을 빼도 잡는다");
  assert.deepEqual(priceWordsIn("expected_yield"), ["yield"]);
  assert.deepEqual(priceWordsIn("bunyang_price"), ["price", "bunyang"]);
  assert.deepEqual(priceWordsIn("예상_분담금"), ["분담금"]);
  assert.deepEqual(priceWordsIn("re_turn"), ["return"], "밑줄로 낱말을 쪼개도 잡는다");
  for (const ok of ["landmark", "notice_no", "source_url", "last_verified_at", "current_stage_position", "under_review", "recorded_at", "summary"]) {
    assert.deepEqual(priceWordsIn(ok), [], ok);
  }
  assert.deepEqual(
    priceFieldHits([
      { relation: "projects", column: "summary", comment: "예상 시세 메모" },
      { relation: "projects", column: "name", comment: null },
    ]),
    [{ relation: "projects", column: "summary", where: "comment", words: ["시세"] }],
  );
});

test("실제 DB — 프로젝트 표 3개(16단계 「지방세로 읽기」 포함)와 그 표를 읽는 뷰를 보고 위반 0건 (아직 없는 표는 분양 정보)", async () => {
  const r = await scanPriceFields(client);
  for (const rel of ["projects", "project_events", "project_current_stages", "public_projects", "public_project_events", "project_stage_lenses", "public_project_stage_lenses"]) {
    assert.ok(r.relations.includes(rel), `${rel}를 보지 않았다 — 검사가 비어 있으면 안 된다`);
  }
  assert.deepEqual(r.missingTables, ["supply_notices"]);
  assert.deepEqual(r.hits, []);
});

// 시험 마이그레이션 — 사전 낱말이 든 칸을 넣으면 검사가 실제로 잡는다 (트랜잭션 안에서 적용하고 되돌린다)
const VIOLATIONS = [
  ["projects 칸 이름 (bunyang_price)", "alter table public.projects add column bunyang_price bigint", [["projects", "bunyang_price", "name"]]],
  ["project_events 한글 칸 이름 (분담금)", 'alter table public.project_events add column "예상분담금" bigint', [["project_events", "예상분담금", "name"]]],
  ["대소문자 섞인 칸 이름 (Market_Value)", 'alter table public.projects add column "Market_Value" text', [["projects", "Market_Value", "name"]]],
  ["밑줄을 뺀 칸 이름 (saleamount)", "alter table public.project_events add column saleamount bigint", [["project_events", "saleamount", "name"]]],
  ["칸 설명에 시세", "alter table public.projects add column memo2 text; comment on column public.projects.memo2 is '예상 시세 메모'", [["projects", "memo2", "comment"]]],
  [
    "아직 없는 대상 표 supply_notices (17단계에 생길 표)",
    "create table public.supply_notices (id bigint primary key, name text, supply_price bigint); alter table public.supply_notices enable row level security",
    [["supply_notices", "supply_price", "name"]],
  ],
  ["project_stage_lenses 칸 이름 (16단계 — expected_return)", "alter table public.project_stage_lenses add column expected_return numeric", [["project_stage_lenses", "expected_return", "name"]]],
  ["project_stage_lenses 칸 설명에 분담금", "comment on column public.project_stage_lenses.lens is '단계별 분담금 안내'", [["project_stage_lenses", "lens", "comment"]]],
  [
    "대상 표를 읽는 뷰의 칸 (수익률)",
    "create view public.w4_price_probe as select p.id, 0::numeric as expected_profit from public.projects p",
    [["w4_price_probe", "expected_profit", "name"]],
  ],
  [
    "뷰를 거친 두 겹 뷰의 칸",
    "create view public.w4_price_probe2 as select pp.id, 0::numeric as premium_amount from public.public_projects pp",
    [["w4_price_probe2", "premium_amount", "name"]],
  ],
];

for (const [label, ddl, expected] of VIOLATIONS) {
  test(`시험 마이그레이션 — ${label} → 검사가 잡는다`, () =>
    tx(async () => {
      await client.query(ddl);
      const { hits } = await scanPriceFields(client);
      assert.deepEqual(
        hits.map((h) => [h.relation, h.column, h.where]),
        expected,
      );
      assert.ok(hits.every((h) => h.words.length > 0));
    }));
}

test("시험 마이그레이션 — 사전 밖 칸(공급 규모·청약 일정·원문 주소)은 잡지 않는다", () =>
  tx(async () => {
    await client.query(
      "create table public.supply_notices (id bigint primary key, supply_scale text, apply_start date, apply_end date, official_notice_url text, verified_at timestamptz); alter table public.supply_notices enable row level security",
    );
    const r = await scanPriceFields(client);
    assert.ok(r.relations.includes("supply_notices"));
    assert.deepEqual(r.hits, []);
  }));

test("명령 — 위반 0이면 종료 코드 0과 본 표 이름", () => {
  const run = spawnSync(process.execPath, [path.join(HERE, "..", "scripts", "check-price-fields.mjs")], { encoding: "utf8", env: { ...process.env } });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /위반 0건/);
  assert.match(run.stdout, /project_events/);
});
