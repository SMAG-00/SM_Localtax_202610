import { describe, expect, it } from "vitest";
import { extractRefs, paragraphsFromContent, renderChip } from "./evidence";
import { makeDoc } from "./flow-fixtures";
import { validateParagraphs, type ValidationContext } from "./validators";

const ctx: ValidationContext = { asOf: "2026-10-27", questionText: "시험용 질문", forbiddenPhrases: ["틀림없이", "감면 대상입니다", "투자하세요"], personNames: ["김의효"] };
const doc = makeDoc();
const OK = "시험용 요건을 확인하세요. 제3조 기준 금액은 12345원입니다.";
const v = (paras: Array<{ text: string; cited?: ReturnType<typeof makeDoc>[] }>, c = ctx) => validateParagraphs(paras.map((p) => ({ text: p.text, cited: p.cited ?? [doc] })), c);

describe("V1 인용", () => {
  it("인용 있는 문단은 통과", () => {
    const r = v([{ text: OK }]);
    expect(r.paragraphs).toHaveLength(1);
    expect(r.fallback).toBeNull();
    expect(Object.values(r.passes).every(Boolean)).toBe(true);
  });
  it("첫 문단(결론)에 인용이 없으면 막고 재생성", () => {
    const r = v([{ text: "시험용 결론 문장에 인용이 없습니다 정말로.", cited: [] }]);
    expect(r.paragraphs).toHaveLength(0);
    expect(r.needsRegeneration).toBe(true);
    expect(r.failures[0]!.code).toBe("V1");
  });
  it("뒤 문단의 인용 없는 진술은 그 문단만 제외", () => {
    const r = v([{ text: OK }, { text: "시험용 부연 설명인데 인용이 없습니다 그래서 제외.", cited: [] }]);
    expect(r.paragraphs).toHaveLength(1);
    expect(r.fallback).toBeNull();
    expect(r.passes.V1).toBe(false);
  });
});

describe("V2 조문·사건번호·스냅샷", () => {
  it("인용 메타에 없는 조문 번호가 있으면 막는다", () => {
    const r = v([{ text: "시험용 요건은 제9조에 있습니다 확인하세요." }]);
    expect(r.passes.V2).toBe(false);
    expect(r.paragraphs).toHaveLength(0);
  });
  it("사건번호가 인용 문서 경로에 있으면 통과, 다르면 차단", () => {
    const c = makeDoc({ sourceId: "200", sourceType: "case_decision", docType: "tribunal", path: "시험용심판원 2026지0895 > 요지" });
    expect(v([{ text: "시험용 결정 2026지0895 는 요건을 설명합니다.", cited: [c] }]).paragraphs).toHaveLength(1);
    expect(v([{ text: "시험용 결정 2026지0999 는 요건을 설명합니다.", cited: [c] }]).passes.V2).toBe(false);
  });
  it("스냅샷 없는 실시간 인용은 지워지고 문단이 막힌다", () => {
    const live = makeDoc({ sourceId: "snap:1", sourceType: "live_snapshot", isLive: true, snapshotId: null, snapshotOk: false, path: "실시간 조회 > 질의" });
    const r = v([{ text: "시험용 최신 원문 내용을 설명합니다 정말로.", cited: [live] }]);
    expect(r.passes.V2).toBe(false);
    expect(r.paragraphs).toHaveLength(0);
  });
  it("스냅샷과 해시가 맞는 실시간 인용은 통과하고 칩에 실시간·미검수 표시", () => {
    const live = makeDoc({ sourceId: "snap:7", sourceType: "live_snapshot", docType: "law", isLive: true, snapshotId: 7, snapshotOk: true, path: "실시간 조회 > 질의", fetchedAt: "2026-10-27T00:00:00Z" });
    const r = v([{ text: "시험용 최신 원문 내용을 설명합니다 정말로.", cited: [live] }]);
    expect(r.paragraphs).toHaveLength(1);
    expect(renderChip(live)).toMatchObject({ live: true, unreviewed: true, fetchedAt: "2026-10-27T00:00:00Z" });
  });
  it("조문 번호 추출 정규형", () => {
    expect(extractRefs("제 3 조의 2 와 제12조")).toEqual(["제3조의2", "제12조"]);
    expect(extractRefs("2023두12345 결정")).toEqual(["2023두12345"]);
    expect(extractRefs("2024년 5월 12345원 100개 200")).toEqual([]);
  });
});

