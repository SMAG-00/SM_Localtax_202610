// 본문 글 안의 인라인 표기 두 가지만 읽는다 (F2) — 링크 [글](주소)와 굵게 **글**. 그 밖의 HTML·마크다운은 읽지 않는다. 순수 모듈.
//  · 링크 주소 안의 괄호는 균형 잡힌 쌍(두 겹까지)만 허용한다 — 예 .../File:Government_Complex_Sejong_(N).jpg
//  · 공개 화면(article-view)·관리자 미리보기·글자 수·검색 본문이 같은 규칙을 읽는다

/** 링크 표기 한 개 — [글](주소). 주소는 공백 없이, 괄호는 균형 잡힌 쌍만 (두 겹까지) */
export const INLINE_LINK_SOURCE = String.raw`\[([^\]\n]+)\]\(((?:[^()\s]|\((?:[^()\s]|\([^()\s]*\))*\))+)\)`;

/** 굵게 표기 — **글** (안쪽은 한 줄, 별표 없이, 앞뒤가 공백이 아닌 글자) */
export const INLINE_BOLD = /\*\*([^*\s\n](?:[^*\n]*[^*\s\n])?)\*\*/g;

export type InlinePiece =
  | { kind: "text"; text: string; bold?: true }
  | { kind: "link"; text: string; href: string; external: boolean; bold?: true };

/** 글 → 조각. 링크가 될 수 없는 주소(isLinkable이 false)의 표기는 글 그대로 둔다 */
export function inlinePieces(text: string, isLinkable: (href: string) => { ok: boolean; external: boolean }): InlinePiece[] {
  const out: InlinePiece[] = [];
  const push = (p: InlinePiece) => {
    const prev = out[out.length - 1];
    if (p.kind === "text" && prev && prev.kind === "text" && prev.bold === p.bold) prev.text += p.text;
    else if (p.text !== "") out.push(p);
  };
  const pushPlain = (raw: string) => {
    let last = 0;
    for (const m of raw.matchAll(INLINE_BOLD)) {
      if (m.index! > last) push({ kind: "text", text: raw.slice(last, m.index) });
      push({ kind: "text", text: m[1]!, bold: true });
      last = m.index! + m[0].length;
    }
    if (last < raw.length) push({ kind: "text", text: raw.slice(last) });
  };
  let last = 0;
  for (const m of text.matchAll(new RegExp(INLINE_LINK_SOURCE, "g"))) {
    const [whole, label, href] = m as unknown as [string, string, string];
    const verdict = isLinkable(href);
    if (!verdict.ok) continue;
    if (m.index! > last) pushPlain(text.slice(last, m.index));
    const wrapped = /^\*\*([^*\s\n](?:[^*\n]*[^*\s\n])?)\*\*$/.exec(label);
    out.push({ kind: "link", text: wrapped ? wrapped[1]! : label, href, external: verdict.external, ...(wrapped ? { bold: true as const } : {}) });
    last = m.index! + whole.length;
  }
  if (last < text.length) pushPlain(text.slice(last));
  return out.filter((p) => p.text !== "");
}

/** 글자 수·검색·SEO 본문용 — 링크 표기는 글만, **는 걷어 낸 글자 */
export function stripInlineMarkup(text: string): string {
  return text.replace(new RegExp(INLINE_LINK_SOURCE, "g"), "$1").replace(INLINE_BOLD, "$1");
}
