// local 묶음 견본 등록 — PRD-00 8.6 이름(한글 그대로) 16종과 루트 요소 data-ui가 실제 렌더 결과와 같은지 확인한다
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { registry } from "./registry";
import * as local from "./index";

const NAMES = [
  "분야 허브 머리",
  "지역 허브 머리",
  "지자체 허브 블록",
  "분야 필터",
  "지역 세금 연결 블록",
  "공식 자료 카드",
  "핫뉴스 항목 카드",
  "행사 카드",
  "행사 상태 배지",
  "행사 달력",
  "분양 정보 카드",
  "프로젝트 단계 타임라인",
  "개발방법 비교표",
  "신탁 구조도",
  "이슈 묶음 머리",
  "분야 지방세 포인트 블록",
];

const event = {
  id: "e1",
  title: "지방세 설명회",
  category: "세무·재정",
  host: "강남구청",
  place: "강남구청 대회의실",
  regionCode: "11680",
  start: "2026-10-15",
  end: "2026-10-15",
  officialUrl: "https://www.example.go.kr/e/1",
  source: "강남구청 공지사항",
  checkedAt: "2026-10-13",
};
const point = { points: ["취득세 신고 기한을 먼저 확인합니다."], basisDate: "2026-10-01", links: [{ label: "취득세 해설 보기", href: "/tax/acquisition" }] };
const approval = { by: "편집자 A", at: "2026-10-15T10:00:00+09:00", reason: "같은 구역" };

const SAMPLES: Record<string, ReactElement> = {
  "분야 허브 머리": <local.FieldHubHead field="realestate" eyebrow="REAL ESTATE" title="부동산" intro="소개" />,
  "지역 허브 머리": <local.RegionHubHead sido={{ name: "서울특별시", href: "/local/seoul" }} />,
  "지자체 허브 블록": <local.LocalHubBlocks events={{ items: [] }} />,
  "분야 필터": <local.TopicFilter basePath="/local/seoul" />,
  "지역 세금 연결 블록": (
    <local.RegionTaxLinks
      links={[
        { kind: "explainer", label: "재산세 해설", href: "/tax/property" },
        { kind: "situation", label: "집을 샀어요", href: "/situations/bought" },
      ]}
    />
  ),
  "공식 자료 카드": (
    <local.OfficialSourceCard kind="고시" title="정비구역 지정 고시" publisher="서울특별시" basisDate="2026-10-01" checkedAt="2026-10-13" rights="kogl-1" url="https://www.example.go.kr/g/1" />
  ),
  "핫뉴스 항목 카드": (
    <local.HotNewsItemCard region="서울특별시" summary="요약입니다." publisher="서울특별시 보도자료" publishedAt="2026-10-14" sourceUrl="https://www.example.go.kr/p/1" license="kogl-1" />
  ),
  "행사 카드": <local.EventCard event={event} today="2026-10-14" recheckAfterDays={14} />,
  "행사 상태 배지": <local.EventStatusBadge status="예정" />,
  "행사 달력": <local.EventCalendar events={[event]} today="2026-10-14" recheckAfterDays={14} scope="events-page" />,
  "분양 정보 카드": <local.PresaleInfoCard name="○○지구 공공분양" noticeUrl="https://www.example.or.kr/n/1" checkedAt="2026-10-13" />,
  "프로젝트 단계 타임라인": (
    <local.ProjectStageTimeline
      stages={[{ name: "구역지정", record: { noticeNo: "제2024-1호", noticeDate: "2024-01-02", agency: "서울특별시", sourceUrl: "https://www.example.go.kr/g/2", checkedAt: "2026-10-13" } }]}
    />
  ),
  "개발방법 비교표": (
    <local.DevMethodComparison
      methods={{
        redevelopment: {
          law: "도시정비법",
          operator: "조합",
          target: "정비기반시설이 열악한 지역",
          procedure: "구역지정 → 조합설립 → 사업시행인가 → 관리처분인가",
          facts: [{ label: "동의 요건", value: "75", unit: "%", article: "도시정비법 제35조", basisDate: "2026-10-01", reviewer: "감수자 A" }],
          taxIssue: "관리처분 뒤 새 집 취득세",
        },
      }}
    />
  ),
  "신탁 구조도": (
    <local.TrustStructureDiagram
      title="신탁 구조"
      nodes={[
        { id: "a", role: "위탁자", col: 0, row: 0 },
        { id: "b", role: "수탁자", col: 1, row: 0 },
      ]}
      flows={[{ from: "a", to: "b", kind: "right", label: "소유권 이전" }]}
    />
  ),
  "이슈 묶음 머리": (
    <local.IssueBundleHead
      title="제목"
      summary="요약"
      articles={[
        { id: "1", field: "지방세", card: <p>기사 1</p>, approval },
        { id: "2", field: "부동산", card: <p>기사 2</p>, approval },
      ]}
      taxLens={<aside>지방세로 읽기</aside>}
    />
  ),
  "분야 지방세 포인트 블록": <local.FieldTaxPoint {...point} />,
};

describe("local 묶음 등록", () => {
  it("PRD-00 8.6 이름 16종을 한글 그대로 등록한다", () => {
    expect(registry.map((r) => r.name)).toEqual(NAMES);
  });

  it("data-ui 값은 서로 다르고 kebab-case다", () => {
    const uis = registry.map((r) => r.ui);
    expect(new Set(uis).size).toBe(uis.length);
    for (const ui of uis) expect(ui).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it.each(NAMES)("'%s'의 루트 요소 data-ui가 등록 값과 같다", (name) => {
    const entry = registry.find((r) => r.name === name)!;
    const { container } = render(SAMPLES[name]);
    expect(container.firstElementChild?.getAttribute("data-ui")).toBe(entry.ui);
  });
});
