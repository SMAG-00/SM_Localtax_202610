// ART-07 인포그래픽 · ART-08 동영상 · ART-09 포토 — 형식과 블록이 맞는지, 블록마다 꼭 있어야 하는 칸.
//  · 저장 검사(infographicSaveProblems · parseYoutubeEmbed)는 기사 저장 API와 편집 화면이 같이 부른다 — 저장 불가 조건(ART-07·ART-08)
//  · 발행 판정(checkMediaFormats)은 저장 검사를 한 번 더 하고(직접 넣은 행·이관 자료) 발행 조건(요약·자막·썸네일 16:9·사진 표기)을 본다
import { finding, type Finding } from "../findings";
import { VIDEO_THUMBNAIL_RATIO, type ArticleForPublish, type InfographicData } from "../model";
import { isBlank } from "../text";

// ── 유튜브 임베드 주소 (ART-08 — youtube-nocookie.com만 저장) ─────────────────

/** 유튜브 개인정보 보호 임베드 주소의 앞부분 — 이 호스트 말고는 저장하지 않는다 */
export const YOUTUBE_EMBED_HOST = "www.youtube-nocookie.com";
export const YOUTUBE_EMBED_PREFIX = `https://${YOUTUBE_EMBED_HOST}/embed/`;
/** 유튜브 영상 번호 — 영문·숫자·`-`·`_` 11자 */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** 붙여도 되는 주소 칸 — 시작·끝 시각(초)과 자막 켜기. 그 밖의 칸(자동 재생·목록·추적 칸 등)은 거부한다 */
const ALLOWED_PARAMS: ReadonlyArray<readonly [string, RegExp]> = [
  ["start", /^\d{1,6}$/],
  ["end", /^\d{1,6}$/],
  ["cc_load_policy", /^[01]$/],
];
const MAX_URL_LENGTH = 300;
const HOST_PROBLEM = `동영상 주소는 유튜브 개인정보 보호 주소(${YOUTUBE_EMBED_PREFIX}영상번호)만 저장됩니다 (ART-08)`;

export type EmbedParse = { ok: true; url: string; videoId: string } | { ok: false; problem: string };

/**
 * 동영상 임베드 주소 검사 — `https://www.youtube-nocookie.com/embed/<영상번호 11자>`(+ start·end·cc_load_policy)만 통과한다.
 * 통과하면 정리한 주소(url — 호스트 소문자, 칸 순서 고정)를 돌려준다. 저장은 이 정리한 주소로 한다.
 * 거부: http · youtube.com · youtu.be · 다른 호스트 · 호스트 뒤 점·포트·사용자 정보(@) · 역슬래시 · `..` 경로 · 영상번호 없음·길이 틀림 · 경로 뒤 덧붙임 ·
 * 모르는 칸·겹친 칸 · `#` 조각 · 빈칸·줄바꿈 · 300자 초과
 */
