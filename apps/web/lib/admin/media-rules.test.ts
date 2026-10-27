// 사진 보관함 규칙 시험 (F1) — 진짜 파일 머리 바이트로 형식·크기 판정, 경계값, 가짜 확장자, 메타 입력, 권리 확인 사전 점검
import { describe, expect, test } from "vitest";
import { MEDIA_MAX_BYTES, MEDIA_PATH_PREFIX, checkImageFile, confirmProblems, mediaPathOf, objectNameOf, parseMediaMeta, sniffImage } from "./media-rules";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** 1920×1080 PNG 머리 (서명 + IHDR) */
function png(w: number, h: number): Uint8Array {
  return Uint8Array.from([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
}
/** JPEG — SOI, APP0(16바이트), SOF0(높이·너비) */
function jpeg(w: number, h: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
}
/** WebP VP8X — 가로·세로는 (값 - 1)을 24비트 little endian으로 */
function webpX(w: number, h: number): Uint8Array {
  const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
  return Uint8Array.from([...ascii("RIFF"), 30, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1), 0, 0]);
}

describe("sniffImage — 파일 머리로 형식과 크기를 읽는다", () => {
  test("PNG 1920×1080", () => {
    expect(sniffImage(png(1920, 1080))).toEqual({ mime: "image/png", ext: "png", width: 1920, height: 1080 });
  });
  test("JPEG 800×600 (APP0 조각을 건너뛰고 SOF0에서 읽는다)", () => {
    expect(sniffImage(jpeg(800, 600))).toEqual({ mime: "image/jpeg", ext: "jpg", width: 800, height: 600 });
  });
  test("WebP(VP8X) 1280×720", () => {
    expect(sniffImage(webpX(1280, 720))).toEqual({ mime: "image/webp", ext: "webp", width: 1280, height: 720 });
  });
  test("PNG 서명이 아닌 파일은 null — GIF·글자 파일·빈 파일", () => {
    expect(sniffImage(Uint8Array.from([...ascii("GIF89a"), ...new Array(40).fill(0)]))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
  test("크기 경계 — 20000은 통과, 20001과 0은 null (media_size_range 제약과 같다)", () => {
    expect(sniffImage(png(20000, 1))?.width).toBe(20000);
    expect(sniffImage(png(20001, 10))).toBeNull();
    expect(sniffImage(png(0, 10))).toBeNull();
  });
  test("잘린 PNG(IHDR 이전에 끝남)는 null", () => {
    expect(sniffImage(png(10, 10).slice(0, 20))).toBeNull();
  });
});

describe("checkImageFile — 크기 상한과 오류 문장", () => {
  test("정상 PNG는 통과", () => {
    expect(checkImageFile(png(10, 10))).toMatchObject({ ok: true, value: { ext: "png" } });
  });
  test("빈 파일은 거부", () => {
    expect(checkImageFile(new Uint8Array())).toEqual({ ok: false, errors: ["file: 빈 파일입니다"] });
  });
  test("정확히 4,000,000바이트는 통과, 1바이트 넘으면 거부", () => {
    const head = png(10, 10);
    const at = new Uint8Array(MEDIA_MAX_BYTES);
    at.set(head);
    expect(checkImageFile(at).ok).toBe(true);
    const over = new Uint8Array(MEDIA_MAX_BYTES + 1);
    over.set(head);
    const r = checkImageFile(over);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^file: 파일은 4[,.]000[,.]000바이트/);
  });
  test("사진이 아닌 내용은 확장자가 jpg여도 거부", () => {
    const r = checkImageFile(new TextEncoder().encode("MZ 실행 파일인 척 하는 내용입니다 ........................."));
    expect(r).toEqual({ ok: false, errors: ["file: jpg·png·webp 사진만 올릴 수 있습니다 (파일 내용을 읽을 수 없거나 다른 형식입니다)"] });
  });
});

describe("저장 경로", () => {
  test("mediaPathOf ↔ objectNameOf 왕복, 저장소 경로가 아니면 null", () => {
    expect(mediaPathOf("a.png")).toBe(`${MEDIA_PATH_PREFIX}a.png`);
    expect(objectNameOf(mediaPathOf("a.png"))).toBe("a.png");
    expect(objectNameOf("/img/old.png")).toBeNull();
    expect(objectNameOf("https://cdn.example.test/x.png")).toBeNull();
    expect(objectNameOf(MEDIA_PATH_PREFIX)).toBeNull();
  });
});

describe("parseMediaMeta — 메타 입력", () => {
  test("올릴 때: 앞뒤 공백을 지우고 빈 글자는 null", () => {
    expect(parseMediaMeta({ alt: " 시청 전경 ", credit: "가온시청", photographer: "", license_type: "not_applicable", kind: "photo" }, "create")).toEqual({
      ok: true,
      value: { alt: "시청 전경", credit: "가온시청", photographer: null, license_type: "not_applicable", kind: "photo" },
    });
  });
  test("원본 주소는 http(s)만 — javascript:·data:·ftp: 거부, 상대 경로 거부", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://x.test/a", "/relative", "not a url"]) {
      expect(parseMediaMeta({ source_url: bad }, "create")).toEqual({ ok: false, errors: ["source_url: http:// 또는 https:// 로 시작하는 주소여야 합니다"] });
    }
    expect(parseMediaMeta({ source_url: "https://example.test/a.jpg" }, "create")).toEqual({ ok: true, value: { source_url: "https://example.test/a.jpg" } });
  });
  test("공공누리 유형·종류는 정해진 값만, 500자 초과 거부", () => {
    expect(parseMediaMeta({ license_type: "kogl_9" }, "create").ok).toBe(false);
    expect(parseMediaMeta({ kind: "banner" }, "create").ok).toBe(false);
    expect(parseMediaMeta({ alt: "가".repeat(501) }, "create")).toEqual({ ok: false, errors: ["alt: 500자 이하여야 합니다"] });
    expect(parseMediaMeta({ alt: "가".repeat(500) }, "create").ok).toBe(true);
    expect(parseMediaMeta({ credit: 5 }, "create")).toEqual({ ok: false, errors: ["credit: 글자여야 합니다"] });
  });
  test("고칠 때: 고칠 칸이 하나도 없으면 거부, 보낸 칸만 담는다", () => {
    expect(parseMediaMeta({}, "patch")).toEqual({ ok: false, errors: ["body: 고칠 칸이 없습니다"] });
    expect(parseMediaMeta({ credit: "새 출처", unknown: "버린다" }, "patch")).toEqual({ ok: true, value: { credit: "새 출처" } });
  });
});

describe("confirmProblems — 권리 확인 전 빠진 칸", () => {
  const full = { credit: "가온시청", license: "자체 촬영", photographer: "홍길동", license_type: "not_applicable", kind: "photo" };
  test("모두 있으면 빈 목록", () => {
    expect(confirmProblems(full)).toEqual([]);
  });
  test("사진은 촬영자가 필요하고 썸네일은 필요 없다", () => {
    expect(confirmProblems({ ...full, photographer: null })).toEqual(["촬영자(photographer)"]);
    expect(confirmProblems({ ...full, photographer: null, kind: "thumbnail" })).toEqual([]);
  });
  test("공백뿐인 칸도 빠진 것으로 본다 — 출처·이용 조건·공공누리 유형", () => {
    expect(confirmProblems({ ...full, credit: "  ", license: null, license_type: null })).toEqual(["출처(credit)", "이용 조건(license)", "공공누리 유형(license_type — 자체 촬영은 not_applicable)"]);
  });
});
