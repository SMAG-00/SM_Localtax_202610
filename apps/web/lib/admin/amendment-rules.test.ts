import { describe, expect, it } from "vitest";
import { isHttpUrl, isRealDate, parseCorrect, parseCreate, parseEvent, parseLink } from "./amendment-rules";

const evidence = { occurredOn: "2026-08-01", sourceUrl: "https://example.test/doc", snapshotPayload: "시험용 가짜 원문" };

describe("개정 트래커 입력 검사", () => {
  it("개정안 만들기 — slug 형식과 제목", () => {
    expect(parseCreate({ slug: "sample-1", title: " 시험용 ", lawNames: [" 가 ", ""] })).toEqual({ ok: true, value: { slug: "sample-1", title: "시험용", lawNames: ["가"], summary: null } });
    const bad = parseCreate({ slug: "Bad Slug", title: " " });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.split(":")[0])).toEqual(["slug", "title"]);
  });

  it("단계 기록 — 날짜·원문 URL·스냅샷이 모두 있어야 한다", () => {
    expect(parseEvent({ amendmentId: 3, stage: "pre_notice", ...evidence }).ok).toBe(true);
    for (const missing of ["occurredOn", "sourceUrl", "snapshotPayload"] as const) {
      const r = parseEvent({ amendmentId: 3, stage: "pre_notice", ...evidence, [missing]: "" });
      expect(r.ok).toBe(false);
    }
    expect(parseEvent({ amendmentId: 3, stage: "pre_notice", ...evidence, snapshotId: 5 }).ok).toBe(false); // 번호와 글자 동시 입력 거부
    expect(parseEvent({ amendmentId: 3, stage: "bogus", ...evidence }).ok).toBe(false);
    expect(parseEvent({ amendmentId: 0, stage: "announced", ...evidence }).ok).toBe(false);
  });

  it("해당 없음 — 사유 필수, 증빙은 받지 않는다", () => {
    expect(parseEvent({ amendmentId: 1, stage: "passed", skipped: true }).ok).toBe(false);
    const r = parseEvent({ amendmentId: 1, stage: "passed", skipped: true, skipReason: "시험용 사유" });
    expect(r).toMatchObject({ ok: true, value: { skipped: true, skipReason: "시험용 사유", evidence: null } });
  });

  it("정정 — 사유와 정정할 기록 번호가 필수", () => {
    const base = { amendmentId: 3, stage: "submitted", ...evidence };
    expect(parseCorrect({ ...base, correctionOf: 9, reason: "시험용" }).ok).toBe(true);
    expect(parseCorrect({ ...base, correctionOf: 9, reason: "  " }).ok).toBe(false);
    expect(parseCorrect({ ...base, reason: "시험용" }).ok).toBe(false);
  });

  it("기사 연결 — 양쪽 번호가 양의 정수", () => {
    expect(parseLink({ articleId: "12", amendmentId: 4 })).toEqual({ ok: true, value: { articleId: 12, amendmentId: 4 } });
    expect(parseLink({ articleId: -1, amendmentId: 4 }).ok).toBe(false);
    expect(parseLink({ articleId: 1.5, amendmentId: "x" }).ok).toBe(false);
  });

  it("날짜·주소 경계", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2026-2-1")).toBe(false);
    expect(isHttpUrl("https://a.test/x")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://a.test")).toBe(false);
  });
});
