// 평가 실행기 - 순수 부분 (W12-e e4, PRD-04 EVAL-03·ASK-17, docs/dev/W12-e_설계.md 5장).
// 목록 선택(기본·확장·색인 제외), 조건 지문·변경 사유 감지, 지방세봇 한 턴 결과 -> 답변 칸 변환, 켠/끈 비교.
// 법·세무 문장을 만들지 않는다. 네트워크·DB 없음 - 서버 쪽(lib/server/eval/runner.ts)이 주입받은 공급자로 부른다.
import { createHash } from "node:crypto";
import { runAgentTurn, type AgentDeps, type AgentTurnRecord } from "@/lib/agent/flow";
import type { EvidenceDoc } from "@/lib/agent/evidence";
import type { AgentToolbox } from "@/lib/agent/tools";
import type { FakeAnswer } from "./fake-model";

export type ListKind = "base" | "extended" | "index_exclusion";
export interface RunnerItem {
  id: number;
  set_id: number;
  item_key: string;
  scope: string;
  cross_types: string[];
  expected_behavior: "answer" | "scope_guide" | "blocked" | "no_answer";
  expected_clarify: string | null;
  required_citation_ids: string[];
  index_exclude_ids: string[];
  question: string;
  is_test: boolean;
}

/** 목록 선택 - 기본 = 범위 base, 확장 = base가 아닌 범위, 색인 제외 = 가릴 근거 ID가 있는 문항(범위 무관) */
export function selectItems<T extends Pick<RunnerItem, "scope" | "index_exclude_ids">>(items: readonly T[], list: ListKind): T[] {
  if (list === "base") return items.filter((i) => i.scope === "base");
  if (list === "extended") return items.filter((i) => i.scope !== "base");
  return items.filter((i) => i.index_exclude_ids.length > 0);
}

/** 검색 결과에서 가릴 근거를 뺀다 - sourceId 또는 chunk:번호 로 지정. 목록이 비면 그대로 */
export function applyIndexExclusion(docs: readonly EvidenceDoc[], excludeIds: readonly string[]): EvidenceDoc[] {
  if (excludeIds.length === 0) return [...docs];
  const hide = new Set(excludeIds);
  return docs.filter((d) => !hide.has(d.sourceId) && !(d.chunkId !== null && hide.has(`chunk:${d.chunkId}`)));
}

/** 도구 상자의 검색을 가려진 목록으로 감싼다 - 나머지 도구는 그대로 */
export function withIndexExclusion(tools: AgentToolbox, excludeIds: readonly string[]): AgentToolbox {
  if (excludeIds.length === 0) return tools;
  return { ...tools, search: async (a) => applyIndexExclusion(await tools.search(a), excludeIds) };
}

export interface RunConditions {
  model: string;
  prompt_version: string;
  index_version: string;
  ruleset_hash: string | null;
  determination_hash: string | null;
}

/** DB eval_runs_guard의 지문 계산과 같은 식 (model|prompt|index|ruleset|determination 의 sha256 16진) */
export function fingerprintOf(c: RunConditions): string {
  return createHash("sha256").update(`${c.model}|${c.prompt_version}|${c.index_version}|${c.ruleset_hash ?? ""}|${c.determination_hash ?? ""}`, "utf8").digest("hex");
}

export type ChangeReason = "prompt_changed" | "model_changed" | "index_changed" | "ruleset_changed" | "determination_changed";
/** 이전 실행 조건과 지금 조건의 차이 - 바뀐 것 전부(순서 고정). 이전이 없으면 비교 대상이 없으므로 빈 목록 */
export function changeReasons(prev: RunConditions | null, now: RunConditions): ChangeReason[] {
  if (!prev) return [];
  const out: ChangeReason[] = [];
  if (prev.prompt_version !== now.prompt_version) out.push("prompt_changed");
  if (prev.model !== now.model) out.push("model_changed");
  if (prev.index_version !== now.index_version) out.push("index_changed");
  if ((prev.ruleset_hash ?? null) !== (now.ruleset_hash ?? null)) out.push("ruleset_changed");
  if ((prev.determination_hash ?? null) !== (now.determination_hash ?? null)) out.push("determination_changed");
  return out;
}

