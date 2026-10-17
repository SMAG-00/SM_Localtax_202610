// 점검 엔진 — 같은 원고·같은 문맥·같은 규칙이면 같은 결과 (결정론, OPT-03). 현재 시각·난수·네트워크·AI를 쓰지 않는다.
import pkg from "../package.json";
import { CHECKS } from "./checks";
import { fill } from "./text";
import { AXES, type ArticleForLint, type Axis, type LintContext, type LintItem, type LintResult, type RuleDef, type RuleSet } from "./types";

/** 엔진 버전 — package.json version (`seo_checks.engine_version`) */
export const ENGINE_VERSION: string = pkg.version;

function evaluate(rule: RuleDef, article: ArticleForLint, context: LintContext): LintItem {
  const def = CHECKS[rule.id];
  if (!def) throw new Error(`${rule.id}: 엔진에 없는 규칙 ID입니다 — parseRules를 거친 규칙만 넣는다`);
  const text = (key: string) => {
    const value = rule.messages[key];
    if (value === undefined) throw new Error(`${rule.id}: messages.${key}가 없습니다`);
    return value;
  };
  const head = { id: rule.id, axis: rule.axis, name: rule.name };
  const outcome = def.run(article, context, rule.params as never, text);
  switch (outcome.kind) {
    case "pass":
      return { ...head, level: "pass", message: fill(text("pass"), outcome.vars), applicable: true };
    case "fail":
      return { ...head, level: rule.level, message: fill(text(outcome.variant), outcome.vars), applicable: true };
    case "not_applicable":
      return { ...head, level: "pass", message: text("notApplicable"), applicable: false };
    case "unverified":
      if (!rule.unverifiedLevel) throw new Error(`${rule.id}: unverifiedLevel이 없습니다`);
      return { ...head, level: rule.unverifiedLevel, message: text("unverified"), applicable: true };
  }
}

/** 축 점수 = round(100 × 통과 항목 가중치 합 ÷ 해당 항목 가중치 합). 해당 없음 항목은 빼고, 해당 항목이 없는 축은 100 */
function scoreAxes(rules: readonly RuleDef[], items: readonly LintItem[]): Record<Axis, number> {
  const scores = {} as Record<Axis, number>;
  for (const axis of AXES) {
    let total = 0;
    let passed = 0;
    rules.forEach((rule, i) => {
      const it = items[i]!;
      if (rule.axis !== axis || !it.applicable) return;
      total += rule.weight;
      if (it.level === "pass") passed += rule.weight;
    });
    scores[axis] = total === 0 ? 100 : Math.round((100 * passed) / total);
  }
  return scores;
}

/** 원고 한 판을 규칙대로 점검한다. rules는 parseRules를 거친 값(RULES_V1 등) */
export function lintArticle(article: ArticleForLint, context: LintContext, rules: RuleSet): LintResult {
  const items = rules.rules.map((rule) => evaluate(rule, article, context));
  const blockers = items.filter((i) => i.level === "block").map((i) => i.id);
  const warnings = items.filter((i) => i.level === "warn").map((i) => i.id);
  return {
    ruleVersion: rules.version,
    engineVersion: ENGINE_VERSION,
    scores: scoreAxes(rules.rules, items),
    items,
    blockers,
    warnings,
    canPublish: blockers.length === 0,
  };
}
