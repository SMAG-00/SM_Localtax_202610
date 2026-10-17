import {
  DevMethodComparison,
  EventCalendar,
  EventCard,
  EventStatusBadge,
  FieldHubHead,
  FieldTaxPoint,
  HotNewsItemCard,
  IssueBundleHead,
  LinkCard,
  LocalHubBlocks,
  OfficialSourceCard,
  PresaleInfoCard,
  ProjectStageTimeline,
  RegionHubHead,
  RegionTaxLinks,
  TopicFilter,
  TrustStructureDiagram,
  type DevMethodComparisonProps,
  type FieldTaxPointProps,
  type LocalEvent,
  type ProjectStage,
  type RegionTaxLink,
} from "@ltr/ui";
import { SectionTitle, Specimen } from "./specimen";

// local 묶음 견본 — 지자체·부동산·부동산개발금융 16종. 날짜는 고정한 '오늘'로 보인다(견본이 날마다 바뀌지 않게)
const TODAY = "2026-10-17";
/** 행사 재확인 기준 일수 — 실제 값은 settings (견본 값) */
const RECHECK_DAYS = 14;

const SIDO = { name: "서울특별시", href: "/local/seoul" };
const SIGUNGU = { name: "강남구", href: "/local/seoul/gangnam-gu" };

const taxPoint: FieldTaxPointProps = {
  points: [
    "관리처분계획인가 뒤 조합원 입주권은 취득세 주택 수에 들어갑니다.",
    "신탁한 부동산의 재산세는 위탁자에게 고지됩니다.",
    "새 집의 취득세는 사용승인일부터 60일 안에 신고합니다.",
  ],
  basisDate: "2026-10-01",
  links: [
    { label: "정비사업 지방세 해설 보기", href: "/tax/explainers/redevelopment" },
    { label: "개정 트래커 보기", href: "/tax/tracker" },
  ],
};

const events: LocalEvent[] = [
  {
    id: "ev-1",
    title: "2027년 지방세 개정 주민 설명회",
    category: "세무·재정",
    host: "강남구청 세무관리과",
    place: "강남구청 별관 3층 대회의실",
    regionCode: "11680",
    regionName: "강남구",
    start: "2026-10-22",
    end: "2026-10-22",
    officialUrl: "https://www.example.go.kr/events/tax-briefing",
    source: "강남구청 공지사항",
    checkedAt: "2026-10-15",
    href: "/local/events/gangnam-tax-briefing-2026",
  },
  {
    id: "ev-2",
    title: "○○구역 정비계획 주민설명회",
    category: "개발·정비",
    host: "강남구청 도시계획과",
    place: "○○동 주민센터 2층",
    regionCode: "11680",
    regionName: "강남구",
    start: "2026-10-28",
    end: "2026-10-28",
    officialUrl: "https://www.example.go.kr/events/plan-briefing",
    source: "강남구 고시·공고",
    checkedAt: "2026-10-16",
  },
  {
    id: "ev-3",
    title: "2027년도 구 예산안 주민 공청회",
    category: "세무·재정",
    host: "강남구청 기획예산과",
    place: "강남구의회 본회의장",
    regionCode: "11680",
    start: "2026-11-12",
    end: "2026-11-12",
    officialUrl: "https://www.example.go.kr/events/budget-hearing",
    source: "강남구청 공지사항",
    checkedAt: "2026-09-25",
  },
  {
    id: "ev-4",
    title: "지방재정 공개 설명회",
    category: "세무·재정",
    host: "서울특별시 재정기획관",
    place: "서울시청 다목적홀",
    regionCode: "11000",
    start: "2026-11-05",
    end: "2026-11-05",
    officialUrl: "https://www.example.go.kr/events/finance-open",
    source: "서울특별시 공지사항",
    checkedAt: "2026-10-14",
    editorStatus: "변경 확인 중",
  },
  {
    id: "ev-5",
    title: "부동산 세무 정보 박람회",
    category: "기타",
    host: "○○전시 주식회사",
    place: "○○컨벤션센터 1홀",
    regionCode: "11680",
    start: "2026-10-30",
    end: "2026-11-01",
    officialUrl: "https://www.example.com/fair",
    source: "주최사 안내",
    checkedAt: "2026-10-12",
    sponsored: true,
  },
  {
    id: "ev-6",
    title: "재산세 고지 안내 설명회",
    category: "세무·재정",
    host: "강남구청 세무관리과",
    place: "강남구청 별관 3층 대회의실",
    regionCode: "11680",
    start: "2026-10-08",
    end: "2026-10-08",
    officialUrl: "https://www.example.go.kr/events/property-tax",
    source: "강남구청 공지사항",
    checkedAt: "2026-10-01",
  },
];

