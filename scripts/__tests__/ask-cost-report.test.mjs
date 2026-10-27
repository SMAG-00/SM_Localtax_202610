import { test } from "node:test";
import assert from "node:assert/strict";
import { costTable, summarizeCost } from "../ask-cost-report.mjs";

const row = (over) => ({ mode: "general", kind: "answer", tokens_in: 1000, tokens_out: 500, tokens_cached: 0, cost: "3.5", model_calls: 1, ...over });

test("모델을 부른 턴만 평균·p95에 들어가고 모델 0회 턴은 따로 센다", () => {
  const s = summarizeCost([row({}), row({ cost: "5.5", tokens_in: 3000, model_calls: 2 }), row({ kind: "fallback", cost: "0", model_calls: 0, tokens_in: 0, tokens_out: 0 })]).general;
  assert.deepEqual([s.turns, s.modelTurns, s.noModelTurns], [3, 2, 1]);
  assert.equal(s.avgCostWon, 4.5);
  assert.equal(s.p95CostWon, 5.5);
  assert.equal(s.maxCostWon, 5.5);
  assert.equal(s.avgTokensIn, 2000);
  assert.equal(s.avgModelCalls, 1.5);
});

test("모드별로 나뉘고, 빈 입력이면 빈 결과, 모델 호출이 하나도 없으면 0", () => {
  assert.deepEqual(summarizeCost([]), {});
  const s = summarizeCost([row({ mode: "expert", model_calls: 0, cost: "0" }), row({ mode: "general" })]);
  assert.deepEqual(Object.keys(s), ["expert", "general"]);
  assert.equal(s.expert.avgCostWon, 0);
  assert.equal(s.general.p95CostWon, 3.5);
});

test("표에 모드마다 한 줄이 나온다", () => {
  const lines = costTable(summarizeCost([row({}), row({ mode: "expert" })])).split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[2], /^\| expert \| 1 \| 1 \| 0 \| 3.5 \|/);
});
