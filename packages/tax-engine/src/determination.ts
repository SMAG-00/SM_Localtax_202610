/**
 * 판정표 평가기 (CALC-04 환급 자가진단 · CALC-13 감면 자동 점검) - 이 저장소에서 새로 쓴 순수 모듈 (SM 복사본 아님).
 *
 * 판정표는 데이터다. 요건·한도·기간의 값과 문장은 감수위원이 입력해 서명한 판정표(`determination_tables`)에만 있고,
 * 이 모듈에는 어떤 세법 값도 없다 - 비교 연산(같다·작다·포함·그리고·또는)만 안다.
 *  · 감면(reduction): 항목마다 요건 목록. 요건 결과는 '입력으로 확인'(조건이 참) · '입력으로 확인 안 됨'(조건이 거짓) · '직접 확인 필요'(입력이 없거나 사람이 확인할 요건).
 *    항목 판정은 '해당될 수 있음' / '해당 안 됨'. 단정하지 않는다 - 해당될 수 있음에도 '요건 확인 필요' 고지는 화면이 붙인다.
 *  · 환급(refund): 항목마다 순서 있는 규칙. 처음 맞는 규칙의 가능성(높음·확인 필요·낮음), 맞는 규칙이 없으면 표의 기본값.
 *  · 결과마다 판정표 버전을 각인한다 (CALC-07). 같은 표·같은 입력이면 같은 결과 (순수 함수 - 입력 객체를 바꾸지 않는다).
 */
import { z } from 'zod';

export type FactValue = number | string | boolean;
export type Facts = Readonly<Record<string, FactValue | undefined>>;

/** 비교 대상: 값 또는 다른 입력 칸 (예: 신청일 <= 기한일) */
export type Operand = FactValue | { readonly field: string };

export type Condition =
  | { readonly op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; readonly field: string; readonly value: Operand }
  | { readonly op: 'in'; readonly field: string; readonly values: readonly FactValue[] }
  | { readonly op: 'all' | 'any'; readonly conds: readonly Condition[] }
  | { readonly op: 'not'; readonly cond: Condition }
  | { readonly op: 'manual' };

export const LIKELIHOODS = ['높음', '확인 필요', '낮음'] as const;
export type Likelihood = (typeof LIKELIHOODS)[number];

const key = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, '영문 소문자로 시작하는 소문자·숫자·_ 2~40자 키여야 한다');
const text = z.string().min(1).max(300);
const factValue = z.union([z.number().finite(), z.string().max(100), z.boolean()]);
const operand = z.union([factValue, z.object({ field: key }).strict()]);

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']), field: key, value: operand }).strict(),
    z.object({ op: z.literal('in'), field: key, values: z.array(factValue).min(1).max(50) }).strict(),
    z.object({ op: z.enum(['all', 'any']), conds: z.array(conditionSchema).min(1).max(20) }).strict(),
    z.object({ op: z.literal('not'), cond: conditionSchema }).strict(),
    z.object({ op: z.literal('manual') }).strict(),
  ]),
);

const requirementSchema = z.object({
  id: key,
  /** 화면에 나오는 요건 문장 - 감수 입력 */
  label: text,
  check: conditionSchema,
});

const reductionItemSchema = z.object({
  id: key,
  label: text,
  /** 근거 조문 칩 - 감수 입력 */
  law: text.optional(),
  requirements: z.array(requirementSchema).min(1).max(30),
});

const refundItemSchema = z.object({
  id: key,
  label: text,
  law: text.optional(),
  rules: z.array(z.object({ id: key, when: conditionSchema, likelihood: z.enum(LIKELIHOODS) })).min(1).max(30),
  default: z.enum(LIKELIHOODS),
});

/** 문진 항목 - 환급 자가진단은 판정표가 스스로 문진표를 가진다(서명 범위에 포함). 질문 문장은 60자 이하, 값은 입력 칸(field) 하나에 들어간다 */
const questionSchema = z
  .object({ field: key, text: z.string().min(1).max(60), kind: z.enum(['yesno', 'count', 'date']), help: text.optional() })
  .strict();
const questions = z.array(questionSchema).min(1).max(30).optional();