const hotNews = (
  <HotNewsItemCard
    region="서울특별시 강남구"
    summary="강남구가 내년 재산세 고지서에 납부 기한과 납부 방법 안내를 더 크게 싣기로 했습니다. 고지서는 7월과 9월에 나갑니다."
    publisher="강남구청 보도자료"
    publishedAt="2026-10-14"
    sourceUrl="https://www.example.go.kr/press/property-tax-bill"
    license="kogl-1"
  />
);

const officialSource = (
  <OfficialSourceCard
    kind="예산/결산"
    title="2027년도 강남구 예산안 개요"
    publisher="서울특별시 강남구"
    basisDate="2026-10-01"
    checkedAt="2026-10-13"
    rights="kogl-1"
    url="https://www.example.go.kr/budget/2027"
    articles={[{ title: "강남구 내년 예산, 어디에 쓰이나", href: "/news/gangnam-budget-2027" }]}
  />
);

const presale = (
  <PresaleInfoCard
    name="○○지구 공공분양 본청약"
    region="서울특별시 강남구"
    supply="총 820세대 중 일반공급 410세대"
    subscriptionStart="2026-11-09"
    subscriptionEnd="2026-11-11"
    noticeUrl="https://www.example.or.kr/notice/presale-2026-11"
    checkedAt="2026-10-13"
    projectHref="/realestate/projects/oo-district"
  />
);

const article = (title: string, summary: string) => (
  <LinkCard href="/news/sample">
    <span className="block text-[19px] font-black text-navy-900">{title}</span>
    <span className="mt-2 block text-[15px] text-navy-600">{summary}</span>
  </LinkCard>
);

const taxLinks: RegionTaxLink[] = [
  { kind: "explainer", label: "재산세 고지서 읽는 법", href: "/tax/explainers/property-tax-bill" },
  { kind: "situation", label: "집을 샀어요", href: "/situations/bought-house" },
  { kind: "sm-calculator", label: "취득세 계산하기", href: "https://sm.example.com/calc/acquisition" },
  { kind: "official", label: "강남구 지방세 감면 조례 원문", href: "https://www.example.go.kr/ordinance/local-tax" },
  { kind: "calculator", label: "재산세 계산해 보기", href: "/calc/property", enabled: false },
];

const stages: ProjectStage[] = [
  {
    name: "정비구역 지정",
    record: { noticeNo: "제2024-101호", noticeDate: "2024-03-14", agency: "서울특별시", sourceUrl: "https://www.example.go.kr/gosi/2024-101", checkedAt: "2026-10-13" },
    taxLens: "구역 지정만으로는 취득세가 생기지 않습니다.",
  },
  {
    name: "조합설립인가",
    record: { noticeNo: "제2025-055호", noticeDate: "2025-06-02", agency: "서울특별시 강남구", sourceUrl: "https://www.example.go.kr/gosi/2025-055", checkedAt: "2026-10-13" },
  },
  {
    name: "사업시행계획인가",
    record: { noticeNo: "제2026-210호", noticeDate: "2026-09-30", agency: "서울특별시 강남구", sourceUrl: "https://www.example.go.kr/gosi/2026-210", checkedAt: "2026-10-13", underReview: true },
  },
  { name: "관리처분계획인가", taxLens: "인가 뒤 조합원 입주권은 취득세 주택 수에 들어갑니다." },
  { name: "착공" },
  { name: "준공", taxLens: "새 집의 취득세는 사용승인일부터 60일 안에 신고합니다." },
];

