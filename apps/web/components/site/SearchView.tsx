import type { ReactNode } from "react";
import { Chip, DarkButton, Eyebrow, PrimaryButton, SelectField, SituationCard, TabNav, TextField, UiLink, UnconfirmedChip, type ProgressStageKey } from "@ltr/ui";
import type { SearchHit, SearchOptions, SearchPageData, SearchResult } from "@/lib/server/public";
import { CONTENT_TYPE_NAMES, SECTION_INFO, SECTION_KEYS } from "@/lib/server/public/constants";
import { SEARCH_CONTENT_TYPES, SEARCH_SCREEN } from "@/lib/server/public/search-logic";
import { SEARCH_PLACEHOLDER } from "@/lib/site/home-view";
import {
  SEARCH_TAB_LABELS,
  classifiedLine,
  filterSummary,
  hasFilters,
  clearFiltersHref,
  hitGroups,
  noResultView,
  regionGroups,
  regionSuggestView,
  searchEventProps,
  searchHref,
  searchPager,
  searchTabs,
  searchTitle,
  startSuggestions,
  tabCount,
  trackerStageView,
  type ClassifiedLine,
  type NoResultView,
  type RegionGroup,
  type RegionSuggestView,
  type SuggestionLink,
} from "@/lib/site/search-view";
import { cardTypeBadge } from "./ArticleItem";
import { MeasureSearch, MeasureSearchSituationCards } from "./Measure";
import { Pager } from "./Pager";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { UnavailableNotice } from "./Unavailable";

// 통합 검색 화면 (/search — SRCH-01 · SRCH-02 · UX-05 · PRD-01A 3장, docs/dev/W2-d_설계.md 8장) — 서버에서 그린다. JS를 꺼도 동작한다:
// 탭·쪽은 링크, 검색·거르개는 GET 폼, 거르개 펼침은 details. 화면 상태는 모두 주소(쿼리)에 있다.
//  · 결과마다 유형 표시 — 기사는 기사 유형 배지(목록 카드와 같은 함수), 그 밖은 종류 글자. 전체 탭은 종류별로 묶어 기사와 다른 종류를 섞지 않는다(원칙 ⑥)
//  · 결과 주소는 열린 화면만 — 닫힌 화면(용어사전 전·꺼진 기능)은 글자만 (트래커는 현재 단계 원문 링크)
//  · 결과 없음 — 추천 검색어(설정) 3개 · 상황 카드 · [AI 도우미에게 묻기]는 도우미 공개 승인 전 0 (01C가 위젯과 함께 붙인다)
//  · 결과 목록 위·안에 AI 답변을 끼워 넣는 요소 0 (SRCH-02 — 결과를 대체하지 않는다)
//  · 지역 + 주제 분류 (W4 10단계 — REG-08 · REG1-11) — 검색 폼 아래 분류 줄('이렇게 찾았습니다 — 지역 ○○ · 주제 ○○', 동명은 후보 모두), 지역 허브는
//    검색 함수가 첫 결과로 둔다(기능 키 region_hubs가 꺼지면 글자만). 지역으로 분류됐는데 지역 밖 결과가 0이면 제안 — 상위 지역·다른 표기·상황 카드
// 부분마다 data-search-part — E2E가 화면 골격·결과를 본다

/** 검색 입력창 — 히어로 입력창과 같은 형태(흰 바탕 rounded-2xl, 높이 64px 이상)를 밝은 바탕에 */
const INPUT =
  "min-h-16 w-full min-w-0 flex-1 rounded-2xl border border-navy-200 bg-white px-5 text-[17px] text-navy-900 placeholder:text-navy-400 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500";
/** 선택 목록 — 폼 요소(@ltr/ui SelectField)와 같은 형태 (지역은 시·도 묶음이 있어 직접 그린다) */
const SELECT =
  "block min-h-12 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-[17px] text-navy-900 focus:outline-2 focus:outline-offset-2 focus:outline-hermes-500";
