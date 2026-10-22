// 편집 화면 형식 콘텐츠 도우미 — 인포그래픽 템플릿 틀·같은 내용 칸 글자 ↔ 저장 모양, 동영상·포토·인포그래픽 '발행 전 확인' 줄 (ART-07 · ART-08 · ART-09)
import { describe, expect, test } from "vitest";
import { infographicSaveProblems } from "@ltr/editorial";
import {
  INFOGRAPHIC_SKELETONS,
  changeTemplate,
  durationFromText,
  infographicChecks,
  infographicDataFromText,
  infographicDataToText,
  mediaOptionLabel,
  photoChecks,
  photoSetSummary,
  videoChecks,
  type EditorMedia,
} from "./media-blocks";

const media = (id: number, over: Partial<EditorMedia> = {}): EditorMedia => ({
  id,
  path: `media/${id}.jpg`,
  alt: null,
  rights_status: "confirmed",
  credit: "가온시청",
  photographer: "김가온",
  license: "공공누리 제1유형",
  kind: "photo",
  width: 1920,
  height: 1080,
  ...over,
});
const okOf = (lines: { key: string; ok: boolean }[]) => Object.fromEntries(lines.map((l) => [l.key, l.ok]));

describe("인포그래픽 템플릿 (ART-07 템플릿 3종)", () => {
  test("빈 칸에서 템플릿을 고르면 그 틀 — 절차 흐름은 목록, 비교·핵심 숫자는 머리 칸만 있는 표", () => {
    expect(changeTemplate({ dataKind: "list", dataText: "" }, "compare")).toEqual({ template: "compare", dataKind: "table", dataText: "구분 | 비교 1 | 비교 2" });
    expect(changeTemplate({ dataKind: "table", dataText: "   " }, "numbers")).toEqual({ template: "numbers", dataKind: "table", dataText: "항목 | 숫자" });
    expect(changeTemplate({ dataKind: "table", dataText: "" }, "flow")).toEqual({ template: "flow", dataKind: "list", dataText: "" });
  });

  test("이미 쓴 내용은 템플릿을 바꿔도 그대로 둔다", () => {
    expect(changeTemplate({ dataKind: "list", dataText: "계약\n신고" }, "compare")).toEqual({ template: "compare", dataKind: "list", dataText: "계약\n신고" });
  });

  test("틀만 있는(내용 행 0) 표는 저장되지 않는다 — 편집자가 내용을 써야 한다", () => {
    for (const t of ["compare", "numbers"] as const) {
      const sk = INFOGRAPHIC_SKELETONS[t];
      expect(infographicSaveProblems({ alt: "그림", data: infographicDataFromText(sk.kind, sk.text) }).map((p) => p.field)).toEqual(["data"]);
    }
  });
});

describe("같은 내용 칸 글자 ↔ 저장 모양", () => {
  test("표 — 첫 줄이 머리 칸, 칸은 | 로, 빈 줄은 뺀다", () => {
    expect(infographicDataFromText("table", "구분 | 올해\n\n세율 | 1%\n감면|50%")).toEqual({ kind: "table", columns: ["구분", "올해"], rows: [["세율", "1%"], ["감면", "50%"]] });
  });

  test("목록 — 줄마다 한 항목, 앞뒤 빈칸·빈 줄은 뺀다", () => {
    expect(infographicDataFromText("list", " 계약 \n\n잔금\r\n신고")).toEqual({ kind: "list", items: ["계약", "잔금", "신고"] });
  });

  test("빈 글자는 null (저장 불가 사유가 된다)", () => {
    expect(infographicDataFromText("table", "  \n ")).toBeNull();
    expect(infographicDataFromText("list", "")).toBeNull();
  });

  test("저장 모양 → 글자 → 저장 모양이 같다", () => {
    for (const data of [
      { kind: "table" as const, columns: ["구분", "올해", "작년"], rows: [["세율", "1%", "2%"]] },
      { kind: "list" as const, items: ["계약", "신고"] },
    ]) {
      const t = infographicDataToText(data);
      expect(infographicDataFromText(t.kind, t.text)).toEqual(data);
    }
    expect(infographicDataToText(null)).toEqual({ kind: "list", text: "" });
  });
});

