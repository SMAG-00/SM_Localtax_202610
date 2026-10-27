import { UiLink } from "@ltr/ui";
import type { PlannedRun, TipPiece, TipTerm } from "@/lib/site/glossary-tips";

// 본문 첫 등장 용어 풀이 (GLO-02 — docs/dev/W2-d_설계.md 8.2). 서버에서 그린다 — 저장된 본문은 그대로, 그릴 때 용어 자리만 단추로 감싼다.
//  · 용어는 단추(키보드 포커스로 열린다 — Tab), 풀이 상자는 평소 숨김. 단추의 설명(aria-describedby)이 쉬운 풀이라 화면 읽기가 포커스 때 읽는다
//  · JS가 없어도 마우스를 올리거나 포커스하면 열린다(globals.css). 보조 스크립트(GlossaryTips)가 붙으면 누르기(터치)·Esc 닫기·화면 밖으로 나가지 않게 자리 맞추기
//  · '용어사전에서 보기'는 용어사전이 열렸을 때만(기능 키 glossary) — 꺼져 있으면 풀이 글만
//  · 풀이 상자는 기사 제목·저자·날짜·대표 이미지(구조화 데이터와 대조하는 화면 값)를 건드리지 않는다

const TRIGGER =
  "inline cursor-help rounded-sm border-0 bg-transparent p-0 text-left [font:inherit] text-inherit underline decoration-navy-400 decoration-dotted decoration-2 underline-offset-[5px] transition hover:decoration-hermes-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
const BOX =
  "block w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-navy-100 bg-white p-4 text-left text-[15px] leading-relaxed font-normal whitespace-normal text-navy-800 shadow-[0_8px_30px_-12px_rgba(6,24,42,0.35)]";
const LINK =
  "mt-2 inline-flex min-h-11 items-center text-[15px] font-bold text-navy-900 underline decoration-hermes-500 decoration-2 underline-offset-4 hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 용어 하나 — 단추 + 풀이 상자 (한 기사에 용어마다 하나라 id가 겹치지 않는다) */
export function GlossaryTerm({ text, term }: { text: string; term: TipTerm }) {
  const pop = `glossary-tip-${term.id}`;
  return (
    <span data-glossary-tip="" data-term-id={term.id} className="relative">
      <button type="button" data-tip-trigger="" aria-controls={pop} aria-describedby={`${pop}-text`} className={TRIGGER}>
        {text}
      </button>
      <span id={pop} data-tip-pop="" className="absolute top-full left-0 z-30 pt-2">
        <span className={BOX}>
          <span className="block text-[13px] font-bold text-navy-600">{`${term.term} 쉬운 풀이`}</span>
          <span id={`${pop}-text`} className="mt-1 block [overflow-wrap:anywhere]">
            {term.plain}
          </span>
          {term.href && (
            <UiLink href={term.href} className={LINK}>
              용어사전에서 보기
            </UiLink>
          )}
        </span>
      </span>
    </span>
  );
}

/** 글 조각들 — 용어 자리는 GlossaryTerm, 나머지는 글 그대로 */
export function TipPieces({ pieces }: { pieces: readonly TipPiece[] }) {
  return (
    <>
      {pieces.map((p, i) => (p.kind === "term" ? <GlossaryTerm key={i} text={p.text} term={p.term} /> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** 문단의 계획한 조각 — 글은 툴팁 자리로, 링크는 본문 링크 모양 그대로 */
export function TipRuns({ runs, linkClass }: { runs: readonly PlannedRun[]; linkClass: string }) {
  return (
    <>
      {runs.map((r, i) =>
        r.kind === "text" ? (
          r.bold ? (
            <strong key={i}>
              <TipPieces pieces={r.pieces} />
            </strong>
          ) : (
            <TipPieces key={i} pieces={r.pieces} />
          )
        ) : (
          <UiLink key={i} href={r.href} className={linkClass} {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {r.bold ? <strong>{r.text}</strong> : r.text}
            {r.external && <span className="sr-only"> (새 창)</span>}
          </UiLink>
        ),
      )}
    </>
  );
}