const TITLE_LINK = "inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";
const CHIP_LINK = "inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

/** 거르개를 지나도 남기는 칸 — 새 검색어를 넣어도 고른 거르개는 그대로 */
function FilterHiddenInputs({ o }: { o: SearchOptions }) {
  return (
    <>
      {o.section && <input type="hidden" name="section" value={o.section} />}
      {o.contentType && <input type="hidden" name="type" value={o.contentType} />}
      {o.region && <input type="hidden" name="region" value={o.region} />}
      {o.from && <input type="hidden" name="from" value={o.from} />}
      {o.to && <input type="hidden" name="to" value={o.to} />}
    </>
  );
}

/** 검색 폼 — GET /search?q= (빈 검색어는 서버가 안내한다 — JS가 없어도 같다) */
function SearchForm({ o, blankSubmitted }: { o: SearchOptions; blankSubmitted: boolean }) {
  return (
    <form role="search" action="/search" method="get" data-part="search-form" className="mt-8 w-full max-w-3xl">
      <label htmlFor="search-q" className="block text-[15px] font-bold text-navy-900">
        검색어
      </label>
      <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-stretch">
        <input
          id="search-q"
          name="q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          maxLength={100}
          defaultValue={o.q}
          placeholder={SEARCH_PLACEHOLDER}
          aria-invalid={blankSubmitted ? true : undefined}
          aria-describedby={blankSubmitted ? "search-q-error" : undefined}
          className={INPUT}
        />
        <FilterHiddenInputs o={o} />
        <PrimaryButton type="submit">검색하기</PrimaryButton>
      </div>
      {blankSubmitted && (
        <p id="search-q-error" role="alert" className="mt-3 text-[14px] font-semibold text-rose-700">
          검색어를 입력해 주세요.
        </p>
      )}
    </form>
  );
}

