// 기사 생산·제휴 준비 대시보드 화면 값 (NAV-13 · NAV-14 — docs/dev/W2-c_설계.md 8.5)
//  · 지표마다 분자·분모·제외 조건 글자(공식 정의는 규정 버전의 글자 그대로, 내부 정의는 이 모듈)
//  · 화면 글자에 '인정'·'예상 점수'·'예측'·'판정'·보장 문구 0 — 유사도는 '중복·표절 검토용 경고'
//  · 숫자 글자: 비율은 소수 한 자리 %, 분모 0은 '—', 기준·비교 글자
import { describe, expect, test } from "vitest";
import type { RequirementItem } from "@/lib/readiness/requirements";
import { monthWindow } from "@/lib/readiness/windows";
import * as view from "./readiness-view";
import {
  BANNED_WORDS,
  CAPACITY_GUIDANCE,
  INTERNAL_DEFINITIONS,
  INTERNAL_TABLES,
  READINESS_NOTICE,
  SIMILARITY_NOTICE,
  UNDETERMINED,
  comparisonText,
  criterionText,
  filterText,
  officialCell,
  quotaLines,
  ratioCell,
  windowLabel,
} from "./readiness-view";

const item = (over: Partial<RequirementItem>): RequirementItem => ({
  key: "k",
  label: "요건",
  metric: "ratio",
  numerator: { contentTypes: ["reported_news"] },
  denominator: {},
  numeratorText: "분자",
  denominatorText: "분모",
  exclusionsText: "없음",
  criterion: { comparator: "gte", value: 30, per: "period" },
  ...over,
});

/** 모듈이 내보내는 화면 글자를 모두 모은다 (깊이 들어가며) */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

describe("화면 글자 규칙 (NAV-14 '인정'·'예상 점수' 0 · 유사도는 검토용 경고)", () => {
  test("금지 낱말 목록 — 인정·예상 점수·예측·판정·선정 예정·제휴 확정·네이버 제휴 언론사", () => {
    expect([...BANNED_WORDS]).toEqual(["인정", "예상 점수", "예측", "판정", "선정 예정", "제휴 확정", "네이버 제휴 언론사"]);
  });
  test("이 모듈의 모든 고정 글자에 금지 낱말 0", () => {
    const all = strings(Object.entries(view).flatMap(([name, v]) => (name === "BANNED_WORDS" || typeof v === "function" ? [] : [v])));
    expect(all.length).toBeGreaterThan(40);
    for (const s of all) for (const w of BANNED_WORDS) expect(s.includes(w), `'${w}' in ${s}`).toBe(false);
  });
  test("유사도 안내는 '중복·표절 검토용 경고'이고 네이버 심사와 관계없음을 말한다", () => {
    expect(SIMILARITY_NOTICE).toContain("중복·표절 검토용 경고");
    expect(SIMILARITY_NOTICE).toContain("네이버 심사와 관계없는");
    expect(INTERNAL_DEFINITIONS.similarity.title).toContain("중복·표절 검토용 경고");
  });
  test("요건 미확정 · 내부 지표 안내 · 인력 보강·신청 연기 안내(NAV-13)", () => {
    expect(UNDETERMINED).toBe("요건 미확정");
    expect(READINESS_NOTICE).toMatch(/내부 준비 지표.*네이버 심사 점수가 아닙니다/);
    for (const part of ["인력", "보강", "신청을 미루", "비슷한 기사", "NAV-13"]) expect(CAPACITY_GUIDANCE).toContain(part);
  });
});

describe("내부 정의 — 지표마다 분자·분모·제외 조건", () => {
  test("모든 표의 모든 줄에 정의가 있고, 정의마다 분자·분모·제외 글자", () => {
    for (const t of INTERNAL_TABLES) {
      expect(t.rows.length).toBeGreaterThan(0);
      for (const r of t.rows) expect(INTERNAL_DEFINITIONS[r.definition], `${t.id}/${r.id}`).toBeDefined();
    }
    for (const [k, d] of Object.entries(INTERNAL_DEFINITIONS)) {
      for (const f of ["numerator", "denominator", "exclusions"] as const) expect(d[f].trim().length, `${k}.${f}`).toBeGreaterThan(0);
    }
  });
  test("자체 취재 후보 정의 — 보도만, 금주 핫뉴스·칼럼·광고 제외", () => {
    expect(INTERNAL_DEFINITIONS.own.numerator).toContain("보도");
    for (const w of ["금주 핫뉴스", "칼럼", "광고"]) expect(INTERNAL_DEFINITIONS.own.exclusions).toContain(w);
  });
  test("독자 반응은 사람만 — 봇·편집국 제외", () => {
    expect(INTERNAL_DEFINITIONS.reader.exclusions).toMatch(/봇·편집국/);
  });
});

