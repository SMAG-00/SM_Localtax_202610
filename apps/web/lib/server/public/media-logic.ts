// 형식 콘텐츠·제휴사 화면 값 (ART-08 동영상 · ART-09 포토 · ART-10 제휴사) — 순수 함수 (시험 media-logic.test.ts)
//  · 동영상 카드: 기사 본문의 첫 '그릴 수 있는' 동영상 블록(youtube-nocookie 주소 + 읽히는 썸네일) — 아니면 카드 대신 기사 카드
//  · 제휴사 프로필: 공개 칸(이름·종류·소개·주소)만 — 계약 기간은 비공개 칸이라 읽지 않는다
import { parseYoutubeEmbed } from "@ltr/editorial";
import type { StoredBlock } from "../articles/content";
import type { ArticleListItem } from "./cards";

export type VideoBlockView = Extract<StoredBlock, { type: "video" }>;

/** 그림 한 장의 화면 값 (lib/server/public/article.ts ArticleMedia와 같은 칸) */
export interface MediaView {
  id: number;
  src: string;
  alt: string;
  credit: string | null;
  photographer: string | null;
  license: string | null;
  width: number | null;
  height: number | null;
}

/** 그릴 수 있는 동영상 블록인가 — 주소가 youtube-nocookie 임베드이고 썸네일이 읽힌다 (누르기 전에는 썸네일만 보인다) */
export function isPlayableVideo(b: StoredBlock, readable: ReadonlySet<string>): b is VideoBlockView {
  return b.type === "video" && b.thumbnailMediaId !== null && readable.has(b.thumbnailMediaId) && parseYoutubeEmbed(b.embedUrl).ok;
}

/** 본문의 첫 그릴 수 있는 동영상 블록 — 없으면 null */
export function firstPlayableVideo(blocks: readonly StoredBlock[], readable: ReadonlySet<string>): VideoBlockView | null {
  return blocks.find((b): b is VideoBlockView => isPlayableVideo(b, readable)) ?? null;
}

/** 동영상 목록 한 칸 — 동영상 카드(썸네일·재생 시간·자막 칩) 또는, 그릴 수 있는 동영상이 없으면 기사 카드 */
export interface VideoListEntry {
  item: ArticleListItem;
  video: { thumbnail: MediaView; durationSeconds: number | null; captions: boolean } | null;
}

export function videoListEntries(items: readonly ArticleListItem[], bodies: ReadonlyMap<number, readonly StoredBlock[]>, media: ReadonlyMap<string, MediaView>): VideoListEntry[] {
  const readable = new Set(media.keys());
  return items.map((item) => {
    const v = firstPlayableVideo(bodies.get(item.id) ?? [], readable);
    const thumbnail = v?.thumbnailMediaId ? media.get(v.thumbnailMediaId) : undefined;
    return { item, video: v && thumbnail ? { thumbnail, durationSeconds: v.durationSeconds, captions: v.captions } : null };
  });
}

/** 목록의 첫 동영상 블록들이 가리키는 썸네일 번호 (읽을 media를 고른다 — 주소가 틀린 블록은 빼고) */
export function videoThumbnailIds(bodies: ReadonlyMap<number, readonly StoredBlock[]>): string[] {
  const ids = new Set<string>();
  for (const blocks of bodies.values()) {
    const first = blocks.find((b): b is VideoBlockView => b.type === "video" && b.thumbnailMediaId !== null && parseYoutubeEmbed(b.embedUrl).ok);
    if (first?.thumbnailMediaId) ids.add(first.thumbnailMediaId);
  }
  return [...ids];
}

// ── 제휴사 (ART-10) ───────────────────────────────────────

/** 제휴사 종류 글자 (partners.kind — W2-a 값 목록) */
export const PARTNER_KIND_NAMES: Readonly<Record<string, string>> = { tax_firm: "세무법인", media: "언론", institution: "기관", local_business: "지역 사업자" };

/** 제휴사 누리집 주소 — http(s)만 바깥 링크로, 아니면 null (링크 0) */
export function partnerSiteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** 주소의 제휴사 번호 — 1 이상 정수 글자만 (`/partners/12`), 아니면 null(404) */
export function parsePartnerId(raw: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
