import "server-only";
import { readStoredBody, type StoredBlock } from "../articles/content";
import { siteUrl } from "../env";
import { mediaOf } from "./article";
import type { ArticleListItem } from "./cards";
import { LIMITS } from "./constants";
import { publicDb, rowsOf } from "./db";
import { pageNumber } from "./hub-logic";
import { PARTNER_KIND_NAMES, partnerSiteUrl, videoListEntries, videoThumbnailIds, type VideoListEntry } from "./media-logic";
import { readArticleList, readPublicSettings } from "./reads";
import { MEDIA_COLUMNS, PARTNER_COLUMNS, num, type PublicMediaRow, type PublicPartnerRow } from "./rows";

// 형식별 목록 · 제휴사 프로필 (docs/dev/W2-c_설계.md 8.4) — 모두 anon 키(RLS가 경계). 목록 규칙은 다른 목록과 같다(유형 있음 · digest 제외 · 최신 발행 순, 한 쪽 20건).
//  · /news/video (ART-08) — 형식 동영상 기사. 기능 키 video_list가 꺼져 있으면 null(화면 404 — 동영상 채널 결정 전, PRD-01A 1.3)
//  · /news/photo (ART-09) — 형식 포토 기사의 기사 카드(포토 형식 배지)
//  · /partners/[id] (ART-10) — 공개 제휴사(visible — RLS)의 프로필과 그 제휴사 기사(공동 기획·광고 — 표기 배지는 목록 카드와 같은 함수)

export interface ListPage<T> {
  items: T[];
  page: number;
  total: number;
  hasMore: boolean;
}

function paged<T>(items: T[], page: number, total: number): ListPage<T> {
  return { items, page, total, hasMore: page * LIMITS.pageSize < total };
}

/** 동영상 목록 — 기능 키가 꺼져 있으면 null */
export async function getVideoList({ page = 1 }: { page?: number } = {}): Promise<ListPage<VideoListEntry> | null> {
  const settings = await readPublicSettings();
  if (!settings.features.video_list) return null;
  const db = publicDb();
  const current = pageNumber(page);
  const { items, total } = await readArticleList(db, { format: "video", limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  const ids = items.map((i) => i.id);
  const bodyRows = ids.length ? await rowsOf<{ id: number; body: unknown }>(db.from("public_articles").select("id, body").in("id", ids), "동영상 본문") : [];
  const bodies = new Map<number, readonly StoredBlock[]>(bodyRows.map((r) => [num(r.id), readStoredBody(r.body).blocks]));
  const thumbIds = videoThumbnailIds(bodies);
  const mediaRows = thumbIds.length ? await rowsOf<PublicMediaRow>(db.from("media").select(MEDIA_COLUMNS).in("id", thumbIds.map(Number)), "동영상 썸네일") : [];
  const site = siteUrl();
  const media = new Map(mediaRows.map((m) => [String(num(m.id)), mediaOf(m, site)]));
  return paged(videoListEntries(items, bodies, media), current, total);
}

/** 포토 목록 — 형식 포토 기사 */
export async function getPhotoList({ page = 1 }: { page?: number } = {}): Promise<ListPage<ArticleListItem>> {
  const current = pageNumber(page);
  const { items, total } = await readArticleList(publicDb(), { format: "photo", limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  return paged(items, current, total);
}

export interface PartnerPage extends ListPage<ArticleListItem> {
  partner: { id: number; name: string; kindName: string | null; intro: string | null; siteUrl: string | null };
}

/** 제휴사 프로필 — 공개 제휴사가 아니면(없음·비공개) null(404). 기사 목록은 그 제휴사가 지정된 공개 기사 */
export async function getPartnerPage(id: number, { page = 1 }: { page?: number } = {}): Promise<PartnerPage | null> {
  const db = publicDb();
  const found = await rowsOf<PublicPartnerRow>(db.from("partners").select(PARTNER_COLUMNS).eq("id", id).limit(1), "제휴사");
  const p = found[0];
  if (!p) return null;
  const current = pageNumber(page);
  const { items, total } = await readArticleList(db, { partnerId: id, limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  return {
    partner: { id: num(p.id), name: p.name, kindName: PARTNER_KIND_NAMES[p.kind] ?? null, intro: p.intro?.trim() ? p.intro.trim() : null, siteUrl: partnerSiteUrl(p.url) },
    ...paged(items, current, total),
  };
}
