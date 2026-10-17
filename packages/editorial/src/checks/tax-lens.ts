// 01B CORE-01 「지방세로 읽기」 — 대상 기사 판정, 발행 차단(박스·생략 사유·감수), 저장 규칙(세목·포인트·링크·세액·감면 단정)
import { finding, toSaveValidation, type Finding, type SaveValidation } from "../findings";
import type { ArticleForPublish, ContentType, PublishContext, Section, TaxLens } from "../model";
import { findPhrases, isBlank, taxLensUnit, unitLocation } from "../text";

/** 박스 요구 분야 — 부동산 · 부동산개발금융 · 지자체뉴스 (tax는 대상 아님) */
const TARGET_SECTIONS: ReadonlySet<Section> = new Set(["realestate", "finance", "local"]);
/** 박스 요구 유형 — sponsored 제외, digest는 적용 방식이 결정 안건(01B 11장)이라 지금은 넣지 않는다 */
const TARGET_TYPES: ReadonlySet<ContentType> = new Set(["reported_news", "explainer", "guide", "opinion"]);
/** 핵심 포인트 줄 수 범위 (PRD-00 8.8 "3줄 이하", 0줄은 저장 거부) */
const MIN_POINTS = 1;
const MAX_POINTS = 3;

/**
 * 세액 표현 — 숫자(쉼표·소수) + (십·백·천·만·억·조) + '원'. 뒤가 원칙·원리·원본·원문·원장·원소·원형·원점이면 금액이 아니다.
 * 한글 숫자만으로 쓴 금액("백만 원")은 잡지 않는다.
 */
const TAX_AMOUNT = /\d[\d,]*(?:\.\d+)?\s*(?:[십백천만억조]\s*)*원(?![칙리본문장소형점])/g;

export function isTaxLensTarget(section: Section | null, contentType: ContentType | null): boolean {
  return section !== null && contentType !== null && TARGET_SECTIONS.has(section) && TARGET_TYPES.has(contentType);
}

/** 박스 내용(세목·포인트·링크)이 하나라도 있다 — 없고 생략 사유만 있으면 생략 */
export function hasTaxLensContent(lens: TaxLens): boolean {
  return lens.topics.some((t) => !isBlank(t)) || lens.points.some((p) => !isBlank(p)) || lens.links.length > 0;
}

function contentFindings(lens: TaxLens, ctx: PublishContext, includeDictionary: boolean): Finding[] {
  const out: Finding[] = [];
  if (!lens.topics.some((t) => !isBlank(t))) {
    out.push(finding("core01.topics-required", "관련 세목을 1개 이상 골라 주세요"));
  }
  const points = lens.points.filter((p) => !isBlank(p)).length;
  if (points < MIN_POINTS || points > MAX_POINTS) {
    out.push(finding("core01.points-count", `핵심 포인트는 ${MIN_POINTS}~${MAX_POINTS}줄이어야 합니다 — 지금 ${points}줄`));
  }
  if (lens.links.length === 0) {
    out.push(finding("core01.links-required", "해설·계산기·도서·전문가 링크를 1개 이상 넣어 주세요"));
  }
  const unit = taxLensUnit(lens);
  lens.points.forEach((point, index) => {
    for (const m of point.normalize("NFC").matchAll(TAX_AMOUNT)) {
      out.push(
        finding("core01.tax-amount", `박스에는 세액을 쓰지 않습니다 — ‘${m[0]}’을 빼 주세요`, unitLocation(unit, index, m[0])),
      );
    }
  });
  if (includeDictionary) {
    for (const hit of findPhrases([unit], ctx.dictionaries.forbiddenPhrases)) {
      out.push(
        finding("core01.forbidden-phrase", `박스에 금지 표현 ‘${hit.phrase}’ — 감면 해당 여부를 단정하지 않습니다`, unitLocation(unit, hit.sentenceIndex, hit.phrase)),
      );
    }
  }
  return out;
}

/** CORE-01 저장 규칙 — 생략 사유만 있는 박스는 저장, 내용이 있으면 세목 1+·포인트 1~3·링크 1+·세액 0·금지 표현 0 */
export function validateTaxLensForSave(lens: TaxLens, ctx: PublishContext): SaveValidation {
  if (!hasTaxLensContent(lens) && !isBlank(lens.omissionReason)) return toSaveValidation([]);
  return toSaveValidation(contentFindings(lens, ctx, true));
}

/**
 * 발행 판정 — 대상 기사에 감수된 박스도 생략 사유도 없으면 차단. 박스가 있으면(대상이 아니어도) 저장 규칙과 세무 감수를 본다.
 * 금지 표현은 UX-01 검사가 박스 글까지 보므로 여기서 다시 내지 않는다.
 */
export function checkTaxLens(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const lens = article.taxLens;
  const content = lens !== null && hasTaxLensContent(lens);
  const reason = lens !== null && !isBlank(lens.omissionReason);
  if (!content) {
    return isTaxLensTarget(article.section, article.contentType) && !reason
      ? [finding("core01.box-or-reason", "「지방세로 읽기」 박스를 넣거나, 생략하려면 편집자 생략 사유를 남겨 주세요")]
      : [];
  }
  const out = contentFindings(lens, ctx, false);
  if (!lens.reviewed || lens.reviewedForVersion === null) {
    out.push(finding("core01.box-unreviewed", "「지방세로 읽기」 박스의 세무 감수 서명이 없습니다"));
  } else if (lens.reviewedForVersion !== article.version) {
    out.push(
      finding(
        "core01.box-re-review",
        `「지방세로 읽기」 박스가 감수 뒤 바뀌었습니다(감수 버전 ${lens.reviewedForVersion}, 현재 버전 ${article.version}) — 재감수 필요`,
      ),
    );
  }
  return out;
}
