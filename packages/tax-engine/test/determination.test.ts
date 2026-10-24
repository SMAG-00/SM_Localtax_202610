import { describe, expect, it } from 'vitest';
import { evaluateDeterminationTable, parseDeterminationTable, type DeterminationTable } from '../src/index';

// 이 파일은 이 저장소에서 새로 쓴 시험이다 (SM 복사본 아님).
// 아래 판정표는 모두 '시험용' 지어낸 자료다 - 실제 감면 요건·한도·기간·세법 문장이 아니다. 숫자와 날짜는 경계 동작을 보려고 임의로 정했다.
const LIMIT = 1000; // 시험용 한도
const REDUCTION = {
  kind: 'reduction',
  version: '2099.01',
  label: '시험용 감면 판정표',
  items: [
    {
      id: 'fixture_a',
      label: '시험용 감면 A',
      law: '시험용 근거',
      requirements: [
        { id: 'value_within_limit', label: '시험용 가액 한도 이하', check: { op: 'lte', field: 'value', value: LIMIT } },
        { id: 'count_is_one', label: '시험용 보유 수 1', check: { op: 'eq', field: 'count_after', value: 1 } },
        { id: 'kind_allowed', label: '시험용 종류 목록', check: { op: 'in', field: 'kind', values: ['type_x', 'type_y'] } },
        { id: 'owner_confirms', label: '시험용 사람이 확인할 요건', check: { op: 'manual' } },
      ],
    },
    {
      id: 'fixture_b',
      label: '시험용 감면 B',
      requirements: [{ id: 'any_of', label: '시험용 둘 중 하나', check: { op: 'any', conds: [{ op: 'gt', field: 'area', value: 50 }, { op: 'not', cond: { op: 'eq', field: 'flag', value: true } }] } }],
    },
  ],
} satisfies DeterminationTable;

const REFUND = {
  kind: 'refund',
  version: '2099.02',
  label: '시험용 환급 판정표',
  items: [
    {
      id: 'fixture_refund',
      label: '시험용 환급 유형',
      rules: [
        { id: 'before_deadline', when: { op: 'all', conds: [{ op: 'eq', field: 'paid_twice', value: true }, { op: 'lt', field: 'today', value: { field: 'deadline' } }] }, likelihood: '높음' },
        { id: 'on_deadline', when: { op: 'all', conds: [{ op: 'eq', field: 'paid_twice', value: true }, { op: 'eq', field: 'today', value: { field: 'deadline' } }] }, likelihood: '확인 필요' },
      ],
      default: '낮음',
    },
  ],
} satisfies DeterminationTable;

const base = { value: 500, count_after: 1, kind: 'type_x', area: 10, flag: true };
const verdictOf = (facts: Record<string, number | string | boolean | undefined>, id = 'fixture_a') => {
  const out = evaluateDeterminationTable(parseDeterminationTable(REDUCTION), facts);
  if (out.kind !== 'reduction') throw new Error('kind');
  return out.results.find((r) => r.id === id)!;
};

describe('감면 판정표 - 요건 하나만 경계를 넘는 입력에서 판정이 바뀐다 (CALC-13)', () => {
  it('한도 이하 -> 해당될 수 있음, 한도 + 1 -> 해당 안 됨 (경계 한도와 한도 + 1)', () => {
    expect(verdictOf({ ...base, value: LIMIT }).verdict).toBe('해당될 수 있음');
    const over = verdictOf({ ...base, value: LIMIT + 1 });
    expect(over.verdict).toBe('해당 안 됨');
    expect(over.requirements.find((r) => r.id === 'value_within_limit')!.state).toBe('입력으로 확인 안 됨');
    expect(over.requirements.find((r) => r.id === 'count_is_one')!.state).toBe('입력으로 확인');
  });

  it('보유 수 1 -> 2로 바꾸면 해당 안 됨 (다른 요건은 그대로)', () => {
    expect(verdictOf({ ...base, count_after: 1 }).verdict).toBe('해당될 수 있음');
    expect(verdictOf({ ...base, count_after: 2 }).verdict).toBe('해당 안 됨');
  });

  it('목록에 없는 종류는 해당 안 됨, 목록 안의 두 값은 모두 통과', () => {
    expect(verdictOf({ ...base, kind: 'type_z' }).verdict).toBe('해당 안 됨');
    expect(verdictOf({ ...base, kind: 'type_y' }).verdict).toBe('해당될 수 있음');
  });

  it('입력이 없는 요건과 사람이 확인할 요건은 직접 확인 필요이고, 그것만으로 해당 안 됨이 되지 않는다', () => {
    const r = verdictOf({ value: 500 });
    expect(r.verdict).toBe('해당될 수 있음');
    expect(r.requirements.map((x) => [x.id, x.state])).toEqual([
      ['value_within_limit', '입력으로 확인'],
      ['count_is_one', '직접 확인 필요'],
      ['kind_allowed', '직접 확인 필요'],
      ['owner_confirms', '직접 확인 필요'],
    ]);
  });

  it('all/any/not 조합 - 하나라도 거짓이면 거짓, 모름은 거짓이 아니다', () => {
    expect(verdictOf({ area: 51 }, 'fixture_b').verdict).toBe('해당될 수 있음');
    expect(verdictOf({ area: 10, flag: true }, 'fixture_b').verdict).toBe('해당 안 됨');
    expect(verdictOf({ area: 10, flag: false }, 'fixture_b').verdict).toBe('해당될 수 있음');
    expect(verdictOf({}, 'fixture_b').requirements[0]!.state).toBe('직접 확인 필요');
  });

  it('결과에 판정표 버전이 각인되고, 해당 건수는 판정 결과의 합과 같다', () => {
    const out = evaluateDeterminationTable(parseDeterminationTable(REDUCTION), { ...base, value: LIMIT + 1, area: 51 });
    expect(out.tableVersion).toBe('2099.01');
    expect(out.kind === 'reduction' && out.matchedCount).toBe(1);
  });

  it('순수 함수 - 같은 입력은 같은 결과이고 입력 객체를 바꾸지 않는다', () => {
    const facts = Object.freeze({ ...base });
    const table = parseDeterminationTable(REDUCTION);
    expect(evaluateDeterminationTable(table, facts)).toEqual(evaluateDeterminationTable(table, facts));
  });
});