const fact = (label: string, value: string, unit: string, article: string) => ({ label, value, unit, article, basisDate: "2026-10-01", reviewer: "감수자 A(견본)" });
const methods: DevMethodComparisonProps["methods"] = {
  redevelopment: {
    law: "도시 및 주거환경정비법",
    operator: "조합(토지등소유자)",
    target: "정비기반시설이 열악하고 노후 건축물이 밀집한 지역",
    procedure: "정비구역 지정 → 조합설립인가 → 사업시행계획인가 → 관리처분계획인가 → 준공",
    facts: [fact("조합설립 토지등소유자 동의", "75", "%", "도시정비법 제35조")],
    taxIssue: "관리처분 뒤 입주권의 주택 수, 새 건축물 원시취득",
    href: "/realestate/development-methods/redevelopment",
  },
  reconstruction: {
    law: "도시 및 주거환경정비법",
    operator: "조합(구분소유자)",
    target: "정비기반시설은 양호하나 노후 공동주택이 밀집한 지역",
    procedure: "안전진단 → 정비구역 지정 → 조합설립인가 → 사업시행계획인가 → 관리처분계획인가",
    facts: [fact("조합설립 전체 구분소유자 동의", "75", "%", "도시정비법 제35조")],
    taxIssue: "멸실 전후 재산세 과세 대상, 새 건축물 원시취득",
  },
  small_scale: {
    law: "빈집 및 소규모주택 정비에 관한 특례법",
    operator: "조합 또는 토지등소유자",
    target: "가로구역·소규모 노후 주택 단지",
    procedure: "조합설립인가 → 사업시행계획인가 → 관리처분계획인가 → 준공",
    facts: [fact("가로주택정비 조합설립 동의", "80", "%", "소규모주택정비법 제23조")],
    taxIssue: "소규모 정비 감면 조문의 요건과 사후 관리",
  },
  public: {
    law: "도시 및 주거환경정비법",
    operator: "한국토지주택공사 등 공공시행자",
    target: "공공시행자 지정을 요청한 정비구역",
    procedure: "공공시행자 지정 → 사업시행계획인가 → 관리처분계획인가",
    facts: [fact("공공시행자 지정 요청 토지면적 동의", "50", "% 이상", "도시정비법 제26조")],
    taxIssue: "공공시행자 취득분의 감면 여부",
  },
  trust: {
    law: "도시 및 주거환경정비법",
    operator: "신탁업자(사업시행자 지정)",
    target: "신탁업자를 사업시행자로 지정한 정비구역",
    procedure: "신탁업자 지정 → 사업시행계획인가 → 관리처분계획인가",
    facts: [fact("지정개발자 신탁 토지면적", "3분의 1", " 이상", "도시정비법 시행령 제21조")],
    taxIssue: "신탁재산 재산세 납세의무자(위탁자)",
  },
  renewal: {
    law: "도시재정비 촉진을 위한 특별법",
    operator: "시장·군수 등, 정비사업 시행자",
    target: "재정비촉진지구",
    procedure: "재정비촉진지구 지정 → 재정비촉진계획 결정 → 개별 사업 시행",
    facts: [fact("주거지형 촉진지구 면적", "50", "만㎡ 이상", "도시재정비법 시행령 제6조")],
    taxIssue: "촉진지구 안 개별 사업의 취득세 쟁점",
  },
  speed_integrated: {
    law: "서울특별시 운영 기준",
    operator: "서울특별시(계획 지원)",
    target: "정비계획 수립을 지원받는 구역",
    procedure: "후보지 선정 → 정비계획 수립 지원 → 정비구역 지정",
    facts: [fact("후보지 신청 토지등소유자 동의", "30", "%", "서울특별시 공모 기준")],
    taxIssue: "절차 자체로 생기는 지방세 쟁점은 없음 — 본 사업 유형을 따른다",
  },
};

const approval = { by: "편집자 A", at: "2026-10-15T10:00:00+09:00", reason: "같은 정비구역의 관리처분 단계를 다룸" };

