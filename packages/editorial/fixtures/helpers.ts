// 견본을 바꿔 만드는 도우미 — 시험·E2E가 같은 방법으로 원고 한 곳만 바꾼다
import type { Finding } from "../src/findings";
import type { ArticleBlock, ArticleForPublish } from "../src/model";

/** 항목 ID 목록 — 결과 순서를 지키고 같은 ID는 한 번 */
export function uniqueIds(findings: readonly Finding[]): string[] {
  return [...new Set(findings.map((f) => f.id))];
}

/** index번 블록을 바꾼 원고 */
export function withBlock(article: ArticleForPublish, index: number, block: ArticleBlock): ArticleForPublish {
  return { ...article, blocks: article.blocks.map((b, i) => (i === index ? block : b)) };
}

/** 블록을 끝에 더한 원고 */
export function withExtraBlock(article: ArticleForPublish, block: ArticleBlock): ArticleForPublish {
  return { ...article, blocks: [...article.blocks, block] };
}
