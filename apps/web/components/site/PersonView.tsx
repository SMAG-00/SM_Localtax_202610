import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, PersonHeader } from "@ltr/ui";
import type { PersonPage } from "@/lib/server/public";
import { pagerLinks } from "@/lib/site/hub-view";
import { ArticleGrid } from "./ArticleItem";
import { Pager } from "./Pager";
import { SiteSection } from "./SiteSection";

// 인물 (기자·필자 /people/[slug] — ART-04 · NAV-03 · PRD-01A 3장 '인물') — 인물 페이지 머리(이름·역할·소속·확인일·증빙 있는 약력, 평문 이메일 0)
// · 담당 분야 · 그 사람의 공개 기사·칼럼 카드(최신 순, 쪽 넘김). 이해관계 공개(필자 — 01B TX-15)는 W3 필자 체계와 함께.
// 구조화 데이터 ProfilePage(Person)는 화면과 같은 값(이름·주소)으로 생성기가 만든다 (OPT-02)

export function PersonView({ person }: { person: PersonPage }) {
  const { prev, next } = pagerLinks(person.href, {}, person.page, person.hasMore);
  const jsonLd = toJsonLdScriptContent(pageJsonLd({ kind: "person", person: person.view }));
  return (
    <div data-ui="person-page" data-person={person.slug}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
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
    </div>
  );
}
