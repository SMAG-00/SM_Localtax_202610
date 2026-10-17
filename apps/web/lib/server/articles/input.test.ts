// 요청 본문 검사 시험 — 기사 입력(input.ts)·본문 블록과 JSON 칸(content.ts)·출처·근거(records-input.ts)
import { describe, expect, test } from "vitest";
import { EMPTY_CHECKLISTS, parseBodyInput, parseChecklistsInput, readChecklists, readStoredBody, withChecklists } from "./content";
import { parseArticleInput } from "./input";
import { parseEvidenceInput, parseSourceInput } from "./records-input";

const errorsOf = (r: { ok: boolean; errors?: string[] }) => (r.ok ? [] : (r as { errors: string[] }).errors);

describe("기사 입력", () => {
  test("작성에는 slug·title·section·contentType이 필요하다", () => {
    expect(errorsOf(parseArticleInput({}, "create"))).toEqual([
      "slug: 필요합니다",
      "title: 필요합니다",
      "section: 필요합니다 (tax·realestate·finance·local)",
      "contentType: 필요합니다 (reported_news·explainer·guide·opinion·sponsored·digest)",
    ]);
  });
  test("모르는 칸·값 목록 밖·수정 전용 칸(작성 때)은 거부", () => {
    const errors = errorsOf(parseArticleInput({ slug: "a", title: "t", section: "tax", contentType: "news", roles: ["editor"], updateKind: "typo" }, "create"));
    expect(errors).toEqual(expect.arrayContaining(["roles: 모르는 칸입니다", "updateKind: 모르는 칸입니다", expect.stringMatching(/^contentType: /)]));
  });
  test("slug 공백·'/' 거부, 날짜 형식 검사", () => {
    const errors = errorsOf(parseArticleInput({ slug: "a b", legalBasisDate: "2026-02-30" }, "patch"));
    expect(errors).toEqual(["slug: 공백·'/' 없이 써야 합니다", "legalBasisDate: YYYY-MM-DD 날짜여야 합니다"]);
  });
  test("수정 입력은 보낸 칸만 담는다", () => {
    const r = parseArticleInput({ title: "새 제목", updateKind: "typo", reason: "오탈자", expectedVersion: 3 }, "patch");
    expect(r).toEqual({ ok: true, value: { title: "새 제목", updateKind: "typo", reason: "오탈자", expectedVersion: 3 } });
  });
});

describe("본문 블록", () => {
  test("블록 종류별 필수 칸과 근거 참조 형식", () => {
    const r = parseBodyInput({
      blocks: [{ type: "paragraph" }, { type: "quote", text: "말", origin: "interview", refId: "123" }, { type: "banner" }],
      claims: [{ id: "c1", text: "주장", kind: "fact", evidenceIds: ["src:1", "x"], blockIndex: 9 }],
    });
    expect(errorsOf(r)).toEqual([
      "body.blocks[0].text: 글자가 필요합니다",
      "body.blocks[1].refId: 근거 참조(src:<번호> 또는 ev:<번호>)여야 합니다",
      "body.blocks[2].type: paragraph·table·image·quote·callout·infographic·video·faq·key_summary 중 하나여야 합니다",
      "body.claims[0].evidenceIds: 근거 참조 형식이 아닙니다 (x)",
      "body.claims[0].blockIndex: 본문 블록 번호여야 합니다",
    ]);
  });
  test("이미지 블록의 권리 상태는 저장하지 않는다", () => {
    const r = parseBodyInput({ blocks: [{ type: "image", mediaId: 12, alt: "사진", caption: "", rightsStatus: "confirmed" }] });
    expect(r).toEqual({ ok: true, value: { blocks: [{ type: "image", mediaId: "12", alt: "사진", caption: "" }], claims: [] } });
  });
  test("DB 본문 읽기 — 블록 배열도 받고, 모양이 틀린 블록은 뺀다", () => {
    expect(readStoredBody([{ type: "paragraph", text: "가" }, { type: "paragraph" }])).toEqual({ blocks: [{ type: "paragraph", text: "가" }], claims: [] });
    expect(readStoredBody(null)).toEqual({ blocks: [], claims: [] });
  });
});

describe("확인 목록 (check_log.checklists)", () => {
  test("보낸 칸만 덮어쓰고, 관점 기록은 ev: 참조만", () => {
    const base = { ...EMPTY_CHECKLISTS, isTaxIssue: true };
    const r = parseChecklistsInput({ quantitative: { relatedPartyCheck: "전화 확인" }, perspectives: { experts: { status: "interviewed", evidenceId: "ev:4", contactedAt: "2026-10-08" } } }, base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.isTaxIssue).toBe(true);
    expect(r.value.quantitative).toEqual({ sourceCrossCheck: null, limitations: null, relatedPartyCheck: "전화 확인" });
    expect(r.value.perspectives.experts).toEqual({ status: "interviewed", evidenceId: "ev:4", contactedAt: "2026-10-08" });
    expect(errorsOf(parseChecklistsInput({ perspectives: { local_gov: { status: "interviewed", evidenceId: "src:4" } } }, base))).toEqual([
      "checklists.perspectives.local_gov.evidenceId: 근거 참조(ev:<번호>)여야 합니다",
    ]);
  });
  test("check_log의 다른 칸(발행 기록)은 그대로 두고 확인 목록만 바꾼다", () => {
    const log = withChecklists({ publish: { at: "x" } }, { ...EMPTY_CHECKLISTS, isLocalPolicyIssue: true });
    expect(log.publish).toEqual({ at: "x" });
    expect(readChecklists(log).isLocalPolicyIssue).toBe(true);
    expect(readChecklists(null)).toEqual(EMPTY_CHECKLISTS);
  });
});

describe("출처·근거 입력", () => {
  test("출처 — 종류 필수, camelCase → DB 칸, 스냅샷 글", () => {
    const r = parseSourceInput({ kind: "press_release", url: "https://x.example/p", sourceName: "가온시", snapshot: { text: "보도자료 원문" } });
    expect(r).toEqual({ ok: true, value: { columns: { kind: "press_release", source_url: "https://x.example/p", source_name: "가온시" }, snapshot: { text: "보도자료 원문", url: null, source: null } } });
    expect(errorsOf(parseSourceInput({ kind: "blog" }))).toEqual(["source.kind: official_doc·dataset·press_release·interview·field·photo·other 중 하나여야 합니다"]);
  });
  test("근거 — 유형 6종, 인터뷰 기록은 interview 유형에만, 연락처 칸은 없다", () => {
    expect(errorsOf(parseEvidenceInput({ evidenceType: "rumor", location: "x" }, "create"))).toEqual([
      "evidence.evidenceType: dataset·document·interview·field·photo·calculation 중 하나여야 합니다",
    ]);
    expect(errorsOf(parseEvidenceInput({ evidenceType: "dataset", location: "x", interview: { subjectRole: "관계자" } }, "create"))).toEqual([
      "evidence.interview: 근거 유형이 interview일 때만 씁니다",
    ]);
    expect(errorsOf(parseEvidenceInput({ evidenceType: "interview", location: "x", interview: { subjectRole: "관계자", quoteConsent: "full", anonymity: "named", phone: "010" } }, "create"))).toEqual([
      "evidence.interview.phone: 모르는 칸입니다",
    ]);
  });
});