describe("발행 전 확인 줄", () => {
  const all = [media(1), media(2, { width: 1200, height: 900 }), media(3, { rights_status: "unconfirmed", credit: null, license: null }), media(4, { alt: "구청 창구", credit: "  " })];

  test("동영상 — 다 갖추면 모두 됨", () => {
    expect(videoChecks({ embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", summary: "요약", captions: true, thumbnailMediaId: "1" }, all).every((l) => l.ok)).toBe(true);
  });

  test("동영상 — 주소·요약·자막·썸네일 비율·권리를 하나씩 본다", () => {
    expect(okOf(videoChecks({ embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ", summary: " ", captions: false, thumbnailMediaId: "2" }, all))).toEqual({
      embedUrl: false,
      summary: false,
      captions: false,
      thumbnail: true,
      ratio: false,
      rights: true,
    });
    expect(okOf(videoChecks({ embedUrl: "", summary: "", captions: false, thumbnailMediaId: "" }, all))).toMatchObject({ thumbnail: false, ratio: false, rights: false });
    expect(okOf(videoChecks({ embedUrl: "", summary: "", captions: false, thumbnailMediaId: "3" }, all))).toMatchObject({ thumbnail: true, ratio: true, rights: false });
    expect(okOf(videoChecks({ embedUrl: "", summary: "", captions: false, thumbnailMediaId: "999" }, all)), "목록에 없는 번호").toMatchObject({ thumbnail: false });
  });

  test("포토 — 사진마다 출처·이용 조건·대체 텍스트(블록 또는 이미지 기록)·권리", () => {
    expect(photoChecks({ mediaId: "1", alt: "창구" }, all).every((l) => l.ok)).toBe(true);
    expect(okOf(photoChecks({ mediaId: "3", alt: "" }, all))).toEqual({ credit: false, license: false, alt: false, rights: false });
    expect(okOf(photoChecks({ mediaId: "4", alt: "" }, all)), "출처 공백은 없는 것 · 이미지 기록의 대체 텍스트로 통과").toMatchObject({ credit: false, alt: true });
  });

  test("포토 묶음 요약 — 이미지 블록만 센다", () => {
    const blocks = [
      { type: "image", mediaId: "1", alt: "a" },
      { type: "paragraph", mediaId: "", alt: "" },
      { type: "image", mediaId: "3", alt: "b" },
    ];
    expect(photoSetSummary(blocks, all)).toEqual({ photos: 2, incomplete: 1 });
    expect(photoSetSummary([], all)).toEqual({ photos: 0, incomplete: 0 });
  });

  test("인포그래픽 — 대체 텍스트·같은 내용·그림 권리", () => {
    expect(okOf(infographicChecks({ mediaId: "3", alt: "", dataKind: "list", dataText: "" }, all))).toEqual({ alt: false, data: false, rights: false });
    expect(infographicChecks({ mediaId: "1", alt: "그림", dataKind: "list", dataText: "계약" }, all).every((l) => l.ok)).toBe(true);
  });
});

describe("고르기 칸·재생 시간 칸", () => {
  test("이미지 고르기 글자 — 번호·설명·크기·권리 상태", () => {
    expect(mediaOptionLabel(media(1, { alt: "창구" }))).toBe("1 · 창구 · 1920×1080 (권리 확인)");
    expect(mediaOptionLabel(media(3, { width: null, height: null, rights_status: "rejected" }))).toBe("3 · media/3.jpg (사용 불가)");
    // W4 5단계 — 공공누리 유형·자르기 불가를 함께 (PR-07 · REG1-09)
    expect(mediaOptionLabel(media(4, { alt: "구청", license_type: "kogl_2", crop_allowed: false }))).toBe("4 · 구청 · 1920×1080 (권리 확인 · 공공누리 제2유형 (출처표시·상업적 이용금지) · 자르기 불가)");
    expect(mediaOptionLabel(media(5, { alt: "자체", license_type: "not_applicable", crop_allowed: true }))).toBe("5 · 자체 · 1920×1080 (권리 확인 · 공공누리 해당 없음)");
  });

  test.each([
    ["", null],
    ["  ", null],
    ["0", 0],
    ["95", 95],
    ["86400", 86_400],
  ])("재생 시간 '%s' → %s", (text, value) => expect(durationFromText(text)).toBe(value));

  test.each(["86401", "-1", "1.5", "1분", "123456"])("재생 시간 '%s' → 숫자 아님(NaN — 저장 전 확인이 막는다)", (text) => expect(durationFromText(text)).toBeNaN());
});
