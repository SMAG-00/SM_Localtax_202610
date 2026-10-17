// UX-03 압박 완화 (R9) — 공포 표현(사전) 차단, '기한'·'가산세' 블록은 '할 일을 함께 썼다' 체크, rose 상자 제목 고정
import { finding, type Finding } from "../findings";
import type { ArticleForPublish, PublishContext } from "../model";
import { articleUnits, blockSentences, findPhrases, josa, normalizeText, unitLocation, type TextUnit } from "../text";

/** 이 낱말이 든 블록은 '언제까지 무엇을 하면 되는지'를 함께 써야 한다 (PRD-00 8.8 · R9) */
export const ACTION_TRIGGER_WORDS: readonly string[] = ["기한", "가산세"];

/**
 * 낱말 찾기 — '납부기한'·'신고 기한'은 잡고, '~기하다' 동사의 활용(등기한·제기한·포기한·연기한·표기한·명기한·상기한·환기한)은 뺀다.
 * 부동산·세금 기사에 흔한 '등기한 날'이 '기한'으로 잡히지 않게 한다.
 */
const ACTION_TRIGGER_PATTERNS: readonly [string, RegExp][] = [
  ["기한", /(?<![등제포연표명상환])기한/],
  ["가산세", /가산세/],
];
/** rose(mistake) 상자의 고정 제목 */
export const ROSE_BOX_TITLE = "자주 틀리는 점";

export function fearFindings(units: readonly TextUnit[], ctx: PublishContext): Finding[] {
  return findPhrases(units, ctx.dictionaries.fearPhrases).map((hit) =>
    finding("ux03.fear-phrase", `공포 표현 ‘${hit.phrase}’ — 해야 할 일을 알려 주는 문장으로 바꿔 주세요`, unitLocation(hit.unit, hit.sentenceIndex, hit.phrase)),
  );
}

export function checkPressure(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const out = fearFindings(articleUnits(article), ctx);
  article.blocks.forEach((block, blockIndex) => {
    const text = normalizeText(blockSentences(block).join(" "));
    const trigger = ACTION_TRIGGER_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
    if (trigger !== undefined && block.checklist?.actionWritten !== true) {
      out.push(
        finding(
          "ux03.action-not-written",
          `‘${trigger}’${josa(trigger, "이", "가")} 든 블록 — 언제까지 무엇을 하면 되는지 함께 쓰고 '할 일을 함께 썼다'를 체크해 주세요`,
          { field: "blocks", blockIndex, phrase: trigger },
        ),
      );
    }
    if (block.type === "callout" && block.kind === "mistake" && block.title.trim() !== ROSE_BOX_TITLE) {
      out.push(
        finding("ux03.rose-box-title", `rose 상자의 제목은 ‘${ROSE_BOX_TITLE}’로 고정입니다`, { field: "blocks", blockIndex, phrase: block.title }),
      );
    }
  });
  return out;
}
