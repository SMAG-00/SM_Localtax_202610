import type { ReactNode } from "react";
import { Chip, Eyebrow, TabNav, UiLink } from "@ltr/ui";
import type { GlossaryEntry, GlossaryIndexView, GlossaryTermView, RelatedLink, TermChip } from "@/lib/server/public";
import { glossaryIndexHref } from "@/lib/server/public/constants";
import { MeasureGlossaryTerm } from "./Measure";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 용어사전 (GLO-01 — /glossary 가나다 색인 · /glossary/[번호] 용어 쪽, PRD-01A 3장 '용어사전', docs/dev/W2-d_설계.md 8.2). 서버에서 그린다 — JS 없이 동작한다:
//  · 분야 거르개는 링크 탭(?section=), 가나다 색인은 쪽 안 자리 링크(#glossary-group-n) — 용어가 없는 자음은 글자만
//  · 용어마다 쉬운 풀이 · 뜻 · 관련 용어(칩 — 공개 용어면 링크) · 출처 · 분야. 용어 자리(#term-번호)로 바로 갈 수 있다
//  · 숨긴 용어는 공개 읽기에 없어 그리지 않는다
// 부분마다 data-glossary-part — E2E가 화면 골격을 본다

const CHIP_LINK = "inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
const TITLE_LINK = "inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/**
 * 허브·상황 페이지의 용어 칩 (CAT-02 · UX-05) — 용어와 쉬운 풀이. 용어사전이 열렸으면(기능 키 glossary) 칩이 그 용어 쪽 링크, 아니면 글자만
 */
