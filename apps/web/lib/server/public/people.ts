import "server-only";
import type { PersonView } from "@ltr/structured-data";
import { absolute } from "../articles/mapping";
import { siteUrl } from "../env";
import { publicBioItems } from "./article-logic";
import type { ArticleListItem } from "./cards";
import { LIMITS, personHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { pageNumber } from "./hub-logic";
import { readArticleList } from "./reads";
import { PERSON_COLUMNS, num, type PublicPersonRow } from "./rows";

// 인물(기자·필자) 페이지 (ART-04 · NAV-03 · PRD-01A 3장 '인물') — 공개 인물(visibility=public)의 공개 칸만
// (약력은 증빙 있는 항목만 — DB 계산 칸, 평문 이메일 0)과 그 사람의 공개 기사·칼럼. 비공개 인물은 0행 → 404.
// 이해관계 공개(필자 — 01B TX-15)는 칼럼 필자 체계(01B W3)에서 공개 칸을 정한다 [확인 필요]

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
  bio: { id: string; text: string; evidenceId: string }[];
  lastVerifiedAt: string | null;
  articles: ArticleListItem[];
  page: number;
  total: number;
  hasMore: boolean;
  /** 구조화 데이터 (OPT-02 ProfilePage · Person) — 화면과 같은 값(이름·주소)만 */
  view: PersonView;
}

export async function getPersonPage(slug: string, page = 1): Promise<PersonPage | null> {
  const db = publicDb();
  const person = (await rowsOf<PublicPersonRow>(db.from("public_people").select(PERSON_COLUMNS).eq("slug", slug).limit(1), "인물"))[0];
  if (!person) return null;
  const current = pageNumber(page);
  const { items, total } = await readArticleList(db, { authorId: num(person.id), limit: LIMITS.pageSize, offset: (current - 1) * LIMITS.pageSize, count: true });
  const href = personHref(person.slug);
  return {
    slug: person.slug,
    href,
    name: person.name,
    roles: (person.roles ?? []).filter((r): r is ShownRole => (SHOWN_ROLES as readonly string[]).includes(r)),
    affiliation: person.affiliation,
    beat: person.beat,
    bio: publicBioItems(person.bio_items),
    lastVerifiedAt: person.last_verified_at,
    articles: items,
    page: current,
    total,
    hasMore: current * LIMITS.pageSize < total,
    view: { url: absolute(siteUrl(), href), name: person.name },
  };
}
