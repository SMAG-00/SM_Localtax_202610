import { describe, expect, it } from 'vitest';
import {
  assertSeparateOrigins,
  evaluateConclusionTable,
  evaluateListCountTable,
  parseTableByKind,
  sharedRuleRows,
  ConclusionTableSchema,
  ListCountTableSchema,
  W11_DETERMINATION_KINDS,
  type ConclusionTable,
  type ListCountTable,
} from '../src/index';

// 이 파일은 이 저장소에서 새로 쓴 시험이다. 아래 판정표는 모두 '시험용' 지어낸 자료다 -
// 실제 요건·기간·날짜·세법 문장이 아니다. 날짜는 경계(전날·당일·다음 날)를 보기 위해 지어낸 값이다.
const CUTOFF = '2099-06-01'; // 시험용 기준일

const INHERIT = {
  kind: 'house_count_inheritance',
  version: '2099.01',
  label: '시험용 상속 후 주택 수 판정표',
  required: [
    { id: 'cause_date', label: '시험용 취득일' },
    { id: 'owns_existing', label: '시험용 기존 주택 보유' },
  ],
  rules: [
    { id: 'r_before', label: '시험용 기준일 이전', when: { op: 'all', conds: [{ op: 'eq', field: 'owns_existing', value: true }, { op: 'lt', field: 'cause_date', value: CUTOFF }] }, conclusion: '시험용 결론 상속-이전', basis: '시험용 근거 A' },
    { id: 'r_after', when: { op: 'all', conds: [{ op: 'eq', field: 'owns_existing', value: true }, { op: 'gte', field: 'cause_date', value: CUTOFF }] }, conclusion: '시험용 결론 상속-이후' },
    { id: 'r_shared_ptn', when: { op: 'eq', field: 'co_heir', value: true }, conclusion: '시험용 공동상속 결론' },
  ],
} satisfies ConclusionTable;

const GIFT = {
  kind: 'house_count_gift',
  version: '2099.01',
  label: '시험용 증여 후 주택 수 판정표',
  required: [{ id: 'cause_date', label: '시험용 취득일' }],
  rules: [{ id: 'g1', when: { op: 'gte', field: 'cause_date', value: CUTOFF }, conclusion: '시험용 결론 증여-이후' }],
  fallback: '시험용 결론 증여-기본',
} satisfies ConclusionTable;

const HOUSES = {
  kind: 'house_count',
  version: '2099.01',
  label: '시험용 주택 수 판정표',
  entry_required: [
    { id: 'item_kind', label: '시험용 종류' },
    { id: 'acquired_on', label: '시험용 취득일' },
  ],
  count_when: { op: 'all', conds: [{ op: 'in', field: 'item_kind', values: ['house', 'right'] }, { op: 'lte', field: 'acquired_on', value: CUTOFF }] },
  groups: [{ id: 'rights', label: '시험용 권리', when: { op: 'eq', field: 'item_kind', value: 'right' } }],
  result_rules: [
    { id: 'none', op: 'eq', value: 0, conclusion: '시험용 무주택' },
    { id: 'one', op: 'eq', value: 1, conclusion: '시험용 1주택' },
    { id: 'many', op: 'gte', value: 2, conclusion: '시험용 다주택' },
  ],
} satisfies ListCountTable;

describe('결론형 - 필수 사실 모름', () => {
  it('필수 사실(기존 주택 보유)을 모르면 결론 0, 빠진 항목만 알린다 - 기본 가정으로 채우지 않는다', () => {
    const out = evaluateConclusionTable(INHERIT, { cause_date: '2099-01-01' });
    expect(out.status).toBe('요건 확인 필요');
    expect(out.conclusion).toBeNull();
    expect(out.missing).toEqual([{ id: 'owns_existing', label: '시험용 기존 주택 보유' }]);
  });

  it('필수 사실이 모두 없으면 빠진 항목이 필수 목록 순서대로 전부 나온다', () => {
    expect(evaluateConclusionTable(INHERIT, {}).missing.map((m) => m.id)).toEqual(['cause_date', 'owns_existing']);
  });

  it('false·0·빈 글자는 "모름"이 아니라 답이다 (undefined만 모름)', () => {
    const out = evaluateConclusionTable(INHERIT, { cause_date: '2099-01-01', owns_existing: false, co_heir: false });
    expect(out.missing).toEqual([]);
    expect(out.status).toBe('표에 없는 경우');
  });
});

