// ART-07 인포그래픽 · ART-08 동영상 · ART-09 포토 — 저장 불가 조건(주소·대체 텍스트·같은 내용의 표)과 발행 조건의 경계
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { evaluatePublish } from "../evaluate";
import type { ArticleBlock, ArticleForPublish, ImageBlock, InfographicBlock, VideoBlock } from "../model";
import { checkMediaFormats, infographicSaveProblems, isSixteenByNine, parseYoutubeEmbed } from "./media-formats";

const ID = "dQw4w9WgXcQ";
const OK_URL = `https://www.youtube-nocookie.com/embed/${ID}`;

const infographic = (over: Partial<InfographicBlock> = {}): InfographicBlock => ({
  type: "infographic",
  mediaId: "media-ig-1",
  alt: "취득세 신고 4단계를 화살표로 이은 그림",
  caption: "취득세 신고 절차",
  rightsStatus: "confirmed",
  chart: null,
  template: "flow",
  data: { kind: "list", items: ["계약", "잔금", "신고", "납부"] },
  ...over,
});

const video = (over: Partial<VideoBlock> = {}): VideoBlock => ({
  type: "video",
  embedUrl: OK_URL,
  caption: "취득세 신고 따라 하기",
  summary: "위택스에서 취득세를 신고하는 순서를 화면으로 보여 줍니다.",
  captions: true,
  thumbnailMediaId: "media-thumb-1",
  durationSeconds: 95,
  thumbnail: { rightsStatus: "confirmed", width: 1920, height: 1080 },
  ...over,
});

const photo = (n: number, over: Partial<ImageBlock> = {}): ImageBlock => ({
  type: "image",
  mediaId: `media-photo-${n}`,
  alt: `${n}번째 사진 — 구청 세무과 창구`,
  caption: `사진 ${n}`,
  rightsStatus: "confirmed",
  credit: "가온시청",
  license: "공공누리 제1유형",
  mediaAlt: null,
  ...over,
});

/** 통과 견본(세법 해설)에 블록을 더하고 형식을 바꾼 원고 — 더한 블록의 위치는 TAX_EXPLAINER 블록 수부터 */
const base = TAX_EXPLAINER.blocks.length;
const draft = (format: ArticleForPublish["format"], ...blocks: ArticleBlock[]): ArticleForPublish => ({ ...TAX_EXPLAINER, format, blocks: [...TAX_EXPLAINER.blocks, ...blocks] });
const run = (a: ArticleForPublish) => evaluatePublish(a, BASE_CONTEXT);
const blockers = (a: ArticleForPublish) => uniqueIds(run(a).blockers);

