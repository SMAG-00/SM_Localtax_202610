// 프로젝트 공개 화면 규칙 (W4 15단계 — docs/dev/W4_설계.md 1장 15단계 · 2.4 · 5장 · 12장 #99 · #120~, PRD-01B PR-01 · PR-02 · PR-03 · PR-05)
// 시험용 지역은 접두 99 가짜 코드, 사업 유형·단계·고시는 '시험용' 가짜다 (설계 8장).
import fs from "node:fs";
import path from "node:path";
import { LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { describe, expect, test } from "vitest";
import { PRICE_WORDS, priceWordsIn } from "@/lib/admin/project-rules";
import { FEATURE_KEYS, SECTION_INFO, isOpenPath, type FeatureKey, type Features } from "./constants";
import {
  NO_FILTER,
  PROJECTS_HREF,
  PROJECT_PUBLIC_LIMITS,
  filterProjects,
  hubProjectCards,
  parseProjectApiRequest,
  parseProjectFilter,
  projectApiBody,
  projectBreadcrumb,
  projectCard,
  projectCrumbs,
  projectFilterChips,
  projectHref,
  projectListHref,
  projectRegion,
  projectTimeline,
  relatedArticleIds,
  sortProjects,
  sourceCoverage,
  stageRecord,
  lensFor,
  stageLensMap,
  stageLensView,
  type ProjectCard,
  type PublicStageLensRow,
  type PublicProjectEventRow,
  type PublicProjectRow,
  type StageListRow,
} from "./project-logic";
import type { RegionRow } from "./rows";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../../docs/dev/W4_설계.md"), "utf8");
const TODAY = "2026-10-23";
const region = (code: string, name: string, over: Partial<RegionRow> = {}): RegionRow => ({
  code,
  parent_code: code.endsWith("00000000") ? null : `${code.slice(0, 2)}00000000`,
  level: code.endsWith("00000000") ? "sido" : "sigungu",
  name,
  slug: `siheom-${code}`,
  aliases: [],
  valid_from: null,
  valid_to: null,
  ...over,
});
const REGIONS: RegionRow[] = [
  region("9900000000", "시험용 사업도"),
  region("9901100000", "시험용 가상구"),
  region("9901200000", "시험용 폐지구", { valid_to: "2026-10-22" }),
  region("9901300000", "시험용 다른구"),
];
const row = (over: Partial<PublicProjectRow> = {}): PublicProjectRow => ({
  id: 1,
  slug: "siheom-gasang-1",
  name: "시험용 가상구역 재개발",
  region_code: "9901100000",
  project_type: "siheom_redev",
  project_type_label: "시험용 재개발",
  landmark: false,
  summary: "시험용 요약입니다",
  source_name: "시험용 가상구청",
  last_verified_at: "2026-10-20T15:30:00Z", // KST 2026-10-21
  current_stage: "plan",
  current_stage_label: "시험용 계획인가",
  current_stage_position: 2,
  current_stage_notice_date: "2026-03-02",
  ...over,
});
const cardOf = (over: Partial<PublicProjectRow> = {}) => projectCard(row(over), projectRegion(over.region_code ?? "9901100000", REGIONS, TODAY, true))!;
const LIST: StageListRow[] = [
  { project_type: "siheom_redev", stage_position: 1, stage: "zone", stage_label: "시험용 구역지정" },
  { project_type: "siheom_redev", stage_position: 2, stage: "plan", stage_label: "시험용 계획인가" },
  { project_type: "siheom_redev", stage_position: 3, stage: "build", stage_label: "시험용 착공" },
  { project_type: "siheom_redev", stage_position: 4, stage: "done", stage_label: "시험용 준공" },
  { project_type: "siheom_small", stage_position: 1, stage: "zone", stage_label: "시험용 소규모 구역" },
  { project_type: "siheom_small", stage_position: 2, stage: "done", stage_label: "시험용 소규모 준공" },
];
const ev = (over: Partial<PublicProjectEventRow> = {}): PublicProjectEventRow => ({
  id: 10,
  project_id: 1,
  kind: "stage",
  stage: "zone",
  stage_label: "시험용 구역지정",
  stage_position: 1,
  notice_no: "시험용 고시 제2026-1호",
  notice_date: "2026-01-15",
  issuer: "시험용 가상구청",
  source_url: "https://gov.example.test/notice/1",
  license_type: "kogl_1",
  verified_at: "2026-01-15T16:00:00Z", // KST 2026-01-16
  under_review: false,
  recorded_at: "2026-01-16T01:00:00Z",
  ...over,
});
const features = (on: FeatureKey[] = []): Features => Object.fromEntries(FEATURE_KEYS.map((k) => [k, on.includes(k)])) as Features;

describe("기능 키 realestate_projects (설계 2.4)", () => {
  test("설계 2.4 표의 신규 키 · FEATURE_KEYS에 있다", () => {
    const line = DESIGN.split("\n").find((l) => l.startsWith("| `realestate_projects` (신규) |"));
    expect(line).toBeTruthy();
    expect(FEATURE_KEYS).toContain("realestate_projects");
  });
  test("꺼지면 상세 주소는 닫힘(링크 0), 목록 주소는 하위 분야 목록이라 열림 · 켜면 상세도 열림", () => {
    expect(isOpenPath(projectHref("siheom-a"), features())).toBe(false);
    expect(isOpenPath(projectHref("siheom-a"), features(["realestate_projects"]))).toBe(true);
    expect(isOpenPath(PROJECTS_HREF, features())).toBe(true);
    expect(PROJECTS_HREF).toBe(`${SECTION_INFO.realestate.href}/projects`);
  });
});

describe("카드 — 지역·단계·출처·기준일 누락 0 (PR-01)", () => {
  test("카드 칸: 지역 이름(시·도 시·군·구)·코드·허브 주소, 유형, 현재 단계·고시일(기준일), 출처, 확인일(KST)", () => {
    expect(cardOf()).toEqual({
      id: 1,
      slug: "siheom-gasang-1",
      name: "시험용 가상구역 재개발",
      href: "/realestate/projects/siheom-gasang-1",
      summary: "시험용 요약입니다",
      landmark: false,
      type: { key: "siheom_redev", label: "시험용 재개발" },
      region: { code: "9901100000", name: "시험용 사업도 시험용 가상구", href: "/local/siheom-9900000000/siheom-9901100000" },
      stage: { key: "plan", label: "시험용 계획인가", noticeDate: "2026-03-02" },
      source: "시험용 가상구청",
      verifiedOn: "2026-10-21",
    });
  });
  test.each([
    ["유형 글자 없음", { project_type_label: null }],
    ["현재 단계 없음", { current_stage: null }],
    ["현재 단계 글자 없음", { current_stage_label: " " }],
    ["기준일(고시일) 없음", { current_stage_notice_date: null }],
    ["기준일 모양 밖", { current_stage_notice_date: "2026/03/02" }],
    ["출처 없음", { source_name: "" }],
    ["확인일 없음", { last_verified_at: null }],
    ["주소 모양 밖", { slug: "Bad Slug" }],
    ["이름 빔", { name: "  " }],
  ] as const)("%s → 카드 0", (_, over) => {
    expect(projectCard(row(over as Partial<PublicProjectRow>), projectRegion("9901100000", REGIONS, TODAY, true))).toBeNull();
  });
  test("지역 행이 없으면 카드 0 · 허브가 닫혔거나(region_hubs) 오늘 유효하지 않은 지역은 글자만(주소 null — 404 링크 0)", () => {
    expect(projectRegion("9909900000", REGIONS, TODAY, true)).toBeNull();
    expect(projectCard(row({ region_code: "9909900000" }), projectRegion("9909900000", REGIONS, TODAY, true))).toBeNull();
    expect(projectRegion("9901100000", REGIONS, TODAY, false)).toEqual({ code: "9901100000", name: "시험용 사업도 시험용 가상구", href: null });
    expect(projectRegion("9901200000", REGIONS, TODAY, true)).toEqual({ code: "9901200000", name: "시험용 사업도 시험용 폐지구", href: null });
    expect(projectRegion("9901200000", REGIONS, "2026-10-22", true)?.href).toBe("/local/siheom-9900000000/siheom-9901200000");
    expect(projectRegion("9900000000", REGIONS, TODAY, true)).toEqual({ code: "9900000000", name: "시험용 사업도", href: "/local/siheom-9900000000" });
  });
  test("차례 — 대표 먼저 · 현재 단계 고시일 늦은 것 · 번호 큰 것", () => {
    const cards = [cardOf({ id: 1, current_stage_notice_date: "2026-05-01" }), cardOf({ id: 2, slug: "b", current_stage_notice_date: "2026-01-01", landmark: true }), cardOf({ id: 3, slug: "c", current_stage_notice_date: "2026-05-01" }), cardOf({ id: 4, slug: "d", current_stage_notice_date: "2026-06-01" })];
    expect(sortProjects(cards).map((c) => c.id)).toEqual([2, 4, 3, 1]);
  });
});

describe("목록 거르개 — 지역·사업 유형·현재 단계 (5장)", () => {
  const cards: ProjectCard[] = [
    cardOf({ id: 1, slug: "a" }),
    cardOf({ id: 2, slug: "b", region_code: "9900000000", current_stage: "zone", current_stage_label: "시험용 구역지정" }),
    cardOf({ id: 3, slug: "c", region_code: "9901300000", project_type: "siheom_small", project_type_label: "시험용 소규모", current_stage: "done", current_stage_label: "시험용 소규모 준공" }),
  ];
  test("모양 밖 값·두 번 보낸 칸은 그 칸 전체 · 단계는 유형을 고른 뒤에만", () => {
    expect(parseProjectFilter({})).toEqual(NO_FILTER);
    expect(parseProjectFilter({ region: "9900000000", type: "siheom_redev", stage: "plan" })).toEqual({ region: "9900000000", type: "siheom_redev", stage: "plan" });
    expect(parseProjectFilter({ region: "99000", type: "Siheom", stage: "plan" })).toEqual(NO_FILTER);
    expect(parseProjectFilter({ region: ["9900000000", "9901100000"], stage: "plan" })).toEqual(NO_FILTER);
    expect(parseProjectFilter({ type: "siheom_redev", stage: "x;drop" })).toEqual({ region: null, type: "siheom_redev", stage: null });
  });
  test("시·도 코드는 그 아래 시·군·구 포함 · 시·군·구 코드는 그 지역만 · 유형·단계", () => {
    expect(filterProjects(cards, { ...NO_FILTER, region: "9900000000" }).map((c) => c.id)).toEqual([1, 2, 3]);
    expect(filterProjects(cards, { ...NO_FILTER, region: "9901100000" }).map((c) => c.id)).toEqual([1]);
    expect(filterProjects(cards, { ...NO_FILTER, region: "9901300000" }).map((c) => c.id)).toEqual([3]);
    expect(filterProjects(cards, { ...NO_FILTER, region: "9909900000" })).toEqual([]);
    expect(filterProjects(cards, { ...NO_FILTER, region: "1100000000" })).toEqual([]);
    expect(filterProjects(cards, { ...NO_FILTER, type: "siheom_small" }).map((c) => c.id)).toEqual([3]);
    expect(filterProjects(cards, { region: null, type: "siheom_redev", stage: "zone" }).map((c) => c.id)).toEqual([2]);
  });
  test("칩 — 프로젝트가 있는 값만(데이터 없는 칩 0), '전체'가 앞, 지금 고른 칩 표시, 단계 칩은 유형을 고른 뒤 단계 목록 차례", () => {
    const none = projectFilterChips(cards, NO_FILTER, REGIONS, LIST);
    expect(none.regions.map((c) => [c.label, c.count, c.href, c.current])).toEqual([
      ["전체", 0, "/realestate/projects", true],
      ["시험용 사업도", 3, "/realestate/projects?region=9900000000", false],
    ]);
    expect(none.types.map((c) => c.value)).toEqual([null, "siheom_small", "siheom_redev"]);
    expect(none.stages).toEqual([]);
    const typed = projectFilterChips(cards, { region: "9900000000", type: "siheom_redev", stage: null }, REGIONS, LIST);
    expect(typed.stages.map((c) => [c.value, c.label, c.count, c.href])).toEqual([
      [null, "전체", 0, "/realestate/projects?region=9900000000&type=siheom_redev"],
      ["zone", "시험용 구역지정", 1, "/realestate/projects?region=9900000000&type=siheom_redev&stage=zone"],
      ["plan", "시험용 계획인가", 1, "/realestate/projects?region=9900000000&type=siheom_redev&stage=plan"],
    ]);
    expect(typed.types.find((c) => c.value === "siheom_small")?.href).toBe("/realestate/projects?region=9900000000&type=siheom_small");
    expect(projectFilterChips([], NO_FILTER, REGIONS, LIST)).toEqual({ regions: [], types: [], stages: [] });
    expect(projectListHref({ region: null, type: null, stage: "zone" })).toBe("/realestate/projects");
  });
});

describe("단계 타임라인 — 전체 단계 목록 + 공개 기록 (12장 #99 · PR-03)", () => {
  test("첫 단계 … 마지막 단계 차례, 단계마다 기록·해당 없음·기록 없음 · 기록 칸(고시 번호·고시일·기관·원문·공공누리·확인일 KST·검토 중)", () => {
    const t = projectTimeline(LIST.filter((s) => s.project_type === "siheom_redev").reverse(), [
      ev(),
      ev({ id: 11, stage: "plan", stage_label: "시험용 계획인가", stage_position: 2, notice_no: "시험용 고시 제2026-7호", notice_date: "2026-03-02", license_type: "unmarked", under_review: true }),
      ev({ id: 12, kind: "not_applicable", stage: "build", stage_label: "시험용 착공", stage_position: 3, notice_no: null, notice_date: null, issuer: null, source_url: null, license_type: null, verified_at: null }),
    ]);
    expect(t.map((s) => [s.key, s.position, s.status])).toEqual([
      ["zone", 1, "recorded"],
      ["plan", 2, "recorded"],
      ["build", 3, "not_applicable"],
      ["done", 4, "none"],
    ]);
    expect(t[0]!.record).toEqual({
      noticeNo: "시험용 고시 제2026-1호",
      noticeDate: "2026-01-15",
      issuer: "시험용 가상구청",
      sourceUrl: "https://gov.example.test/notice/1",
      licenseType: "kogl_1",
      licenseLabel: LICENSE_TYPE_LABELS.kogl_1,
      checkedOn: "2026-01-16",
      underReview: false,
    });
    expect(t[1]!.record).toMatchObject({ licenseLabel: LICENSE_TYPE_LABELS.unmarked, underReview: true });
    expect(LICENSE_TYPE_LABELS.kogl_1).toMatch(/제1유형/);
    expect(sourceCoverage(t)).toEqual({ recorded: 2, linked: 2 });
  });
  test("원문 주소가 http(s)가 아니거나 고시 칸이 빈 기록은 기록으로 치지 않는다 (링크 없는 단계 0)", () => {
    for (const bad of [{ source_url: "javascript:alert(1)" }, { source_url: null }, { notice_no: "" }, { issuer: null }, { notice_date: "2026-1-5" }, { verified_at: null }, { license_type: null }]) {
      expect(stageRecord(ev(bad as Partial<PublicProjectEventRow>))).toBeNull();
      expect(projectTimeline(LIST.slice(0, 4), [ev(bad as Partial<PublicProjectEventRow>)])[0]!.status).toBe("none");
    }
  });
  test("단계 목록을 읽지 못하면 기록된 단계만(기록의 차례)", () => {
    const t = projectTimeline([], [ev({ id: 2, stage: "plan", stage_label: "시험용 계획인가", stage_position: 2 }), ev()]);
    expect(t.map((s) => s.key)).toEqual(["zone", "plan"]);
    expect(projectTimeline([], [])).toEqual([]);
  });
});

describe("이동 줄 = BreadcrumbList (OPT-02)", () => {
  test("홈 > 부동산 > 프로젝트 트래커 > 이름 · 구조화 데이터 이름 = 화면 글자 · 사이트 주소 없으면 0", () => {
    const crumbs = projectCrumbs({ name: "시험용 가상구역 재개발", href: projectHref("siheom-gasang-1") });
    expect(crumbs.map((c) => c.name)).toEqual(["홈", "부동산", "프로젝트 트래커", "시험용 가상구역 재개발"]);
    const bc = projectBreadcrumb(crumbs, "https://e2e.example.test");
    expect(bc?.items.map((i) => i.name)).toEqual(crumbs.map((c) => c.name));
    expect(bc?.items.at(-1)?.url).toBe("https://e2e.example.test/realestate/projects/siheom-gasang-1");
    expect(projectBreadcrumb(crumbs, undefined)).toBeNull();
    expect(projectCrumbs().map((c) => c.href)).toEqual(["/", "/realestate", "/realestate/projects"]);
  });
});

describe("관련 기사 · 허브 ③ 카드 (12장 #120 · #122)", () => {
  const link = (from_type: string, from_id: string, to_type: string, to_id: string, at: string) => ({ from_type, from_id, to_type, to_id, confirmed_at: at });
  test("프로젝트 → 기사 · 기사 → 프로젝트 둘 다, 최근 확인 순, 한 번씩, 다른 프로젝트·다른 종류 0, 한도", () => {
    const rows = [
      link("project", "1", "article", "11", "2026-10-01T00:00:00Z"),
      link("article", "12", "project", "1", "2026-10-03T00:00:00Z"),
      link("article", "11", "project", "1", "2026-10-02T00:00:00Z"),
      link("project", "1", "official_source", "21", "2026-10-04T00:00:00Z"),
      link("article", "13", "project", "2", "2026-10-05T00:00:00Z"),
      link("project", "2", "article", "14", "2026-10-05T00:00:00Z"),
    ];
    expect(relatedArticleIds(rows, 1)).toEqual([12, 11]);
    const many = Array.from({ length: 15 }, (_, i) => link("article", String(100 + i), "project", "1", `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00Z`));
    expect(relatedArticleIds(many, 1)).toHaveLength(PROJECT_PUBLIC_LIMITS.relatedArticles);
  });
  test("지역에서 출발한 확인된 연결의 프로젝트 먼저, 그다음 목록 차례 · 최대 4장 · 범위 밖 연결 번호는 무시", () => {
    const cards = [1, 2, 3, 4, 5, 6].map((id) => cardOf({ id, slug: `p${id}`, current_stage_notice_date: `2026-0${id}-01` }));
    expect(hubProjectCards(cards, [2, 99, 2]).map((c) => c.id)).toEqual([2, 6, 5, 4]);
    expect(hubProjectCards(cards, []).map((c) => c.id)).toEqual([6, 5, 4, 3]);
    expect(hubProjectCards([], [1])).toEqual([]);
  });
});

describe("GET /api/projects/{slug} — 400 · 응답 모양 · 가격 칸 0 (PR-05)", () => {
  test("주소 모양 밖·너무 긴 주소·모르는 쿼리 칸 → 칸마다 사유 (DB를 부르기 전)", () => {
    expect(parseProjectApiRequest("siheom-gasang-1", new URLSearchParams())).toEqual({ ok: true, slug: "siheom-gasang-1" });
    for (const bad of ["Siheom", "a--b", "-a", "a_b", "", "%27or1", "a".repeat(PROJECT_PUBLIC_LIMITS.slugChars + 1)]) {
      const r = parseProjectApiRequest(bad, new URLSearchParams());
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.errors[0]).toMatch(/^slug: /);
    }
    const r = parseProjectApiRequest("siheom-a", new URLSearchParams("price=1&x=2&x=3"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0])).toEqual(["price", "x"]);
  });
  test("응답 — 공개 기록만 · source·verifiedAt·status · 원문 검수 중이면 under_review · 칸 이름에 가격 사전 낱말 0", () => {
    const t = projectTimeline(LIST.slice(0, 4), [ev(), ev({ id: 11, stage: "plan", stage_label: "시험용 계획인가", stage_position: 2, under_review: true })]);
    const body = projectApiBody(cardOf(), t);
    expect(body).toMatchObject({ slug: "siheom-gasang-1", url: "/realestate/projects/siheom-gasang-1", source: "시험용 가상구청", verifiedAt: "2026-10-21", status: "under_review", region: { code: "9901100000", name: "시험용 사업도 시험용 가상구" } });
    expect(body.stages.map((s) => [s.key, s.status])).toEqual([
      ["zone", "recorded"],
      ["plan", "recorded"],
      ["build", "none"],
      ["done", "none"],
    ]);
    expect(body.stages[0]!.record).toEqual({ noticeNo: "시험용 고시 제2026-1호", noticeDate: "2026-01-15", issuer: "시험용 가상구청", sourceUrl: "https://gov.example.test/notice/1", licenseType: "kogl_1", verifiedAt: "2026-01-16", underReview: false });
    expect(projectApiBody(cardOf(), t.slice(0, 1)).status).toBe("public");
    const keys = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keys) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
    expect(PRICE_WORDS.length).toBe(16);
    expect(keys(body).filter((k) => priceWordsIn(k).length > 0)).toEqual([]);
  });
});

