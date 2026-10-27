// 사진 보관함 규칙 (F1) — 올린 파일 검사·메타 입력 검사·권리 확인 사전 점검. 순수 함수 (시험: media-rules.test.ts)
//  · 파일은 확장자·보낸 형식(content-type)이 아니라 파일 머리(매직 바이트)로 jpg·png·webp를 가린다 — 이름만 바꾼 파일을 받지 않는다
//  · 가로·세로(픽셀)는 파일 머리에서 읽는다 — 동영상 썸네일 16:9 판정(ART-08)과 화면 자리 확보에 쓴다
//  · 크기 상한 4,000,000바이트 — Vercel 함수 요청 본문 4.5MB 한도 안 (docs/dev/F1_설계.md)
import { LICENSE_TYPES } from "@ltr/editorial";

export const MEDIA_MAX_BYTES = 4_000_000;
export const MEDIA_BUCKET = "media";
/** media.path에 저장하는 저장소 공개 경로의 앞부분 (화면 주소는 lib/server/articles/mapping.ts absolute가 만든다) */
export const MEDIA_PATH_PREFIX = `storage/v1/object/public/${MEDIA_BUCKET}/`;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export interface ImageInfo {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // SOF0~SOF15 (DHT 0xC4 · JPG 0xC8 · DAC 0xCC 제외) — 크기를 담은 칸
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const kind = ascii(b, 12, 4);
  if (kind === "VP8 " && b.length >= 30) return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  if (kind === "VP8L" && b.length >= 25) {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (kind === "VP8X" && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** 파일 머리로 형식과 크기를 읽는다 — jpg·png·webp가 아니거나 크기를 읽을 수 없으면 null */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  let found: { mime: ImageInfo["mime"]; ext: ImageInfo["ext"]; size: { width: number; height: number } | null } | null = null;
  if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) found = { mime: "image/jpeg", ext: "jpg", size: jpegSize(bytes) };
  else if (bytes.length > 24 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89 && ascii(bytes, 12, 4) === "IHDR") {
    found = { mime: "image/png", ext: "png", size: { width: u32be(bytes, 16), height: u32be(bytes, 20) } };
  } else if (bytes.length > 30 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") found = { mime: "image/webp", ext: "webp", size: webpSize(bytes) };
  if (!found || !found.size) return null;
  const { width, height } = found.size;
  // media 표 제약(media_size_range)과 같다 — 1~20000
  if (!(width >= 1 && width <= 20000 && height >= 1 && height <= 20000)) return null;
  return { mime: found.mime, ext: found.ext, width, height };
}

/** 파일 검사 결과 — 문제가 있으면 편집자에게 보일 한국어 문장 */
export function checkImageFile(bytes: Uint8Array): Result<ImageInfo> {
  if (bytes.length === 0) return { ok: false, errors: ["file: 빈 파일입니다"] };
  if (bytes.length > MEDIA_MAX_BYTES) return { ok: false, errors: [`file: 파일은 ${MEDIA_MAX_BYTES.toLocaleString("ko-KR")}바이트(약 4MB) 이하여야 합니다 (지금 ${bytes.length.toLocaleString("ko-KR")}바이트)`] };
  const info = sniffImage(bytes);
  return info ? { ok: true, value: info } : { ok: false, errors: ["file: jpg·png·webp 사진만 올릴 수 있습니다 (파일 내용을 읽을 수 없거나 다른 형식입니다)"] };
}

/** 저장소 안 파일 이름 → media.path (예: storage/v1/object/public/media/<이름>) */
export const mediaPathOf = (objectName: string) => `${MEDIA_PATH_PREFIX}${objectName}`;

/** media.path → 저장소 안 파일 이름. 저장소 경로가 아니면(http 주소·옛 상대 경로) null */
export function objectNameOf(path: string): string | null {
  return path.startsWith(MEDIA_PATH_PREFIX) && path.length > MEDIA_PATH_PREFIX.length ? path.slice(MEDIA_PATH_PREFIX.length) : null;
}

// ── 메타 입력 ─────────────────────────────────────────────

export const MEDIA_KINDS = ["photo", "thumbnail"] as const;
export const MEDIA_KIND_LABELS = { photo: "사진", thumbnail: "썸네일" } as const;
export const MEDIA_RIGHTS_DECISIONS = ["confirmed", "rejected", "unconfirmed"] as const;
export type MediaRightsDecision = (typeof MEDIA_RIGHTS_DECISIONS)[number];

/** 권리 확인 상태에 영향을 주는 칸 — 권리 확인된 사진에서 이 칸을 고치려면 권리 확인 권한(편집 책임자 이상)이 필요하다 */
export const RIGHTS_FIELDS = ["credit", "license", "photographer", "license_type", "source_url", "kind"] as const;

export interface MediaMeta {
  alt?: string | null;
  credit?: string | null;
  photographer?: string | null;
  license?: string | null;
  source_url?: string | null;
  license_type?: string | null;
  kind?: (typeof MEDIA_KINDS)[number];
}

const TEXT_MAX = 500;
const URL_MAX = 2000;

/** http(s) 주소만 — 다른 방식(javascript: 등)은 받지 않는다 */
export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 올리기·고치기 입력 검사. 올릴 때(create)는 보낸 칸만, 고칠 때(patch)도 보낸 칸만 바꾼다. 빈 글자는 null(비움).
 * 문자열로 온 폼 값(multipart)과 JSON 값을 같은 규칙으로 읽는다
 */
export function parseMediaMeta(raw: Record<string, unknown>, mode: "create" | "patch"): Result<MediaMeta> {
  const errors: string[] = [];
  const out: MediaMeta = {};
  const textKeys = ["alt", "credit", "photographer", "license"] as const;
  for (const key of textKeys) {
    const v = raw[key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== "string") {
      errors.push(`${key}: 글자여야 합니다`);
      continue;
    }
    const t = (v ?? "").trim();
    if (t.length > TEXT_MAX) errors.push(`${key}: ${TEXT_MAX}자 이하여야 합니다`);
    else out[key] = t === "" ? null : t;
  }
  if (raw.source_url !== undefined) {
    const v = raw.source_url;
    if (v !== null && typeof v !== "string") errors.push("source_url: 글자여야 합니다");
    else {
      const t = (v ?? "").trim();
      if (t === "") out.source_url = null;
      else if (t.length > URL_MAX) errors.push(`source_url: ${URL_MAX}자 이하여야 합니다`);
      else if (!isHttpUrl(t)) errors.push("source_url: http:// 또는 https:// 로 시작하는 주소여야 합니다");
      else out.source_url = t;
    }
  }
  if (raw.license_type !== undefined) {
    const v = raw.license_type;
    if (v === null || v === "") out.license_type = null;
    else if (typeof v === "string" && (LICENSE_TYPES as readonly string[]).includes(v)) out.license_type = v;
    else errors.push(`license_type: ${LICENSE_TYPES.join("·")} 중 하나여야 합니다`);
  }
  if (raw.kind !== undefined) {
    const v = raw.kind;
    if (typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v)) out.kind = v as MediaMeta["kind"] & string;
    else errors.push(`kind: ${MEDIA_KINDS.join("·")} 중 하나여야 합니다`);
  }
  if (mode === "patch" && errors.length === 0 && Object.keys(out).length === 0) errors.push("body: 고칠 칸이 없습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** 권리 확인(confirmed) 전 점검 — DB 제약(media_confirmed_complete · media_license_required)과 같은 조건을 먼저 문장으로 알린다. 빠진 칸 목록 */
export function confirmProblems(row: { credit: string | null; license: string | null; photographer: string | null; license_type: string | null; kind: string }): string[] {
  const blank = (v: string | null) => v === null || v.trim() === "";
  const out: string[] = [];
  if (blank(row.credit)) out.push("출처(credit)");
  if (blank(row.license)) out.push("이용 조건(license)");
  if (row.kind === "photo" && blank(row.photographer)) out.push("촬영자(photographer)");
  if (blank(row.license_type)) out.push("공공누리 유형(license_type — 자체 촬영은 not_applicable)");
  return out;
}

/** 목록에 보이는 권리 상태 글자 */
export const MEDIA_RIGHTS_STATUS_LABELS: Readonly<Record<string, string>> = { unconfirmed: "권리 미확인", confirmed: "권리 확인됨", rejected: "반려" };
