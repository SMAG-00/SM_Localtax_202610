import { JsonLd } from "./JsonLd";
import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, PersonHeader } from "@ltr/ui";
import type { PersonPage } from "@/lib/server/public";
import { pagerLinks } from "@/lib/site/hub-view";
import { ArticleGrid } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection } from "./SiteSection";

// 인물 (기자·필자·감수자·전문가 공용 /people/[slug] — ART-04 · NAV-03 · BR-02) — 인물 페이지 머리(이름·역할·소속·확인일·증빙 승인 약력, 평문 이메일 0)
// · 담당 분야 · 그 사람의 공개 기사·칼럼 카드(최신 순, 쪽 넘김) · 역할별 블록(people_pages 켜짐 — 필자 = 칼럼, 감수위원 = 서명이 살아 있는 감수 기사).
// 구조화 데이터 ProfilePage(Person)는 화면과 같은 값(이름·주소·약력)으로 생성기가 만든다 (OPT-02)

const BLOCK_HEAD = {
  columns: { eyebrow: "COLUMNS", title: "칼럼" },
  reviewed: { eyebrow: "REVIEWED", title: "세무 감수한 기사" },
} as const;

export function PersonView({ person }: { person: PersonPage }) {
  const { prev, next } = pagerLinks(person.href, {}, person.page, person.hasMore);
  const jsonLd = toJsonLdScriptContent(pageJsonLd({ kind: "person", person: person.view }));
  return (
    <div data-ui="person-page" data-person={person.slug}>
      <JsonLd content={jsonLd} />
      <SiteSection id="person-head" tone="ivory" first data={{ "data-person-part": "head" }}>
        <PersonHeader
          name={person.name}
          roles={person.roles}
          affiliation={person.affiliation ?? undefined}
          checkedAt={person.lastVerifiedAt}
          bio={person.bio}
        />
        {person.beat && (
          <p className="text-[15px] text-navy-700">
            담당 분야 <Chip>{person.beat}</Chip>
          </p>
        )}
      </SiteSection>
      <SiteSection
        id="person-articles"
        tone="ivory-dark"
        heading={{ eyebrow: "ARTICLES", title: person.total ? `쓴 기사 ${person.total}건` : "아직 공개된 기사가 없습니다" }}
        data={{ "data-person-part": "articles" }}
      >
        {person.articles.length > 0 && <ArticleGrid part="person-articles" items={person.articles} />}
        <Pager page={person.page} total={person.total} prev={prev} next={next} />
      </SiteSection>
      {person.blocks.map((b) => (
        <SiteSection key={b.kind} id={`person-${b.kind}`} tone="ivory" heading={BLOCK_HEAD[b.kind]} data={{ "data-person-part": b.kind }}>
          <ArticleGrid part={`person-${b.kind}`} items={b.items} />
        </SiteSection>
      ))}
    </div>
  );
}