/** 거르개 — 분야·기사 유형·지역·기간 (SRCH-02). GET 폼, 펼침은 details (JS 없이) */
function SearchFilters({ o, regions, active }: { o: SearchOptions; regions: RegionGroup[]; active: string[] }) {
  return (
    <details data-part="search-filters" open={active.length > 0} className="mt-6 rounded-2xl border border-navy-100 bg-white">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-5 py-3 text-[15px] font-bold text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
        거르개
        <span className="font-semibold text-navy-600">{active.length ? active.join(" · ") : "분야·기간·지역·기사 유형"}</span>
      </summary>
      <form action="/search" method="get" data-part="filter-form" aria-label="검색 거르개" className="space-y-4 border-t border-navy-100 p-6">
        <input type="hidden" name="q" value={o.q} />
        {o.tab !== "all" && <input type="hidden" name="tab" value={o.tab} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="search-section"
            name="section"
            label="분야"
            hint="고르면 그 분야 결과만 보입니다"
            placeholder="전체"
            options={SECTION_KEYS.map((s) => ({ value: s, label: SECTION_INFO[s].name }))}
            defaultValue={o.section ?? ""}
          />
          <SelectField
            id="search-type"
            name="type"
            label="기사 유형"
            hint="고르면 기사만 보입니다"
            placeholder="전체"
            options={SEARCH_CONTENT_TYPES.map((t) => ({ value: t, label: CONTENT_TYPE_NAMES[t] ?? t }))}
            defaultValue={o.contentType ?? ""}
          />
          <div data-ui="form-field" data-field="select" className="space-y-1.5">
            <label htmlFor="search-region" className="block text-[15px] font-bold text-navy-900">
              지역
            </label>
            <p id="search-region-hint" className="text-[14px] text-navy-600">
              고르면 그 지역 기사와 지역만 보입니다
            </p>
            <select id="search-region" name="region" defaultValue={o.region ?? ""} aria-describedby="search-region-hint" className={SELECT}>
              <option value="">전체</option>
              {regions.map((g) => (
                <optgroup key={g.code} label={g.name}>
                  <option value={g.code}>{`${g.name} 전체`}</option>
                  {g.children.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField id="search-from" name="from" type="date" label="시작일" defaultValue={o.from ?? ""} />
            <TextField id="search-to" name="to" type="date" label="끝일" defaultValue={o.to ?? ""} />
          </div>
        </div>
        <p className="text-[14px] text-navy-600">기간을 고르면 날짜가 있는 기사·트래커만 보입니다.</p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <DarkButton type="submit">적용하기</DarkButton>
          {active.length > 0 && (
            <UiLink href={clearFiltersHref(o)} className={TEXT_LINK}>
              거르개 지우기
            </UiLink>
          )}
        </div>
      </form>
    </details>
  );
}

/** 결과 하나의 유형 표시 (SRCH-01) — 기사는 기사 유형 배지(광고 '광고', 공동 기획 '공동 기획 ○○', 유형 없는 이관 기사 '기사'), 그 밖은 종류 글자 */
function TypeMark({ hit }: { hit: SearchHit }) {
  if (hit.kind === "article") {
    const badge = cardTypeBadge({ contentType: hit.contentType, sponsor: hit.sponsor });
    if (badge) return <>{badge}</>;
  }
  return (
    <span data-part="type-label">
      <Chip>{hit.typeLabel}</Chip>
    </span>
  );
}

function HitTitle({ hit }: { hit: SearchHit }) {
  return (
    <h3 className="mt-3 text-[19px] leading-snug font-black text-navy-900 [overflow-wrap:anywhere]">
      {hit.href ? (
        <UiLink href={hit.href} className={TITLE_LINK}>
          {hit.title}
        </UiLink>
      ) : (
        <span data-part="hit-title">{hit.title}</span>
      )}
      {hit.kind === "glossary" && hit.reading && <span className="ml-2 text-[15px] font-semibold text-navy-600">({hit.reading})</span>}
    </h3>
  );
}

/** 결과 한 칸 — 유형 표시 · 분야 · 날짜 → 제목(열린 화면이면 링크) → 한 줄 (카드 안쪽 24px — R7) */
function HitItem({ hit, confirmStage }: { hit: SearchHit; confirmStage: ProgressStageKey }) {
  const section = "sectionName" in hit ? hit.sectionName : null;
  const date = hit.kind === "article" ? hit.publishedOn : hit.kind === "tracker" || hit.kind === "project" ? hit.stageOn : hit.kind === "interpretation" ? hit.decidedOn : null;
  const stage = hit.kind === "tracker" ? trackerStageView(hit, confirmStage) : null;
  return (
    <li data-search-hit="" data-kind={hit.kind} data-ref={hit.ref} {...(hit.kind === "article" ? { "data-content-type": hit.contentType ?? "none" } : {})} className="flex">
      <article className="w-full rounded-2xl border border-navy-100 bg-white p-6">
        <p className="flex flex-wrap items-center gap-2 text-[14px] text-navy-600">
          <TypeMark hit={hit} />
          {section && <span>{section}</span>}
          {hit.kind === "interpretation" && <Chip>{hit.docTypeLabel}</Chip>}
          {/* 프로젝트 (W4 15단계) — 사업 유형·현재 단계 글자 칩 (가격 0 — PR-05) */}
          {hit.kind === "project" && hit.projectTypeLabel && <Chip>{hit.projectTypeLabel}</Chip>}
          {hit.kind === "project" && hit.stageLabel && <Chip>{hit.stageLabel}</Chip>}
          {stage?.label && <Chip>{stage.label}</Chip>}
          {stage?.unconfirmed && <UnconfirmedChip />}
          {date && (
            <time dateTime={date} className="font-mono text-[13px] tracking-wide">
              {date}
            </time>
          )}
        </p>
        <HitTitle hit={hit} />
        {hit.snippet && <p className="mt-2 line-clamp-2 text-[15px] leading-relaxed text-navy-600 [overflow-wrap:anywhere]">{hit.snippet}</p>}
        {hit.kind === "tracker" && !hit.href && hit.sourceUrl && (
          <p className="mt-2">
            <a href={hit.sourceUrl} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              현재 단계 원문 보기<span className="sr-only"> (새 창)</span>
            </a>
          </p>
        )}
        {hit.kind === "interpretation" && !hit.href && hit.sourceUrl && (
          <p className="mt-2">
            <a href={hit.sourceUrl} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
              원문 보기<span className="sr-only"> (새 창)</span>
            </a>
          </p>
        )}
      </article>
    </li>
  );
}

function HitList({ hits, confirmStage }: { hits: readonly SearchHit[]; confirmStage: ProgressStageKey }) {
  return (
    <ul data-part="hits" className="mt-4 grid gap-4 sm:grid-cols-2">
      {hits.map((h) => (
        <HitItem key={`${h.kind}:${h.ref}`} hit={h} confirmStage={confirmStage} />
      ))}
    </ul>
  );
}

function SuggestionChips({ items, part, label = "추천 검색어" }: { items: readonly SuggestionLink[]; part: string; label?: string }) {
  return (
    <ul aria-label={label} data-part={part} className="mt-4 flex flex-wrap gap-x-2">
      {items.map((s) => (
        <li key={s.label}>
          <UiLink href={s.href} className={CHIP_LINK}>
            <Chip className="transition hover:border-hermes-400">{s.label}</Chip>
          </UiLink>
        </li>
      ))}
    </ul>
  );
}

/** 전체 탭 — 종류별 묶음 (종류 차례). 탭이 있는 종류는 '모두 보기', 탭이 없는 종류는 앞 몇 개만이라는 안내 */
function AllTab({ result, o, confirmStage }: { result: SearchResult; o: SearchOptions; confirmStage: ProgressStageKey }) {
  return (
    <>
      {hitGroups(result, o).map((g) => (
        <section key={g.kind} data-part="hit-group" data-kind={g.kind} aria-labelledby={`hits-${g.kind}`} className="mt-12 first:mt-0">
          <h2 id={`hits-${g.kind}`} className="text-[22px] leading-snug font-black text-navy-900">
            {g.label} <span className="font-mono text-[15px] font-semibold tracking-wide text-navy-600">{`${g.count}건`}</span>
          </h2>
          <HitList hits={g.items} confirmStage={confirmStage} />
          {g.more && (
            <p className="mt-4">
              <UiLink href={g.more.href} className={TEXT_LINK}>
                {g.more.label}
              </UiLink>
            </p>
          )}
          {g.truncated && <p className="mt-4 text-[15px] text-navy-600">{`앞 ${SEARCH_SCREEN.allPerKind}개만 보입니다. 검색어를 더 자세히 적어 보세요.`}</p>}
        </section>
      ))}
    </>
  );
}

/** 종류 탭 — 한 쪽 결과와 쪽 넘김. 이 탭에 결과가 없으면(다른 탭에는 있다) 한 줄 안내 */
function KindTab({ result, o, confirmStage }: { result: SearchResult; o: SearchOptions; confirmStage: ProgressStageKey }) {
  const total = tabCount(result.counts, o.tab);
  const pager = searchPager(result, o);
  return (
    <section data-part="hit-group" data-kind-tab={o.tab} aria-labelledby="hits-tab">
      <h2 id="hits-tab" className="text-[22px] leading-snug font-black text-navy-900">
        {SEARCH_TAB_LABELS[o.tab]} <span className="font-mono text-[15px] font-semibold tracking-wide text-navy-600">{`${total}건`}</span>
      </h2>
      {result.items.length > 0 ? (
        <HitList hits={result.items} confirmStage={confirmStage} />
      ) : (
        <div data-part="tab-empty" className="mt-4 space-y-2">
          <p className="text-[17px] text-navy-700">{total > 0 ? "이 쪽에는 결과가 더 없습니다." : "이 탭에는 결과가 없습니다."}</p>
          <UiLink href={total > 0 ? searchHref(o, { page: 1 }) : searchHref(o, { tab: "all", page: 1 })} className={TEXT_LINK}>
            {total > 0 ? "첫 쪽으로" : "전체 결과 보기"}
          </UiLink>
        </div>
      )}
      <Pager page={result.page} total={total} prev={pager.prev} next={pager.next} />
    </section>
  );
}

/** 결과 없음 (SRCH-02 · UX-05) — 추천 검색어 3개 · 상황 카드. 도우미 링크는 view.assistant가 참일 때 01C가 붙인다(지금 0) */
function NoResult({ q, view }: { q: string; view: NoResultView }) {
  return (
    <SiteSection id="search-empty" tone="ivory-dark" data={{ "data-search-part": "empty" }}>
      <h2 className="text-[28px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[32px]">{`‘${q}’ 결과가 없습니다`}</h2>
      <p className="mt-3 text-[17px] text-navy-700">낱말을 줄이거나 다른 말로 찾아보세요.</p>
      {view.clearFilters && (
        <p className="mt-2">
          <UiLink href={view.clearFilters} className={TEXT_LINK}>
            거르개를 지우고 다시 찾기
          </UiLink>
        </p>
      )}
      {view.suggestions.length > 0 && (
        <>
          <h3 className="mt-10 text-[19px] font-black text-navy-900">이렇게 찾아보세요</h3>
          <SuggestionChips items={view.suggestions} part="search-suggestions" />
        </>
      )}
      {view.situations.length > 0 && (
        <>
          <h3 className="mt-10 text-[19px] font-black text-navy-900">상황으로 찾기</h3>
          <ul data-part="search-situations" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.situations.map((s) => (
              <li key={s.slug} data-situation-slug={s.slug} data-situation-section={s.section}>
                <SituationCard href={s.href} pictogram={s.pictogram} title={s.title} description={s.subtitle} />
              </li>
            ))}
          </ul>
          {/* 측정 — 카드를 누르면 situation_card_clicked(위치 search_empty). 그리는 것 0 */}
          <MeasureSearchSituationCards />
        </>
      )}
    </SiteSection>
  );
}

/** 분류 줄 (W4 10단계) — 검색어를 지역·주제로 어떻게 읽었는지. 후보가 둘 이상이면 하나로 정하지 않았다고 쓴다 */
function ClassifiedNote({ line }: { line: ClassifiedLine }) {
  return (
    <p data-search-part="classified" className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-navy-700 [overflow-wrap:anywhere]">
      <span className="font-bold text-navy-900">이렇게 찾았습니다</span>
      {line.regions.length > 0 && (
        <span data-classified="regions">
          {line.ambiguous ? `지역 후보 ${line.regions.length}곳 — ${line.regions.join(" · ")} (하나로 정하지 않고 모두 보입니다)` : `지역 ${line.regions[0]}`}
        </span>
      )}
      {line.topics.length > 0 && <span data-classified="topics">{`주제 ${line.topics.join(" · ")}`}</span>}
    </p>
  );
}

/** 결과 0건 제안 (W4 10단계 — REG1-11 상위 지역·다른 표기·상황 카드). 셋 다 비면 그리지 않는다 */
function RegionSuggest({ view }: { view: RegionSuggestView }) {
  if (view.upper.length === 0 && view.spellings.length === 0 && view.situations.length === 0) return null;
  return (
    <SiteSection id="search-region-suggest" tone="ivory" data={{ "data-search-part": "region-suggest" }}>
      <h2 className="text-[22px] leading-snug font-black text-navy-900">이 지역에서 찾은 기사가 없습니다</h2>
      <p className="mt-3 text-[17px] text-navy-700">상위 지역이나 다른 표기로 찾거나, 상황으로 찾아보세요.</p>
      {view.upper.length > 0 && (
        <>
          <h3 className="mt-8 text-[19px] font-black text-navy-900">상위 지역으로 찾기</h3>
          <SuggestionChips items={view.upper} part="suggest-upper" label="상위 지역 검색어" />
        </>
      )}
      {view.spellings.length > 0 && (
        <>
          <h3 className="mt-8 text-[19px] font-black text-navy-900">다른 표기로 찾기</h3>
          <SuggestionChips items={view.spellings} part="suggest-spellings" label="다른 표기 검색어" />
        </>
      )}
      {view.situations.length > 0 && (
        <>
          <h3 className="mt-8 text-[19px] font-black text-navy-900">상황으로 찾기</h3>
          <ul data-part="search-situations" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.situations.map((s) => (
              <li key={s.slug} data-situation-slug={s.slug} data-situation-section={s.section}>
                <SituationCard href={s.href} pictogram={s.pictogram} title={s.title} description={s.subtitle} />
              </li>
            ))}
          </ul>
          <MeasureSearchSituationCards />
        </>
      )}
    </SiteSection>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <SiteSection id="search-head" tone="ivory" first data={{ "data-search-part": "head" }}>
      <Eyebrow>SEARCH</Eyebrow>
      <h1 className="mt-3 text-[28px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[36px]">{title}</h1>
      {children}
    </SiteSection>
  );
}

/** 공개 데이터를 읽지 못했다 — 머리와 안내 한 줄 (검색 폼은 기능 공개 여부를 모르므로 그리지 않는다) */
export function SearchUnavailable() {
  return (
    <div data-ui="search-page">
      <Head title="검색">
        <UnavailableNotice />
      </Head>
    </div>
  );
}

export function SearchView({ data, blankSubmitted }: { data: SearchPageData; blankSubmitted: boolean }) {
  const { options: o, result, confirmStage } = data;
  const regions = regionGroups(data.regions, data.today);
  const regionName = (code: string) => regions.flatMap((g) => [g, ...g.children]).find((r) => r.code === code)?.name ?? null;
  const active = filterSummary(o, regionName);
  const empty = result !== null && tabCount(result.counts, "all") === 0;
  const event = result ? searchEventProps(result, o.q) : null;
  // 도우미 위젯·공개 승인(01C CHAT-01·CHAT-14) 전 — [AI 도우미에게 묻기] 0
  const noResult = empty ? noResultView({ options: o, chips: data.chips, situations: data.situations, assistantOpen: false }) : null;
  const line = result ? classifiedLine(result.classification) : null;
  // 결과 없음 화면이 상황 카드를 이미 보이므로, 그때는 제안 묶음에서 상황 카드를 뺀다
  const suggest = regionSuggestView(result, empty ? [] : data.situations);

  return (
    <div data-ui="search-page">
      {event && <MeasureSearch section={o.section} props={event} />}
      <Head title={searchTitle(o.q)}>
        <SearchForm o={o} blankSubmitted={blankSubmitted} />
        {line && <ClassifiedNote line={line} />}
        {result && !empty && (
          <div className="mt-8">
            <TabNav label="결과 종류" items={searchTabs(result, o).map((t) => ({ id: t.id, label: `${t.label} ${t.count}`, href: t.href }))} current={o.tab} />
          </div>
        )}
        {result && <SearchFilters o={o} regions={regions} active={hasFilters(o) ? active : []} />}
      </Head>
      {result === null && data.chips.length > 0 && (
        <SiteSection id="search-start" tone="ivory-dark" data={{ "data-search-part": "start" }}>
          <h2 className="text-[22px] leading-snug font-black text-navy-900">이렇게 찾아보세요</h2>
          <SuggestionChips items={startSuggestions(data.chips)} part="start-suggestions" />
        </SiteSection>
      )}
      {noResult && <NoResult q={o.q} view={noResult} />}
      {result && !empty && (
        <SiteSection id="search-results" tone="ivory-dark" data={{ "data-search-part": "results" }}>
          {o.tab === "all" ? <AllTab result={result} o={o} confirmStage={confirmStage} /> : <KindTab result={result} o={o} confirmStage={confirmStage} />}
        </SiteSection>
      )}
      {suggest && <RegionSuggest view={suggest} />}
    </div>
  );
}
