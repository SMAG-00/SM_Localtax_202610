// 규칙 파일 읽기·검사 — 형식이 틀리거나, 차단 항목 8종이 빠지거나, 패널 금지어가 든 규칙 파일은 거부한다 (OPT-03)
import rulesV1Json from "../rules/rules.v1.json";
import { CHECKS, type ParamType } from "./checks";
import { forbiddenWordIn } from "./text";
import { AXES, type Axis, type RuleDef, type RuleSet } from "./types";

/** OPT-03 차단 항목 8종 (OPT-03 수용 기준의 순서). 규칙 파일에서 빼거나 경고로 낮출 수 없다 */
export const BLOCKING_RULE_IDS = [
  "seo.canonical",
  "geo.claim-evidence",
  "geo.author",
  "geo.dates",
  "geo.law-basis-date",
  "common.structured-data",
  "common.similarity",
  "common.sponsor-label",
] as const;

export class RulesError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`규칙 파일 오류 ${problems.length}건\n${problems.join("\n")}`);
    this.name = "RulesError";
  }
}

const RULE_KEYS = new Set(["$comment", "id", "axis", "level", "unverifiedLevel", "name", "weight", "source", "params", "messages"]);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const LEVELS = ["block", "warn"];

function checkParam(type: ParamType, value: unknown): boolean {
  if (type === "int") return Number.isInteger(value);
  if (type === "string") return isText(value);
  return Array.isArray(value) && value.length > 0 && value.every(isText);
}

