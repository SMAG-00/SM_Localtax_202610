// 정정 결정 폼 시험 (NAV-06 · ART-05) — 이유 필수, 종류별 고친 내용(changes), 전후 버전 비교
import { describe, expect, test } from "vitest";
import type { StoredBody } from "@/lib/server/articles/content";
import { changedBlocks, correctionPayload, correctionRequestPayload, editableParagraphs, type CorrectionForm } from "./correction-form";

const BODY: StoredBody = {
  blocks: [
    { type: "key_summary", lines: ["징수액은 1,284억 원입니다."] },
    { type: "paragraph", text: "올해 1~6월 취득세 징수액은 1,284억 원이었다." },
    { type: "table", caption: "구별", rows: [["구", "억 원"]], chart: null },
    { type: "paragraph", text: "감면 확대 요인은 따로 보지 않았다." },
  ],
  claims: [{ id: "claim-1", text: "징수액은 1,284억 원", kind: "fact", evidenceIds: ["ev:1"], blockIndex: 1 }],
};
const original = { title: "가온시 취득세 18.4% 감소", summary: "요약", body: BODY };
const form = (over: Partial<CorrectionForm> = {}): CorrectionForm => ({
  kind: "correction",
  reason: "징수액 오기 정정 (1,284억 원 → 1,248억 원)",
  readerNotice: "",
  title: original.title,
  summary: original.summary,
  paragraphs: Object.fromEntries(editableParagraphs(BODY).map((p) => [p.index, p.text])),
  inquiryId: "",
  ...over,
});

describe("정정 결정 본문", () => {
  test("이유가 없으면 저장하지 않는다 — 이유 칸 오류 (NAV-06)", () => {
    const r = correctionPayload(form({ reason: "  " }), original);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["cor-reason"]).toMatch(/이유/);
  });

  test("정정 — 고친 문단만 바꾼 본문(핵심 주장 그대로)", () => {
    const r = correctionPayload(form({ paragraphs: { 1: "올해 1~6월 취득세 징수액은 1,248억 원이었다.", 3: BODY.blocks[3]!.type === "paragraph" ? (BODY.blocks[3] as { text: string }).text : "" } }), original);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.kind).toBe("correction");
    expect(r.body.reason).toBe("징수액 오기 정정 (1,284억 원 → 1,248억 원)");
    const changes = r.body.changes as { body: StoredBody; title?: string };
    expect(changes.title).toBeUndefined();
    expect(changes.body.blocks[1]).toEqual({ type: "paragraph", text: "올해 1~6월 취득세 징수액은 1,248억 원이었다." });
    expect(changes.body.blocks[0]).toEqual(BODY.blocks[0]);
    expect(changes.body.claims).toEqual(BODY.claims);
  });

  test("정정인데 고친 내용이 없으면 거부", () => {
    const r = correctionPayload(form(), original);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["cor-changes"]).toBeTruthy();
  });

  test("제목 변경 — 새 제목이 필요하고 changes.title만", () => {
    const same = correctionPayload(form({ kind: "title_change" }), original);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.errors["cor-title"]).toBeTruthy();
    const r = correctionPayload(form({ kind: "title_change", title: "가온시 취득세 18.4% 줄어" }), original);
    expect(r.ok && r.body.changes).toEqual({ title: "가온시 취득세 18.4% 줄어" });
  });

  test("반론·추후보도 — 고친 내용 없이도 기록만 된다", () => {
    const r = correctionPayload(form({ kind: "rebuttal", reason: "가온시 반론 게재" }), original);
    expect(r).toEqual({ ok: true, body: { kind: "rebuttal", reason: "가온시 반론 게재" } });
  });

  test("삭제 — 고친 내용을 보내지 않는다", () => {
    const r = correctionPayload(form({ kind: "deletion", reason: "법원 결정에 따른 삭제", title: "다른 제목" }), original);
    expect(r).toEqual({ ok: true, body: { kind: "deletion", reason: "법원 결정에 따른 삭제" } });
  });

  test("독자 표시 문구·정정 요청 번호는 있을 때만", () => {
    const r = correctionPayload(form({ kind: "follow_up", reason: "후속 보도", readerNotice: " 추후보도 2026-10-20 ", inquiryId: "12" }), original);
    expect(r).toEqual({ ok: true, body: { kind: "follow_up", reason: "후속 보도", readerNotice: "추후보도 2026-10-20", inquiryId: 12 } });
  });

  test("종류를 고르지 않으면 거부", () => {
    const r = correctionPayload(form({ kind: "" }), original);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["cor-kind"]).toBeTruthy();
  });
});

describe("정정 요청 (기자)", () => {
  test("무엇을 왜 고쳐야 하는지 필수", () => {
    expect(correctionRequestPayload(" ")).toEqual({ ok: false, error: "무엇을 왜 고쳐야 하는지 적어 주세요 (NAV-06)" });
    expect(correctionRequestPayload(" 1,284억은 1,248억의 오기 ")).toEqual({ ok: true, body: { reason: "1,284억은 1,248억의 오기" } });
  });
});

describe("전후 버전 비교", () => {
  test("글이 바뀐 블록만 — 번호·전·후", () => {
    const after: StoredBody = { ...BODY, blocks: BODY.blocks.map((b, i) => (i === 1 ? { type: "paragraph", text: "올해 1~6월 취득세 징수액은 1,248억 원이었다." } : b)) };
    expect(changedBlocks(BODY, after)).toEqual([
      { index: 1, before: "올해 1~6월 취득세 징수액은 1,284억 원이었다.", after: "올해 1~6월 취득세 징수액은 1,248억 원이었다." },
    ]);
  });

  test("블록이 늘거나 줄면 빈 쪽은 빈 글자", () => {
    const shorter: StoredBody = { blocks: BODY.blocks.slice(0, 3), claims: [] };
    expect(changedBlocks(BODY, shorter)).toEqual([{ index: 3, before: "감면 확대 요인은 따로 보지 않았다.", after: "" }]);
  });

  test("정정 폼에서 고칠 수 있는 것은 문단 블록 (다른 블록은 발행 뒤 수정으로)", () => {
    expect(editableParagraphs(BODY).map((p) => p.index)).toEqual([1, 3]);
  });
});
