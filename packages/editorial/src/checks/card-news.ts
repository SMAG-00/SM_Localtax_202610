// ART-03 카드뉴스 — 형식이 카드뉴스인 기사는 장(slide 블록)이 5~7개, 장마다 대체 텍스트와 글자(제목 또는 글)가 있어야 발행된다.
// 장 글자는 이미지가 아니라 HTML 글자라 비어 있으면 화면에 아무것도 없는 장이 된다. 카드뉴스가 아닌 기사의 장 블록은 공개 화면이 그리지 않으므로 막는다.
import { finding, type Finding } from "../findings";
import { CARDNEWS_SLIDES, type ArticleForPublish } from "../model";
import { isBlank } from "../text";

export function checkCardNews(article: ArticleForPublish): Finding[] {
  const slides = article.blocks.flatMap((block, blockIndex) => (block.type === "slide" ? [{ block, blockIndex }] : []));
  if (article.format !== "cardnews") {
    return slides.map(({ blockIndex }) =>
      finding("art03.slide-outside-cardnews", "카드뉴스 장은 형식이 카드뉴스인 기사에만 씁니다 — 형식을 카드뉴스로 바꾸거나 이 장을 문단으로 바꿔 주세요", {
        field: "blocks",
        blockIndex,
      }),
    );
  }
  const out: Finding[] = [];
  const n = slides.length;
  if (n < CARDNEWS_SLIDES.min || n > CARDNEWS_SLIDES.max) {
    out.push(finding("art03.slide-count", `카드뉴스는 ${CARDNEWS_SLIDES.min}~${CARDNEWS_SLIDES.max}장이어야 발행됩니다 — 지금 ${n}장입니다`, { field: "blocks" }));
  }
  slides.forEach(({ block, blockIndex }, i) => {
    if (block.type !== "slide") return;
    if (isBlank(block.alt)) out.push(finding("art03.slide-alt", `${i + 1}번째 장에 대체 텍스트가 없습니다 — 장의 그림·배치를 글로 적어 주세요`, { field: "blocks", blockIndex }));
    if (isBlank(block.title) && isBlank(block.text)) out.push(finding("art03.slide-text", `${i + 1}번째 장에 글자가 없습니다 — 제목이나 글을 적어 주세요`, { field: "blocks", blockIndex }));
  });
  return out;
}
