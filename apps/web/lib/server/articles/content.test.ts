// 기사 본문 저장 검사 (content.ts) — 형식 콘텐츠 블록의 저장 불가 조건 (ART-07 인포그래픽 · ART-08 동영상) 과 읽기
//  · 저장(parseBodyInput): 인포그래픽 대체 텍스트·같은 내용의 표 없음 → 거부(칸 경로와 문장), 동영상 주소가 youtube-nocookie 임베드가 아님 → 거부, 통과한 주소는 정리해 저장
//  · 읽기(readStoredBody): 모양만 본다 — 저장 규칙을 어긴 행(DB에 직접 넣은 행·이관 자료)도 읽어 발행 판정이 막게 한다
import { describe, expect, test } from "vitest";
import { parseBodyInput, readStoredBody } from "./content";

const ID = "dQw4w9WgXcQ";
const URL_OK = `https://www.youtube-nocookie.com/embed/${ID}`;
const infographic = (over: Record<string, unknown> = {}) => ({
  type: "infographic",
  mediaId: "12",
  alt: "취득세 신고 4단계 그림",
  caption: "신고 절차",
  chart: null,
  template: "flow",
  data: { kind: "list", items: ["계약", "잔금", "신고", "납부"] },
  ...over,
});
const video = (over: Record<string, unknown> = {}) => ({
  type: "video",
  embedUrl: URL_OK,
  caption: "신고 따라 하기",
  summary: "위택스 신고 순서를 보여 줍니다.",
  captions: true,
  thumbnailMediaId: "21",
  durationSeconds: 95,
  ...over,
});
const save = (...blocks: unknown[]) => parseBodyInput({ blocks: [{ type: "paragraph", text: "본문" }, ...blocks], claims: [] });
const errorsOf = (r: ReturnType<typeof parseBodyInput>) => (r.ok ? [] : r.errors);

