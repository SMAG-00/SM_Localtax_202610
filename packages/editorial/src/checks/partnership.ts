// ART-10 제휴 콘텐츠 — 표기(공동 기획·광고)가 있으면 sponsored, 공동 기획에는 제휴사, 제휴사를 지정하면 표기,
// 계약 종료일(contract_to, 그날까지 유효)이 지난 제휴사는 새 기사(첫 발행 전)에 지정할 수 없다 — 기존 기사 배지는 남는다.
// 공동 기획과 광고를 함께 지정하는 것은 표기 칸이 하나(label)라 입력 모델에서 생길 수 없다.
import { finding, type Finding } from "../findings";
import type { ArticleForPublish, PublishContext } from "../model";

export function checkPartnership(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  const partner = article.partner;
  if (article.label !== "none" && article.contentType !== "sponsored") {
    out.push(finding("art10.label-requires-sponsored", "표기(공동 기획·광고)가 있는 기사는 유형이 광고·협찬(sponsored)이어야 합니다"));
  }
  if (article.label === "co_planned" && partner === null) {
    out.push(finding("art10.co-planned-partner-required", "공동 기획 표기에는 제휴사를 지정해야 합니다 (배지 ‘공동 기획 ○○’)"));
  }
  if (partner !== null && article.label === "none") {
    out.push(finding("art10.partner-requires-label", "제휴사를 지정한 기사는 표기(공동 기획 또는 광고)가 있어야 합니다"));
  }
  if (partner !== null && article.firstPublishedAt === null && partner.contractTo !== null && partner.contractTo < ctx.today) {
    out.push(
      finding(
        "art10.partner-contract-expired",
        `제휴사 ‘${partner.name}’의 계약이 ${partner.contractTo}에 끝났습니다 — 새 기사에 지정할 수 없습니다`,
        { field: "partner", phrase: partner.id },
      ),
    );
  }
  return out;
}
