// 지방세봇 질문당 비용 보고 (W12-z - 4단계 설계 6장 '질문당 비용 실측')
// 사용: node scripts/ask-cost-report.mjs --db=<DB 주소> [--days=7]
//   agent_messages의 토큰·비용 칸(질문 글은 읽지 않는다)을 모드별로 묶어 질문당 평균·p95를 표로 낸다.
//   비용은 API 응답 사용량 x 설정 단가(ask_pricing)로 이미 기록된 값이다. 실제 비용 실측은 실제 모델 키로 질문을 돌린 뒤에 PO가 실행한다(막힘).
import { fileURLToPath } from "node:url";

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** rows = [{ mode, kind, tokens_in, tokens_out, tokens_cached, cost, model_calls }] -> 모드별 요약. 모델을 부르지 않은 턴(범위 안내·검색 모드)은 따로 센다 */
export function summarizeCost(rows) {
  const out = {};
  for (const mode of [...new Set(rows.map((r) => r.mode))].sort()) {
    const all = rows.filter((r) => r.mode === mode);
    const called = all.filter((r) => num(r.model_calls) > 0);
    const costs = called.map((r) => num(r.cost)).sort((a, b) => a - b);
    const sum = (k) => called.reduce((s, r) => s + num(r[k]), 0);
    out[mode] = {
      turns: all.length,
      modelTurns: called.length,
      noModelTurns: all.length - called.length,
      avgCostWon: called.length ? Math.round((costs.reduce((s, c) => s + c, 0) / called.length) * 10_000) / 10_000 : 0,
      p95CostWon: percentile(costs, 0.95),
      maxCostWon: costs.length ? costs[costs.length - 1] : 0,
      avgTokensIn: called.length ? Math.round(sum("tokens_in") / called.length) : 0,
      avgTokensOut: called.length ? Math.round(sum("tokens_out") / called.length) : 0,
      avgModelCalls: called.length ? Math.round((sum("model_calls") / called.length) * 100) / 100 : 0,
    };
  }
  return out;
}

export function costTable(summary) {
  const head = "| 모드 | 턴 | 모델 호출 턴 | 모델 0회 턴 | 평균 비용(원) | p95(원) | 최대(원) | 평균 입력 토큰 | 평균 출력 토큰 | 평균 호출 수 |\n|---|---|---|---|---|---|---|---|---|---|";
  const rows = Object.entries(summary).map(([m, s]) => `| ${m} | ${s.turns} | ${s.modelTurns} | ${s.noModelTurns} | ${s.avgCostWon} | ${s.p95CostWon} | ${s.maxCostWon} | ${s.avgTokensIn} | ${s.avgTokensOut} | ${s.avgModelCalls} |`);
  return [head, ...rows].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = (process.argv.find((a) => a.startsWith("--db=")) ?? "").slice(5);
  if (!url) {
    console.error("--db=<DB 주소>가 필요합니다");
    process.exit(2);
  }
  const days = Number((process.argv.find((a) => a.startsWith("--days=")) ?? "--days=7").slice(7)) || 7;
  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query(
      "select s.mode, m.kind, m.tokens_in, m.tokens_out, m.tokens_cached, m.cost, m.model_calls from public.agent_messages m join public.agent_sessions s on s.id = m.session_id where m.created_at > now() - ($1 || ' days')::interval",
      [String(days)],
    );
    console.log(costTable(summarizeCost(rows)));
  } finally {
    await c.end();
  }
}
