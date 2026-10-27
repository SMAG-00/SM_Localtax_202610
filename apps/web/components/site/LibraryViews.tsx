import { UiLink } from "@ltr/ui";
import { citationSegments, paragraphs } from "@/lib/server/library/logic";
import type { AuthorItem } from "@/lib/server/library/read";
import { TEXT_LINK } from "./SiteSection";

// 지식창고 공개 화면 부품 (W13-a a4·a5, LIB-01·02·04). 문구는 데이터(제목·본문·기준일)와 상태만 보여 준다 - 약관·고지·가격 문장은 이 파일에 없다.
// 본문 글자는 문단 텍스트로만 그린다(HTML로 해석하지 않는다). 조문 인용은 검색 링크로만 바꾼다.

/** 인쇄 워터마크 (LIB-05) - 화면에는 보이지 않고 인쇄할 때만 계정 표시가 깔린다. 이메일·이름은 쓰지 않는다 */
export function PrintWatermark({ label }: { label: string }) {
  return (
    <div aria-hidden="true" data-part="library-watermark" className="pointer-events-none fixed inset-0 hidden items-center justify-center text-[48px] font-black text-navy-900/10 print:flex">
      {label}
    </div>
  );
}

export function LibraryText({ text, asOf, part, watermark }: { text: string; asOf?: string | null; part: "library-body" | "library-preview"; watermark?: string | null }) {
  return (
    <div data-part={part} className="space-y-5 text-[18px] leading-relaxed text-navy-800">
      {watermark ? <PrintWatermark label={watermark} /> : null}
      {paragraphs(text).map((p, i) => (
        <p key={i}>
          {citationSegments(p, asOf).map((s, j) =>
            s.kind === "cite" ? (
              <UiLink key={j} href={s.href} className={TEXT_LINK} data-part="library-cite">
                {s.text}
              </UiLink>
            ) : (
              <span key={j}>{s.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

/** 잠금 안내 - 구독 안내 한 곳으로만 보낸다. 무상 범위 화면에서는 쓰지 않는다 */
export function LibraryGate({ reason }: { reason: "login" | "subscribe" | "sale_rights" | null }) {
  return (
    <section data-part="library-gate" data-reason={reason ?? "subscribe"} aria-label="구독 안내" className="mt-6 rounded-2xl border border-navy-100 bg-white p-6">
      <h2 className="text-[19px] font-black text-navy-900">이어지는 내용은 지식창고 구독자에게 열립니다</h2>
      <p className="mt-2 text-[16px] text-navy-800">{reason === "login" ? "로그인한 구독자에게 열립니다." : reason === "sale_rights" ? "이 자료는 아직 유료 열람이 열리지 않았습니다." : "구독 중이 아닙니다."}</p>
      {reason !== "sale_rights" ? (
        <p className="mt-4">
          <UiLink href="/store/subscription" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            구독 안내 보기
          </UiLink>
        </p>
      ) : null}
    </section>
  );
}

export function LibraryLimited() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-[24px] font-black text-navy-900">잠시 후 다시 열어 주세요</h1>
      <p data-part="library-limited" className="mt-4 text-[16px] text-navy-800">
        짧은 시간에 너무 많이 열어 일시적으로 제한되었습니다.
      </p>
    </main>
  );
}

/** 필자 페이지의 지식창고 항목 목록 (LIB-03) - 공개 조건을 통과한 제목만. 유료 항목은 목록에서 표시한다 */
export function AuthorLibrary({ items }: { items: AuthorItem[] }) {
  if (items.length === 0) return null;
  return (
    <section data-part="author-library" aria-label="지식창고 글" className="mx-auto max-w-3xl px-4 pb-16">
      <h2 className="text-[19px] font-black text-navy-900">지식창고 글</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-[16px]">
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`}>
            <a href={i.kind === "column" ? `/library/columns/${i.id}` : `/library/magazine/${i.parent_id}#a${i.id}`} className="underline underline-offset-2">
              {i.title}
            </a>
            {i.kind === "column" ? " (구독자 전용)" : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}