const base = {
  version: z.string().regex(/^\d{4}\.\d{2}$/, 'version은 YYYY.NN 형식이어야 한다'),
  /** 표 이름 - 시험용 자료에는 '시험용'이 들어간다 */
  label: text,
};

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const DeterminationTableSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('reduction'), ...base, questions, items: z.array(reductionItemSchema).min(1).max(50) }).strict(),
    z.object({ kind: z.literal('refund'), ...base, questions, items: z.array(refundItemSchema).min(1).max(50) }).strict(),
  ])
  .superRefine((t, ctx) => {
    if (!uniqueIds(t.items.map((i) => i.id))) ctx.addIssue({ code: 'custom', message: '항목 id가 겹친다' });
    if (t.questions && !uniqueIds(t.questions.map((q) => q.field))) ctx.addIssue({ code: 'custom', message: '문진 항목의 입력 칸이 겹친다' });
    for (const item of t.items) {
      const inner = t.kind === 'reduction' ? (item as z.infer<typeof reductionItemSchema>).requirements : (item as z.infer<typeof refundItemSchema>).rules;
      if (!uniqueIds(inner.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: `항목 ${item.id}의 요건·규칙 id가 겹친다` });
    }
  });
export type DeterminationTable = z.infer<typeof DeterminationTableSchema>;

/** 판정표를 검증하며 파싱한다. 실패하면 throw (감수 입력 틀림은 활성화 전에 잡는다) */
export function parseDeterminationTable(raw: unknown): DeterminationTable {
  return DeterminationTableSchema.parse(raw);
}

/** 조건 결과: 참·거짓·모름(입력 없음·사람 확인) */
type Tri = 'yes' | 'no' | 'unknown';

function operandValue(facts: Facts, o: Operand): FactValue | undefined {
  return typeof o === 'object' ? facts[o.field] : o;
}

function compare(op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte', a: FactValue, b: FactValue): Tri {
  if (op === 'eq') return a === b ? 'yes' : 'no';
  if (op === 'ne') return a !== b ? 'yes' : 'no';
  // 순서 비교는 같은 종류끼리만 (숫자-숫자, 글자-글자: ISO 날짜 YYYY-MM-DD는 글자 순서가 날짜 순서) - 종류가 다르면 모름
  if (typeof a !== typeof b || typeof a === 'boolean') return 'unknown';
  const x = a as number | string;
  const y = b as number | string;
  const r = op === 'lt' ? x < y : op === 'lte' ? x <= y : op === 'gt' ? x > y : x >= y;
  return r ? 'yes' : 'no';
}

function evalCondition(c: Condition, facts: Facts): Tri {
  switch (c.op) {
    case 'manual':
      return 'unknown';
    case 'in': {
      const v = facts[c.field];
      return v === undefined ? 'unknown' : c.values.includes(v) ? 'yes' : 'no';
    }
    case 'not': {
      const r = evalCondition(c.cond, facts);
      return r === 'unknown' ? 'unknown' : r === 'yes' ? 'no' : 'yes';
    }
    case 'all': {
      const rs = c.conds.map((x) => evalCondition(x, facts));
      return rs.includes('no') ? 'no' : rs.includes('unknown') ? 'unknown' : 'yes';
    }
    case 'any': {
      const rs = c.conds.map((x) => evalCondition(x, facts));
      return rs.includes('yes') ? 'yes' : rs.includes('unknown') ? 'unknown' : 'no';
    }
    default: {
      const left = facts[c.field];
      const right = operandValue(facts, c.value);
      if (left === undefined || right === undefined) return 'unknown';
      return compare(c.op, left, right);
    }
  }
}

export type RequirementState = '입력으로 확인' | '입력으로 확인 안 됨' | '직접 확인 필요';
export interface RequirementResult {
  readonly id: string;
  readonly label: string;
  readonly state: RequirementState;
}
export interface ReductionResult {
  readonly id: string;
  readonly label: string;
  readonly law?: string;
  /** '해당될 수 있음'은 단정이 아니다 - 요건 확인 필요 고지는 화면이 붙인다 */
  readonly verdict: '해당될 수 있음' | '해당 안 됨';
  readonly requirements: readonly RequirementResult[];
}
export interface RefundResult {
  readonly id: string;
  readonly label: string;
  readonly law?: string;
  readonly likelihood: Likelihood;
  /** 근거가 된 규칙 id (맞는 규칙이 없어 기본값이면 null) */
  readonly ruleId: string | null;
}
export type DeterminationOutcome =
  | { readonly kind: 'reduction'; readonly tableVersion: string; readonly results: readonly ReductionResult[]; readonly matchedCount: number }
  | { readonly kind: 'refund'; readonly tableVersion: string; readonly results: readonly RefundResult[] };