export function parseYoutubeEmbed(raw: string | null | undefined): EmbedParse {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, problem: `동영상 주소를 적어 주세요 — ${YOUTUBE_EMBED_PREFIX}영상번호 (ART-08)` };
  if (text.length > MAX_URL_LENGTH) return { ok: false, problem: `동영상 주소는 ${MAX_URL_LENGTH}자 이하여야 합니다` };
  // 빈칸·줄바꿈·제어 문자·역슬래시 — 주소 해석기마다 다르게 읽는 글자
  if (/[\s\p{Cc}\\]/u.test(text)) return { ok: false, problem: "동영상 주소에 빈칸·줄바꿈·역슬래시를 넣을 수 없습니다" };
  // 주소 해석 전에 글자 그대로 본다 — 'https://' 다음 '/' 앞까지가 정확히 호스트 이름이어야 한다(포트·사용자 정보·끝 점 0)
  const head = /^https:\/\/([^/?#]*)(\/[^?#]*)?/i.exec(text);
  if (!head) return { ok: false, problem: /^http:\/\//i.test(text) ? "동영상 주소는 https 주소만 저장됩니다 (ART-08)" : HOST_PROBLEM };
  if (head[1]!.toLowerCase() !== YOUTUBE_EMBED_HOST) return { ok: false, problem: HOST_PROBLEM };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: HOST_PROBLEM };
  }
  if (url.protocol !== "https:" || url.hostname !== YOUTUBE_EMBED_HOST || url.port !== "" || url.username !== "" || url.password !== "") {
    return { ok: false, problem: HOST_PROBLEM };
  }
  // 글자 그대로의 경로와 해석한 경로가 같아야 한다 ('/x/../embed/…' 같은 경로 바꾸기 0)
  const pathMatch = /^\/embed\/([^/]+)$/.exec(url.pathname);
  if ((head[2] ?? "") !== url.pathname || !pathMatch || !VIDEO_ID.test(pathMatch[1]!)) {
    return { ok: false, problem: `동영상 주소는 ${YOUTUBE_EMBED_PREFIX} 뒤에 영상번호(영문·숫자 11자)만 옵니다` };
  }
  if (text.includes("#")) return { ok: false, problem: "동영상 주소 끝에 # 조각을 붙일 수 없습니다" };
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    const rule = ALLOWED_PARAMS.find(([k]) => k === key);
    if (!rule) return { ok: false, problem: `동영상 주소에 쓸 수 없는 칸입니다 (${key.slice(0, 30)}) — start·end·cc_load_policy만 붙입니다` };
    if (seen.has(key)) return { ok: false, problem: `동영상 주소의 ${key} 칸이 두 번 있습니다` };
    if (!rule[1].test(value)) return { ok: false, problem: `동영상 주소의 ${key} 값이 숫자가 아닙니다` };
    seen.add(key);
  }
  const videoId = pathMatch[1]!;
  const params = ALLOWED_PARAMS.flatMap(([k]) => (url.searchParams.has(k) ? [`${k}=${url.searchParams.get(k)}`] : []));
  return { ok: true, videoId, url: `${YOUTUBE_EMBED_PREFIX}${videoId}${params.length ? `?${params.join("&")}` : ""}` };
}

/** 가로·세로가 16:9인가 (VIDEO_THUMBNAIL_RATIO — 1% 안). 크기를 모르거나 0 이하면 false */
export function isSixteenByNine(width: number | null | undefined, height: number | null | undefined): boolean {
  if (typeof width !== "number" || typeof height !== "number" || !(width > 0) || !(height > 0)) return false;
  const target = VIDEO_THUMBNAIL_RATIO.width / VIDEO_THUMBNAIL_RATIO.height;
  // 부동소수 반올림 오차(1e-9)는 경계 안으로 — 정확히 1%는 통과
  return Math.abs(width / height / target - 1) <= VIDEO_THUMBNAIL_RATIO.tolerance + 1e-9;
}

// ── 인포그래픽 저장 조건 (ART-07 — 대체 텍스트·같은 내용의 표 둘 다 있어야 저장) ───────────

export interface BlockProblem {
  field: "alt" | "data";
  message: string;
}

function dataProblem(data: InfographicData | null | undefined): string | null {
  if (!data) return "그림과 같은 내용의 표나 목록을 넣어 주세요 — 없으면 저장되지 않습니다 (ART-07)";
  if (data.kind === "list") {
    if (data.items.length === 0) return "같은 내용의 목록에 항목이 하나 이상 있어야 합니다 (ART-07)";
    const empty = data.items.findIndex((item) => isBlank(item));
    return empty >= 0 ? `같은 내용의 목록 ${empty + 1}번째 항목이 비어 있습니다` : null;
  }
  if (data.columns.length === 0 || data.columns.some((c) => isBlank(c))) return "같은 내용의 표 머리 칸(첫 줄)을 모두 채워 주세요 (ART-07)";
  if (data.rows.length === 0) return "같은 내용의 표에 내용 행이 하나 이상 있어야 합니다 (ART-07)";
  for (const [i, row] of data.rows.entries()) {
    if (row.length !== data.columns.length) return `같은 내용의 표 ${i + 1}번째 행의 칸 수(${row.length})가 머리 칸 수(${data.columns.length})와 다릅니다`;
    if (row.every((cell) => isBlank(cell))) return `같은 내용의 표 ${i + 1}번째 행이 비어 있습니다`;
  }
  return null;
}