describe('결론형 - 경계와 규칙 순서', () => {
  it('기준일 전날은 이전 규칙, 당일은 이후 규칙', () => {
    const before = evaluateConclusionTable(INHERIT, { cause_date: '2099-05-31', owns_existing: true });
    const day = evaluateConclusionTable(INHERIT, { cause_date: CUTOFF, owns_existing: true });
    expect(before.conclusion).toEqual({ ruleId: 'r_before', text: '시험용 결론 상속-이전', basis: '시험용 근거 A' });
    expect(day.conclusion).toEqual({ ruleId: 'r_after', text: '시험용 결론 상속-이후' });
    expect(day.tableVersion).toBe('2099.01');
    expect(day.tableKind).toBe('house_count_inheritance');
  });

  it('맞는 규칙이 없고 fallback도 없으면 결론을 지어내지 않고 "표에 없는 경우"', () => {
    const out = evaluateConclusionTable(INHERIT, { cause_date: '2099-01-01', owns_existing: false, co_heir: false });
    expect(out).toMatchObject({ status: '표에 없는 경우', conclusion: null, missing: [] });
  });

  it('맞는 규칙이 없으면 fallback 결론(ruleId null)', () => {
    const out = evaluateConclusionTable(GIFT, { cause_date: '2099-05-31' });
    expect(out.conclusion).toEqual({ ruleId: null, text: '시험용 결론 증여-기본' });
  });

  it('앞 규칙이 선택 사실 없음(모름)이면 뒤 규칙으로 건너뛰지 않고 멈춘다', () => {
    // co_heir를 모르는 채로 r_shared_ptn까지 내려오면 결론을 내지 않고 그 칸을 빠진 항목으로 알린다
    const out = evaluateConclusionTable(INHERIT, { cause_date: '2099-01-01', owns_existing: false });
    expect(out.status).toBe('요건 확인 필요');
    expect(out.missing).toEqual([{ id: 'co_heir', label: 'co_heir' }]);
  });

  it('사람이 확인할 조건(manual)에서 멈추면 그 규칙 이름을 빠진 항목으로 알린다', () => {
    const t = ConclusionTableSchema.parse({ ...GIFT, kind: 'trust_taxpayer', rules: [{ id: 'needs_person', label: '시험용 사람 확인', when: { op: 'manual' }, conclusion: '시험용 X' }], fallback: undefined });
    const out = evaluateConclusionTable(t, { cause_date: '2099-01-01' });
    expect(out).toMatchObject({ status: '요건 확인 필요', conclusion: null, missing: [{ id: 'needs_person', label: '시험용 사람 확인' }] });
  });

  it('입력 객체를 바꾸지 않고, 같은 입력은 같은 결과', () => {
    const facts = Object.freeze({ cause_date: CUTOFF, owns_existing: true });
    expect(evaluateConclusionTable(INHERIT, facts)).toEqual(evaluateConclusionTable(INHERIT, facts));
  });
});

