import { describe, expect, it } from "vitest";
import {
  blockedDomainsErrors,
  diagramFromText,
  diagramToText,
  financeEnableErrors,
  legalReviewSettingErrors,
  parseCase,
  parseDiagram,
  parseIndicator,
  parseInterestItems,
  parseRegulation,
  parseSign,
  parseStructure,
  rebuttalWaitErrors,
} from "./finance-rules";

// 개발금융 입력 모양 검사 (W5) - 값은 모두 시험용 가짜다. 금지 표현 등 내용 검사는 DB 트리거 시험(w5-finance.test.mjs)이 본다.
const SRC = { provider: "시험 기관", source_url: "https://www.example.test/a", snapshot_id: 7 };

describe("구조도 글자 변환", () => {
  const d = diagramFromText("대체", "a=주체 가\nb=주체 나\n", "a>b:관계\nb>a");
  it("노드 줄 key=이름, 관계 줄 from>to:이름으로 읽고 되돌려 쓴다", () => {
    expect(d.nodes).toEqual([{ key: "a", label: "주체 가" }, { key: "b", label: "주체 나" }]);
    expect(d.edges).toEqual([{ from: "a", to: "b", label: "관계" }, { from: "b", to: "a", label: "" }]);
    expect(diagramToText(d)).toEqual({ nodes: "a=주체 가\nb=주체 나", edges: "a>b:관계\nb>a" });
  });
  it("관계 없음·대체 텍스트 없음·없는 노드·같은 노드끼리·노드 key 중복을 거부한다", () => {
    expect(parseDiagram({ ...d, edges: [] }).ok).toBe(false);
    expect(parseDiagram({ ...d, alt: " " }).ok).toBe(false);
    expect(parseDiagram({ ...d, edges: [{ from: "a", to: "zz", label: "" }] }).ok).toBe(false);
    expect(parseDiagram({ ...d, edges: [{ from: "a", to: "a", label: "" }] }).ok).toBe(false);
    expect(parseDiagram({ ...d, nodes: [d.nodes[0], d.nodes[0]] }).ok).toBe(false);
    expect(parseDiagram(d).ok).toBe(true);
  });
});

describe("parseStructure", () => {
  const base = { slug: "test-structure", structure_type: "trust", title: "시험 구조", summary: "한 줄", notes: ["문단"], lens_omit_reason: "사유" };
  it("정상 입력 - 빈 요약은 null, 구조도 없이 초안만도 된다", () => {
    const p = parseStructure({ ...base, summary: "" });
    expect(p.ok && p.value.summary).toBeNull();
    expect(p.ok && p.value.diagram).toBeNull();
  });
  it.each([
    ["slug 대문자", { slug: "Bad" }],
    ["구조 유형 밖", { structure_type: "stock" }],
    ["제목 빔", { title: " " }],
    ["빈 문단", { notes: ["가", " "] }],
    ["박스와 생략 사유 둘 다", { lens: { topics: [] }, lens_omit_reason: "사유" }],
    ["박스가 객체 아님", { lens: "x", lens_omit_reason: "" }],
  ])("거부 - %s", (_n, over) => {
    expect(parseStructure({ ...base, ...over }).ok).toBe(false);
  });
});

describe("parseIndicator / parseRegulation", () => {
  const ind = { indicator_key: "idx_a", label: "시험 지표", definition: "정의", value: "1.5", unit: "단위", as_of: "2026-09-30", collected_on: "2026-10-01", ...SRC };
  it("정상 입력 - 값은 숫자로", () => {
    const p = parseIndicator(ind);
    expect(p.ok && p.value.value).toBe(1.5);
  });
  it.each([
    ["값이 숫자 아님", { value: "많음" }],
    ["기준일 형식", { as_of: "2026/09/30" }],
    ["없는 날짜", { collected_on: "2026-02-30" }],
    ["원문 주소 http 아님", { source_url: "ftp://x" }],
    ["스냅샷 번호도 글자도 없음", { snapshot_id: "" }],
    ["제공기관 빔", { provider: "" }],
    ["정의 빔", { definition: "" }],
  ])("통계 거부 - %s", (_n, over) => {
    expect(parseIndicator({ ...ind, ...over }).ok).toBe(false);
  });
  it("원문 글자만 있어도 스냅샷 조건을 채운다", () => {
    expect(parseIndicator({ ...ind, snapshot_id: "", snapshot_payload: "시험 원문" }).ok).toBe(true);
  });
  const reg = { reg_key: "reg_a", title: "시험 규제", stage: "예정", effective_on: "2099-01-01", ...SRC };
  it("규제 - 시행 예정일 필수, 정상은 통과", () => {
    expect(parseRegulation(reg).ok).toBe(true);
    expect(parseRegulation({ ...reg, effective_on: "" }).ok).toBe(false);
    expect(parseRegulation({ ...reg, reg_key: "A" }).ok).toBe(false);
  });
});