export function TermChipList({ terms, part, className }: { terms: readonly TermChip[]; part?: string; className: string }) {
  return (
    <ul {...(part ? { "data-part": part } : {})} className={className}>
      {terms.map((t) => (
        <li key={t.id} data-term-id={t.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {t.href ? (
            <UiLink href={t.href} className={CHIP_LINK}>
              <Chip className="transition hover:border-hermes-400">{t.term}</Chip>
            </UiLink>
          ) : (
            <Chip>{t.term}</Chip>
          )}
          {t.plain && <span className="text-[15px] text-navy-600">{t.plain}</span>}
        </li>
      ))}
    </ul>
  );
}

function RelatedChips({ items }: { items: readonly RelatedLink[] }) {
  return (
    <ul aria-label="관련 용어" data-part="glossary-related" className="flex flex-wrap gap-x-2">
      {items.map((r) => (
        <li key={r.label}>
          {r.href ? (
            <UiLink href={r.href} className={CHIP_LINK}>
              <Chip className="transition hover:border-hermes-400">{r.label}</Chip>
            </UiLink>
          ) : (
            <span className="inline-flex min-h-11 items-center">
              <Chip>{r.label}</Chip>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** 뜻·관련 용어·출처 (있는 것만) */
function TermFacts({ e }: { e: GlossaryEntry }) {
  const rows: { label: string; value: ReactNode; part: string }[] = [];
  if (e.definition) rows.push({ label: "뜻", part: "definition", value: <p className="whitespace-pre-line [overflow-wrap:anywhere]">{e.definition}</p> });
  if (e.related.length) rows.push({ label: "관련 용어", part: "related", value: <RelatedChips items={e.related} /> });
  if (e.source) rows.push({ label: "출처", part: "source", value: <p className="[overflow-wrap:anywhere]">{e.source}</p> });
  if (rows.length === 0) return null;
  return (
    <dl className="mt-4 space-y-3 text-[16px] leading-relaxed text-navy-800">
      {rows.map((r) => (
        <div key={r.part} data-term-part={r.part}>
          <dt className="text-[14px] font-bold text-navy-600">{r.label}</dt>
          <dd className="mt-1">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionChips({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  return (
    <p data-part="glossary-sections" className="flex flex-wrap gap-2">
      {names.map((n) => (
        <Chip key={n}>{n}</Chip>
      ))}
    </p>
  );
}

/** 색인 화면의 용어 한 칸 — 제목은 용어 쪽 링크 */
function TermCard({ e }: { e: GlossaryEntry }) {
  return (
    <li id={e.anchor} data-glossary-term={e.id} className="scroll-mt-6">
      <article aria-labelledby={`${e.anchor}-title`} className="rounded-2xl border border-navy-100 bg-white p-6">
        <SectionChips names={e.sectionNames} />
        <h3 id={`${e.anchor}-title`} className="mt-2 text-[21px] leading-snug font-black text-navy-900 [overflow-wrap:anywhere]">
          <UiLink href={e.href} className={TITLE_LINK}>
            {e.term}
          </UiLink>
          {e.reading && <span className="ml-2 text-[15px] font-semibold text-navy-600">({e.reading})</span>}
        </h3>
        {e.plain && (
          <p data-term-part="plain" className="mt-2 text-[17px] leading-relaxed text-navy-900 [overflow-wrap:anywhere]">
            <span className="mr-2 text-[14px] font-bold text-hermes-800">쉬운 풀이</span>
            {e.plain}
          </p>
        )}
        <TermFacts e={e} />
      </article>
    </li>
  );
}

function IndexHead({ children, total }: { children?: ReactNode; total: number | null }) {
  return (
    <SiteSection id="glossary-head" tone="ivory" first data={{ "data-glossary-part": "head" }}>
      <Eyebrow>GLOSSARY</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 sm:text-[36px]">용어사전</h1>
      <p className="mt-3 text-[17px] text-navy-700">
        어려운 세금 말을 쉬운 말로 풀었습니다.
        {total !== null && <span className="ml-2 font-mono text-[15px] font-semibold tracking-wide text-navy-600">{`용어 ${total}개`}</span>}
      </p>
      {children}
    </SiteSection>
  );
}

/** 공개 데이터를 읽지 못했다 — 머리와 안내 한 줄 (200, 다른 목록 화면과 같다) */
export function GlossaryUnavailable() {
  return (
    <div data-ui="glossary-page">
      <IndexHead total={null}>
        <UnavailableNotice />
      </IndexHead>
    </div>
  );
}

/** 색인 화면 (/glossary) */
export function GlossaryIndex({ data }: { data: GlossaryIndexView }) {
  const current = data.section ?? "all";
  return (
    <div data-ui="glossary-page">
      <IndexHead total={data.total}>
        {data.tabs.length > 1 && (
          <div className="mt-8">
            <TabNav label="분야" items={data.tabs.map((t) => ({ id: t.id, label: t.label, href: t.href }))} current={current} />
          </div>
        )}
        <nav aria-label="가나다 색인" data-part="glossary-index" className="mt-6">
          <ul className="flex flex-wrap gap-x-1">
            {data.nav.map((n) => (
              <li key={n.label}>
                {n.anchor ? (
                  <a href={`#${n.anchor}`} className={`${CHIP_LINK} min-w-11 justify-center`}>
                    <Chip className="transition hover:border-hermes-400">{n.label}</Chip>
                  </a>
                ) : (
                  <span data-empty="" className="inline-flex min-h-11 min-w-11 items-center justify-center text-[13px] font-bold text-navy-600">
                    {n.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </IndexHead>
      <SiteSection id="glossary-groups" tone="ivory-dark" data={{ "data-glossary-part": "groups" }}>
        {data.groups.length === 0 ? (
          <div data-part="glossary-empty" className="space-y-2">
            <p className="text-[17px] text-navy-700">{data.section ? "이 분야에는 아직 공개한 용어가 없습니다." : "아직 공개한 용어가 없습니다."}</p>
            {data.section && (
              <UiLink href={glossaryIndexHref(null)} className={TEXT_LINK}>
                모든 용어 보기
              </UiLink>
            )}
          </div>
        ) : (
          data.groups.map((g) => (
            <section key={g.initial} id={g.anchor} data-glossary-group={g.initial} aria-labelledby={`${g.anchor}-title`} className="mt-12 scroll-mt-6 first:mt-0">
              <h2 id={`${g.anchor}-title`} className="text-[24px] leading-snug font-black text-navy-900">
                {g.initial} <span className="font-mono text-[15px] font-semibold tracking-wide text-navy-600">{`${g.entries.length}개`}</span>
              </h2>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {g.entries.map((e) => (
                  <TermCard key={e.id} e={e} />
                ))}
              </ul>
            </section>
          ))
        )}
      </SiteSection>
    </div>
  );
}

/** 용어 쪽 (/glossary/[번호]) */
export function GlossaryTermPage({ t }: { t: GlossaryTermView }) {
  return (
    <div data-ui="glossary-term-page" data-term-id={t.id}>
      <MeasureGlossaryTerm termId={t.id} section={t.sections[0] ?? null} />
      <SiteSection id="glossary-term-head" tone="ivory" first data={{ "data-glossary-part": "term-head" }}>
        <Eyebrow>GLOSSARY</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[36px]">
          {t.term}
          {t.reading && <span className="ml-2 text-[19px] font-semibold text-navy-600">({t.reading})</span>}
        </h1>
        {t.plain && (
          <p data-term-part="plain" className="mt-4 max-w-3xl text-[19px] leading-relaxed text-navy-900 [overflow-wrap:anywhere]">
            {t.plain}
          </p>
        )}
      </SiteSection>
      <SiteSection id="glossary-term-body" tone="ivory-dark" data={{ "data-glossary-part": "term-body" }}>
        <div className="max-w-3xl space-y-4">
          <SectionChips names={t.sectionNames} />
          <TermFacts e={t} />
          <p className="pt-4">
            <UiLink href={t.indexHref} className={TEXT_LINK}>
              용어사전 가나다 색인으로
            </UiLink>
          </p>
        </div>
      </SiteSection>
    </div>
  );
}