describe("숫자 글자", () => {
  test("비율 칸 — 분자 / 분모 · 소수 한 자리 %, 분모 0은 —", () => {
    expect(ratioCell(4, 6)).toBe("4 / 6 · 66.7%");
    expect(ratioCell(1, 2)).toBe("1 / 2 · 50%");
    expect(ratioCell(0, 0)).toBe("0 / 0 · —");
    expect(ratioCell(1234, 2000)).toBe("1,234 / 2,000 · 61.7%");
  });
  test("공식 칸 — 비율·기사 수·기자 1인당", () => {
    expect(officialCell(item({ metric: "ratio" }), { numerator: 1, denominator: 3, value: 1 / 3 })).toBe("1 / 3 · 33.3%");
    expect(officialCell(item({ metric: "count" }), { numerator: 5, denominator: null, value: 5 })).toBe("5");
    expect(officialCell(item({ metric: "per_reporter" }), { numerator: 3, denominator: 2, value: 1.5 })).toBe("3 / 2명 · 1인당 1.5");
    expect(officialCell(item({ metric: "per_reporter" }), { numerator: 0, denominator: 0, value: null })).toBe("0 / 0명 · —");
  });
  test("기준 글자 — 이상·초과·월평균·1인당, 기준 없음", () => {
    expect(criterionText(item({}))).toBe("30% 이상");
    expect(criterionText(item({ criterion: { comparator: "gt", value: 30, per: "period" } }))).toBe("30% 초과");
    expect(criterionText(item({ metric: "count", criterion: { comparator: "gte", value: 40, per: "month" } }))).toBe("월평균 40건 이상");
    expect(criterionText(item({ metric: "count", criterion: { comparator: "gte", value: 120, per: "period" } }))).toBe("심사 기간 120건 이상");
    expect(criterionText(item({ metric: "per_reporter", criterion: { comparator: "gte", value: 5, per: "month" } }))).toBe("기자 1인당 월평균 5건 이상");
    expect(criterionText(item({ criterion: null }))).toBe("기준 없음 (숫자만 봅니다)");
  });
  test("비교 글자 — 충족·미달(값과 함께)·기준 없음", () => {
    expect(comparisonText(item({}), { kind: "met", compared: 50 })).toBe("충족 (50%)");
    expect(comparisonText(item({ metric: "count", criterion: { comparator: "gte", value: 2, per: "month" } }), { kind: "short", compared: 5 / 3 })).toBe("미달 (월평균 1.7건)");
    expect(comparisonText(item({}), { kind: "short", compared: null })).toBe("미달 (기사 없음)");
    expect(comparisonText(item({ criterion: null }), { kind: "none" })).toBe("—");
  });
  test("거르개 글자 — 고른 값 이름, 비우면 모든 공개 기사", () => {
    expect(filterText({})).toBe("모든 공개 기사 (이관 기사 제외)");
    expect(filterText({ contentTypes: ["reported_news", "explainer"], reportingMethods: ["quantitative"], assignmentKinds: ["feature", "investigative"], includeLegacy: true })).toBe(
      "유형 보도·해설 · 취재 방식 정량형 · 기획 종류 기획·탐사 · 이관 기사 포함",
    );
  });
  test("기간 글자 — 달 수와 한국 날짜", () => {
    expect(windowLabel(monthWindow(3, "closed_months", Date.parse("2026-10-18T03:00:00Z")))).toEqual({ title: "3개월", range: "2026-07-01 ~ 2026-09-30" });
  });
});

describe("기사 할당량 줄 (NAV-09 · NAV-13 '확정 버전이 없으면 기사 할당량이 요건 미확정')", () => {
  const row = { id: 1, version: 2 } as never;
  const reviewPeriod = { months: 3, basis: "closed_months" as const, text: "임의의 3개월" };
  test("확정 버전이 없으면 요건 미확정과 이유 — 할당량 숫자 0", () => {
    expect(quotaLines([{ platform: "naver", state: { kind: "none", reason: "등록된 규정 버전이 없습니다" } }])).toEqual([
      { platform: "naver", confirmed: false, text: "요건 미확정 — 등록된 규정 버전이 없습니다" },
    ]);
  });
  test("확정 버전이면 기사 수·기자 1인당 기준만 할당량으로 (비율은 할당량이 아니다), 없으면 그렇다고", () => {
    const items = [
      item({ key: "own", metric: "ratio" }),
      item({ key: "monthly", label: "월 발행량", metric: "count", criterion: { comparator: "gte", value: 40, per: "month" } }),
      item({ key: "per", label: "기자 1인당", metric: "per_reporter", criterion: { comparator: "gt", value: 5, per: "month" } }),
      item({ key: "free", label: "기획 기사", metric: "count", criterion: null }),
    ];
    expect(quotaLines([{ platform: "naver", state: { kind: "confirmed", row, items, reviewPeriod, drafts: 0 } }])).toEqual([
      { platform: "naver", confirmed: true, text: "규정 2번 — 월 발행량: 월평균 40건 이상 · 기자 1인당: 기자 1인당 월평균 5건 초과" },
    ]);
    expect(quotaLines([{ platform: "kakao", state: { kind: "confirmed", row, items: [items[0]!], reviewPeriod, drafts: 0 } }])).toEqual([
      { platform: "kakao", confirmed: true, text: "규정 2번 — 기사 수 기준이 없습니다" },
    ]);
  });
});
