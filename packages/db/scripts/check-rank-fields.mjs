#!/usr/bin/env node
// 점수·순위 칸 검사 (PRD-01B PR-11 · docs/dev/W4_설계.md 1장 18단계 '점수·순위 칸 0(스키마 검사)' · 2.13) — 실제 DB에 접속해 개발방법 표와 그 표를 읽는 뷰에
// 점수·순위·등급·추천·유리 판정을 뜻하는 칸이 없는지 본다. 위반이 있으면 종료 코드 1 (DB 시험 tests/w4-dev-methods.test.mjs가 같은 함수를 부른다).
//  · 판정 방식은 가격 칸 검사(check-price-fields.mjs — 2.10)와 같다: 사전 낱말(소문자, 밑줄 무시)이 칸 이름의 일부이거나 칸 설명에 들면 위반. 표 설명은 보지 않는다.
//  · 대상: 2.13의 표 3개(dev_methods · dev_method_compare · dev_method_facts) + 그 표를 (다른 뷰를 거쳐서라도) 읽는 public 뷰 전부.
// 사용: node scripts/check-rank-fields.mjs   (SUPABASE_DB_URL이 없으면 로컬 Supabase)
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";
import { formatHits, priceFieldHits, priceWordsIn, scanPriceFields } from "./check-price-fields.mjs";

/** 2.13 사전 — 시험이 설계 문서 2.13 줄과 같은지 본다 */
export const RANK_WORDS = Object.freeze(["score", "rank", "rating", "grade", "recommend", "best", "favorable", "advantage", "점수", "순위", "등급", "추천", "유리"]);

/** 2.13 검사 대상 표 */
export const RANK_TABLES = Object.freeze(["dev_methods", "dev_method_compare", "dev_method_facts"]);

/** 글자에 든 사전 낱말 (소문자·밑줄 무시·일부 일치) */
export const rankWordsIn = (text, words = RANK_WORDS) => priceWordsIn(text, words);

/** 칸 목록에서 위반 찾기 — columns: [{ relation, column, comment }] */
export const rankFieldHits = (columns, words = RANK_WORDS) => priceFieldHits(columns, words);

/** 검사 — { relations, missingTables, hits } */
export const scanRankFields = (client, { tables = RANK_TABLES, words = RANK_WORDS } = {}) => scanPriceFields(client, { tables, words });

async function main() {
  const client = await connect();
  try {
    const { relations, missingTables, hits } = await scanRankFields(client);
    console.log(`점수·순위 칸 검사 (PR-11 · 설계 2.13) — 본 표·뷰 ${relations.length}개: ${relations.join(", ") || "없음"}`);
    if (missingTables.length) console.log(`아직 없는 대상 표 (건너뜀): ${missingTables.join(", ")}`);
    if (hits.length) {
      console.error(`점수·순위·추천을 뜻하는 칸 ${hits.length}건:`);
      for (const line of formatHits(hits)) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log("위반 0건");
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
