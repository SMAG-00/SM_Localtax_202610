// 홈 배치 규칙 (HOME-03) — 같은 날 상한(스토리 6·트래커 3)·기간·입력 검사. DB 트리거와 같은 셈인지 경계값으로 본다
import { describe, expect, test } from "vitest";
import {
  capacityError,
  curationFormToBody,
  curationStatus,
  duplicateTargetError,
  fullToday,
  nextSort,
  parseCurationInput,
  parseCurationOrder,
  peakCount,
  periodErrors,
} from "./home-curation-rules";

const TODAY = "2026-10-18";
let seq = 0;
const card = (starts_on: string, ends_on: string | null = null, targetId = ++seq) => ({ id: ++seq, starts_on, ends_on, targetId });

describe("상태 — 한국 날짜, 종료일 당일까지 노출", () => {
  test.each([
    [{ starts_on: TODAY, ends_on: TODAY }, "active"],
    [{ starts_on: "2026-10-01", ends_on: "2026-10-17" }, "expired"],
    [{ starts_on: "2026-10-19", ends_on: null }, "upcoming"],
    [{ starts_on: "2026-01-01", ends_on: null }, "active"],
  ] as const)("%j → %s", (c, status) => expect(curationStatus(c, TODAY)).toBe(status));
});

describe("같은 날 보이는 카드 수 (DB 트리거와 같은 셈)", () => {
  const six = Array.from({ length: 6 }, () => card("2026-11-01", "2026-11-30"));

  test("스토리 6장까지는 괜찮고 7장째는 거부 — 거부 문장에 날짜와 장 수", () => {
    expect(capacityError("story", six.slice(0, 5), { starts_on: "2026-11-01", ends_on: "2026-11-30" })).toBeNull();
    const err = capacityError("story", six, { starts_on: "2026-11-15", ends_on: "2026-12-15" });
    expect(err).toMatch(/같은 날 6장까지/);
    expect(err).toMatch(/2026-11-15에 7장째/);
  });

  test("끝난 다음 날 시작하면 7번째 행이어도 괜찮고, 하루라도 겹치면 거부", () => {
    expect(capacityError("story", six, { starts_on: "2026-12-01", ends_on: null })).toBeNull();
    expect(capacityError("story", six, { starts_on: "2026-11-30", ends_on: "2026-12-05" })).not.toBeNull();
  });

  test("새 카드 시작일이 아니라 기간 중간의 겹침 최대값을 찾는다", () => {
    const rows = [...Array.from({ length: 3 }, () => card("2026-11-01", "2026-11-10")), ...Array.from({ length: 3 }, () => card("2026-11-05", "2026-11-20"))];
    expect(peakCount(rows, { starts_on: "2026-10-25", ends_on: "2026-11-06" })).toEqual({ count: 7, day: "2026-11-05" });
    expect(capacityError("story", rows, { starts_on: "2026-11-11", ends_on: "2026-11-30" })).toBeNull();
  });

  test("기간을 고칠 때는 자기 자신을 세지 않는다", () => {
    expect(capacityError("story", six, { starts_on: "2026-11-01", ends_on: "2026-11-30" }, six[0]!.id)).toBeNull();
  });

  test("트래커 하이라이트는 3장까지 — 4장째 거부", () => {
    const three = Array.from({ length: 3 }, () => card("2026-10-01"));
    expect(capacityError("tracker", three.slice(0, 2), { starts_on: TODAY, ends_on: null })).toBeNull();
    expect(capacityError("tracker", three, { starts_on: TODAY, ends_on: TODAY })).toMatch(/3장까지/);
  });

  test("같은 대상을 겹치는 기간에 두 번 — 거부, 겹치지 않으면 괜찮다", () => {
    const rows = [{ id: 1, targetId: 9, starts_on: "2026-11-01", ends_on: "2026-11-10" }];
    expect(duplicateTargetError(rows, 9, { starts_on: "2026-11-10", ends_on: null })).not.toBeNull();
    expect(duplicateTargetError(rows, 9, { starts_on: "2026-11-11", ends_on: null })).toBeNull();
    expect(duplicateTargetError(rows, 8, { starts_on: "2026-11-01", ends_on: null })).toBeNull();
    expect(duplicateTargetError(rows, 9, { starts_on: "2026-11-01", ends_on: null }, 1)).toBeNull();
  });
});

describe("기간 검사", () => {
  test("종료일이 시작일보다 앞이면 거부, 같은 날은 괜찮다", () => {
    expect(periodErrors({ starts_on: "2026-11-02", ends_on: "2026-11-01" }, TODAY)).toHaveLength(1);
    expect(periodErrors({ starts_on: "2026-11-01", ends_on: "2026-11-01" }, TODAY)).toEqual([]);
  });
  test("종료일이 오늘보다 앞이면 거부(이미 끝난 카드), 오늘이면 괜찮다", () => {
    expect(periodErrors({ starts_on: "2026-10-01", ends_on: "2026-10-17" }, TODAY)[0]).toMatch(/오늘\(2026-10-18\)보다 앞/);
    expect(periodErrors({ starts_on: "2026-10-01", ends_on: TODAY }, TODAY)).toEqual([]);
  });
});

