// 형식 콘텐츠·제휴사 화면 값 (ART-07 · ART-08 · ART-09 · ART-10, W2-c 설계 8.4) — 인포그래픽 화면 값 · 사진 표기 줄 · 측정 속성 · 화면 문구
import { describe, expect, test } from "vitest";
import { SEED_DICTIONARIES, checkScreenCopy, R8_THRESHOLDS } from "@ltr/editorial";
import { validateEvent } from "@/lib/analytics/events";
import {
  PARTNER_COPY,
  PHOTO_LIST_COPY,
  VIDEO_LIST_COPY,
  infographicNotes,
  infographicView,
  partnerListTitle,
  partnerViewedProps,
  photoCreditLine,
  videoPlayedProps,
  videoTitle,
} from "./media-view";

describe("인포그래픽 화면 값 (ART-07)", () => {
  test("절차 흐름 목록은 번호 목록, 그 밖의 목록은 점 목록", () => {
    expect(infographicView({ caption: "", alt: "그림", template: "flow", data: { kind: "list", items: ["계약", "신고"] } })).toEqual({ kind: "list", items: ["계약", "신고"], ordered: true });
    expect(infographicView({ caption: "", alt: "그림", template: "numbers", data: { kind: "list", items: ["60일"] } })).toEqual({ kind: "list", items: ["60일"], ordered: false });
  });

  test("표의 화면 읽기 캡션은 블록 캡션, 없으면 대체 텍스트", () => {
    const data = { kind: "table" as const, columns: ["구분", "올해"], rows: [["세율", "1%"]] };
    expect(infographicView({ caption: "세율 비교", alt: "그림", template: "compare", data })).toEqual({ kind: "table", caption: "세율 비교", columns: ["구분", "올해"], rows: [["세율", "1%"]] });
    expect(infographicView({ caption: " ", alt: "세율 그림", template: "compare", data })).toMatchObject({ caption: "세율 그림" });
  });

  test("그림 아래 줄 — 단위·출처(있을 때) · 그림 출처", () => {
    expect(infographicNotes({ unit: "%", source: "세정과" }, "편집국")).toEqual(["단위 % · 출처 세정과", "그림 편집국"]);
    expect(infographicNotes({ unit: "", source: "세정과" }, null)).toEqual(["출처 세정과"]);
    expect(infographicNotes(null, " ")).toEqual([]);
  });
});

describe("포토 기사 사진 표기 줄 (ART-09 사진마다 저작권·촬영자)", () => {
  test("촬영 · 출처 · 이용 조건 차례, 빈 칸은 뺀다", () => {
    expect(photoCreditLine({ photographer: "김가온", credit: "가온시청", license: "공공누리 제1유형" })).toBe("촬영 김가온 · 출처 가온시청 · 이용 조건 공공누리 제1유형");
    expect(photoCreditLine({ photographer: null, credit: "가온시청", license: " " })).toBe("출처 가온시청");
  });
});

describe("동영상 카드 제목·측정 속성 — 수집 API 검사를 지나는 모양", () => {
  test("제목은 블록 설명, 없으면 기사 제목", () => {
    expect(videoTitle("신고 따라 하기", "기사")).toBe("신고 따라 하기");
    expect(videoTitle("  ", "기사 제목")).toBe("기사 제목");
  });

  test("video_played(분야 필수 · 기사 번호) · partner_content_viewed(제휴사·기사 번호)", () => {
    expect(validateEvent({ name: "video_played", section: "tax", props: videoPlayedProps(12) }).ok).toBe(true);
    expect(validateEvent({ name: "partner_content_viewed", section: "realestate", props: partnerViewedProps(3, 12) }).ok).toBe(true);
    expect(validateEvent({ name: "video_played", props: videoPlayedProps(12) }).ok, "동영상 재생은 분야 필수").toBe(false);
  });
});

describe("화면 문구 — 금지·공포 표현 0, 안내 문장 60자 이하 (UX-01 · UX-03)", () => {
  test("목록·제휴사 화면 문구", () => {
    const copy = [
      ...Object.values(VIDEO_LIST_COPY),
      ...Object.values(PHOTO_LIST_COPY),
      ...Object.values(PARTNER_COPY),
      partnerListTitle(0),
      partnerListTitle(3),
    ].map((text, i) => ({ id: `copy-${i}`, kind: "guide" as const, text }));
    expect(checkScreenCopy(copy, { today: "2026-10-18", dictionaries: SEED_DICTIONARIES, thresholds: R8_THRESHOLDS, seoLint: null, similarity: null })).toEqual([]);
  });

  test("제휴 기사 수 글자", () => {
    expect(partnerListTitle(3)).toBe("제휴 기사 3건");
    expect(partnerListTitle(0)).toBe("아직 공개된 제휴 기사가 없습니다");
  });
});
