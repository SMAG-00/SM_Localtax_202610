import { Callout, FaqBlock, KeySummary, StatusBox, UiLink } from "@ltr/ui";
import type { StoredBlock } from "@/lib/server/articles/content";
import type { ArticleMedia } from "@/lib/server/public";
import { paragraphSegments, tableView, videoHref } from "@/lib/site/article-view";
import { TEXT_LINK } from "./SiteSection";

// 기사 본문 블록 (ART-01 블록 9종 — 카드뉴스 장은 CardNewsSlider) — 문단·표·이미지·인용·상자·인포그래픽·동영상·FAQ·핵심 요약 상자.
//  · 이미지·인포그래픽은 권리 확인되어 읽히는 것만 온다(공개 데이터 함수가 뺀다) — 사진마다 대체 텍스트·출처(credit)
//  · rose 상자는 '자주 틀리는 점'에만(UX-03), 절세 체크포인트는 emerald 상태 상자, 정보·주의는 강조 문단
//  · 표는 좁은 화면에서 표 안에서만 가로로 밀린다 — 화면 전체 가로 스크롤 0 (UX-06)
//  · 동영상은 유튜브 nocookie 주소만 새 창 링크로 (재생기·썸네일 카드는 ART-08 동영상 기사 — W2-c)

const PARAGRAPH = "text-[17px] leading-[1.8] text-navy-900 [overflow-wrap:anywhere]";

function Paragraph({ text }: { text: string }) {
  return (
    <p className={`${PARAGRAPH} whitespace-pre-line`}>
      {paragraphSegments(text).map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <UiLink key={i} href={s.href} className="font-bold text-hermes-800 underline underline-offset-4 hover:text-hermes-900" {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {s.text}
            {s.external && <span className="sr-only"> (새 창)</span>}
          </UiLink>
        ),
      )}
    </p>
  );
}

function Figure({ media, caption, chart, kind }: { media: ArticleMedia; caption: string; chart: { axis: string; unit: string; source: string } | null; kind: "image" | "infographic" }) {
  return (
    <figure data-block={kind} data-media-id={media.id}>
      {/* 원본 비율 그대로 줄이고 자르지 않는다 (ART-07 · ART-09) — 크기는 이미지 파일이 정한다 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.src} alt={media.alt} loading="lazy" decoding="async" className="block h-auto w-full rounded-xl border border-navy-100 bg-white" />
      {(caption || media.credit || chart) && (
        <figcaption className="mt-2 space-y-1 text-[14px] text-navy-600">
          {caption && <p>{caption}</p>}
          {chart && (chart.unit || chart.source) && <p>{[chart.unit && `단위 ${chart.unit}`, chart.source && `출처 ${chart.source}`].filter(Boolean).join(" · ")}</p>}
          {media.credit && <p data-part="credit">{`사진·그림 ${media.credit}`}</p>}
        </figcaption>
      )}
    </figure>
  );
}

function Block({ block, media, index }: { block: StoredBlock; media: Record<number, ArticleMedia>; index: number }) {
  switch (block.type) {
    case "paragraph":
      return <Paragraph text={block.text} />;
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
    case "image":
    case "infographic": {
      const m = media[Number(block.mediaId)];
      if (!m) return null;
      return <Figure media={{ ...m, alt: block.alt || m.alt }} caption={block.caption} chart={block.type === "infographic" ? block.chart : null} kind={block.type} />;
    }
    case "quote":
      return (
        <figure data-block="quote" className="border-l-2 border-navy-300 pl-5">
          <blockquote className={PARAGRAPH}>{block.text}</blockquote>
          {block.speaker && <figcaption className="mt-2 text-[15px] text-navy-600">{`— ${block.speaker}`}</figcaption>}
        </figure>
      );
    case "callout":
      if (block.kind === "mistake")
        return (
          <StatusBox kind="mistake" title="자주 틀리는 점">
            <p className="whitespace-pre-line">{block.text}</p>
          </StatusBox>
        );
      if (block.kind === "tip")
        return (
          <StatusBox kind="tip" title={block.title || "절세 체크포인트"}>
            <p className="whitespace-pre-line">{block.text}</p>
          </StatusBox>
        );
      return (
        <div data-block="callout" data-kind={block.kind}>
          {block.title && <p className="mb-1 text-[15px] font-black text-navy-900">{block.title}</p>}
          <Callout className="whitespace-pre-line text-[16px] text-navy-800">{block.text}</Callout>
        </div>
      );
    case "video": {
      const href = videoHref(block.embedUrl);
      if (!href) return null;
      return (
        <p data-block="video" className="text-[15px] text-navy-700">
          {block.caption && <span className="mr-2">{block.caption}</span>}
          <a href={href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
            동영상 보기<span className="sr-only"> (새 창)</span>
          </a>
        </p>
      );
    }
    case "faq":
      return <FaqBlock items={block.items.map((it, i) => ({ id: `faq-${index}-${i}`, question: it.question, answer: it.answer }))} />;
    case "slide":
      // 카드뉴스 장은 본문 블록으로 그리지 않는다 (CardNewsSlider)
      return null;
  }
}

export function ArticleBlocks({ blocks, media }: { blocks: readonly StoredBlock[]; media: Record<number, ArticleMedia> }) {
  if (blocks.length === 0) return null;
  return (
    <div data-part="blocks" className="mt-10 space-y-8">
      {blocks.map((b, i) => (
        <div key={i} data-block-index={i} data-block-type={b.type}>
          <Block block={b} media={media} index={i} />
        </div>
      ))}
    </div>
  );
}