describe("API 본문 검사", () => {
  test("더하기 — 종류·대상·시작일, 종료일은 비우면 끝 없음", () => {
    expect(parseCurationInput({ kind: "story", targetId: 12, startsOn: TODAY }, "create", TODAY)).toEqual({ ok: true, value: { kind: "story", targetId: 12, starts_on: TODAY, ends_on: null } });
    expect(parseCurationInput({ kind: "tracker", targetId: 3, startsOn: TODAY, endsOn: "2026-12-31", sort: 30 }, "create", TODAY)).toEqual({
      ok: true,
      value: { kind: "tracker", targetId: 3, starts_on: TODAY, ends_on: "2026-12-31", sort: 30 },
    });
  });

  test.each([
    [{ kind: "banner", targetId: 1, startsOn: TODAY }, /tracker·story/],
    [{ kind: "story", startsOn: TODAY }, /대상 번호/],
    [{ kind: "story", targetId: 0, startsOn: TODAY }, /대상 번호/],
    [{ kind: "story", targetId: 1 }, /시작일이 필요/],
    [{ kind: "story", targetId: 1, startsOn: "2026-13-01" }, /YYYY-MM-DD/],
    [{ kind: "story", targetId: 1, startsOn: TODAY, endsOn: "2026-10-17" }, /시작일보다 앞/],
    [{ kind: "story", targetId: 1, startsOn: "2026-10-01", endsOn: "2026-10-17" }, /오늘/],
    [{ kind: "story", targetId: 1, startsOn: TODAY, sort: -1 }, /정수/],
    [{ kind: "story", targetId: 1, startsOn: TODAY, title: "x" }, /모르는 칸/],
  ])("거부 %j", (raw, message) => {
    const r = parseCurationInput(raw as Record<string, unknown>, "create", TODAY);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toMatch(message);
  });

  test("고치기 — 기간·순서만, 종류·대상은 바꿀 수 없다, 바꿀 칸이 없으면 거부", () => {
    expect(parseCurationInput({ endsOn: null, sort: 5 }, "patch", TODAY)).toEqual({ ok: true, value: { ends_on: null, sort: 5 } });
    const kind = parseCurationInput({ kind: "tracker" }, "patch", TODAY);
    expect(!kind.ok && kind.errors[0]).toMatch(/종류·대상은 바꿀 수 없습니다/);
    expect(parseCurationInput({}, "patch", TODAY).ok).toBe(false);
  });

  test("순서 — 종류와 번호 목록, 같은 번호 두 번은 거부", () => {
    expect(parseCurationOrder({ kind: "story", ids: [3, 1, 2] })).toEqual({ ok: true, value: { kind: "story", ids: [3, 1, 2] } });
    expect(parseCurationOrder({ kind: "story", ids: [1, 1] }).ok).toBe(false);
    expect(parseCurationOrder({ kind: "x", ids: [1] }).ok).toBe(false);
    expect(nextSort([{ sort: 10 }, { sort: 40 }])).toBe(50);
    expect(nextSort([])).toBe(10);
  });
});

describe("화면 폼 — 서버보다 먼저 막는다", () => {
  test("오늘 6장이 보이면 [카드 더하기]를 막는다 (7장째 지정 불가), 끝난 카드는 세지 않는다", () => {
    const rows = [...Array.from({ length: 6 }, () => card("2026-10-01", null)), card("2026-09-01", "2026-09-30")];
    expect(fullToday("story", rows, TODAY)).toBe(true);
    expect(fullToday("story", rows.slice(1), TODAY)).toBe(false);
  });

  test("고른 기간에 상한이 넘으면 시작일 칸 오류, 같은 대상 겹침은 대상 칸 오류", () => {
    const rows = Array.from({ length: 6 }, () => card(TODAY, null));
    const full = curationFormToBody("story", { targetId: "77", startsOn: TODAY, endsOn: "" }, TODAY, rows);
    expect(full.ok).toBe(false);
    expect(!full.ok && full.errors["curation-new-story-starts"]).toMatch(/6장까지/);
    const dup = curationFormToBody("tracker", { targetId: "5", startsOn: TODAY, endsOn: "" }, TODAY, [{ id: 1, targetId: 5, starts_on: "2026-10-01", ends_on: null }]);
    expect(!dup.ok && dup.errors["curation-new-tracker-target"]).toMatch(/같은 대상/);
  });

  test("대상·날짜를 고르지 않으면 칸 오류, 고르면 본문", () => {
    const empty = curationFormToBody("story", { targetId: "", startsOn: "", endsOn: "" }, TODAY, []);
    expect(!empty.ok && Object.keys(empty.errors).sort()).toEqual(["curation-new-story-starts", "curation-new-story-target"]);
    expect(curationFormToBody("story", { targetId: "12", startsOn: TODAY, endsOn: "2026-10-31" }, TODAY, [])).toEqual({
      ok: true,
      body: { kind: "story", targetId: 12, startsOn: TODAY, endsOn: "2026-10-31" },
    });
  });
});
