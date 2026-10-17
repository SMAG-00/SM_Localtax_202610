// NAV-02 보도자료 단순 재게시 · NAV-04 자체 취재 증거(출처·검증된 근거)와 사진 권리
import { finding, type Finding } from "../findings";
import type { ArticleForPublish } from "../model";

export function checkSourcing(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  if (article.contentType === "reported_news") {
    if (article.sources.length === 0) {
      out.push(finding("nav04.sources-required", "보도기사는 공개 출처가 1건 이상 있어야 합니다"));
    } else if (article.sources.every((s) => s.kind === "press_release")) {
      out.push(
        finding("nav02.press-release-only", "출처가 보도자료뿐입니다 — 보도자료 재게시는 자체 취재 보도기사로 발행할 수 없습니다"),
      );
    }
    if (!article.evidence.some((e) => e.verificationStatus === "verified")) {
      out.push(
        finding("nav04.own-evidence-required", "검증된 자체 취재 근거(원자료·문서·인터뷰·현장·사진·계산)가 1건 이상 있어야 합니다"),
      );
    }
  }
  out.push(...imageRights(article));
  return out;
}

/** 사진 권리 — 대표 이미지 · 이미지·인포그래픽 블록 · 사진 출처 (유형과 상관없이) */
function imageRights(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  const lead = article.leadImage;
  if (lead && lead.rightsStatus !== "confirmed") {
    out.push(finding("nav04.image-rights", "대표 사진의 이용 권리를 확인하지 않았습니다", { field: "leadImage", phrase: lead.mediaId }));
  }
  article.blocks.forEach((block, blockIndex) => {
    if ((block.type === "image" || block.type === "infographic") && block.rightsStatus !== "confirmed") {
      out.push(
        finding("nav04.image-rights", "본문 이미지의 이용 권리를 확인하지 않았습니다", {
          field: "blocks",
          blockIndex,
          phrase: block.mediaId,
        }),
      );
    }
  });
  for (const source of article.sources) {
    if (source.kind === "photo" && source.rightsStatus !== "confirmed") {
      out.push(finding("nav04.image-rights", "사진 출처의 이용 권리를 확인하지 않았습니다", { field: "sources", phrase: source.id }));
    }
  }
  return out;
}