/** 지방세봇 한 턴의 결과 -> 평가 답변 칸. 차단(투자 추천·예측·국세 금액 계산기 안내)은 blocked, 범위 안내는 scope_guide, 근거 부족 등은 no_answer */
export function toEvalAnswer(rec: AgentTurnRecord): FakeAnswer {
  const blocked = rec.measure.some((m) => m.name === "ask_investment_blocked" || (m.name === "ask_scope_redirected" && m.props.reason === "national_tax_calculator"));
  let behavior: FakeAnswer["behavior"];
  if (rec.kind === "clarify") behavior = "clarify";
  else if (rec.kind === "answer") behavior = "answer";
  else if (blocked) behavior = "blocked";
  else if (rec.fallbackReason === "scope") behavior = "scope_guide";
  else behavior = "no_answer";
  const live = rec.citations.filter((c) => c.isLive);
  const text = (rec.answerMasked ?? "").trim();
  return {
    answer_text: text.length > 0 ? text.slice(0, 8000) : `(${behavior} - 본문 없음)`,
    behavior,
    cited_ids: [...new Set(rec.citations.map((c) => c.sourceId))],
    live_citations: live.length,
    live_without_snapshot: live.filter((c) => c.snapshotId === null).length,
  };
}

export interface Outcome {
  item_key: string;
  behavior: FakeAnswer["behavior"];
  cited_ids: string[];
}
export interface ItemDiff {
  item_key: string;
  behavior_changed: boolean;
  from: FakeAnswer["behavior"] | null;
  to: FakeAnswer["behavior"] | null;
  citations_added: string[];
  citations_removed: string[];
}
export interface Comparison {
  total: number;
  changed: number;
  diffs: ItemDiff[];
}

/** 켠/끈 비교 (ASK-17) - 같은 문항을 두 조건으로 돌린 결과를 문항별로 견준다. 한쪽에만 있는 문항도 차이로 센다 */
export function compareOutcomes(off: readonly Outcome[], on: readonly Outcome[]): Comparison {
  const a = new Map(off.map((o) => [o.item_key, o]));
  const b = new Map(on.map((o) => [o.item_key, o]));
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const diffs: ItemDiff[] = [];
  for (const k of keys) {
    const x = a.get(k) ?? null;
    const y = b.get(k) ?? null;
    const xs = new Set(x?.cited_ids ?? []);
    const ys = new Set(y?.cited_ids ?? []);
    const added = [...ys].filter((c) => !xs.has(c)).sort();
    const removed = [...xs].filter((c) => !ys.has(c)).sort();
    const behaviorChanged = (x?.behavior ?? null) !== (y?.behavior ?? null);
    if (behaviorChanged || added.length || removed.length) diffs.push({ item_key: k, behavior_changed: behaviorChanged, from: x?.behavior ?? null, to: y?.behavior ?? null, citations_added: added, citations_removed: removed });
  }
  return { total: keys.length, changed: diffs.length, diffs };
}

/** 지방세봇 한 턴을 끝까지 돌려 평가 답변 칸으로 바꾼다. 색인 제외 문항이면 검색 도구를 감싼다. 역질문 답변은 받지 않고 한 턴만 본다 */
export async function answerWithAgent(item: Pick<RunnerItem, "question" | "index_exclude_ids">, deps: AgentDeps): Promise<FakeAnswer> {
  const gen = runAgentTurn({ message: item.question, mode: "general", turn: 0, clarify: { rounds: 0, answers: {} } }, { ...deps, tools: withIndexExclusion(deps.tools, item.index_exclude_ids) });
  for (;;) {
    const n = await gen.next();
    if (n.done) return toEvalAnswer(n.value);
  }
}

/** 기대 응답 모양과 실제가 같은가 - 1차 점검용 요약(정답 판정은 사람 채점만 쓴다) */
export function behaviorMatches(item: Pick<RunnerItem, "expected_behavior" | "cross_types" | "expected_clarify">, got: FakeAnswer["behavior"]): boolean {
  if (item.cross_types.includes("clarify") && item.expected_clarify !== null) return got === "clarify";
  return got === item.expected_behavior;
}