/** 판정표를 입력(facts)으로 평가한다. 서명되지 않은 표를 막는 것은 호출하는 쪽(활성 판정표만 읽는다)의 일이다. */
export function evaluateDeterminationTable(table: DeterminationTable, facts: Facts): DeterminationOutcome {
  if (table.kind === 'reduction') {
    const results: ReductionResult[] = table.items.map((item) => {
      const requirements: RequirementResult[] = item.requirements.map((r) => {
        const t = evalCondition(r.check, facts);
        return { id: r.id, label: r.label, state: t === 'yes' ? '입력으로 확인' : t === 'no' ? '입력으로 확인 안 됨' : '직접 확인 필요' };
      });
      const failed = requirements.some((r) => r.state === '입력으로 확인 안 됨');
      return { id: item.id, label: item.label, ...(item.law ? { law: item.law } : {}), verdict: failed ? '해당 안 됨' : '해당될 수 있음', requirements };
    });
    return { kind: 'reduction', tableVersion: table.version, results, matchedCount: results.filter((r) => r.verdict === '해당될 수 있음').length };
  }
  const results: RefundResult[] = table.items.map((item) => {
    const hit = item.rules.find((rule) => evalCondition(rule.when, facts) === 'yes');
    return { id: item.id, label: item.label, ...(item.law ? { law: item.law } : {}), likelihood: hit ? hit.likelihood : item.default, ruleId: hit ? hit.id : null };
  });
  return { kind: 'refund', tableVersion: table.version, results };
}

// ─────────────────────────────────────────────────────────────
// W11-a a2 - 결론형(conclusion) · 목록 집계형(list_count) 모양 (PRD-03 FAM-05 · PR-12 · 6장 요건 사전)
// 기존 두 모양(reduction · refund)과 평가 함수는 그대로다. 새 모양도 세법 값이 없다 - 비교 연산만 안다.
//  · 결론형: 필수 사실(required)이 하나라도 없으면('모르겠어요') 결론 없이 '요건 확인 필요'와 빠진 항목을 돌려준다 - 기본 가정으로 채우지 않는다.
//    필수 사실이 다 있으면 순서 있는 규칙의 처음 맞는 결론. 규칙 판단이 모름(선택 사실 없음·사람 확인)이면 그 규칙에서 멈추고 '요건 확인 필요'.
//  · 목록 집계형: 보유 목록의 항목마다 필수 칸이 있어야 하고, 조건에 맞는 항목 수를 센 뒤 개수 규칙으로 결론을 낸다 (주택 수 판정).
//  · 판정표 종류(kind)는 원인·목적마다 따로다 - 상속과 증여는 같은 행을 나눠 쓰지 못한다 (assertSeparateOrigins).
// ─────────────────────────────────────────────────────────────
export const CONCLUSION_KINDS = ['trust_taxpayer', 'redevelopment_right', 'house_count_inheritance', 'house_count_gift', 'redevelopment_tax', 'trust_acquisition'] as const;
export const LIST_COUNT_KINDS = ['house_count'] as const;
/** W11 판정표 종류 7종 (마이그레이션 112 determination_tables.kind와 같은 순서) */
export const W11_DETERMINATION_KINDS = ['house_count', 'trust_taxpayer', 'redevelopment_right', 'house_count_inheritance', 'house_count_gift', 'redevelopment_tax', 'trust_acquisition'] as const;
export type ConclusionKind = (typeof CONCLUSION_KINDS)[number];

const requiredFactSchema = z.object({ id: key, label: text }).strict();
const conclusionRuleSchema = z
  .object({ id: key, label: text.optional(), when: conditionSchema, conclusion: text, basis: text.optional() })
  .strict();

export const ConclusionTableSchema = z
  .object({
    kind: z.enum(CONCLUSION_KINDS),
    ...base,
    required: z.array(requiredFactSchema).min(1).max(30),
    rules: z.array(conclusionRuleSchema).min(1).max(50),
    fallback: text.optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (!uniqueIds(t.required.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: '필수 사실 id가 겹친다' });
    if (!uniqueIds(t.rules.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: '규칙 id가 겹친다' });
  });
export type ConclusionTable = z.infer<typeof ConclusionTableSchema>;

const countOps = z.enum(['eq', 'lt', 'lte', 'gt', 'gte']);
export const ListCountTableSchema = z
  .object({
    kind: z.literal('house_count'),
    ...base,
    /** 목록의 항목마다 있어야 하는 칸 */
    entry_required: z.array(requiredFactSchema).min(1).max(20),
    /** 세는 조건 (항목의 칸 + 목록 밖 사실을 읽는다) */
    count_when: conditionSchema,
    groups: z.array(z.object({ id: key, label: text, when: conditionSchema }).strict()).max(20).optional(),
    result_rules: z.array(z.object({ id: key, op: countOps, value: z.number().int().min(0).max(1000), conclusion: text, basis: text.optional() }).strict()).min(1).max(20),
    fallback: text.optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    if (!uniqueIds(t.entry_required.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: '항목 필수 칸 id가 겹친다' });
    if (!uniqueIds(t.result_rules.map((r) => r.id))) ctx.addIssue({ code: 'custom', message: '개수 규칙 id가 겹친다' });
    if (t.groups && !uniqueIds(t.groups.map((g) => g.id))) ctx.addIssue({ code: 'custom', message: '묶음 id가 겹친다' });
  });
