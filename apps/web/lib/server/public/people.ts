import "server-only";
import { publicBio } from "./article-logic";
import type { ArticleListItem } from "./cards";
import { LIMITS, personHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { readArticleList } from "./reads";
import { PERSON_COLUMNS, num, type PublicPersonRow } from "./rows";

// 인물(기자·필자) 페이지 (ART-04 · NAV-03) — 공개 인물의 공개 칸만(약력은 증빙 있는 항목만, 평문 이메일 0)과 그 사람의 공개 기사.
// 이해관계 공개(필자 — TX-15)는 칼럼 필자 체계(01B TX-14~17)에서 공개 칸을 정한다 [확인 필요]

export interface PersonPage {
  slug: string;
  href: string;
  name: string;
  roles: string[];
  affiliation: string | null;
  beat: string | null;
  bio: string[];
  lastVerifiedAt: string | null;
  articles: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
}

export async function getPersonPage(slug: string, page = 1): Promise<PersonPage | null> {
  const db = publicDb();
  const person = (await rowsOf<PublicPersonRow>(db.from("public_people").select(PERSON_COLUMNS).eq("slug", slug).limit(1), "인물"))[0];
  if (!person) return null;
  const current = Number.isInteger(page) && page >= 1 ? page : 1;
  const { items, total } = await readArticleList(db, { authorId: num(person.id), limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  return {
    slug: person.slug,
    href: personHref(person.slug),
    name: person.name,
    roles: person.roles ?? [],
    affiliation: person.affiliation,
    beat: person.beat,
    bio: publicBio(person.bio_items),
    lastVerifiedAt: person.last_verified_at,
    articles: items,
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
  };
}