describe("parseCase / parseInterestItems / parseSign", () => {
  it("사례 - 쟁점 문자열은 줄로 나누고 빈 줄은 뺀다, 요청일은 ISO로", () => {
    const p = parseCase({ article_id: 5, structure_type: "reit", issues: "가\n\n나", outcome: "", named_company: true, rebuttal_requested_at: "2026-10-01", rebuttal_method: "email", rebuttal_status: "answered" });
    expect(p.ok && p.value.issues).toEqual(["가", "나"]);
    expect(p.ok && p.value.named_company).toBe(true);
    expect(p.ok && p.value.rebuttal_requested_at).toBe("2026-10-01T00:00:00.000Z");
    expect(p.ok && p.value.outcome).toBeNull();
  });
  it.each([
    ["기사 번호 없음", { article_id: 0 }],
    ["구조 유형 밖", { structure_type: "x" }],
    ["쟁점 9개", { issues: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] }],
    ["요청 방법 밖", { rebuttal_method: "fax" }],
    ["답변 상태 밖", { rebuttal_status: "maybe" }],
  ])("사례 거부 - %s", (_n, over) => {
    expect(parseCase({ article_id: 5, structure_type: "trust", ...over }).ok).toBe(false);
  });
  it("소속 항목 - declared는 내용, none_confirmed는 확인자가 있어야 하고 항목 중복 0", () => {
    const ok = parseInterestItems({ article_id: 3, items: [{ item: "financial_company", state: "declared", interest_text: "시험" }, { item: "trust_company", state: "none_confirmed", confirmed_by: "필자" }] });
    expect(ok.ok).toBe(true);
    expect(parseInterestItems({ article_id: 3, items: [{ item: "financial_company", state: "declared", interest_text: " " }] }).ok).toBe(false);
    expect(parseInterestItems({ article_id: 3, items: [{ item: "trust_company", state: "none_confirmed", confirmed_by: "" }] }).ok).toBe(false);
    expect(parseInterestItems({ article_id: 3, items: [{ item: "union", state: "declared", interest_text: "x" }] }).ok).toBe(false);
    expect(parseInterestItems({ article_id: 3, items: [{ item: "trust_company", state: "declared", interest_text: "x" }, { item: "trust_company", state: "declared", interest_text: "y" }] }).ok).toBe(false);
  });
  it("서명 - 읽은 초안 시각이 없으면 거부", () => {
    expect(parseSign({ slug: "a-b", updated_at: "" }).ok).toBe(false);
    expect(parseSign({ slug: "a-b", updated_at: "2026-10-24T00:00:00Z" }).ok).toBe(true);
  });
});

describe("설정 규칙", () => {
  it("법률 검토 기록 - 빈 객체는 허용, 결론은 approved·rejected, 알 수 없는 칸 거부", () => {
    expect(legalReviewSettingErrors({})).toEqual([]);
    expect(legalReviewSettingErrors({ reviewer: "가", reviewed_on: "2026-10-01", conclusion: "approved" })).toEqual([]);
    expect(legalReviewSettingErrors({ reviewer: "가", reviewed_on: "2026-10-01", conclusion: "ok" }).length).toBeGreaterThan(0);
    expect(legalReviewSettingErrors({ reviewer: "가", reviewed_on: "2026-10-01", conclusion: "approved", x: 1 }).length).toBeGreaterThan(0);
    expect(legalReviewSettingErrors([]).length).toBeGreaterThan(0);
  });
  it("차단 도메인·대기 기간 범위", () => {
    expect(blockedDomainsErrors(["shop.example.test"])).toEqual([]);
    expect(blockedDomainsErrors(["Bad Domain"]).length).toBe(1);
    expect(blockedDomainsErrors(["a.example.test", "a.example.test"]).length).toBe(1);
    expect(rebuttalWaitErrors(7)).toEqual([]);
    expect(rebuttalWaitErrors(0).length).toBe(1);
    expect(rebuttalWaitErrors("7").length).toBe(1);
  });
  it("켜기 사전 검사 - approved 기록이 있을 때만 통과", () => {
    expect(financeEnableErrors({}).length).toBe(1);
    expect(financeEnableErrors({ reviewer: "가", reviewed_on: "2026-10-01", conclusion: "rejected" }).length).toBe(1);
    expect(financeEnableErrors({ reviewer: "가", reviewed_on: "2026-10-01", conclusion: "approved" })).toEqual([]);
  });
});
