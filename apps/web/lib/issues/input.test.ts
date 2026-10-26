import { describe, expect, it } from "vitest";
import { parseCaseTagApply, parseGraphDraft, parseGraphSign, parseId, parseTagPropose } from "./input";

const base = { slug: "test-issue", hub: "trust", title: "시험용 쟁점", nodes: [{ node_id: "n1", kind: "law_article", ref_id: 11 }, { node_id: "n2", kind: "law_article", ref_id: 12 }, { node_id: "n3", kind: "case", ref_id: 5 }] };

describe("쟁점 지도 초안 입력", () => {
  it("올바른 초안은 통과하고 문자열로 붙여 넣은 JSON도 받는다", () => {
    const r = parseGraphDraft({ ...base, nodes: JSON.stringify(base.nodes), edges: JSON.stringify([{ from: "n1", to: "n2", relation: "delegation", note: "시험용" }, { from: "n1", to: "n3", relation: "precedent" }]) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.edges).toHaveLength(2);
      expect(r.value.nodes[2]).toEqual({ node_id: "n3", kind: "case", ref_id: 5 });
    }
  });

  it("노드에 법령명 같은 칸이 있으면 거부한다 (번호만 저장)", () => {
    const r = parseGraphDraft({ ...base, nodes: [{ node_id: "n1", kind: "law_article", ref_id: 1, law_name: "시험용 법" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/node_id·kind·ref_id만/);
  });

  it("관계 라벨 4종 밖·없는 노드·자기 연결·짝 규칙 위반·중복 연결선을 거부한다", () => {
    const ok = (e: unknown) => parseGraphDraft({ ...base, edges: [e] }).ok;
    expect(ok({ from: "n1", to: "n2", relation: "cites" })).toBe(false);
    expect(ok({ from: "n1", to: "n9", relation: "delegation" })).toBe(false);
    expect(ok({ from: "n1", to: "n1", relation: "delegation" })).toBe(false);
    expect(ok({ from: "n1", to: "n2", relation: "precedent" })).toBe(false);
    expect(ok({ from: "n1", to: "n3", relation: "delegation" })).toBe(false);
    expect(ok({ from: "n1", to: "n2", relation: "requirement" })).toBe(true);
    expect(ok({ from: "n1", to: "n3", relation: "precedent" })).toBe(true);
    expect(parseGraphDraft({ ...base, edges: [{ from: "n1", to: "n2", relation: "mutatis" }, { from: "n1", to: "n2", relation: "mutatis" }] }).ok).toBe(false);
  });

  it("slug cases 예약·잘못된 날짜·200자 넘는 note·틀린 JSON을 거부한다", () => {
    expect(parseGraphDraft({ ...base, slug: "cases" }).ok).toBe(false);
    expect(parseGraphDraft({ ...base, as_of: "2026-02-30" }).ok).toBe(false);
    expect(parseGraphDraft({ ...base, edges: [{ from: "n1", to: "n2", relation: "delegation", note: "가".repeat(201) }] }).ok).toBe(false);
    expect(parseGraphDraft({ ...base, nodes: "{틀림" }).ok).toBe(false);
  });

  it("개인정보로 보이는 글자(전화번호)가 제목에 있으면 거부한다", () => {
    expect(parseGraphDraft({ ...base, title: "시험용 010-1234-5678" }).ok).toBe(false);
  });
});

describe("서명·태그 입력", () => {
  it("서명은 번호와 감수 시트 위치가 모두 있어야 한다", () => {
    expect(parseGraphSign({ id: 3, sheet_ref: "시험용 시트" }).ok).toBe(true);
    expect(parseGraphSign({ id: 0, sheet_ref: "시험용" }).ok).toBe(false);
    expect(parseGraphSign({ id: 3, sheet_ref: "" }).ok).toBe(false);
    expect(parseId({ id: "7" }, "쟁점 지도 버전")).toEqual({ ok: true, value: { id: 7 } });
    expect(parseId({ id: "7a" }, "쟁점 지도 버전").ok).toBe(false);
  });

  it("태그 제안 - 키 모양·허브 값·동의어 20개 제한·중복 제거", () => {
    const r = parseTagPropose({ tag_key: "test_tag", label: "시험용", hub: "trust", synonyms: "가, 가, 나" });
    expect(r.ok && r.value.synonyms).toEqual(["가", "나"]);
    expect(parseTagPropose({ tag_key: "Test", label: "시험용", hub: "trust" }).ok).toBe(false);
    expect(parseTagPropose({ tag_key: "test_tag", label: "시험용", hub: "tax" }).ok).toBe(false);
    expect(parseTagPropose({ tag_key: "test_tag", label: "시험용", hub: "local_tax", synonyms: Array.from({ length: 21 }, (_, i) => `동${i}`) }).ok).toBe(false);
  });

  it("결정례 태그 붙이기는 두 번호가 모두 있어야 한다", () => {
    expect(parseCaseTagApply({ case_id: "4", issue_tag_id: 2 })).toEqual({ ok: true, value: { caseId: 4, issueTagId: 2 } });
    expect(parseCaseTagApply({ case_id: 4 }).ok).toBe(false);
  });
});