export type ListCountTable = z.infer<typeof ListCountTableSchema>;
export type W11DeterminationTable = ConclusionTable | ListCountTable;

/** 종류 이름에 맞는 모양으로만 파싱한다 - 종류와 본문 모양이 다르면 throw (예: house_count_gift에 목록 집계형 본문) */
export function parseTableByKind(kind: string, raw: unknown): DeterminationTable | W11DeterminationTable {
  if (kind === 'reduction' || kind === 'refund') {
    const t = parseDeterminationTable(raw);
    if (t.kind !== kind) throw new Error(`판정표 종류(${kind})와 본문 종류(${t.kind})가 다르다`);
    return t;
  }
  if ((LIST_COUNT_KINDS as readonly string[]).includes(kind)) {
    const t = ListCountTableSchema.parse(raw);
    if (t.kind !== kind) throw new Error(`판정표 종류(${kind})와 본문 종류(${t.kind})가 다르다`);
    return t;
  }
  if ((CONCLUSION_KINDS as readonly string[]).includes(kind)) {
    const t = ConclusionTableSchema.parse(raw);
    if (t.kind !== kind) throw new Error(`판정표 종류(${kind})와 본문 종류(${t.kind})가 다르다`);
    return t;
  }
  throw new Error(`모르는 판정표 종류: ${kind}`);
}

export type ConclusionStatus = '결론' | '요건 확인 필요' | '표에 없는 경우';
export interface MissingItem {
  readonly id: string;
  readonly label: string;
}
export interface ConclusionText {
  /** 근거가 된 규칙 id (fallback이면 null) */
  readonly ruleId: string | null;
  readonly text: string;
  readonly basis?: string;
}
export interface ConclusionOutcome {
  readonly kind: 'conclusion';
  readonly tableKind: ConclusionKind;
  readonly tableVersion: string;
  readonly status: ConclusionStatus;
  readonly conclusion: ConclusionText | null;
  /** 결론을 못 낸 이유가 입력 부족일 때 빠진 항목 */
  readonly missing: readonly MissingItem[];
}
export interface ListCountOutcome {
  readonly kind: 'list_count';
  readonly tableKind: 'house_count';
  readonly tableVersion: string;
  readonly status: ConclusionStatus;
  /** 센 개수 - 입력이 부족하면 null (일부만 센 값을 내지 않는다) */
  readonly count: number | null;
  readonly groups: readonly { readonly id: string; readonly label: string; readonly count: number }[] | null;
  readonly conclusion: ConclusionText | null;
  readonly missing: readonly MissingItem[];
}

function conditionFields(c: Condition, out: Set<string> = new Set()): Set<string> {
  switch (c.op) {
    case 'manual':
      break;
    case 'all':
    case 'any':
      c.conds.forEach((x) => conditionFields(x, out));
      break;
    case 'not':
      conditionFields(c.cond, out);
      break;
    case 'in':
      out.add(c.field);
      break;
    default:
      out.add(c.field);
      if (typeof c.value === 'object') out.add(c.value.field);
  }
  return out;
}

/** 결론형 평가. 필수 사실이 없으면('모르겠어요') 결론 0 + 빠진 항목. 입력 객체는 바꾸지 않는다. */
export function evaluateConclusionTable(table: ConclusionTable, facts: Facts): ConclusionOutcome {
  const head = { kind: 'conclusion', tableKind: table.kind, tableVersion: table.version } as const;
  const missing = table.required.filter((r) => facts[r.id] === undefined).map((r) => ({ id: r.id, label: r.label }));
  if (missing.length > 0) return { ...head, status: '요건 확인 필요', conclusion: null, missing };
  for (const rule of table.rules) {
    const t = evalCondition(rule.when, facts);
    if (t === 'yes') return { ...head, status: '결론', conclusion: { ruleId: rule.id, text: rule.conclusion, ...(rule.basis ? { basis: rule.basis } : {}) }, missing: [] };
    if (t === 'unknown') {
      const absent = [...conditionFields(rule.when)].filter((f) => facts[f] === undefined);
      const items = absent.length > 0 ? absent.map((f) => ({ id: f, label: f })) : [{ id: rule.id, label: rule.label ?? '직접 확인 필요' }];
      return { ...head, status: '요건 확인 필요', conclusion: null, missing: items };
    }
  }
  if (table.fallback) return { ...head, status: '결론', conclusion: { ruleId: null, text: table.fallback }, missing: [] };
  return { ...head, status: '표에 없는 경우', conclusion: null, missing: [] };
}

