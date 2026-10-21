import "server-only";
import type { PersonView } from "@ltr/structured-data";
import { absolute } from "../articles/mapping";
import { siteUrl } from "../env";
import { approvedBioMap, profilePageIds, reviewedArticleIds } from "./brand";
import { personStructuredView, roleBlocks, type BioLine, type RoleBlock } from "./brand-logic";
import { publicBioItems } from "./article-logic";
import type { ArticleListItem } from "./cards";
import { LIMITS, personHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { pageNumber } from "./hub-logic";
import { readArticleList, readPublicSettings } from "./reads";
import { PERSON_COLUMNS, num, type PublicPersonRow } from "./rows";

// 인물 페이지 (ART-04 · NAV-03 · BR-02 · PRD-01A 3장 '인물') — 기자·필자·감수자·전문가 공용 틀.
//  · 공개 인물(visibility=public)이고 현재 동의서 범위에 profile_page가 있을 때만 (동의 철회·만료 → 404, 기능 키와 상관없이 — BR-07)
//  · 약력은 같은 인물의 승인된 증빙을 가리키는 항목만 (public_person_bio — 렌더 줄 수 = 승인 증빙 줄 수, BR-01)
//  · 역할별 블록(칼럼 목록·감수 기사 목록)은 기능 키 people_pages가 켜졌을 때 그 역할에만 (감수 기사는 서명이 살아 있는 것만, BR-02·03)
//  · 구조화 데이터 ProfilePage(Person)는 화면과 같은 값(이름·주소·약력)으로 만든다 (OPT-02)

/** 화면 역할 칩 — 인물 페이지 머리 컴포넌트가 아는 역할만 (편집 책임자는 인물 페이지 역할 칩이 없다) */
const SHOWN_ROLES = ["reporter", "writer", "reviewer", "expert"] as const;
export type ShownRole = (typeof SHOWN_ROLES)[number];

export interface PersonPage {
  slug: string;
  href: string;
  name: string;
  roles: ShownRole[];
  affiliation: string | null;
  beat: string | null;
  bio: BioLine[];
  lastVerifiedAt: string | null;
  articles: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
  /** 역할별 블록 — 블록 이름 순서대로, 카드가 0이면 블록째 숨긴다 */
  blocks: { kind: RoleBlock; items: ArticleListItem[] }[];
  /** 구조화 데이터 (OPT-02 ProfilePage · Person) — 화면과 같은 값(이름·주소·약력)만 */
  view: PersonView;
}

export async function getPersonPage(slug: string, page = 1): Promise<PersonPage | null> {
  const db = publicDb();
  const person = (await rowsOf<PublicPersonRow>(db.from("public_people").select(PERSON_COLUMNS).eq("slug", slug).limit(1), "인물"))[0];
  if (!person) return null;
  const id = num(person.id);
  const [pages, bios, settings] = await Promise.all([profilePageIds([id]), approvedBioMap([id]), readPublicSettings()]);
  if (!pages.has(id)) return null;
  const current = pageNumber(page);
  const { items, total } = await readArticleList(db, { authorId: id, limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  const href = personHref(person.slug);
  const roles = person.roles ?? [];
  const bio = publicBioItems(bios.get(id) ?? []);
  const blocks = await Promise.all(
    roleBlocks(roles, settings.features.people_pages).map(async (kind) => {
      if (kind === "columns") return { kind, items: (await readArticleList(db, { authorId: id, contentType: "opinion", limit: LIMITS.pageSize })).items };
      const ids = await reviewedArticleIds(id, LIMITS.pageSize);
      return { kind, items: (await readArticleList(db, { ids, limit: LIMITS.pageSize })).items };
    }),
  );
  return {
    slug: person.slug,
    href,
    name: person.name,
    roles: roles.filter((r): r is ShownRole => (SHOWN_ROLES as readonly string[]).includes(r)),
    affiliation: person.affiliation,
    beat: person.beat,
    bio,
    lastVerifiedAt: person.last_verified_at,
    articles: items,
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
    blocks: blocks.filter((b) => b.items.length > 0),
    view: personStructuredView(absolute(siteUrl(), href), person.name, bio),
  };
}
