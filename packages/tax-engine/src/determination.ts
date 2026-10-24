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

const base = {
  version: z.string().regex(/^\d{4}\.\d{2}$/, 'version은 YYYY.NN 형식이어야 한다'),
  /** 표 이름 - 시험용 자료에는 '시험용'이 들어간다 */
  label: text,
};

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

export const DeterminationTableSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('reduction'), ...base, items: z.array(reductionItemSchema).min(1).max(50) }).strict(),
    z.object({ kind: z.literal('refund'), ...base, items: z.array(refundItemSchema).min(1).max(50) }).strict(),
  ])
  .superRefine((t, ctx) => {
    if (!uniqueIds(t.items.map((i) => i.id))) ctx.addIssue({ code: 'custom', message: '항목 id가 겹친다' });
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