/** 인포그래픽 블록의 저장 불가 사유 — 대체 텍스트 없음 · 같은 내용의 표·목록 없음(또는 빈 칸). 없으면 빈 목록 */
export function infographicSaveProblems(block: { alt: string | null | undefined; data: InfographicData | null | undefined }): BlockProblem[] {
  const out: BlockProblem[] = [];
  if (isBlank(block.alt)) out.push({ field: "alt", message: "인포그래픽의 대체 텍스트를 적어 주세요 — 그림이 보여 주는 내용을 글로, 없으면 저장되지 않습니다 (ART-07)" });
  const problem = dataProblem(block.data);
  if (problem) out.push({ field: "data", message: problem });
  return out;
}

// ── 발행 판정 ─────────────────────────────────────────────

export function checkMediaFormats(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  const has = (type: string) => article.blocks.some((b) => b.type === type);
  if (article.format === "infographic" && !has("infographic")) {
    out.push(finding("art07.infographic-required", "형식이 인포그래픽인 기사에는 인포그래픽 블록이 하나 이상 있어야 합니다 — 블록을 더하거나 형식을 바꿔 주세요", { field: "blocks" }));
  }
  if (article.format === "video" && !has("video")) {
    out.push(finding("art08.video-required", "형식이 동영상인 기사에는 동영상 블록이 하나 이상 있어야 합니다 — 블록을 더하거나 형식을 바꿔 주세요", { field: "blocks" }));
  }
  if (article.format === "photo" && !has("image")) {
    out.push(finding("art09.photos-required", "포토 기사에는 사진(이미지 블록)이 하나 이상 있어야 합니다", { field: "blocks" }));
  }

  let photoNo = 0;
  article.blocks.forEach((block, blockIndex) => {
    const at = { field: "blocks", blockIndex };
    if (block.type === "infographic") {
      for (const p of infographicSaveProblems(block)) out.push(finding(p.field === "alt" ? "art07.infographic-alt" : "art07.infographic-data", p.message, at));
    } else if (block.type === "video") {
      const embed = parseYoutubeEmbed(block.embedUrl);
      if (!embed.ok) out.push(finding("art08.embed-url", embed.problem, at));
      if (isBlank(block.summary)) out.push(finding("art08.summary-required", "동영상 요약 텍스트를 적어 주세요 — 영상을 보지 않아도 내용을 알 수 있게 (ART-08)", at));
      if (block.captions !== true) out.push(finding("art08.captions-unconfirmed", "영상에 자막이 있는지 확인하고 '자막 있음'을 체크해 주세요 (ART-08)", at));
      if (isBlank(block.thumbnailMediaId)) {
        out.push(finding("art08.thumbnail-required", "동영상 썸네일 이미지를 골라 주세요 — 누르기 전에는 썸네일만 보입니다 (ART-08)", at));
      } else {
        const t = block.thumbnail;
        const phrase = block.thumbnailMediaId!;
        if (!t || t.width === null || t.height === null) {
          out.push(finding("art08.thumbnail-ratio", "썸네일 이미지의 가로·세로 크기가 기록되지 않아 16:9인지 알 수 없습니다 — 이미지 기록에 크기를 적어 주세요", { ...at, phrase }));
        } else if (!isSixteenByNine(t.width, t.height)) {
          out.push(finding("art08.thumbnail-ratio", `썸네일이 16:9가 아닙니다 (지금 ${t.width}×${t.height}) — 자르지 않고 원본 비율로 보이므로 16:9 이미지를 골라 주세요`, { ...at, phrase }));
        }
      }
    } else if (block.type === "image" && article.format === "photo") {
      photoNo += 1;
      const phrase = block.mediaId;
      if (isBlank(block.credit)) out.push(finding("art09.photo-credit", `${photoNo}번째 사진의 출처(누가 찍거나 제공했는지)가 이미지 기록에 없습니다 (ART-09)`, { ...at, phrase }));
      if (isBlank(block.license)) out.push(finding("art09.photo-license", `${photoNo}번째 사진의 이용 조건이 이미지 기록에 없습니다 (ART-09)`, { ...at, phrase }));
      if (isBlank(block.alt) && isBlank(block.mediaAlt)) out.push(finding("art09.photo-alt", `${photoNo}번째 사진에 대체 텍스트가 없습니다 — 사진에 무엇이 있는지 글로 적어 주세요 (ART-09)`, { ...at, phrase }));
    }
  });
  return out;
}