function countCompare(op: 'eq' | 'lt' | 'lte' | 'gt' | 'gte', n: number, v: number): boolean {
  return op === 'eq' ? n === v : op === 'lt' ? n < v : op === 'lte' ? n <= v : op === 'gt' ? n > v : n >= v;
}

/**
 * 목록 집계형 평가. entries가 없으면('모르겠어요') 개수 0이 아니라 '요건 확인 필요'다 - 빈 목록([])은 "하나도 없음"이라는 답이다.
 * 항목마다 필수 칸이 있어야 센다. 일부라도 모르면 개수를 내지 않는다 (일부만 센 값이 결론이 되면 안 된다).
 */
export function evaluateListCountTable(table: ListCountTable, entries: readonly Facts[] | undefined, outer: Facts = {}): ListCountOutcome {
  const head = { kind: 'list_count', tableKind: table.kind, tableVersion: table.version } as const;
  if (entries === undefined) return { ...head, status: '요건 확인 필요', count: null, groups: null, conclusion: null, missing: [{ id: 'entries', label: '보유 목록' }] };
  const missing: MissingItem[] = [];
  let count = 0;
  const groupCounts = new Map((table.groups ?? []).map((g) => [g.id, 0]));
  entries.forEach((entry, i) => {
    const lacking = table.entry_required.filter((r) => entry[r.id] === undefined);
    for (const r of lacking) missing.push({ id: `entries.${i}.${r.id}`, label: `${i + 1}번째 항목: ${r.label}` });
    if (lacking.length > 0) return;
    const merged: Facts = { ...outer, ...entry };
    const counted = evalCondition(table.count_when, merged);
    if (counted === 'unknown') missing.push({ id: `entries.${i}.count_when`, label: `${i + 1}번째 항목: 직접 확인 필요` });
    else if (counted === 'yes') count += 1;
    for (const g of table.groups ?? []) {
      const r = evalCondition(g.when, merged);
      if (r === 'unknown') missing.push({ id: `entries.${i}.${g.id}`, label: `${i + 1}번째 항목: ${g.label} 직접 확인 필요` });
      else if (r === 'yes') groupCounts.set(g.id, (groupCounts.get(g.id) ?? 0) + 1);
    }
  });
  if (missing.length > 0) return { ...head, status: '요건 확인 필요', count: null, groups: null, conclusion: null, missing };
  const groups = (table.groups ?? []).map((g) => ({ id: g.id, label: g.label, count: groupCounts.get(g.id) ?? 0 }));
  const hit = table.result_rules.find((r) => countCompare(r.op, count, r.value));
  if (hit) return { ...head, status: '결론', count, groups, conclusion: { ruleId: hit.id, text: hit.conclusion, ...(hit.basis ? { basis: hit.basis } : {}) }, missing: [] };
  if (table.fallback) return { ...head, status: '결론', count, groups, conclusion: { ruleId: null, text: table.fallback }, missing: [] };
  return { ...head, status: '표에 없는 경우', count, groups, conclusion: null, missing: [] };
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** a의 규칙 가운데 b에도 같은 행(조건·결론이 같다. id·라벨은 무시)이 있는 규칙 id 목록 */
export function sharedRuleRows(a: ConclusionTable, b: ConclusionTable): string[] {
  const sig = (r: ConclusionTable['rules'][number]) => canonical({ when: r.when, conclusion: r.conclusion });
  const inB = new Set(b.rules.map(sig));
  return a.rules.filter((r) => inB.has(sig(r))).map((r) => r.id);
}

/** 상속 주택 수 판정표와 증여 주택 수 판정표는 다른 종류이고 같은 행을 나눠 쓰지 못한다 (FAM-05). 어기면 throw */
export function assertSeparateOrigins(inheritance: ConclusionTable, gift: ConclusionTable): void {
  if (inheritance.kind !== 'house_count_inheritance') throw new Error(`상속 판정표 종류가 아니다: ${inheritance.kind}`);
  if (gift.kind !== 'house_count_gift') throw new Error(`증여 판정표 종류가 아니다: ${gift.kind}`);
  const shared = sharedRuleRows(inheritance, gift);
  if (shared.length > 0) throw new Error(`상속과 증여 판정표가 같은 행을 나눠 쓴다: ${shared.join(', ')}`);
}
