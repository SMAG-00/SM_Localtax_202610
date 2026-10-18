// 목록 카드 · 개정 트래커 상태 (ART-02 · ART-10 · CAT-03 · TX-07 · TX-08)
import { describe, expect, test } from "vitest";
import { emptyLookups, isListable, latestChangedTracker, regionLabel, toListItem, toListItems, trackerState, validEvents, type Lookups } from "./cards";
import type { PublicArticleListRow, RegionRow } from "./rows";
import { region, stageEvent } from "./test-items";
import { partnerBadgeFor, typeBadgeFor } from "@/lib/site/article-view";

const row = (over: Partial<PublicArticleListRow> = {}): PublicArticleListRow => ({
  id: 1,
  slug: "acquisition-tax-2026",
  title: "취득세 개편, 무엇이 바뀌나",
  summary: "요약",
  format: "general",
  section: "realestate",
  content_type: "explainer",
  category_id: 7,
  subtype: "general",
  label: "none",
  partner_id: null,
  author_id: 3,
  first_published_at: "2026-10-14T15:30:00Z",
  substantive_updated_at: null,
  region_codes: [],
  editorial_field: null,
  amendment_id: null,
  reported_approved: false,
  series_title: null,
  series_episode: null,
  partner_badge_name: null,
  ...over,
});

const SEOUL = region({ code: "1100000000", name: "서울특별시", slug: "seoul" });
const SEONGDONG = region({ code: "1120000000", name: "성동구", level: "sigungu", parent_code: "1100000000", slug: "seongdong" });

function lookups(): Lookups {
  const lk = emptyLookups();
  return {
    ...lk,
    categories: new Map([[7, { id: 7, section: "realestate", slug: "projects", name: "프로젝트 트래커", intro: null, sort: 20, needs_disclaimer: false, needs_tax_lens: true }]]),
    people: new Map([[3, { id: 3, slug: "kim-reporter", name: "김기자", roles: ["reporter"], affiliation: null, bio_items: [], beat: "부동산", last_verified_at: null }]]),
    regions: new Map<string, RegionRow>([
      [SEOUL.code, SEOUL],
      [SEONGDONG.code, SEONGDONG],
    ]),
  };
}

describe("toListItem", () => {
  test("기사 카드 값 — 상세 주소 /news/[slug], 분야 이름·하위 분야, 유형 배지 글자, 한국 날짜, 기자", () => {
    const item = toListItem(row(), lookups())!;
    expect(item).toMatchObject({
      href: "/news/acquisition-tax-2026",
      section: "realestate",
      sectionName: "부동산",
      subsection: "프로젝트 트래커",
      typeLabel: "해설",
      format: null,
      sponsorBadge: null,
      publishedOn: "2026-10-15",
      authorName: "김기자",
      authorHref: "/people/kim-reporter",
    });
  });

  test("형식 — 일반이면 배지 없음(null), 카드뉴스·인포그래픽은 그 값 (HOME-03)", () => {
    expect(toListItem(row({ format: "general" }), lookups())!.format).toBeNull();
    expect(toListItem(row({ format: "cardnews" }), lookups())!.format).toBe("cardnews");
    expect(toListItem(row({ format: "infographic" }), lookups())!.format).toBe("infographic");
  });

  test("제휴 배지 — 광고는 '광고', 공동 기획은 기사의 배지 이름으로 '공동 기획 ○○' (ART-10)", () => {
    const ad = toListItem(row({ label: "ad", content_type: "sponsored", partner_id: 9 }), lookups())!;
    expect([ad.sponsorBadge, ad.sponsor]).toEqual(["광고", { kind: "ad" }]);
    const co = toListItem(row({ label: "co_planned", content_type: "sponsored", partner_id: 9, partner_badge_name: "가온세무법인" }), lookups())!;
    expect([co.sponsorBadge, co.sponsor]).toEqual(["공동 기획 가온세무법인", { kind: "co_planned", partner: "가온세무법인" }]);
  });

  test("제휴사가 비공개·계약 종료로 바뀌어도 공동 기획 배지는 그대로 '공동 기획 ○○' — 유형 배지 '광고'로 바뀌지 않는다 (W2-a 4-2 '이미 붙은 배지는 남는다')", () => {
    // 비공개 제휴사는 공개 화면이 제휴사 행을 읽지 못한다(RLS) — 기사가 들고 있는 배지 이름(partner_badge_name)으로 그린다
    const hidden = toListItem(row({ label: "co_planned", content_type: "sponsored", partner_id: 99, partner_badge_name: "숨은세무법인" }), lookups())!;
    expect(hidden.sponsorBadge).toBe("공동 기획 숨은세무법인");
    expect(hidden.sponsor).toEqual({ kind: "co_planned", partner: "숨은세무법인" });
    expect(typeBadgeFor(hidden.contentType, hidden.sponsor)).toBeUndefined();
    expect(partnerBadgeFor(hidden.sponsor)).toBe("숨은세무법인");
    // 광고 기사는 제휴사가 어떻든 '광고'
    const ad = toListItem(row({ label: "ad", content_type: "sponsored", partner_id: 99 }), lookups())!;
    expect(typeBadgeFor(ad.contentType, ad.sponsor)).toBe("sponsored");
  });

  test("지역 표시 — 시·군·구는 '시·도 시·군·구', 시·도는 이름만, 모르는 코드는 null (CAT-03)", () => {
    expect(toListItem(row({ region_codes: [SEONGDONG.code] }), lookups())!.regionLabel).toBe("서울특별시 성동구");
    expect(regionLabel([SEOUL.code], lookups().regions)).toBe("서울특별시");
    expect(regionLabel(["9999999999"], lookups().regions)).toBeNull();
    expect(regionLabel([], lookups().regions)).toBeNull();
  });

  test("목록에서 빠지는 기사 — 금주 핫뉴스(digest)·유형 미분류 이관 기사·4대 분야 밖", () => {
    expect(isListable({ content_type: "digest" })).toBe(false);
    expect(isListable({ content_type: null })).toBe(false);
    const items = toListItems([row({ id: 1 }), row({ id: 2, content_type: "digest" }), row({ id: 3, content_type: null }), row({ id: 4, section: "tourism" })], lookups());
    expect(items.map((i) => i.id)).toEqual([1]);
  });

  test("편집 승인된 보도기사 표시는 계산 칸 그대로", () => {
    expect(toListItem(row({ content_type: "reported_news", reported_approved: true }), lookups())!.reportedApproved).toBe(true);
    expect(toListItem(row({ content_type: "reported_news", reported_approved: false }), lookups())!.reportedApproved).toBe(false);
  });
});