describe("V3 숫자·국세 금액", () => {
  it("인용 원문에 없는 금액·세율은 막는다", () => {
    expect(v([{ text: "시험용 금액은 99999원입니다 확인하세요." }]).passes.V3).toBe(false);
    expect(v([{ text: "시험용 비율은 5% 입니다 확인하세요." }]).passes.V3).toBe(false);
  });
  it("계산 결과로 허용된 숫자는 통과 (W12-c 자리)", () => {
    expect(v([{ text: "시험용 금액은 777원입니다 확인하세요." }], { ...ctx, allowedNumbers: ["777"] }).paragraphs).toHaveLength(1);
  });
  it("국세 금액 문장은 재생성이 아니라 안내로 바꾼다", () => {
    const t = v([{ text: "시험용 양도세는 5000만원입니다 확인하세요." }]);
    expect(t.fallback).toBe("national_guide");
    expect(t.national).toBe("transfer");
    expect(t.needsRegeneration).toBe(false);
    const g = v([{ text: "시험용 증여세는 300원입니다 확인하세요." }]);
    expect(g.national).toBe("inherit_gift");
  });
  it("금액 없는 국세 언급은 통과 (안내 문장)", () => {
    expect(v([{ text: "시험용 양도세는 별도 메뉴에서 확인하세요 안내입니다." }]).passes.V3).toBe(true);
  });
});

describe("V4 기준일", () => {
  it("기준일에 시행 전·종료된 조문 인용은 표기가 없으면 막는다", () => {
    const future = makeDoc({ validFrom: "2027-01-01" });
    const ended = makeDoc({ validTo: "2026-01-01" });
    expect(v([{ text: OK, cited: [future] }]).passes.V4).toBe(false);
    expect(v([{ text: OK, cited: [ended] }]).passes.V4).toBe(false);
  });
  it("시행 예정·폐지 표기가 있으면 통과", () => {
    expect(v([{ text: "시험용 조문은 시행 예정입니다. 제3조 기준 12345원입니다.", cited: [makeDoc({ validFrom: "2027-01-01" })] }]).paragraphs).toHaveLength(1);
  });
});

describe("V5 금지 표현", () => {
  it("금지 낱말·감면 단정·투자 권유·사칭", () => {
    for (const t of ["시험용 안내입니다 틀림없이 됩니다 확인하세요.", "시험용 안내입니다 감면 대상입니다 확인하세요.", "시험용 안내입니다 투자하세요 확인하세요.", "시험용 안내입니다 비과세됩니다 확인하세요.", "김의효 입장에서 제가 말씀드립니다 확인하세요."]) {
      const r = v([{ text: t }]);
      expect(r.passes.V5, t).toBe(false);
      expect(r.paragraphs).toHaveLength(0);
    }
  });
});

describe("V6 개인정보", () => {
  it("다시 나온 전화번호는 가려서 통과", () => {
    const r = v([{ text: "시험용 문의는 010-1234-5678 로 확인하세요 정말로." }]);
    expect(r.passes.V6).toBe(false);
    expect(r.paragraphs[0]!.text).toContain("[전화번호]");
    expect(r.paragraphs[0]!.text).not.toMatch(/1234/);
  });
});

describe("칩·문단 구성", () => {
  it("칩의 번호·일자는 DB 메타에서 온다", () => {
    expect(renderChip(doc)).toMatchObject({ kind: "법", label: "법 시험용법 > 제3조(시험용 제목)", validFrom: "2020-01-01", live: false });
  });
  it("쟁점 지도 칩에 서명 버전·감수일", () => {
    const m = makeDoc({ sourceType: "issue_graph_version", docType: "issue_graph", mapVersion: "v1", reviewedOn: "2026-10-01" });
    expect(renderChip(m).mapNote).toBe("v1 · 감수 2026-10-01");
  });
  it("모델 응답의 인용은 문서 번호로 source_id에 대응된다", () => {
    const docs = [makeDoc({ sourceId: "100" }), makeDoc({ sourceId: "200", chunkId: 2 })];
    const content = [
      { type: "text", text: "첫 문단" },
      { type: "text", text: "\n\n둘째 문단", citations: [{ type: "char_location", document_index: 1, document_title: "200" }] },
    ] as never;
    const ps = paragraphsFromContent(content, docs);
    expect(ps).toHaveLength(2);
    expect(ps[0]!.cited.map((d) => d.sourceId)).toEqual([]);
    expect(ps[1]!.cited.map((d) => d.sourceId)).toEqual(["200"]);
  });
});
