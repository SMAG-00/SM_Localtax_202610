/**
 * 통과 견본 — 유형별 화면 데이터 객체 (OPT-02 "유형별 견본 페이지 7유형").
 * 내용은 모두 지어낸 것이다 — 실존 인물·기관·도서가 아니다. 주소는 예약 도메인(.example)만 쓴다.
 */
import type {
  ArticleView,
  BookView,
  BreadcrumbView,
  CourseView,
  DatasetView,
  EventView,
  OrganizationRef,
  OrganizationView,
  PageInput,
  PersonView,
  VideoView,
} from "../src/models";

/** 매체 이름은 호출하는 쪽이 넘긴다 — 견본용 가상 매체 */
export const samplePublisher: OrganizationRef = {
  name: "가상지방세신문",
  url: "https://news.example",
  logo: { url: "https://news.example/brand/logo.png", width: 600, height: 60 },
};

export const sampleArticle: ArticleView = {
  url: "https://news.example/news/acquisition-tax-relief-deadline",
  title: "취득세 감면 신청 기한, 잔금일로부터 60일 안에 해야",
  summary: "생애최초 주택 취득세 감면은 잔금일로부터 60일 안에 신청해야 한다.",
  sectionName: "지방세",
  authors: [{ kind: "person", name: "한예린", url: "https://news.example/people/han-yerin" }],
  publisher: samplePublisher,
  datePublished: "2026-10-20T09:00:00+09:00",
  dateModified: "2026-10-21T14:30:00+09:00",
  mainImage: { url: "https://news.example/images/2026/10/relief-deadline.jpg", width: 1200, height: 675 },
};

export const sampleVideo: VideoView = {
  name: "1분 해설 — 재산세 납부 기한",
  description: "재산세 7월·9월 납부 기한과 분할 납부 조건을 1분 동안 설명한다.",
  thumbnailUrl: "https://news.example/images/2026/10/property-tax-video.jpg",
  uploadDate: "2026-10-18T10:00:00+09:00",
  duration: "PT1M30S",
  embedUrl: "https://www.youtube-nocookie.com/embed/EXAMPLE0001",
};

export const sampleVideoArticle: ArticleView = {
  url: "https://news.example/news/property-tax-due-dates-video",
  title: "재산세 납부 기한 1분 해설",
  sectionName: "지방세",
  authors: [{ kind: "person", name: "오지훈", url: "https://news.example/people/oh-jihun" }],
  publisher: samplePublisher,
  datePublished: "2026-10-18T10:00:00+09:00",
  mainImage: { url: "https://news.example/images/2026/10/property-tax-video.jpg", width: 1280, height: 720 },
  video: sampleVideo,
};

/** 광고 기사 — 화면 제목에 "[광고]"가 붙는다 */
export const sampleAdArticle: ArticleView = {
  url: "https://news.example/news/tax-filing-app-guide",
  title: "지방세 신고, 앱 하나로 챙기는 법",
  sponsorship: { kind: "광고" },
  authors: [{ kind: "organization", name: "가상지방세신문 광고국" }],
  publisher: samplePublisher,
  datePublished: "2026-10-19T08:00:00+09:00",
  mainImage: { url: "https://news.example/images/2026/10/tax-app.jpg", width: 1200, height: 675 },
};

/** 공동 기획 기사 — 제휴 배지 "공동 기획 ○○" (ART-10) */
export const samplePartnerArticle: ArticleView = {
  url: "https://news.example/news/local-finance-series-1",
  title: "지방재정 바로 보기 ① 세입 구조",
  sponsorship: { kind: "공동 기획", partnerName: "예시회계연구소" },
  authors: [{ kind: "person", name: "한예린", url: "https://news.example/people/han-yerin" }],
  publisher: samplePublisher,
  datePublished: "2026-10-17T07:00:00+09:00",
  mainImage: { url: "https://news.example/images/2026/10/local-finance.jpg", width: 1200, height: 675 },
};

export const sampleArticleBreadcrumb: BreadcrumbView = {
  items: [
    { name: "홈", url: "https://news.example/" },
    { name: "지방세", url: "https://news.example/tax" },
    { name: "취득세 감면 신청 기한, 잔금일로부터 60일 안에 해야" },
  ],
};

export const sampleOrganization: OrganizationView = {
  name: "가상지방세신문",
  url: "https://news.example",
  logo: { url: "https://news.example/brand/logo.png", width: 600, height: 60 },
  description: "지방세·부동산·지방재정·지자체 소식을 다루는 가상의 전문 매체",
  sameAs: ["https://social.example/news-example"],
  policies: {
    publishingPrinciples: "https://news.example/about/editorial-policy",
    correctionsPolicy: "https://news.example/about/corrections",
    ethicsPolicy: "https://news.example/about/ethics",
  },
};

export const samplePerson: PersonView = {
  url: "https://news.example/people/yoon-seojin",
  name: "윤서진",
  jobTitle: { text: "수석 연구위원", evidenceId: "ev-2026-0001" },
  affiliation: { text: "예시세무회계사무소", evidenceId: "ev-2026-0002" },
  credentials: [{ text: "세무사", evidenceId: "ev-2026-0003" }],
  knowsAbout: ["취득세", "재산세"],
  sameAs: ["https://profiles.example/yoon-seojin"],
  image: { url: "https://news.example/images/people/yoon-seojin.jpg", width: 400, height: 400 },
};