describe("ART-08 동영상 주소 — youtube-nocookie 임베드 주소만 저장된다", () => {
  it("정확한 주소는 그대로 통과하고 영상번호를 돌려준다", () => {
    expect(parseYoutubeEmbed(OK_URL)).toEqual({ ok: true, url: OK_URL, videoId: ID });
  });

  it("앞뒤 빈칸은 떼고, 대문자 호스트·칸 순서는 정리한 주소로 저장한다", () => {
    expect(parseYoutubeEmbed(`  HTTPS://WWW.YOUTUBE-NOCOOKIE.COM/embed/${ID}?cc_load_policy=1&start=30 `)).toEqual({
      ok: true,
      url: `${OK_URL}?start=30&cc_load_policy=1`,
      videoId: ID,
    });
    expect(parseYoutubeEmbed(`${OK_URL}?`)).toEqual({ ok: true, url: OK_URL, videoId: ID });
    expect(parseYoutubeEmbed(`${OK_URL}?end=120`)).toMatchObject({ ok: true, url: `${OK_URL}?end=120` });
  });

  it.each([
    ["빈 주소", "", "적어 주세요"],
    ["http", `http://www.youtube-nocookie.com/embed/${ID}`, "https 주소만"],
    ["youtube.com", `https://www.youtube.com/embed/${ID}`, "개인정보 보호 주소"],
    ["www 없는 호스트", `https://youtube-nocookie.com/embed/${ID}`, "개인정보 보호 주소"],
    ["짧은 주소 youtu.be", `https://youtu.be/${ID}`, "개인정보 보호 주소"],
    ["다른 하위 도메인", `https://m.youtube-nocookie.com/embed/${ID}`, "개인정보 보호 주소"],
    ["호스트 뒤에 붙인 도메인", `https://www.youtube-nocookie.com.evil.example/embed/${ID}`, "개인정보 보호 주소"],
    ["쿼리에 숨긴 주소", `https://evil.example/?u=https://www.youtube-nocookie.com/embed/${ID}`, "개인정보 보호 주소"],
    ["@ 뒤 진짜 호스트", `https://www.youtube-nocookie.com@evil.example/embed/${ID}`, "개인정보 보호 주소"],
    ["사용자 정보", `https://user:pw@www.youtube-nocookie.com/embed/${ID}`, "개인정보 보호 주소"],
    ["포트", `https://www.youtube-nocookie.com:443/embed/${ID}`, "개인정보 보호 주소"],
    ["호스트 끝 점", `https://www.youtube-nocookie.com./embed/${ID}`, "개인정보 보호 주소"],
    ["역슬래시", `https://evil.example\\@www.youtube-nocookie.com/embed/${ID}`, "역슬래시"],
    ["javascript:", "javascript:alert(1)", "개인정보 보호 주소"],
    ["프로토콜 없는 주소", `//www.youtube-nocookie.com/embed/${ID}`, "개인정보 보호 주소"],
    ["영상번호 없음", "https://www.youtube-nocookie.com/embed/", "영상번호"],
    ["경로 없음", "https://www.youtube-nocookie.com", "영상번호"],
    ["영상번호 길이 틀림(10자)", "https://www.youtube-nocookie.com/embed/dQw4w9WgXc", "영상번호"],
    ["영상번호 뒤 덧붙인 경로", `${OK_URL}/extra`, "영상번호"],
    ["끝 슬래시", `${OK_URL}/`, "영상번호"],
    ["embed 아닌 경로", `https://www.youtube-nocookie.com/watch?v=${ID}`, "영상번호"],
    ["경로 바꾸기 ..", `https://www.youtube-nocookie.com/x/../embed/${ID}`, "영상번호"],
    ["퍼센트 인코딩 영상번호", "https://www.youtube-nocookie.com/embed/dQw4w9WgXc%51", "영상번호"],
    ["자동 재생 칸", `${OK_URL}?autoplay=1`, "쓸 수 없는 칸"],
    ["추적·출처 칸", `${OK_URL}?start=5&origin=https://evil.example`, "쓸 수 없는 칸"],
    ["같은 칸 두 번", `${OK_URL}?start=10&start=20`, "두 번"],
    ["값에 숨긴 칸", `${OK_URL}?start=10%26autoplay%3D1`, "숫자가 아닙니다"],
    ["음수 시각", `${OK_URL}?start=-1`, "숫자가 아닙니다"],
    ["# 조각", `${OK_URL}#t=10`, "# 조각"],
    ["가운데 줄바꿈", `https://www.youtube-nocookie.com/embed/dQw4w\n9WgXcQ`, "빈칸"],
    ["가운데 빈칸", `https://www.youtube-nocookie.com/embed/ ${ID}`, "빈칸"],
    ["301자", `${OK_URL}?start=1${"0".repeat(300)}`, "300자"],
  ])("%s → 거부", (_name, url, fragment) => {
    const r = parseYoutubeEmbed(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain(fragment);
  });

  it("null·undefined도 빈 주소로 거부한다", () => {
    expect(parseYoutubeEmbed(null).ok).toBe(false);
    expect(parseYoutubeEmbed(undefined).ok).toBe(false);
  });
});

describe("ART-08 썸네일 16:9 — 가로÷세로가 16÷9에서 1% 안", () => {
  it.each([
    [1920, 1080],
    [1280, 720],
    [854, 480],
    [1616, 900],
    [1584, 900],
  ])("%i×%i → 16:9", (w, h) => expect(isSixteenByNine(w, h)).toBe(true));

  it.each([
    [1617, 900, "1% 넘게 넓음"],
    [1583, 900, "1% 넘게 좁음"],
    [1200, 900, "4:3"],
    [1080, 1920, "세로 9:16"],
    [1080, 1080, "정사각형"],
  ])("%i×%i → 16:9 아님 (%s)", (w, h) => expect(isSixteenByNine(w, h)).toBe(false));

  it("크기를 모르거나 0 이하면 16:9로 보지 않는다", () => {
    expect(isSixteenByNine(null, 1080)).toBe(false);
    expect(isSixteenByNine(1920, undefined)).toBe(false);
    expect(isSixteenByNine(0, 0)).toBe(false);
    expect(isSixteenByNine(-16, -9)).toBe(false);
    expect(isSixteenByNine(Number.NaN, 9)).toBe(false);
  });
});

describe("ART-07 인포그래픽 저장 불가 조건 — 대체 텍스트와 같은 내용의 표·목록", () => {
  it("대체 텍스트와 목록·표가 있으면 문제 0", () => {
    expect(infographicSaveProblems(infographic())).toEqual([]);
    expect(infographicSaveProblems(infographic({ template: "compare", data: { kind: "table", columns: ["구분", "올해", "작년"], rows: [["세율", "1%", "1%"]] } }))).toEqual([]);
  });

  it("대체 텍스트가 비면(공백만) alt 문제 하나", () => {
    expect(infographicSaveProblems(infographic({ alt: "   " }))).toEqual([{ field: "alt", message: expect.stringContaining("대체 텍스트") }]);
  });

  it("같은 내용이 없으면(null) data 문제 하나, 둘 다 없으면 alt → data 순서로 둘", () => {
    expect(infographicSaveProblems(infographic({ data: null }))).toEqual([{ field: "data", message: expect.stringContaining("표나 목록") }]);
    expect(infographicSaveProblems(infographic({ alt: "", data: null })).map((p) => p.field)).toEqual(["alt", "data"]);
  });

  it.each([
    ["목록 항목 0개", { kind: "list" as const, items: [] }, "하나 이상"],
    ["빈 목록 항목", { kind: "list" as const, items: ["계약", " "] }, "2번째 항목"],
    ["표 머리 칸 없음", { kind: "table" as const, columns: [], rows: [["a"]] }, "머리 칸"],
    ["표 머리 칸 하나가 빔", { kind: "table" as const, columns: ["구분", ""], rows: [["a", "b"]] }, "머리 칸"],
    ["표 내용 행 0개", { kind: "table" as const, columns: ["구분", "값"], rows: [] }, "내용 행"],
    ["행의 칸 수가 머리와 다름", { kind: "table" as const, columns: ["구분", "값"], rows: [["세율", "1%"], ["감면"]] }, "2번째 행의 칸 수(1)"],
    ["빈 행", { kind: "table" as const, columns: ["구분", "값"], rows: [[" ", ""]] }, "1번째 행이 비어"],
  ])("%s → data 문제", (_name, data, fragment) => {
    const problems = infographicSaveProblems(infographic({ data }));
    expect(problems.map((p) => p.field)).toEqual(["data"]);
    expect(problems[0]!.message).toContain(fragment);
  });

  it("목록 항목 1개·표 내용 행 1개가 가장 작은 통과 값이다", () => {
    expect(infographicSaveProblems(infographic({ data: { kind: "list", items: ["신고는 60일 안에"] } }))).toEqual([]);
    expect(infographicSaveProblems(infographic({ data: { kind: "table", columns: ["항목"], rows: [["60일"]] } }))).toEqual([]);
  });
});

describe("ART-07 발행 판정 — 인포그래픽", () => {
  it("다 갖춘 인포그래픽 블록이면 인포그래픽 형식 기사도 발행된다", () => {
    const a = draft("infographic", infographic());
    expect(blockers(a)).toEqual([]);
    expect(run(a).canPublish).toBe(true);
  });

  it("형식이 인포그래픽인데 인포그래픽 블록이 없으면 막는다, 일반 형식은 없어도 된다", () => {
    expect(blockers(draft("infographic"))).toEqual(["art07.infographic-required"]);
    expect(blockers(draft("general"))).toEqual([]);
  });

  it("DB에 직접 넣은 대체 텍스트·표 없는 블록도 발행 판정이 그 블록 위치로 막는다", () => {
    const findings = checkMediaFormats(draft("infographic", infographic({ alt: "", data: null })));
    expect(findings.map((f) => [f.id, f.location?.blockIndex])).toEqual([
      ["art07.infographic-alt", base],
      ["art07.infographic-data", base],
    ]);
  });

  it("같은 내용의 표 글자도 금지 표현 검사 대상이다", () => {
    const a = draft("infographic", infographic({ data: { kind: "list", items: ["무조건 감면됩니다"] } }));
    expect(run(a).blockers).toContainEqual(expect.objectContaining({ id: "ux01.forbidden-phrase", location: expect.objectContaining({ field: "blocks", blockIndex: base }) }));
  });
});

describe("ART-08 발행 판정 — 동영상 (요약 · 자막 확인 · 썸네일 16:9 · 권리)", () => {
  it("다 갖춘 동영상 블록이면 동영상 형식 기사가 발행된다", () => {
    const a = draft("video", video());
    expect(blockers(a)).toEqual([]);
    expect(run(a).canPublish).toBe(true);
  });

  it.each<[string, Partial<VideoBlock>, string]>([
    ["요약 텍스트 빔", { summary: "  " }, "art08.summary-required"],
    ["'자막 있음' 체크 안 함", { captions: false }, "art08.captions-unconfirmed"],
    ["썸네일 안 고름", { thumbnailMediaId: null, thumbnail: null }, "art08.thumbnail-required"],
    ["썸네일 4:3", { thumbnail: { rightsStatus: "confirmed", width: 1200, height: 900 } }, "art08.thumbnail-ratio"],
    ["썸네일 크기 모름", { thumbnail: { rightsStatus: "confirmed", width: null, height: null } }, "art08.thumbnail-ratio"],
    ["썸네일 권리 미확인", { thumbnail: { rightsStatus: "unconfirmed", width: 1920, height: 1080 } }, "nav04.image-rights"],
    ["youtube.com 주소(직접 넣은 행)", { embedUrl: `https://www.youtube.com/embed/${ID}` }, "art08.embed-url"],
  ])("%s → 그 항목 하나로 발행 불가", (_name, over, id) => {
    const a = draft("video", video(over));
    expect(blockers(a)).toEqual([id]);
    expect(run(a).blockers.find((f) => f.id === id)!.location).toMatchObject({ field: "blocks", blockIndex: base });
  });

  it("4:3 썸네일 문장은 지금 크기를 알려 준다, 썸네일 항목에는 media 번호가 붙는다", () => {
    const f = checkMediaFormats(draft("video", video({ thumbnail: { rightsStatus: "confirmed", width: 1200, height: 900 } })));
    expect(f).toEqual([expect.objectContaining({ id: "art08.thumbnail-ratio", location: { field: "blocks", blockIndex: base, phrase: "media-thumb-1" } })]);
    expect(f[0]!.message).toContain("1200×900");
  });

  it("형식이 동영상인데 동영상 블록이 없으면 막는다", () => {
    expect(blockers(draft("video"))).toEqual(["art08.video-required"]);
  });

  it("일반 기사의 동영상 블록도 같은 조건이다 (어디서나 같은 '누르면 재생' 카드)", () => {
    expect(blockers(draft("general", video({ captions: false, summary: "" })))).toEqual(["art08.summary-required", "art08.captions-unconfirmed"]);
    expect(blockers(draft("general", video()))).toEqual([]);
  });

  it("요약 텍스트도 금지 표현 검사 대상이다", () => {
    const a = draft("video", video({ summary: "놓치면 끝입니다." }));
    expect(uniqueIds(run(a).blockers)).toEqual(expect.arrayContaining(["ux01.forbidden-phrase", "ux03.fear-phrase"]));
  });
});

describe("ART-09 발행 판정 — 포토 (사진마다 출처 · 이용 조건 · 대체 텍스트)", () => {
  it("사진 2장이 다 갖추면 발행된다", () => {
    const a = draft("photo", photo(1), photo(2));
    expect(blockers(a)).toEqual([]);
    expect(run(a).canPublish).toBe(true);
  });

  it.each<[string, Partial<ImageBlock>, string]>([
    ["출처 없음", { credit: null }, "art09.photo-credit"],
    ["출처 공백", { credit: "  " }, "art09.photo-credit"],
    ["이용 조건 없음", { license: undefined }, "art09.photo-license"],
    ["대체 텍스트 없음 (블록·media 둘 다)", { alt: "", mediaAlt: null }, "art09.photo-alt"],
  ])("두 번째 사진이 %s → 그 사진 위치로 막는다", (_name, over, id) => {
    const findings = checkMediaFormats(draft("photo", photo(1), photo(2, over)));
    expect(findings).toEqual([expect.objectContaining({ id, location: { field: "blocks", blockIndex: base + 1, phrase: "media-photo-2" } })]);
    expect(findings[0]!.message).toContain("2번째 사진");
  });

  it("블록 대체 텍스트가 비어도 media 대체 텍스트가 있으면 통과", () => {
    expect(checkMediaFormats(draft("photo", photo(1, { alt: "", mediaAlt: "구청 세무과 창구" })))).toEqual([]);
  });

  it("포토 기사에 사진이 0장이면 막는다", () => {
    expect(blockers(draft("photo"))).toEqual(["art09.photos-required"]);
  });

  it("포토가 아닌 기사의 이미지는 출처·이용 조건 검사 대상이 아니다 (NAV-04 권리 확인만)", () => {
    expect(checkMediaFormats(draft("general", photo(1, { credit: null, license: null, alt: "" })))).toEqual([]);
  });

  it("사진 번호는 이미지 블록만 센다 — 문단·인포그래픽 사이에 있어도", () => {
    const findings = checkMediaFormats(draft("photo", photo(1), infographic(), photo(2, { license: "" })));
    expect(findings).toEqual([expect.objectContaining({ id: "art09.photo-license", location: expect.objectContaining({ blockIndex: base + 2 }) })]);
    expect(findings[0]!.message).toContain("2번째 사진");
  });
});
