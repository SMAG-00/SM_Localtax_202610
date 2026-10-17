// UX-01 쉬운 말 (R8, PRD-00 8.8) — 금지 표현(차단·위치), 풀이 없는 전문 용어 첫 등장(경고), 안내 문장 글자 수(경고), 한 상자 문장 수(경고).
// 기사에서 '안내 문장'은 요약과 상자 블록(콜아웃·핵심 요약 상자)의 문장이다. 본문 문단에는 글자 수 기준을 쓰지 않는다.
// 상황 카드·허브 소개·화면 고정 문구는 checkScreenCopy로 같은 사전·기준을 쓴다 (UX-03 공포 표현 포함).
import { finding, sortFindings, type Finding } from "../findings";
import type { ArticleForPublish, PublishContext } from "../model";
import {
  articleUnits,
  blockSentences,
  boxBodySentences,
  countChars,
  findPhrases,
  josa,
  normalizeText,
  splitSentences,
  unitLocation,
  type TextUnit,
} from "../text";
import { fearFindings } from "./pressure";

function forbiddenFindings(units: readonly TextUnit[], ctx: PublishContext): Finding[] {
  return findPhrases(units, ctx.dictionaries.forbiddenPhrases).map((hit) =>
    finding("ux01.forbidden-phrase", `금지 표현 ‘${hit.phrase}’ — 이 표현을 빼야 발행됩니다`, unitLocation(hit.unit, hit.sentenceIndex, hit.phrase)),
  );
}

/** 용어가 처음 나오는 단위에 쉬운 풀이가 없으면 경고 — 단위(문단) 안 어디든 풀이 글자가 있으면 풀었다고 본다 */
function jargonFindings(units: readonly TextUnit[], ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  for (const { term, plain } of ctx.dictionaries.jargonTerms) {
    const t = normalizeText(term);
    if (t === "") continue;
    for (const unit of units) {
      const sentenceIndex = unit.sentences.findIndex((s) => normalizeText(s).includes(t));
      if (sentenceIndex === -1) continue;
      if (!normalizeText(unit.sentences.join(" ")).includes(normalizeText(plain))) {
        out.push(
          finding(
            "ux01.jargon-unexplained",
            `‘${term}’${josa(term, "이", "가")} 처음 나오는 문단에 쉬운 풀이(${plain})가 없습니다`,
            unitLocation(unit, sentenceIndex, term),
          ),
        );
      }
      break;
    }
  }
  return out;
}

function guideLengthFindings(unit: TextUnit, ctx: PublishContext): Finding[] {
  const max = ctx.thresholds.guideSentenceMax;
  const out: Finding[] = [];
  unit.sentences.forEach((sentence, sentenceIndex) => {
    const n = countChars(sentence);
    if (n > max) {
      out.push(finding("ux01.guide-sentence-long", `안내 문장이 ${n}자입니다(기준 ${max}자) — 문장을 나눠 주세요`, unitLocation(unit, sentenceIndex)));
    }
  });
  return out;
}

function boxCountFinding(count: number, location: { field: string; blockIndex?: number }, ctx: PublishContext): Finding[] {
  const max = ctx.thresholds.boxSentenceMax;
  if (count <= max) return [];
  return [finding("ux01.box-too-many-sentences", `한 상자에 ${count}문장이 있습니다(기준 ${max}문장) — 줄이거나 나눠 주세요`, location)];
}

export function checkPlainLanguage(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const units = articleUnits(article);
  const out = [...forbiddenFindings(units, ctx)];
  // 전문 용어 첫 등장은 본문 블록에서 찾는다 (제목·요약은 풀이를 넣을 자리가 아니다)
  out.push(...jargonFindings(units.filter((u) => u.field === "blocks"), ctx));
  out.push(...guideLengthFindings({ field: "summary", sentences: splitSentences(article.summary) }, ctx));
  article.blocks.forEach((block, blockIndex) => {
    const body = boxBodySentences(block);
    if (body === null) return;
    // 카드뉴스 장의 대체 텍스트는 화면 글자가 아니다 — 안내 문장 길이는 제목·글만 본다 (대체 텍스트는 문장 목록의 끝이라 번호가 같다)
    const shown = block.type === "slide" ? [...splitSentences(block.title), ...body] : blockSentences(block);
    out.push(...guideLengthFindings({ field: "blocks", blockIndex, sentences: shown }, ctx));
    out.push(...boxCountFinding(body.length, { field: "blocks", blockIndex }, ctx));
  });
  return out;
}

/** 화면 문구 한 칸 — guide는 안내 문장, box는 상자(문장 수 기준도 본다). id는 위치 field `copy:<id>`가 된다 */
export interface ScreenCopy {
  id: string;
  kind: "guide" | "box";
  text: string;
}

/** 상황 카드·허브 소개·공식 자료 설명·행사·화면 안내 문구의 저장 검사 (UX-01 + UX-03 공포 표현) */
export function checkScreenCopy(items: readonly ScreenCopy[], ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  for (const item of items) {
    const unit: TextUnit = { field: `copy:${item.id}`, sentences: splitSentences(item.text) };
    out.push(...forbiddenFindings([unit], ctx), ...fearFindings([unit], ctx), ...jargonFindings([unit], ctx), ...guideLengthFindings(unit, ctx));
    if (item.kind === "box") out.push(...boxCountFinding(unit.sentences.length, { field: unit.field }, ctx));
  }
  return sortFindings(out);
}