export const sampleEvent: EventView = {
  url: "https://news.example/local/events/yesi-city-2027-budget-briefing",
  name: "예시시 2027년도 예산안 주민설명회",
  status: "예정",
  sponsored: false,
  startDate: "2026-11-03T14:00:00+09:00",
  endDate: "2026-11-03T16:00:00+09:00",
  venue: { name: "예시시청 대회의실", address: "예시시 중앙로 1" },
  organizer: { name: "예시시청", url: "https://city.example" },
  officialUrl: "https://city.example/notice/2027-budget-briefing",
};

/** 상업 행사 (LG-13) — '광고' 표기 */
export const sampleSponsoredEvent: EventView = {
  url: "https://news.example/local/events/sample-tax-seminar",
  name: "부동산 세금 설명회",
  status: "예정",
  sponsored: true,
  startDate: "2026-11-10T19:00:00+09:00",
  endDate: "2026-11-10T21:00:00+09:00",
  venue: { name: "예시빌딩 3층 세미나실", address: "예시시 상업로 20" },
  organizer: { name: "예시부동산컨설팅", url: "https://consulting.example" },
  officialUrl: "https://consulting.example/seminar/2026-11",
};

export const sampleBook: BookView = {
  url: "https://news.example/store/books/local-tax-practice-intro",
  name: "가상 지방세 실무 입문",
  authors: [{ kind: "person", name: "강도윤", url: "https://news.example/people/kang-doyun" }],
  bookEdition: "제3판",
  publisher: { name: "예시출판" },
  datePublished: "2026-03-02",
  image: { url: "https://news.example/images/books/local-tax-practice-intro.jpg", width: 600, height: 860 },
  numberOfPages: 512,
};

export const sampleCourse: CourseView = {
  url: "https://news.example/edu/2027-local-tax-amendment-course",
  name: "2027 개정 지방세법 실무 과정",
  description: "2027년 시행 지방세법 개정 내용을 세목별로 짚고 신고 실무 사례를 함께 본다.",
  provider: { name: "예시지방세교육원", url: "https://edu.example" },
  audience: "지자체 세무 공무원",
  sessions: [
    {
      startDate: "2026-12-07T09:30:00+09:00",
      endDate: "2026-12-08T17:00:00+09:00",
      mode: "onsite",
      location: { name: "예시교육원 강의실 2", address: "예시시 배움로 10" },
    },
  ],
};

export const sampleDataset: DatasetView = {
  url: "https://news.example/finance/trackers/pf-delinquency",
  name: "부동산 PF 대출 연체율 분기 추이",
  description:
    "부동산 프로젝트파이낸싱(PF) 대출의 업권별 연체율을 분기마다 모은 시계열이다. 값마다 제공기관·원문 주소·기준일·수집일을 함께 보존한다.",
  creator: { name: "예시금융통계원", url: "https://stats.example" },
  license: "https://stats.example/license",
  temporalCoverage: "2024-01/2026-06",
  spatialCoverage: "전국",
  variables: [{ name: "연체율", unitText: "%" }],
  dateModified: "2026-10-10",
  isBasedOn: "https://stats.example/pf/delinquency",
  distribution: [{ contentUrl: "https://news.example/finance/trackers/pf-delinquency.csv", encodingFormat: "text/csv" }],
};

/** 유형 대응표의 7유형 견본 페이지 — 키는 유형 대응표의 kind */
export const passSamples: Record<Exclude<PageInput["kind"], "collection">, PageInput> = {
  article: { kind: "article", article: sampleArticle, breadcrumb: sampleArticleBreadcrumb },
  mediaOrganization: { kind: "mediaOrganization", organization: sampleOrganization },
  person: { kind: "person", person: samplePerson },
  event: { kind: "event", event: sampleEvent },
  book: { kind: "book", book: sampleBook },
  course: { kind: "course", course: sampleCourse },
  dataset: { kind: "dataset", dataset: sampleDataset },
};

/** 7유형 밖의 통과 견본 — 동영상 기사·광고 기사·공동 기획 기사·상업 행사 */
export const extraPassSamples: { id: string; input: PageInput }[] = [
  {
    id: "weekly-collection",
    input: {
      kind: "collection",
      collection: {
        url: "https://news.example/realestate/weekly/2026-43",
        name: "이번 주 재테크 포인트 2026년 43주차",
        datePublished: "2026-10-23",
        items: [
          { name: "기사 하나", url: "https://news.example/news/a-1" },
          { name: "기사 둘", url: "https://news.example/news/a-2" },
          { name: "기사 셋", url: "https://news.example/news/a-3" },
        ],
      },
    },
  },
  { id: "video-article", input: { kind: "article", article: sampleVideoArticle } },
  { id: "ad-article", input: { kind: "article", article: sampleAdArticle } },
  { id: "partner-article", input: { kind: "article", article: samplePartnerArticle } },
  { id: "sponsored-event", input: { kind: "event", event: sampleSponsoredEvent } },
];
