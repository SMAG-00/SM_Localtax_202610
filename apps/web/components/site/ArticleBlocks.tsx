import { Callout, FaqBlock, InfographicBlock, KeySummary, StatusBox, UiLink } from "@ltr/ui";
import type { StoredBlock } from "@/lib/server/articles/content";
import type { ArticleMedia } from "@/lib/server/public";
import type { SectionKey } from "@/lib/server/public/constants";
import { paragraphSegments, tableView } from "@/lib/site/article-view";
import type { PlannedRun } from "@/lib/site/glossary-tips";
import { infographicNotes, infographicView, photoCreditLine, videoTitle } from "@/lib/site/media-view";
import { TipPieces, TipRuns } from "./GlossaryTip";
import { VideoPlayer } from "./VideoPlayer";

// 기사 본문 블록 (ART-01 블록 9종 — 카드뉴스 장은 CardNewsSlider) — 문단·표·이미지·인용·상자·인포그래픽·동영상·FAQ·핵심 요약 상자.
//  · 이미지·인포그래픽·동영상 썸네일은 권리 확인되어 읽히는 것만 온다(공개 데이터 함수가 뺀다) — 사진마다 대체 텍스트·출처(credit).
//    그림은 원본 비율 그대로 줄이고 자르지 않는다(크기를 알면 width·height로 자리를 잡는다 — ART-07 · ART-08 · ART-09)
//  · 포토 기사(ART-09)는 사진마다 촬영·출처·이용 조건 줄
//  · 인포그래픽(ART-07)은 그림 + 같은 내용의 표·목록(기본 접힘, 키보드로 펼침) — @ltr/ui InfographicBlock
//  · 동영상(ART-08)은 누르면 재생되는 카드 — 누르기 전 유튜브·구글 요청 0, 누르면 video_played 1건 (VideoPlayer)
//  · rose 상자는 '자주 틀리는 점'에만(UX-03), 절세 체크포인트는 emerald 상태 상자, 정보·주의는 강조 문단
//  · 표는 좁은 화면에서 표 안에서만 가로로 밀린다 — 화면 전체 가로 스크롤 0 (UX-06)
//  · 본문 첫 등장 용어 풀이(GLO-02) — 문단·인용·상자 글에 기사 상세가 계획한 툴팁 자리(lib/site/glossary-tips.ts)를 단추로 그린다(GlossaryTip.tsx).
//    문단 링크·상자 제목·인용 발언자·표·FAQ·핵심 요약에는 붙지 않는다. 계획이 없는 블록은 글 그대로

const PARAGRAPH = "text-[17px] leading-[1.8] text-navy-900 [overflow-wrap:anywhere]";
const PARAGRAPH_LINK = "font-bold text-hermes-800 underline underline-offset-4 hover:text-hermes-900";

function Paragraph({ text, tips }: { text: string; tips?: readonly PlannedRun[] }) {
  return (
    <p className={`${PARAGRAPH} whitespace-pre-line`}>
      {tips ? (
        <TipRuns runs={tips} linkClass={PARAGRAPH_LINK} />
      ) : (
        paragraphSegments(text).map((s, i) =>
          s.kind === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <UiLink key={i} href={s.href} className={PARAGRAPH_LINK} {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              {s.text}
              {s.external && <span className="sr-only"> (새 창)</span>}
            </UiLink>
          ),
        )
      )}
    </p>
  );
}

/** 인용·상자 글 — 툴팁 계획이 있으면 용어 자리를 단추로 */
function BlockText({ text, tips }: { text: string; tips?: readonly PlannedRun[] }) {
  const run = tips?.[0];
  return run && run.kind === "text" ? <TipPieces pieces={run.pieces} /> : <>{text}</>;
}

/** 그림의 원본 크기 — 알면 img width·height(자리 확보). CSS는 h-auto w-full이라 원본 비율 그대로 줄어든다(자르지 않음) */
const sizeOf = (m: ArticleMedia) => (m.width && m.height ? { width: m.width, height: m.height } : {});

/** 기사 블록이 그리는 데 쓰는 기사 값 — 동영상 측정(기사 번호·분야)·카드 제목 · 포토 기사 표기 줄 */
export interface BlockArticle {
  id: number;
  section: SectionKey;
  title: string;
  format: string | null;
}

function Figure({ media, caption, photo }: { media: ArticleMedia; caption: string; photo: boolean }) {
  const credit = photo ? photoCreditLine(media) : media.credit ? `사진·그림 ${media.credit}` : "";
  return (
    <figure data-block="image" data-media-id={media.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.src} alt={media.alt} {...sizeOf(media)} loading="lazy" decoding="async" className="block h-auto w-full rounded-xl border border-navy-100 bg-white" />
      {(caption || credit) && (
        <figcaption className="mt-2 space-y-1 text-[14px] text-navy-600">
          {caption && <p>{caption}</p>}
          {credit && <p data-part={photo ? "photo-credit" : "credit"}>{credit}</p>}
        </figcaption>
      )}
    </figure>
  );
}

