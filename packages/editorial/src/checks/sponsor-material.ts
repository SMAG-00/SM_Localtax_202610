// PR-04 분양 홍보 원고 — 시행사·분양대행사가 준 분양 홍보 원고(출처 종류 sponsor_material)를 쓴 기사는 광고·협찬(sponsored)으로만 발행한다
// (01B PR-04 · docs/dev/W4_설계.md 1장 17단계). DB 트리거 articles_sponsor_material_guard·article_sources_sponsor_material_guard(마이그레이션 …51)와 같은 규칙.
// '광고' 표기 자체는 ART-10(partnership.ts — 표기가 있으면 sponsored, sponsored는 표기 필수)이 본다.
import { finding, type Finding } from "../findings";
import type { ArticleForPublish, PublishContext } from "../model";

export function checkSponsorMaterial(article: ArticleForPublish, _ctx: PublishContext): Finding[] {
  if (article.contentType === "sponsored") return [];
  const material = article.sources.filter((s) => s.kind === "sponsor_material");
  if (material.length === 0) return [];
  const type = article.contentType ?? "없음";
  return [
    finding(
      "pr04.sponsor-material-sponsored",
      `시행사·분양대행사가 준 분양 홍보 원고를 쓴 기사는 광고·협찬(sponsored)으로만 발행합니다 — 지금 유형 ${type}. 보도·해설로 내려면 그 출처를 빼고 자체 취재로 다시 쓰세요`,
      { field: "sources", phrase: material.map((s) => s.id).join(",") },
    ),
  ];
}