function checkRule(raw: unknown, index: number, problems: string[]): RuleDef | null {
  if (!isObject(raw)) {
    problems.push(`rules[${index}]: 규칙은 객체여야 합니다`);
    return null;
  }
  const id = isText(raw.id) ? raw.id : `rules[${index}]`;
  const bad = (msg: string) => problems.push(`${id}: ${msg}`);
  const before = problems.length;

  const def = CHECKS[id];
  if (!def) bad("엔진에 없는 규칙 ID입니다");
  for (const key of Object.keys(raw)) if (!RULE_KEYS.has(key)) bad(`모르는 키 ${key}`);
  if (!AXES.includes(raw.axis as Axis)) bad(`axis는 ${AXES.join("·")} 중 하나여야 합니다`);
  if (!LEVELS.includes(raw.level as string)) bad("level은 block 또는 warn이어야 합니다");
  else if ((BLOCKING_RULE_IDS as readonly string[]).includes(id) && raw.level !== "block") bad("level은 block이어야 합니다 (OPT-03 차단 항목)");
  if (!isText(raw.name)) bad("name이 없습니다");
  if (!isText(raw.source)) bad("source(PRD 근거)가 없습니다");
  if (!Number.isInteger(raw.weight) || (raw.weight as number) <= 0) bad("weight는 양의 정수여야 합니다");

  if (def?.canBeUnverified) {
    if (!LEVELS.includes(raw.unverifiedLevel as string)) bad("unverifiedLevel(block 또는 warn)이 필요합니다");
  } else if (raw.unverifiedLevel !== undefined) bad("unverifiedLevel은 비교 대상 없음 상태를 내는 규칙에만 둡니다");

  if (!isObject(raw.params)) bad("params는 객체여야 합니다");
  if (!isObject(raw.messages)) bad("messages는 객체여야 합니다");
  const params = isObject(raw.params) ? raw.params : {};
  const messages = isObject(raw.messages) ? raw.messages : {};
  if (def) {
    for (const [name, type] of Object.entries(def.params)) {
      if (!checkParam(type, params[name])) bad(`params.${name}의 형식이 틀립니다 (${type === "int" ? "정수" : type === "string" ? "글자" : "빈 글자 없는 1개 이상 목록"})`);
    }
    for (const name of Object.keys(params)) if (!Object.hasOwn(def.params, name)) bad(`모르는 params 키 ${name}`);
    for (const key of def.messageKeys) if (!isText(messages[key])) bad(`messages.${key}가 없습니다`);
    for (const key of Object.keys(messages)) if (!def.messageKeys.includes(key)) bad(`모르는 messages 키 ${key}`);
  }
  const panelTexts: [string, unknown][] = [["name", raw.name], ...Object.entries(messages).map(([k, v]): [string, unknown] => [`messages.${k}`, v])];
  for (const [where, text] of panelTexts) {
    const word = typeof text === "string" ? forbiddenWordIn(text) : undefined;
    if (word) bad(`${where}에 패널 금지어 '${word}'가 있습니다 (OPT-03)`);
  }
  if (problems.length > before) return null;

  return Object.freeze({
    id,
    axis: raw.axis as Axis,
    level: raw.level as RuleDef["level"],
    ...(raw.unverifiedLevel !== undefined ? { unverifiedLevel: raw.unverifiedLevel as RuleDef["level"] } : {}),
    name: raw.name as string,
    weight: raw.weight as number,
    source: raw.source as string,
    params: deepFreeze(structuredClone(params)),
    messages: Object.freeze({ ...(messages as Record<string, string>) }),
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** 규칙 파일(JSON 값)을 검사해 RuleSet으로. 문제가 하나라도 있으면 RulesError(문제 목록) */
export function parseRules(raw: unknown): RuleSet {
  const problems: string[] = [];
  if (!isObject(raw)) throw new RulesError(["규칙 파일은 객체여야 합니다"]);
  if (!isText(raw.version)) problems.push("version이 없습니다");
  if (!Array.isArray(raw.axes) || raw.axes.length !== AXES.length || raw.axes.some((a, i) => a !== AXES[i])) {
    problems.push(`axes는 [${AXES.join(", ")}]이어야 합니다`);
  }
  const rawRules = Array.isArray(raw.rules) ? raw.rules : (problems.push("rules는 목록이어야 합니다"), []);
  const rules = rawRules.map((r, i) => checkRule(r, i, problems));

  const ids = rawRules.map((r) => (isObject(r) ? r.id : undefined));
  for (const id of new Set(ids)) if (typeof id === "string" && ids.filter((x) => x === id).length > 1) problems.push(`${id}: 같은 ID가 두 번 있습니다`);
  for (const id of BLOCKING_RULE_IDS) if (!ids.includes(id)) problems.push(`${id}: 차단 규칙이 빠졌습니다 (OPT-03 차단 항목 8종)`);

  if (problems.length) throw new RulesError(problems);
  return Object.freeze({ version: raw.version as string, axes: Object.freeze([...AXES]), rules: Object.freeze(rules as RuleDef[]) });
}

/** rules/rules.v1.json — 검사를 마친 기본 규칙 */
export const RULES_V1: RuleSet = parseRules(rulesV1Json);

/**
 * 설정(settings.seo_lint_params)이 규칙 기준값을 덮어쓴다 — `{ "<규칙 ID>": { "<params 이름>": 값 } }`.
 * 모르는 규칙·모르는 이름·형식이 틀린 값은 무시하고 규칙 파일 값을 그대로 둔다. 차단 규칙의 level·가중치는 바꾸지 않는다 (OPT-03).
 * 돌려주는 problems는 무시한 항목 목록(화면 안내용)이다.
 */
export function applyRuleParams(rules: RuleSet, overrides: unknown): { rules: RuleSet; problems: string[] } {
  const problems: string[] = [];
  if (overrides === undefined || overrides === null) return { rules, problems };
  if (!isObject(overrides)) return { rules, problems: ["seo_lint_params는 객체여야 합니다"] };
  const next = rules.rules.map((rule) => {
    const over = overrides[rule.id];
    if (over === undefined) return rule;
    const def = CHECKS[rule.id];
    if (!def || !isObject(over)) {
      problems.push(`${rule.id}: 객체가 아닙니다`);
      return rule;
    }
    const params: Record<string, unknown> = { ...rule.params };
    for (const [name, value] of Object.entries(over)) {
      const type = def.params[name];
      if (type === undefined || !checkParam(type, value)) {
        problems.push(`${rule.id}.${name}: 모르는 이름이거나 형식이 틀립니다`);
        continue;
      }
      params[name] = value;
    }
    return Object.freeze({ ...rule, params: deepFreeze(structuredClone(params)) });
  });
  for (const id of Object.keys(overrides)) if (!rules.rules.some((r) => r.id === id)) problems.push(`${id}: 규칙 파일에 없는 규칙입니다`);
  return { rules: Object.freeze({ ...rules, rules: Object.freeze(next) }), problems };
}
