import { UiLink } from "@ltr/ui";
import { paragraphSegments } from "@/lib/site/article-view";

// 본문 글의 인라인 표기 그리기 (F2) — **굵게**는 strong, [글](주소)는 링크(바깥 주소는 새 창 + rel). 그 밖의 글은 해석하지 않는 글자로만 그린다.
// 공개 기사 화면(문단·표 칸·상자)과 관리자 미리보기가 같은 조각 함수(paragraphSegments)를 읽는다.

export const INLINE_LINK_CLASS = "font-bold text-hermes-800 underline underline-offset-4 hover:text-hermes-900";

export function InlineText({ text, linkClass = INLINE_LINK_CLASS }: { text: string; linkClass?: string }) {
  return (
    <>
      {paragraphSegments(text).map((s, i) => {
        if (s.kind === "text") return s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>;
        const label = s.bold ? <strong>{s.text}</strong> : s.text;
        return (
          <UiLink key={i} href={s.href} className={linkClass} {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {label}
            {s.external && <span className="sr-only"> (새 창)</span>}
          </UiLink>
        );
      })}
    </>
  );
}
