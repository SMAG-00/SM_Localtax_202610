import type { OfficialSourceCard } from "@/lib/site/source-cards";
import { UNDER_REVIEW_LABEL, UNDER_REVIEW_NOTE } from "@/lib/site/source-cards";

// 공식 자료 원문 카드 (W4 5·6·9단계 — REG1-07 · REG1-09 · REG1-13 · PR-07) — 기사 상세의 '공식 자료 원문'과 지자체 허브 ⑤ 공식 자료/해설이 같은 카드를 쓴다.
// 발표기관이 낸 원자료의 사실만(자료 종류·제목·발표기관·발표일·기준일·지역 단위·확인일 고정폭·공공누리 유형 글자·원문 새 창 링크). 기자의 해석(본문 글자)은 넣지 않는다.
// 열린 원문 검수 항목이 있으면 카드 안(원문 블록 쪽)에 '검토 중' + 한 줄 안내 (6단계 — 12장 #48). 원본 스냅샷 글자는 그리지 않는다(링크만).
// 지자체 허브 카드에는 '이 자료를 다룬 기사' 링크를 함께 둔다(해석은 기사에서 — 원문 카드 아래 다른 묶음).

/** 검토 중 표시 — 원문 카드 안. 색에 더해 글자로 뜻을 전한다 */
export function ReviewMark() {
  return (
    <p data-part="source-review-mark" className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-navy-800">
      <span className="inline-flex rounded-md border border-hermes-200 bg-hermes-50 px-2 py-0.5 text-[13px] font-bold text-hermes-900">{UNDER_REVIEW_LABEL}</span>
      <span>{UNDER_REVIEW_NOTE}</span>
    </p>
  );
}

export function OfficialSourceCardView({ card: c, as: Tag = "li", articles = [] }: { card: OfficialSourceCard; as?: "li" | "article"; articles?: readonly { id: number; title: string; href: string }[] }) {
  return (
    <Tag data-part="official-source-card" data-source-id={c.id} {...(c.typeKey ? { "data-source-type": c.typeKey } : {})} className="h-full w-full rounded-2xl border border-navy-100 bg-white p-5">
      <p data-part="official-source-type" className="text-[13px] font-bold text-hermes-800">
        {c.typeLabel}
      </p>
      {c.underReview && <ReviewMark />}
      <p className="mt-1 text-[16px] font-black text-navy-900 [overflow-wrap:anywhere]">{c.title}</p>
      <p className="mt-1 text-[14px] text-navy-700 [overflow-wrap:anywhere]">
        {c.issuer}
        {c.provider && <span className="text-navy-600">{` · 제공 ${c.provider}`}</span>}
      </p>
      <dl data-part="official-source-dates" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] tracking-wide text-navy-700">
        {c.publishedOn && (
          <div className="flex gap-1">
            <dt>발표일</dt>
            <dd>
              <time dateTime={c.publishedOn}>{c.publishedOn}</time>
            </dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>기준일</dt>
          <dd>
            <time dateTime={c.referenceDate}>{c.referenceDate}</time>
          </dd>
        </div>
        {c.regionUnit && (
          <div className="flex gap-1">
            <dt>지역 단위</dt>
            <dd>{c.regionUnit}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt>확인일</dt>
          <dd>
            <time dateTime={c.verifiedOn}>{c.verifiedOn}</time>
          </dd>
        </div>
      </dl>
      <p data-part="license-badge" className="mt-2 inline-flex rounded-md border border-navy-200 bg-navy-50 px-2.5 py-0.5 text-[13px] font-bold text-navy-800">
        {c.license}
      </p>
      <p className="mt-2">
        <a href={c.href} target="_blank" rel="noopener noreferrer" data-part="official-source-open" className="inline-flex min-h-11 items-center text-[15px] font-bold underline underline-offset-4 hover:text-hermes-900">
          원문 보기 (새 창)
        </a>
      </p>
      {articles.length > 0 && (
        <div data-part="official-source-articles" className="mt-3 border-t border-navy-100 pt-3">
          <p className="text-[13px] font-bold text-navy-600">이 자료를 다룬 기사 — 해석은 기사에서 읽습니다</p>
          <ul className="mt-1">
            {articles.map((a) => (
              <li key={a.id} data-article-link={a.id}>
                <a href={a.href} className="inline-flex min-h-11 items-center text-[15px] font-bold text-navy-900 underline underline-offset-4 hover:text-hermes-900 [overflow-wrap:anywhere]">
                  {a.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tag>
  );
}