describe('환급 판정표 - 처음 맞는 규칙의 가능성, 날짜는 기한 전날·당일·다음 날 경계 (CALC-04)', () => {
  const likelihood = (facts: Record<string, string | boolean>) => {
    const out = evaluateDeterminationTable(parseDeterminationTable(REFUND), facts);
    if (out.kind !== 'refund') throw new Error('kind');
    return out.results[0]!;
  };

  it('기한 전날 높음 -> 당일 확인 필요 -> 다음 날 낮음 (시험용 날짜)', () => {
    const f = { paid_twice: true, deadline: '2099-03-15' };
    expect(likelihood({ ...f, today: '2099-03-14' })).toMatchObject({ likelihood: '높음', ruleId: 'before_deadline' });
    expect(likelihood({ ...f, today: '2099-03-15' })).toMatchObject({ likelihood: '확인 필요', ruleId: 'on_deadline' });
    expect(likelihood({ ...f, today: '2099-03-16' })).toMatchObject({ likelihood: '낮음', ruleId: null });
  });

  it('조건에 쓸 입력이 없으면 규칙이 맞지 않아 기본값을 쓴다 (높음으로 올리지 않는다)', () => {
    expect(likelihood({ paid_twice: true }).likelihood).toBe('낮음');
    expect(likelihood({}).likelihood).toBe('낮음');
  });

  it('결과에 판정표 버전이 각인된다', () => {
    expect(evaluateDeterminationTable(parseDeterminationTable(REFUND), {}).tableVersion).toBe('2099.02');
  });
});

describe('판정표 검증 (zod) - 감수 입력이 틀리면 활성화 전에 걸린다', () => {
  const bad = (patch: (t: Record<string, unknown>) => void) => {
    const t = JSON.parse(JSON.stringify(REDUCTION)) as Record<string, unknown>;
    patch(t);
    return () => parseDeterminationTable(t);
  };

  it('정상 표는 통과한다', () => {
    expect(parseDeterminationTable(REDUCTION).items).toHaveLength(2);
    expect(parseDeterminationTable(REFUND).items).toHaveLength(1);
  });

  it('버전 모양·알 수 없는 종류·알 수 없는 연산·빈 항목·빈 요건·모르는 칸을 거부한다', () => {
    expect(bad((t) => (t.version = '2099-01'))).toThrow();
    expect(bad((t) => (t.kind = 'other'))).toThrow();
    expect(bad((t) => (t.items = []))).toThrow();
    expect(bad((t) => (((t.items as Record<string, unknown>[])[0]!.requirements as unknown[]) = []))).toThrow();
    expect(bad((t) => (((t.items as { requirements: { check: unknown }[] }[])[0]!.requirements[0]!.check) = { op: 'between', field: 'value', value: 1 }))).toThrow();
    expect(bad((t) => (t.unknown_field = 1))).toThrow();
    expect(bad((t) => (((t.items as { requirements: { check: unknown }[] }[])[0]!.requirements[0]!.check) = { op: 'lte', field: 'Value', value: 1 }))).toThrow();
  });

  it('항목 id·요건 id가 겹치면 거부한다', () => {
    expect(bad((t) => ((t.items as { id: string }[])[1]!.id = 'fixture_a'))).toThrow(/겹친다/);
    expect(bad((t) => ((t.items as { requirements: { id: string }[] }[])[0]!.requirements[1]!.id = 'value_within_limit'))).toThrow(/겹친다/);
  });
});
