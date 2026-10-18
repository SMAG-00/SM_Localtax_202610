// 형식 콘텐츠·제휴사 화면 값 (ART-08 · ART-09 · ART-10) — 동영상 카드 고르기 · 썸네일 번호 · 제휴사 공개 칸
import { describe, expect, test } from "vitest";
import { PARTNER_KINDS } from "@/lib/admin/partner-rules";
import type { StoredBlock } from "../articles/content";
import type { ArticleListItem } from "./cards";
import { PARTNER_KIND_NAMES, firstPlayableVideo, isPlayableVideo, parsePartnerId, partnerSiteUrl, videoListEntries, videoThumbnailIds, type MediaView } from "./media-logic";
import { publicBlocks, blockMediaIds } from "./article-logic";

const OK = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
const video = (thumb: string | null, embedUrl = OK): StoredBlock => ({ type: "video", embedUrl, caption: "", summary: "요약", captions: true, thumbnailMediaId: thumb, durationSeconds: 60 });
const mediaView = (id: number): MediaView => ({ id, src: `https://e2e.example.test/m/${id}.jpg`, alt: "", credit: null, photographer: null, license: null, width: 1280, height: 720 });
const item = (id: number) => ({ id, href: `/news/a${id}`, title: `기사 ${id}` }) as ArticleListItem;

describe("그릴 수 있는 동영상 (누르기 전 썸네일만 — ART-08)", () => {
  const readable = new Set(["5", "6"]);

  test("youtube-nocookie 주소 + 읽히는 썸네일만", () => {
    expect(isPlayableVideo(video("5"), readable)).toBe(true);
    expect(isPlayableVideo(video("7"), readable), "썸네일이 읽히지 않음(권리 미확인·초안)").toBe(false);
    expect(isPlayableVideo(video(null), readable), "썸네일 없음").toBe(false);
    expect(isPlayableVideo(video("5", "https://www.youtube.com/embed/dQw4w9WgXcQ"), readable), "youtube.com").toBe(false);
    expect(isPlayableVideo({ type: "paragraph", text: "x" }, readable)).toBe(false);
  });

  test("첫 그릴 수 있는 블록 — 앞의 그릴 수 없는 블록은 건너뛴다, 없으면 null", () => {
    expect(firstPlayableVideo([video("7"), video("6")], readable)).toMatchObject({ thumbnailMediaId: "6" });
    expect(firstPlayableVideo([video(null)], readable)).toBeNull();
  });

  test("공개 본문 블록 — 그릴 수 없는 동영상·대체 텍스트나 같은 내용이 없는 인포그래픽은 뺀다, 썸네일 번호도 media 읽기에 들어간다", () => {
    const blocks: StoredBlock[] = [
      video("5"),
      video("7"),
      video("5", "https://youtu.be/dQw4w9WgXcQ"),
      { type: "infographic", mediaId: "6", alt: "그림", caption: "", chart: null, template: "flow", data: { kind: "list", items: ["a"] } },
      { type: "infographic", mediaId: "6", alt: "", caption: "", chart: null, template: "flow", data: { kind: "list", items: ["a"] } },
      { type: "infographic", mediaId: "6", alt: "그림", caption: "", chart: null, template: "compare", data: null },
    ];
    expect(publicBlocks(blocks, readable).map((b, i) => `${b.type}${i}`)).toEqual(["video0", "infographic1"]);
    expect(blockMediaIds(blocks)).toEqual(["5", "7", "6"]);
  });
});

describe("동영상 목록 칸 — 동영상 카드, 그릴 수 없으면 기사 카드", () => {
  const bodies = new Map<number, readonly StoredBlock[]>([
    [1, [{ type: "paragraph", text: "본문" }, video("5")]],
    [2, [video("9")]],
    [3, [video("5", "https://www.youtube.com/embed/dQw4w9WgXcQ"), video("6")]],
  ]);

  test("읽을 썸네일 번호 — 기사마다 첫 정상 주소 동영상의 썸네일 (겹치면 하나)", () => {
    expect(videoThumbnailIds(bodies)).toEqual(["5", "9", "6"]);
  });

  test("썸네일이 읽힌 기사는 동영상 카드(재생 시간·자막), 아니면 video null(기사 카드), 본문을 못 읽은 기사도 기사 카드", () => {
    const media = new Map([
      ["5", mediaView(5)],
      ["6", mediaView(6)],
    ]);
    const entries = videoListEntries([item(1), item(2), item(3), item(4)], bodies, media);
    expect(entries.map((e) => [e.item.id, e.video?.thumbnail.id ?? null])).toEqual([
      [1, 5],
      [2, null],
      [3, 6],
      [4, null],
    ]);
    expect(entries[0]!.video).toMatchObject({ durationSeconds: 60, captions: true });
  });
});

describe("제휴사 공개 칸 (ART-10)", () => {
  test("제휴사 종류 글자는 DB 값 목록과 같다", () => {
    expect(Object.keys(PARTNER_KIND_NAMES).sort()).toEqual([...PARTNER_KINDS].sort());
  });

  test("누리집 주소는 http(s)만 바깥 링크로", () => {
    expect(partnerSiteUrl("https://gaon-tax.example/about")).toBe("https://gaon-tax.example/about");
    expect(partnerSiteUrl("http://gaon-tax.example")).toBe("http://gaon-tax.example/");
    for (const bad of ["javascript:alert(1)", "ftp://x.example", "/partners/1", "아무 글", "", null, undefined]) expect(partnerSiteUrl(bad), String(bad)).toBeNull();
  });

  test.each([
    ["1", 1],
    ["12", 12],
    ["9007199254740991", 9007199254740991],
  ])("주소 번호 '%s' → %s", (raw, id) => expect(parsePartnerId(raw)).toBe(id));

  test.each(["0", "012", "-1", "1.5", "abc", "", "99999999999999999"])("주소 번호 '%s' → null(404)", (raw) => expect(parsePartnerId(raw)).toBeNull());
});
