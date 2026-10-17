// NAV-10 정량형 필수 7묶음 — 원자료 · 지표 정의 · 계산 과정 · 원자료 대조 기록 · 그래프·표 표기 · 한계 · 관계자 확인 + '인과 단정 없음'
// 대상: reported_news 중 취재 방식 quantitative·mixed
import { finding, type Finding, type RuleId } from "../findings";
import type { ArticleDataset, ArticleForPublish, ChartLabels } from "../model";
import { isBlank } from "../text";

type DatasetField = Exclude<keyof ArticleDataset, "evidenceId">;

/** article_datasets 칸으로 채우는 3묶음 — 칸 이름은 편집자에게 보이는 이름 */
const DATASET_GROUPS: readonly { id: RuleId; name: string; fields: readonly [DatasetField, string][] }[] = [
  {
    id: "nav10.source-data",
    name: "원자료",
    fields: [
      ["sourceUrl", "원자료 파일/공식 URL"],
      ["provider", "제공기관"],
      ["collectedAt", "수집일"],
      ["license", "이용권리"],
    ],
  },
  {
    id: "nav10.indicator-definition",
    name: "지표 정의",
    fields: [
      ["definition", "지표 정의"],
      ["period", "기간"],
      ["unit", "단위"],
      ["regionUnit", "지역 단위"],
      ["denominator", "분모"],
      ["exclusions", "제외값"],
    ],
  },
  {
    id: "nav10.calculation",
    name: "계산 과정",
    fields: [
      ["transform", "계산 과정·수식"],
      ["reproFileHash", "재현 파일 해시"],
    ],
  },
];

const CHART_FIELDS: readonly [keyof ChartLabels, string][] = [
  ["axis", "축"],
  ["unit", "단위"],
  ["source", "출처"],
];

export function isQuantitative(article: ArticleForPublish): boolean {
  return article.contentType === "reported_news" && (article.reportingMethod === "quantitative" || article.reportingMethod === "mixed");
}

export function checkQuantitative(article: ArticleForPublish): Finding[] {
  if (!isQuantitative(article)) return [];
  const out: Finding[] = [];

  for (const group of DATASET_GROUPS) {
    if (article.datasets.length === 0) {
      out.push(finding(group.id, `${group.name} 묶음이 비었습니다 — 재현 정보(원자료·지표·계산)가 0건입니다`));
      continue;
    }
    for (const dataset of article.datasets) {
      const missing = group.fields.filter(([key]) => isBlank(dataset[key])).map(([, label]) => label);
      if (missing.length > 0) {
        out.push(
          finding(group.id, `${group.name} 묶음이 비었습니다 — 비어 있는 칸: ${missing.join(", ")} (자료 ${dataset.evidenceId})`, {
            field: "datasets",
            phrase: dataset.evidenceId,
          }),
        );
      }
    }
  }

  const checklist = article.quantitativeChecklist;
  if (isBlank(checklist?.sourceCrossCheck)) {
    out.push(finding("nav10.source-cross-check", "원자료 대조 기록 묶음이 비었습니다 — 기자가 원자료와 대조한 기록을 남겨 주세요"));
  }
  out.push(...chartLabels(article));
  if (isBlank(checklist?.limitations)) {
    out.push(finding("nav10.limitations", "한계 묶음이 비었습니다 — 수치가 말하지 않는 것을 적어 주세요"));
  }
  if (isBlank(checklist?.relatedPartyCheck)) {
    out.push(finding("nav10.related-party-check", "관계자 확인 묶음이 비었습니다 — 관련 기관·전문가 확인 기록을 남겨 주세요"));
  }
  if (checklist?.noCausalClaim !== true) {
    out.push(finding("nav10.no-causal-claim", "편집자 확인 '인과 단정 없음'을 체크해야 발행됩니다 — 상관관계를 원인으로 단정하지 않았는지 확인하세요"));
  }
  return out;
}

/** 그래프·표 표기 — 표·인포그래픽이 1개 이상 있고, 모두 축/단위/출처를 적었다 */
function chartLabels(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  let charts = 0;
  article.blocks.forEach((block, blockIndex) => {
    if (block.type !== "table" && block.type !== "infographic") return;
    charts++;
    const missing = CHART_FIELDS.filter(([key]) => block.chart === null || isBlank(block.chart[key])).map(([, label]) => label);
    if (missing.length > 0) {
      out.push(
        finding("nav10.chart-labels", `그래프·표 표기 묶음이 비었습니다 — 비어 있는 칸: ${missing.join(", ")}`, { field: "blocks", blockIndex }),
      );
    }
  });
  if (charts === 0) {
    out.push(finding("nav10.chart-labels", "그래프·표 표기 묶음이 비었습니다 — 축/단위/출처를 적은 표나 그래프가 없습니다"));
  }
  return out;
}