describe('목록 집계형 - 주택 수', () => {
  const item = (item_kind: string, acquired_on: string) => ({ item_kind, acquired_on });

  it('기준일 전날·당일은 세고 다음 날은 세지 않는다 (0개 → 1개 → 2개 경계)', () => {
    expect(evaluateListCountTable(HOUSES, [item('house', '2099-06-02')])).toMatchObject({ count: 0, conclusion: { ruleId: 'none', text: '시험용 무주택' } });
    expect(evaluateListCountTable(HOUSES, [item('house', CUTOFF)])).toMatchObject({ count: 1, conclusion: { ruleId: 'one' } });
    expect(evaluateListCountTable(HOUSES, [item('house', '2099-05-31'), item('right', CUTOFF)])).toMatchObject({ count: 2, conclusion: { ruleId: 'many' }, groups: [{ id: 'rights', count: 1 }] });
  });

  it('빈 목록([])은 "하나도 없음"이라는 답이라 개수 0 결론이고, 목록 자체를 모르면(undefined) 결론 0', () => {
    expect(evaluateListCountTable(HOUSES, [])).toMatchObject({ status: '결론', count: 0, conclusion: { ruleId: 'none' } });
    expect(evaluateListCountTable(HOUSES, undefined)).toEqual({
      kind: 'list_count', tableKind: 'house_count', tableVersion: '2099.01', status: '요건 확인 필요', count: null, groups: null, conclusion: null, missing: [{ id: 'entries', label: '보유 목록' }],
    });
  });

  it('항목 하나의 취득일을 모르면 일부만 센 값을 내지 않고 빠진 칸 위치를 알린다', () => {
    const out = evaluateListCountTable(HOUSES, [item('house', '2099-01-01'), { item_kind: 'house' }]);
    expect(out.count).toBeNull();
    expect(out.conclusion).toBeNull();
    expect(out.missing).toEqual([{ id: 'entries.1.acquired_on', label: '2번째 항목: 시험용 취득일' }]);
  });

  it('센 개수가 개수 규칙 어디에도 안 맞으면 "표에 없는 경우" (개수는 알려 준다)', () => {
    const t = ListCountTableSchema.parse({ ...HOUSES, result_rules: [{ id: 'only_one', op: 'eq', value: 1, conclusion: '시험용 1주택' }] });
    expect(evaluateListCountTable(t, [])).toMatchObject({ status: '표에 없는 경우', count: 0, conclusion: null });
  });
});

describe('상속·증여 판정표 분리 (FAM-05)', () => {
  it('서로 다른 행이면 통과한다', () => {
    expect(() => assertSeparateOrigins(INHERIT, GIFT)).not.toThrow();
    expect(sharedRuleRows(INHERIT, GIFT)).toEqual([]);
  });

  it('같은 행(조건과 결론이 같음)을 id만 바꿔 나눠 쓰면 실패한다', () => {
    const gift = { ...GIFT, rules: [...GIFT.rules, { id: 'copied', when: INHERIT.rules[1]!.when, conclusion: INHERIT.rules[1]!.conclusion }] };
    expect(sharedRuleRows(INHERIT, gift)).toEqual(['r_after']);
    expect(() => assertSeparateOrigins(INHERIT, gift)).toThrow(/r_after/);
  });

  it('종류를 바꿔 끼우면(증여 자리에 상속 표) 실패한다', () => {
    expect(() => assertSeparateOrigins(INHERIT, INHERIT)).toThrow(/증여 판정표 종류가 아니다/);
  });
});

describe('종류와 본문 모양', () => {
  it('W11 판정표 종류는 7종이고 주택 수만 목록 집계형', () => {
    expect([...W11_DETERMINATION_KINDS]).toEqual(['house_count', 'trust_taxpayer', 'redevelopment_right', 'house_count_inheritance', 'house_count_gift', 'redevelopment_tax', 'trust_acquisition']);
    expect(parseTableByKind('house_count', HOUSES).kind).toBe('house_count');
    for (const k of W11_DETERMINATION_KINDS.filter((x) => x !== 'house_count')) {
      expect(parseTableByKind(k, { ...GIFT, kind: k }).kind).toBe(k);
    }
  });

  it('종류 이름과 본문 종류가 다르면 거부한다', () => {
    expect(() => parseTableByKind('house_count_inheritance', GIFT)).toThrow(/다르다/);
    expect(() => parseTableByKind('house_count_gift', HOUSES)).toThrow();
    expect(() => parseTableByKind('house_count', GIFT)).toThrow();
    expect(() => parseTableByKind('unknown_kind', GIFT)).toThrow(/모르는 판정표 종류/);
  });

  it('id가 겹치거나 모르는 칸이 있으면 거부한다', () => {
    expect(() => ConclusionTableSchema.parse({ ...GIFT, rules: [GIFT.rules[0], GIFT.rules[0]] })).toThrow();
    expect(() => ConclusionTableSchema.parse({ ...GIFT, amount: 1 })).toThrow();
    expect(() => ListCountTableSchema.parse({ ...HOUSES, result_rules: [{ id: 'neg', op: 'eq', value: -1, conclusion: '시험용' }] })).toThrow();
  });
});
