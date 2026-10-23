import { describe, expect, it } from "vitest";
import {
  digestSidosErrors,
  digestSourcesErrors,
  digestSummaryMaxErrors,
  eventRecheckErrors,
  kstToIso,
  parseCandidate,
  parseEvent,
  parseEventStatus,
  parseItem,
  weeklyDigestEnableErrors,
} from "./local-news-rules";

const event = {
  slug: "ev-test-1",
  series_key: "series-test",
  title: "시험 행사",
  category: "tax_finance",
  organizer: "시험 주최",
  organizer_type: "government",
  venue: "시험 장소",
  region_code: "1100000000",
  starts_at: "2026-10-30T10:00",
  ends_at: "2026-10-30T12:00",
  official_url: "https://event.example.test/a",
  source_name: "시험 출처",
  confirmed_on: "2026-10-24",
};

describe("kstToIso", () => {
  it("날짜만이면 기본 시각, 날짜+시각이면 한국 시각 ISO", () => {
    expect(kstToIso("2026-10-24")).toBe("2026-10-24T09:00:00+09:00");
    expect(kstToIso("2026-10-24T13:30")).toBe("2026-10-24T13:30:00+09:00");
  });
  it("없는 날짜·시각은 null", () => {
    expect(kstToIso("2026-02-30")).toBeNull();
    expect(kstToIso("2026-10-24T25:00")).toBeNull();
    expect(kstToIso("어제")).toBeNull();
  });
});

describe("parseEvent (LG-11)", () => {
  it("올바른 입력은 한국 시각 ISO로 바뀐다", () => {
    const r = parseEvent(event);
    expect(r.ok && r.value.starts_at).toBe("2026-10-30T10:00:00+09:00");
    expect(r.ok && r.value.sponsored).toBe(false);
  });
  it("필수 칸이 비면 칸 이름이 붙은 오류, 종료가 시작보다 이르면 거부", () => {
    const r = parseEvent({ ...event, title: "", official_url: "", ends_at: "2026-10-30T09:00" });
    expect(r.ok).toBe(false);
    const errors = !r.ok ? r.errors : [];
    expect(errors.some((e) => e.startsWith("title:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("official_url:"))).toBe(true);
    expect(errors.some((e) => e.startsWith("ends_at:") && e.includes("이릅니다"))).toBe(true);
  });
  it("분류·주최 유형·지역 코드·slug 형식 검사", () => {
    const r = parseEvent({ ...event, category: "tour", organizer_type: "x", region_code: "11", slug: "Bad Slug" });
    const errors = !r.ok ? r.errors : [];
    for (const f of ["category", "organizer_type", "region_code", "slug"]) expect(errors.some((e) => e.startsWith(`${f}:`))).toBe(true);
  });
});

describe("parseEventStatus (REG1-04)", () => {
  it("취소는 공식 출처 주소가 있어야 한다, 변경 확인 중은 없어도 된다", () => {
    expect(parseEventStatus({ slug: "a", state: "cancelled" }).ok).toBe(false);
    expect(parseEventStatus({ slug: "a", state: "cancelled", source_url: "https://e.example.test/n" }).ok).toBe(true);
    expect(parseEventStatus({ slug: "a", state: "changing" }).ok).toBe(true);
    expect(parseEventStatus({ slug: "a", state: "취소" }).ok).toBe(false);
  });
});

describe("parseCandidate / parseItem", () => {
  const cand = { sido_code: "1100000000", source_id: "src_test", title: "시험 후보", press_org: "시험 기관", announced_at: "2026-10-20", source_url: "https://press.example.test/x" };
  it("후보 - 지역 코드는 시·도로 기본값, 공공누리 기본 unknown", () => {
    const r = parseCandidate(cand);
    expect(r.ok && r.value.region_code).toBe("1100000000");
    expect(r.ok && r.value.license_type).toBe("unknown");
    expect(r.ok && r.value.announced_at).toBe("2026-10-20T09:00:00+09:00");
  });
  it("후보 - 원문 주소·발표기관·제목이 없으면 거부", () => {
    const r = parseCandidate({ ...cand, source_url: "원문없음", press_org: "", title: "" });
    const errors = !r.ok ? r.errors : [];
    for (const f of ["source_url", "press_org", "title"]) expect(errors.some((e) => e.startsWith(`${f}:`))).toBe(true);
  });
  it("항목 고치기 - 고칠 칸이 없으면 거부", () => {
    expect(parseItem({ id: 1 }).ok).toBe(false);
    const r = parseItem({ id: 1, summary: " 새 요약 " });
    expect(r.ok && r.value.patch).toEqual({ summary: "새 요약" });
  });
});

describe("설정 검사", () => {
  it("digest_sidos - 10자리 코드만, 같은 값 두 번 거부", () => {
    expect(digestSidosErrors(["1100000000", "2600000000"])).toEqual([]);
    expect(digestSidosErrors(["11"]).length).toBe(1);
    expect(digestSidosErrors(["1100000000", "1100000000"]).length).toBe(1);
    expect(digestSidosErrors("x").length).toBe(1);
  });
  it("요약 길이 상한 50~2000", () => {
    expect(digestSummaryMaxErrors(300)).toEqual([]);
    expect(digestSummaryMaxErrors(49).length).toBe(1);
    expect(digestSummaryMaxErrors(2001).length).toBe(1);
    expect(digestSummaryMaxErrors("300").length).toBe(1);
  });
  it("출처는 허용 근거와 확인일이 모두 있어야 한다", () => {
    const ok = { id: "src_a", name: "출처", host: "press.example.test", kind: "board", basis: "시험 근거", checked_on: "2026-10-24" };
    expect(digestSourcesErrors([ok])).toEqual([]);
    expect(digestSourcesErrors([{ ...ok, basis: "" }]).length).toBe(1);
    expect(digestSourcesErrors([{ ...ok, checked_on: "어제" }]).length).toBe(1);
    expect(digestSourcesErrors([ok, ok]).length).toBeGreaterThan(0);
  });
  it("행사 재확인 기준 1~90일 + hide_stale", () => {
    expect(eventRecheckErrors({ days: 7, hide_stale: false })).toEqual([]);
    expect(eventRecheckErrors({ days: 0, hide_stale: false }).length).toBe(1);
    expect(eventRecheckErrors({ days: 7 }).length).toBe(1);
    expect(eventRecheckErrors({ days: 7, hide_stale: false, x: 1 }).length).toBe(1);
  });
  it("금주 핫뉴스 켜기는 시·도 2곳 이상", () => {
    expect(weeklyDigestEnableErrors(["a"]).length).toBe(1);
    expect(weeklyDigestEnableErrors(["a", "b"])).toEqual([]);
    expect(weeklyDigestEnableErrors(undefined).length).toBe(1);
  });
});