// ── 단계별 「지방세로 읽기」 (16단계 — PR-08 · CORE-01 · 12장 #129~) ──
describe("단계별 「지방세로 읽기」 박스 값 (stageLensView · stageLensMap · lensFor)", () => {
  const lensRow = (over: Partial<PublicStageLensRow> = {}): PublicStageLensRow => ({
    project_type: "siheom_pl",
    stage: "zone",
    stage_position: 1,
    topics: ["시험용 세목"],
    points: ["시험용 포인트 하나"],
    links: [
      { kind: "explainer", label: "시험용 해설", url: "/tax" },
      { kind: "book", label: "시험용 도서", url: "/store/siheom" },
      { kind: "expert", label: "시험용 전문가", url: "/experts?field=siheom" },
    ],
    base_date: "2026-01-01",
    reviewed_at: "2026-10-23T02:00:00+00:00",
    reviewer_name: "시험용 감수위원",
    ...over,
  });
  // 전문가 링크는 기능 expert_finder + 화면 /experts(유틸 메뉴 기능 experts)가 모두 열려야 남는다
  const open = features(["store", "expert_finder", "experts"]);

  test("서명된 줄 → 박스 값 (세목·포인트·열린 링크·기준일·감수자)", () => {
    expect(stageLensView(lensRow(), open)).toEqual({
      topics: ["시험용 세목"],
      points: ["시험용 포인트 하나"],
      links: [
        { kind: "explainer", href: "/tax" },
        { kind: "book", href: "/store/siheom" },
        { kind: "expert", href: "/experts?field=siheom" },
      ],
      basisDate: "2026-01-01",
      reviewer: "시험용 감수위원",
    });
  });
  test("닫힌 기능의 링크는 뺀다 — 도서(store)·전문가(expert_finder) 꺼짐이면 해설만, 해설이 닫힌 화면이면 박스 0", () => {
    expect(stageLensView(lensRow(), features())!.links).toEqual([{ kind: "explainer", href: "/tax" }]);
    expect(stageLensView(lensRow(), features(["store", "expert_finder"]))!.links.map((l) => l.kind)).toEqual(["explainer", "book"]);
    expect(stageLensView(lensRow({ links: [{ kind: "explainer", label: "시험용", url: "/local/events" }] }), open)).toBeNull();
    expect(stageLensView(lensRow({ links: [{ kind: "explainer", label: "시험용", url: "/realestate/projects/siheom-a" }] }), open)).toBeNull();
    expect(stageLensView(lensRow({ links: [{ kind: "explainer", label: "시험용", url: "/realestate/projects/siheom-a" }] }), features(["realestate_projects"]))).not.toBeNull();
  });
  test("모양이 틀리면 박스 0 — 서명자 공개 이름 없음(BR-03)·기준일 없음·포인트 0·4줄·세액 표현·계산기·바깥 주소", () => {
    for (const over of [
      { reviewer_name: null },
      { reviewer_name: " " },
      { base_date: null },
      { points: [] },
      { points: ["가", "나", "다", "라"] },
      { points: ["시험용 300만 원"] },
      { topics: [] },
      { topics: "시험용" },
      { links: [] },
      { links: [{ kind: "calculator", label: "시험용", url: "/calc" }] },
      { links: [{ kind: "explainer", label: "시험용", url: "https://gasang.example/x" }] },
    ] as Partial<PublicStageLensRow>[]) {
      expect(stageLensView(lensRow(over), open), JSON.stringify(over)).toBeNull();
    }
  });
  test("단계 키 → 박스 — 그 사업 유형만 · 같은 단계는 앞 줄 · 해당 없음 단계에는 붙이지 않는다 · 없는 단계 0", () => {
    const map = stageLensMap(
      [lensRow(), lensRow({ points: ["시험용 다른 줄"] }), lensRow({ project_type: "siheom_pm", stage: "plan" }), lensRow({ stage: "done", reviewer_name: null })],
      "siheom_pl",
      open,
    );
    expect(Object.keys(map)).toEqual(["zone"]);
    expect(map.zone!.points).toEqual(["시험용 포인트 하나"]);
    expect(lensFor({ key: "zone", status: "recorded" }, map)).toBe(map.zone);
    expect(lensFor({ key: "zone", status: "none" }, map)).toBe(map.zone);
    expect(lensFor({ key: "zone", status: "not_applicable" }, map)).toBeNull();
    expect(lensFor({ key: "plan", status: "recorded" }, map)).toBeNull();
  });
});