describe("ART-07 인포그래픽 — 대체 텍스트와 같은 내용의 표·목록이 없으면 저장 불가", () => {
  test("다 갖추면 저장된다 — 템플릿·같은 내용이 그대로 남는다", () => {
    const r = save(infographic({ template: "compare", data: { kind: "table", columns: ["구분", "올해"], rows: [["세율", "1%"]] } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.blocks[1]).toMatchObject({ type: "infographic", template: "compare", data: { kind: "table", columns: ["구분", "올해"], rows: [["세율", "1%"]] } });
  });

  test("대체 텍스트가 비면 거부 — 그 블록의 alt 칸 경로", () => {
    expect(errorsOf(save(infographic({ alt: "  " })))).toEqual([expect.stringMatching(/^body\.blocks\[1\]\.alt: 인포그래픽의 대체 텍스트/)]);
  });

  test("같은 내용이 없으면(빠짐·null) 거부 — data 칸 경로", () => {
    expect(errorsOf(save(infographic({ data: undefined })))).toEqual([expect.stringMatching(/^body\.blocks\[1\]\.data: /)]);
    expect(errorsOf(save(infographic({ data: null })))).toEqual([expect.stringMatching(/^body\.blocks\[1\]\.data: /)]);
  });

  test("표 내용 행 0개·빈 목록 항목도 거부, 둘 다 없으면 두 문장", () => {
    expect(errorsOf(save(infographic({ data: { kind: "table", columns: ["구분"], rows: [] } })))).toEqual([expect.stringContaining("내용 행")]);
    expect(errorsOf(save(infographic({ data: { kind: "list", items: ["a", ""] } })))).toEqual([expect.stringContaining("2번째 항목")]);
    expect(errorsOf(save(infographic({ alt: "", data: null }))).map((e) => e.split(":")[0])).toEqual(["body.blocks[1].alt", "body.blocks[1].data"]);
  });

  test("템플릿은 절차 흐름·비교·핵심 숫자 중 하나, 같은 내용의 모양이 틀리면 거부", () => {
    expect(errorsOf(save(infographic({ template: "chart" })))[0]).toContain("body.blocks[1].template");
    expect(errorsOf(save(infographic({ data: { kind: "grid", items: ["a"] } })))[0]).toContain("body.blocks[1].data.kind");
    expect(errorsOf(save(infographic({ data: { kind: "table", columns: ["a"], rows: "a|b" } })))[0]).toContain("body.blocks[1].data.rows");
    expect(errorsOf(save(infographic({ data: { kind: "list", items: ["가".repeat(501)] } })))[0]).toContain("500자");
  });
});

describe("ART-08 동영상 — youtube-nocookie 임베드 주소가 아니면 저장 불가", () => {
  test("정리한 주소로 저장한다 — 대문자 호스트·칸 순서", () => {
    const r = save(video({ embedUrl: `HTTPS://WWW.YOUTUBE-NOCOOKIE.COM/embed/${ID}?cc_load_policy=1&start=5` }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.blocks[1]).toMatchObject({ type: "video", embedUrl: `${URL_OK}?start=5&cc_load_policy=1`, summary: "위택스 신고 순서를 보여 줍니다.", captions: true, thumbnailMediaId: "21", durationSeconds: 95 });
  });

  test.each([
    ["youtube.com", `https://www.youtube.com/embed/${ID}`],
    ["http", `http://www.youtube-nocookie.com/embed/${ID}`],
    ["하위 도메인 속임", `https://www.youtube-nocookie.com.evil.example/embed/${ID}`],
    ["영상번호 없음", "https://www.youtube-nocookie.com/embed/"],
    ["자동 재생 칸", `${URL_OK}?autoplay=1`],
    ["빈 주소", ""],
  ])("%s → 거부 (embedUrl 칸 경로)", (_name, embedUrl) => {
    const errors = errorsOf(save(video({ embedUrl })));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^body\.blocks\[1\]\.embedUrl: /);
  });

  test("요약·자막 확인·썸네일은 비워도 저장된다 (발행 판정이 막는다 — 작성 중)", () => {
    const r = save(video({ summary: undefined, captions: undefined, thumbnailMediaId: null, durationSeconds: null }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.blocks[1]).toMatchObject({ summary: "", captions: false, thumbnailMediaId: null, durationSeconds: null });
  });

  test("썸네일 번호·재생 시간 모양이 틀리면 거부", () => {
    expect(errorsOf(save(video({ thumbnailMediaId: "abc" })))[0]).toContain("body.blocks[1].thumbnailMediaId");
    expect(errorsOf(save(video({ durationSeconds: -1 })))[0]).toContain("body.blocks[1].durationSeconds");
    expect(errorsOf(save(video({ durationSeconds: 86_401 })))[0]).toContain("durationSeconds");
    expect(errorsOf(save(video({ durationSeconds: 1.5 })))[0]).toContain("durationSeconds");
    expect(save(video({ durationSeconds: 86_400 })).ok).toBe(true);
    expect(save(video({ thumbnailMediaId: 21 })).ok, "숫자 번호도 받는다").toBe(true);
  });

  test("앞 블록 모양이 틀려도 뒤 블록의 오류 경로는 그 블록 번호다", () => {
    const r = parseBodyInput({ blocks: [{ type: "nope" }, video({ embedUrl: "https://youtu.be/x" })], claims: [] });
    expect(errorsOf(r).map((e) => e.split(":")[0])).toEqual(["body.blocks[0].type", "body.blocks[1].embedUrl"]);
  });
});

describe("읽기 — 모양만 본다 (저장 규칙을 어긴 행도 발행 판정이 볼 수 있게)", () => {
  test("대체 텍스트·같은 내용 없는 인포그래픽, youtube.com 주소 동영상도 읽힌다", () => {
    const body = readStoredBody({ blocks: [infographic({ alt: "", data: null }), video({ embedUrl: `https://www.youtube.com/embed/${ID}`, captions: false })], claims: [] });
    expect(body.blocks.map((b) => b.type)).toEqual(["infographic", "video"]);
    expect(body.blocks[0]).toMatchObject({ alt: "", data: null });
    expect(body.blocks[1]).toMatchObject({ embedUrl: `https://www.youtube.com/embed/${ID}`, captions: false });
  });

  test("템플릿이 없는 옛 인포그래픽 블록은 모양이 틀려 빠진다", () => {
    const { template: _t, ...old } = infographic();
    expect(readStoredBody({ blocks: [old, { type: "paragraph", text: "본문" }], claims: [] }).blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });
});