function Block({ block, media, index, article, tips }: { block: StoredBlock; media: Record<number, ArticleMedia>; index: number; article: BlockArticle; tips?: readonly PlannedRun[] }) {
  switch (block.type) {
    case "paragraph":
      return <Paragraph text={block.text} tips={tips} />;
    case "heading":
      return block.level === 3 ? (
        <h3 className="text-[19px] font-black leading-snug text-navy-900 [overflow-wrap:anywhere]">{block.text}</h3>
      ) : (
        <h2 className="text-[23px] font-black leading-snug text-navy-900 [overflow-wrap:anywhere]">{block.text}</h2>
      );
    case "key_summary":
      return <KeySummary lines={block.lines} />;
    case "table": {
      const t = tableView(block.rows);
      if (!t) return null;
      return (
        <figure data-block="table">
          <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white">
            <table className="w-full min-w-max border-collapse text-left text-[15px] text-navy-800">
              <caption className="px-4 pt-3 text-left text-[15px] font-bold text-navy-900">{block.caption}</caption>
              {t.head && (
                <thead>
                  <tr>
                    {t.head.map((c, i) => (
                      <th key={i} scope="col" className="border-b border-navy-200 px-4 py-2 text-[13px] font-bold text-navy-700">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {t.body.map((row, r) => (
                  <tr key={r} className="border-b border-navy-100 last:border-b-0">
                    {row.map((c, i) => (
                      <td key={i} className="px-4 py-2 tabular-nums">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.chart && (block.chart.unit || block.chart.source) && (
            <figcaption className="mt-2 text-[14px] text-navy-600">{[block.chart.unit && `단위 ${block.chart.unit}`, block.chart.source && `출처 ${block.chart.source}`].filter(Boolean).join(" · ")}</figcaption>
          )}
        </figure>
      );
    }
    case "image": {
      const m = media[Number(block.mediaId)];
      if (!m) return null;
      return <Figure media={{ ...m, alt: block.alt || m.alt }} caption={block.caption} photo={article.format === "photo"} />;
    }
    case "infographic": {
      const m = media[Number(block.mediaId)];
      // 대체 텍스트·같은 내용이 없는 블록은 공개 데이터 함수가 이미 뺐다 — 화면도 한 번 더 (컴포넌트도 그리지 않는다)
      if (!m || !block.data) return null;
      return (
        <div data-block="infographic" data-media-id={m.id}>
          <InfographicBlock
            title={block.caption.trim() || block.alt}
            image={{ src: m.src, alt: block.alt, ...sizeOf(m) }}
            data={infographicView({ caption: block.caption, alt: block.alt, template: block.template, data: block.data })}
            notes={infographicNotes(block.chart, m.credit)}
            template={block.template}
          />
        </div>
      );
    }
    case "quote":
      return (
        <figure data-block="quote" className="border-l-2 border-navy-300 pl-5">
          <blockquote className={PARAGRAPH}>
            <BlockText text={block.text} tips={tips} />
          </blockquote>
          {block.speaker && <figcaption className="mt-2 text-[15px] text-navy-600">{`— ${block.speaker}`}</figcaption>}
        </figure>
      );
    case "callout":
      if (block.kind === "mistake")
        return (
          <StatusBox kind="mistake" title="자주 틀리는 점">
            <p className="whitespace-pre-line">
              <BlockText text={block.text} tips={tips} />
            </p>
          </StatusBox>
        );
      if (block.kind === "tip")
        return (
          <StatusBox kind="tip" title={block.title || "절세 체크포인트"}>
            <p className="whitespace-pre-line">
              <BlockText text={block.text} tips={tips} />
            </p>
          </StatusBox>
        );
      return (
        <div data-block="callout" data-kind={block.kind}>
          {block.title && <p className="mb-1 text-[15px] font-black text-navy-900">{block.title}</p>}
          <Callout className="whitespace-pre-line text-[16px] text-navy-800">
            <BlockText text={block.text} tips={tips} />
          </Callout>
        </div>
      );
    case "video": {
      const thumb = block.thumbnailMediaId === null ? undefined : media[Number(block.thumbnailMediaId)];
      // 주소·썸네일이 맞지 않는 블록은 공개 데이터 함수(publicBlocks)가 이미 뺐다
      if (!thumb) return null;
      return (
        <div data-block="video" data-media-id={thumb.id}>
          <VideoPlayer
            articleId={article.id}
            section={article.section}
            title={videoTitle(block.caption, article.title)}
            summary={block.summary}
            embedUrl={block.embedUrl}
            thumbnail={{ src: thumb.src, ...sizeOf(thumb) }}
            durationSeconds={block.durationSeconds}
            captions={block.captions}
          />
        </div>
      );
    }
    case "faq":
      return <FaqBlock items={block.items.map((it, i) => ({ id: `faq-${index}-${i}`, question: it.question, answer: it.answer }))} />;
    case "slide":
      // 카드뉴스 장은 본문 블록으로 그리지 않는다 (CardNewsSlider)
      return null;
  }
}

export function ArticleBlocks({
  blocks,
  media,
  article,
  tips,
}: {
  blocks: readonly StoredBlock[];
  media: Record<number, ArticleMedia>;
  article: BlockArticle;
  /** 본문 첫 등장 용어 풀이 계획 (블록 번호 → 조각) — 없으면 글 그대로 */
  tips?: ReadonlyMap<number, readonly PlannedRun[]>;
}) {
  if (blocks.length === 0) return null;
  return (
    <div data-part="blocks" className="mt-10 space-y-8">
      {blocks.map((b, i) => (
        <div key={i} data-block-index={i} data-block-type={b.type}>
          <Block block={b} media={media} index={i} article={article} tips={tips?.get(i)} />
        </div>
      ))}
    </div>
  );
}
