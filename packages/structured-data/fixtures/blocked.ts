/**
 * 차단 견본 — 통과 견본에서 항목 하나만 어긴 화면 데이터 객체.
 * 생성한 JSON-LD를 validate()에 넣으면 적힌 오류 하나만 나와야 한다 (W1-b "차단 견본은 실패").
 */
import type { PageInput } from "../src/models";
import {
  sampleArticle,
  sampleBook,
  sampleCourse,
  sampleDataset,
  sampleEvent,
  sampleOrganization,
  samplePerson,
  sampleVideoArticle,
} from "./samples";

export interface BlockedSample {
  id: string;
  /** 무엇을 어겼는지 */
  violation: string;
  input: PageInput;
  expected: { path: string; code: "required" | "format" | "order" };
}

export const blockedSamples: BlockedSample[] = [
  {
    id: "article-no-image",
    violation: "대표 이미지 없음",
    input: { kind: "article", article: { ...sampleArticle, mainImage: undefined } },
    expected: { path: "NewsArticle.image", code: "required" },
  },
  {
    id: "article-no-author",
    violation: "저자 없음 (GEO 차단 항목)",
    input: { kind: "article", article: { ...sampleArticle, authors: [] } },
    expected: { path: "NewsArticle.author", code: "required" },
  },
  {
    id: "article-blank-author-name",
    violation: "저자 이름이 빈 글자",
    input: { kind: "article", article: { ...sampleArticle, authors: [{ kind: "person", name: "  " }] } },
    expected: { path: "NewsArticle.author[0].name", code: "required" },
  },
  {
    id: "article-modified-before-published",
    violation: "수정일이 최초 발행일보다 이르다 (날짜 조작, OPT-10)",
    input: { kind: "article", article: { ...sampleArticle, dateModified: "2026-10-19T09:00:00+09:00" } },
    expected: { path: "NewsArticle.dateModified", code: "order" },
  },
  {
    id: "article-time-without-offset",
    violation: "발행 시각에 시간대 오프셋이 없다",
    input: { kind: "article", article: { ...sampleArticle, datePublished: "2026-10-20T09:00:00" } },
    expected: { path: "NewsArticle.datePublished", code: "format" },
  },
  {
    id: "video-no-thumbnail",
    violation: "동영상 썸네일 없음",
    input: {
      kind: "article",
      article: { ...sampleVideoArticle, video: { ...sampleVideoArticle.video!, thumbnailUrl: "" } },
    },
    expected: { path: "VideoObject.thumbnailUrl", code: "required" },
  },
  {
    id: "organization-relative-url",
    violation: "매체 주소가 상대 경로",
    input: { kind: "mediaOrganization", organization: { ...sampleOrganization, url: "/about" } },
    expected: { path: "NewsMediaOrganization.url", code: "format" },
  },
  {
    id: "profile-blank-name",
    violation: "인물 이름이 빈 글자",
    input: { kind: "person", person: { ...samplePerson, name: "" } },
    expected: { path: "ProfilePage.mainEntity.name", code: "required" },
  },
  {
    id: "event-no-address",
    violation: "행사 장소 주소 없음",
    input: { kind: "event", event: { ...sampleEvent, venue: { name: "예시시청 대회의실" } } },
    expected: { path: "Event.location.address", code: "required" },
  },
  {
    id: "event-end-before-start",
    violation: "종료 일시가 시작 일시보다 이르다",
    input: { kind: "event", event: { ...sampleEvent, endDate: "2026-11-03T13:00:00+09:00" } },
    expected: { path: "Event.endDate", code: "order" },
  },
  {
    id: "book-no-edition",
    violation: "판차 없음 (BIZ-01)",
    input: { kind: "book", book: { ...sampleBook, bookEdition: "" } },
    expected: { path: "Book.bookEdition", code: "required" },
  },
  {
    id: "course-blank-provider",
    violation: "강좌 운영 기관 이름 없음",
    input: { kind: "course", course: { ...sampleCourse, provider: { name: "" } } },
    expected: { path: "Course.provider.name", code: "required" },
  },
  {
    id: "dataset-short-description",
    violation: "통계 설명이 50자 미만",
    input: { kind: "dataset", dataset: { ...sampleDataset, description: "PF 대출 연체율 시계열" } },
    expected: { path: "Dataset.description", code: "format" },
  },
];