describe("트래커 상태 (TX-07 · TX-08)", () => {
  test("현재 단계는 가장 늦은 순서의 기록, 공포 전이면 확정 아님 — 원문·날짜는 그 기록에서", () => {
    const s = trackerState(
      [
        stageEvent({ stage: "announced", occurred_on: "2026-08-26", recorded_at: "2026-08-27T00:00:00Z" }),
        stageEvent({ stage: "pre_notice", occurred_on: "2026-09-10", source_url: "https://www.moleg.go.kr/x", recorded_at: "2026-09-11T00:00:00Z" }),
      ],
      "promulgated",
      "2026-10-18",
    );
    expect(s).toMatchObject({ current: "pre_notice", label: "입법예고", confirmed: false, currentOn: "2026-09-10", sourceUrl: "https://www.moleg.go.kr/x", recordedAt: "2026-09-11T00:00:00Z" });
    expect(s.events).toHaveLength(2);
  });

  test("공포를 기록하면 확정 — 확정 기준을 시행으로 바꾸면 공포는 확정 아님", () => {
    const events = [stageEvent({ stage: "announced" }), stageEvent({ stage: "promulgated", occurred_on: "2026-12-30", recorded_at: "2026-12-30T01:00:00Z" })];
    expect(trackerState(events, "promulgated", "2027-01-02").confirmed).toBe(true);
    expect(trackerState(events, "effective", "2027-01-02").confirmed).toBe(false);
  });

  test("시행일 D 전날은 '시행 예정', D부터 '시행' (한국 날짜 경계)", () => {
    const events = [stageEvent({ stage: "promulgated", occurred_on: "2026-12-30" }), stageEvent({ stage: "effective", occurred_on: "2027-01-01", recorded_at: "2026-12-31T00:00:00Z" })];
    expect(trackerState(events, "promulgated", "2026-12-31")).toMatchObject({ current: "effective", label: "시행 예정", effectivePending: true });
    expect(trackerState(events, "promulgated", "2027-01-01")).toMatchObject({ current: "effective", label: "시행", effectivePending: false });
  });

  test("정정된 기록은 빼고 정정 기록이 대신한다, 건너뛴 단계는 현재 단계가 아니다", () => {
    const wrong = stageEvent({ id: 1, stage: "submitted", occurred_on: "2026-10-01" });
    const fix = stageEvent({ id: 2, stage: "pre_notice", occurred_on: "2026-09-12", correction_of: 1, recorded_at: "2026-10-02T00:00:00Z" });
    const skipped = stageEvent({ id: 3, stage: "passed", skipped: true, occurred_on: null, skip_reason: "시행령 개정 — 국회 단계 없음", recorded_at: "2026-10-03T00:00:00Z" });
    expect(validEvents([wrong, fix, skipped]).map((e) => e.id)).toEqual([2, 3]);
    expect(trackerState([wrong, fix, skipped], "promulgated", "2026-10-18")).toMatchObject({ current: "pre_notice", currentOn: "2026-09-12" });
  });

  test("기록이 없으면 현재 단계 없음 — 대체 트래커 후보가 아니다", () => {
    const empty = trackerState([], "promulgated", "2026-10-18");
    expect(empty.current).toBeNull();
    const amendment = (id: number) => ({ id, slug: `am-${id}`, title: `개정안 ${id}`, law_names: [], summary: null });
    expect(latestChangedTracker([{ amendment: amendment(1), state: empty }])).toBeNull();
  });

  test("최근 단계가 바뀐 트래커 — 현재 단계 날짜가 늦은 것, 같으면 늦게 기록된 것", () => {
    const amendment = (id: number) => ({ id, slug: `am-${id}`, title: `개정안 ${id}`, law_names: [], summary: null });
    const at = (occurred_on: string, recorded_at: string) => trackerState([stageEvent({ stage: "announced", occurred_on, recorded_at })], "promulgated", "2026-10-18");
    const a = { amendment: amendment(1), state: at("2026-09-01", "2026-09-02T00:00:00Z") };
    const b = { amendment: amendment(2), state: at("2026-10-01", "2026-10-01T00:00:00Z") };
    const c = { amendment: amendment(3), state: at("2026-10-01", "2026-10-05T00:00:00Z") };
    expect(latestChangedTracker([a, b, c])!.amendment.id).toBe(3);
    expect(latestChangedTracker([a, b])!.amendment.id).toBe(2);
  });
});
