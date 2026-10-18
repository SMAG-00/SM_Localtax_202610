import { Chip, FieldHubHead, PartnerBadge, VideoCard } from "@ltr/ui";
import type { ArticleListItem, ListPage, PartnerPage, VideoListEntry } from "@/lib/server/public";
import { PHOTO_LIST_HREF, VIDEO_LIST_HREF } from "@/lib/server/public/constants";
import { pagerLinks } from "@/lib/site/hub-view";
import { PARTNER_COPY, PHOTO_LIST_COPY, VIDEO_LIST_COPY, partnerListTitle } from "@/lib/site/media-view";
import { ArticleGrid, ArticleItem, cardTypeBadge } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 형식별 목록·제휴사 프로필 (docs/dev/W2-c_설계.md 7장·8.4) — 다른 목록과 같은 틀(분야 허브 머리 + 목록 + 쪽 넘김), 사이트 안 링크는 UiLink(화면 전환).
//  · /news/video (ART-08) — 동영상 카드 그리드 1열 → 2열 → 3열(PRD-01A 3장). 목록 카드는 썸네일만(누르면 기사 상세) — 이 화면에서도 유튜브 요청 0.
//    그릴 수 있는 동영상이 없는 기사(썸네일 미공개 등)는 기사 카드로
//  · /news/photo (ART-09) — 기사 카드(포토 형식 배지) 그리드
//  · /partners/[id] (ART-10) — 제휴사 소개 · 제휴 배지 · 그 제휴사 기사 카드(표기 배지는 목록 카드와 같은 함수)
//  · 공개 데이터를 읽지 못하면(unavailable) 머리 + 안내 한 줄 (200 — 다른 목록 화면과 같다)

const GRID = "mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3";

function ListHead({ id, copy, unavailable }: { id: string; copy: { eyebrow: string; title: string; intro: string }; unavailable: boolean }) {
  return (
    <SiteSection id={`${id}-head`} tone="ivory" first data={{ "data-hub-part": "head" }}>
      <FieldHubHead field="news" eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro} />
      {unavailable && <UnavailableNotice />}
    </SiteSection>
  );
}

function VideoEntry({ entry }: { entry: VideoListEntry }) {
  const { item, video } = entry;
  if (!video) return <ArticleItem item={item} />;
  return (
    <VideoCard
      href={item.href}
      title={item.title}
      summary={item.summary}
      thumbnail={{ src: video.thumbnail.src, ...(video.thumbnail.width && video.thumbnail.height ? { width: video.thumbnail.width, height: video.thumbnail.height } : {}) }}
      {...(video.durationSeconds === null ? {} : { durationSeconds: video.durationSeconds })}
      captions={video.captions}
      badges={cardTypeBadge(item)}
    />
  );
}

export function VideoListView({ data, unavailable = false }: { data: ListPage<VideoListEntry>; unavailable?: boolean }) {
  const { prev, next } = pagerLinks(VIDEO_LIST_HREF, {}, data.page, data.hasMore);
  return (
    <div data-ui="video-list">
      <ListHead id="video" copy={VIDEO_LIST_COPY} unavailable={unavailable} />
      {!unavailable && (
        <SiteSection id="video-items" tone="ivory-dark" data={{ "data-hub-part": "latest" }}>
          {data.items.length > 0 ? (
            <ul data-part="video-articles" className={GRID}>
              {data.items.map((e) => (
                <li key={e.item.id} data-article-id={e.item.id} data-card={e.video ? "video" : "article"} className="flex">
                  <VideoEntry entry={e} />
                </li>
              ))}
            </ul>
          ) : (
            <p data-part="empty-guide" className="text-[17px] text-navy-700">
              {VIDEO_LIST_COPY.empty}
            </p>
          )}
          <Pager page={data.page} total={data.total} prev={prev} next={next} />
        </SiteSection>
      )}
    </div>
  );
}

export function PhotoListView({ data, unavailable = false }: { data: ListPage<ArticleListItem>; unavailable?: boolean }) {
  const { prev, next } = pagerLinks(PHOTO_LIST_HREF, {}, data.page, data.hasMore);
  return (
    <div data-ui="photo-list">
      <ListHead id="photo" copy={PHOTO_LIST_COPY} unavailable={unavailable} />
      {!unavailable && (
        <SiteSection id="photo-items" tone="ivory-dark" data={{ "data-hub-part": "latest" }}>
          {data.items.length > 0 ? (
            <ArticleGrid part="photo-articles" items={data.items} />
          ) : (
            <p data-part="empty-guide" className="text-[17px] text-navy-700">
              {PHOTO_LIST_COPY.empty}
            </p>
          )}
          <Pager page={data.page} total={data.total} prev={prev} next={next} />
        </SiteSection>
      )}
    </div>
  );
}

export function PartnerView({ data }: { data: PartnerPage }) {
  const p = data.partner;
  const { prev, next } = pagerLinks(`/partners/${p.id}`, {}, data.page, data.hasMore);
  return (
    <div data-ui="partner-page" data-partner-id={p.id}>
      <SiteSection id="partner-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead field="news" eyebrow={PARTNER_COPY.eyebrow} title={p.name} intro={p.intro} />
        <div data-part="partner-meta" className="mt-6 flex flex-wrap items-center gap-2">
          <PartnerBadge partner={p.name} />
          {p.kindName && <Chip>{p.kindName}</Chip>}
        </div>
        <p data-part="partner-independence" className="mt-4 text-[15px] text-navy-700">
          {PARTNER_COPY.independence}
        </p>
        {p.siteUrl && (
          <p className="mt-2">
            <a href={p.siteUrl} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              {PARTNER_COPY.site}
              <span className="sr-only"> (새 창)</span>
            </a>
          </p>
        )}
      </SiteSection>
      <SiteSection id="partner-items" tone="ivory-dark" heading={{ eyebrow: "ARTICLES", title: partnerListTitle(data.total) }} data={{ "data-hub-part": "latest" }}>
        {data.items.length > 0 && <ArticleGrid part="partner-articles" items={data.items} />}
        <Pager page={data.page} total={data.total} prev={prev} next={next} />
      </SiteSection>
    </div>
  );
}