export function LocalSection() {
  return (
    <section>
      <SectionTitle>local</SectionTitle>
      <div className="space-y-6">
        <Specimen name="분야 허브 머리">
          <FieldHubHead
            field="realestate"
            eyebrow="REAL ESTATE"
            title="부동산"
            intro="지역 개발과 정비사업의 진행을 공식 원문으로 확인합니다."
            tabs={{
              current: "projects",
              items: [
                { id: "projects", label: "프로젝트", href: "/realestate/projects" },
                { id: "presale", label: "분양 정보", href: "/realestate/presale" },
                { id: "methods", label: "개발방법 비교", href: "/realestate/development-methods" },
              ],
            }}
            taxPoint={taxPoint}
          />
        </Specimen>

        <Specimen name="지역 허브 머리">
          <RegionHubHead
            sido={SIDO}
            sigungu={SIGUNGU}
            sigunguOptions={[
              { name: "서초구", href: "/local/seoul/seocho-gu" },
              { name: "송파구", href: "/local/seoul/songpa-gu" },
              { name: "강동구", href: "/local/seoul/gangdong-gu" },
            ]}
            taxPoint={<FieldTaxPoint {...taxPoint} />}
            filter={<TopicFilter basePath={SIGUNGU.href} topic="local_tax" />}
            blocks={<LocalHubBlocks weekly={{ items: [hotNews], meta: "2026-42 · 10.12~10.18 · 발행 2026-10-16" }} localTax={{ items: [article("강남구 내년 재산세 고지, 무엇이 달라지나", "고지서 안내 문구와 납부 기한을 정리했습니다.")] }} />}
            taxLinks={<RegionTaxLinks links={taxLinks.slice(0, 3)} />}
          />
        </Specimen>

        <Specimen name="지자체 허브 블록">
          <LocalHubBlocks
            weekly={{ items: [hotNews], meta: "2026-42 · 10.12~10.18 · 발행 2026-10-16", more: { href: "/local/seoul/weekly/2026-42", label: "이번 주 핫뉴스 전체 보기" } }}
            localTax={{ items: [article("강남구 내년 재산세 고지, 무엇이 달라지나", "고지서 안내 문구와 납부 기한을 정리했습니다."), article("구 예산안, 지방세 수입은 얼마나", "예산안의 세입 구성을 원문과 함께 봅니다.")] }}
            realEstate={{ items: [presale], fallbackRegion: "서울특별시" }}
            events={{ items: [] }}
            sources={{ items: [officialSource] }}
          />
        </Specimen>

        <Specimen name="분야 필터">
          <TopicFilter basePath="/local/seoul/gangnam-gu" topic="realestate" />
        </Specimen>

        <Specimen name="지역 세금 연결 블록">
          <RegionTaxLinks links={taxLinks} />
        </Specimen>

        <Specimen name="공식 자료 카드">
          <div className="max-w-md">{officialSource}</div>
        </Specimen>

        <Specimen name="핫뉴스 항목 카드">
          <div className="max-w-md">{hotNews}</div>
        </Specimen>

        <Specimen name="행사 카드">
          <div className="grid gap-4 sm:grid-cols-2">
            <EventCard event={events[0]} today={TODAY} recheckAfterDays={RECHECK_DAYS} />
            <EventCard event={events[2]} today={TODAY} recheckAfterDays={RECHECK_DAYS} />
            <EventCard event={events[4]} today={TODAY} recheckAfterDays={RECHECK_DAYS} />
            <EventCard event={events[3]} today={TODAY} recheckAfterDays={RECHECK_DAYS} />
          </div>
        </Specimen>

        <Specimen name="행사 상태 배지">
          <div className="flex flex-wrap items-center gap-3">
            <EventStatusBadge status="예정" checkedAt="2026-10-15" />
            <EventStatusBadge status="진행" />
            <EventStatusBadge status="종료" />
            <EventStatusBadge status="취소" />
            <EventStatusBadge status="변경 확인 중" />
          </div>
        </Specimen>

        <Specimen name="행사 달력">
          <EventCalendar events={events} today={TODAY} recheckAfterDays={RECHECK_DAYS} scope="events-page" />
        </Specimen>

        <Specimen name="분양 정보 카드">
          <div className="max-w-md">{presale}</div>
        </Specimen>

        <Specimen name="프로젝트 단계 타임라인">
          <ProjectStageTimeline title="○○구역 주택재개발정비사업 단계" stages={stages} />
        </Specimen>

        <Specimen name="개발방법 비교표">
          <p className="mb-4 font-mono text-[13px] tracking-wide text-navy-600">견본 값 — 실제 숫자 요건은 dev_method_facts에서 읽는다</p>
          <DevMethodComparison methods={methods} />
        </Specimen>

        <Specimen name="신탁 구조도">
          <TrustStructureDiagram
            title="담보신탁 구조"
            nodes={[
              { id: "truster", role: "위탁자", note: "토지 소유자(시행사)", col: 0, row: 0, localTaxpayer: "재산세" },
              { id: "trustee", role: "수탁자", note: "신탁회사", col: 1, row: 0 },
              { id: "lender", role: "우선수익자", note: "대주단", col: 1, row: 1 },
            ]}
            flows={[
              { from: "truster", to: "trustee", kind: "right", label: "소유권 이전(신탁등기)" },
              { from: "trustee", to: "lender", kind: "right", label: "우선수익권" },
              { from: "lender", to: "truster", kind: "money", label: "사업비 대출" },
            ]}
          />
        </Specimen>

        <Specimen name="이슈 묶음 머리">
          <IssueBundleHead
            title="○○구역 관리처분, 무엇이 달라지나"
            summary="같은 구역을 다룬 지방세·부동산·지자체 기사를 한곳에 모았습니다."
            articles={[
              { id: "a1", field: "지방세", card: article("입주권과 취득세 주택 수", "관리처분 뒤 입주권이 주택 수에 들어가는 때를 정리했습니다."), approval },
              { id: "a2", field: "부동산", card: article("○○구역 관리처분계획 인가", "인가 고시 원문과 다음 단계를 봅니다."), approval },
              { id: "a3", field: "지자체뉴스", card: article("강남구, 주민설명회 연다", "관리처분 내용 설명회 일정과 장소입니다."), approval },
            ]}
            taxLens={
              <aside className="rounded-2xl border border-navy-100 bg-white p-6 text-[15px] text-navy-600">
                「지방세로 읽기」 박스 자리 (다른 묶음 컴포넌트)
              </aside>
            }
          />
        </Specimen>

        <Specimen name="분야 지방세 포인트 블록">
          <FieldTaxPoint {...taxPoint} />
        </Specimen>
      </div>
    </section>
  );
}
