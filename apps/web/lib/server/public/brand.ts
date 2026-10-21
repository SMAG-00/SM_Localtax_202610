import "server-only";
import type { ConsentScope } from "./constants";
import { personHref } from "./constants";
import { publicDb, rowsOf } from "./db";
import { num } from "./rows";

// 브랜드 공개 판정 (W3 7단계 — BR-01·02·03·07) — 공개 뷰만 읽는다(anon). 증빙·동의서 문서 위치·확인자는 뷰에 없다.
//  · public_person_bio: 같은 인물의 승인된 증빙을 가리키는 약력 항목만
//  · public_name_consents: 현재 동의서 버전이 활성인 사람의 범위 / public_profile_pages: 인물 페이지를 낼 수 있는 사람(사이트맵 원본)
//  · article_review_marks: 세무 감수 서명 기록으로만 계산한 감수 표시 (손입력 칸 없음)
// 기능 키와 상관없이 항상 이 판정을 쓴다 — 키(people_pages)는 역할별 블록만 연다.

/** 인물 페이지를 낼 수 있는 사람 — 공개 인물 + 현재 동의서 범위에 profile_page (철회·만료 → 빠짐) */
export async function profilePageIds(personIds: readonly number[]): Promise<Set<number>> {
  if (personIds.length === 0) return new Set();
  const rows = await rowsOf<{ person_id: number }>(publicDb().from("public_profile_pages").select("person_id").in("person_id", [...personIds]), "인물 페이지 동의");
  return new Set(rows.map((r) => num(r.person_id)));
}

/** 증빙 승인 약력 — 인물 번호 → 약력 항목(그대로 publicBioItems에 넘긴다) */
export async function approvedBioMap(personIds: readonly number[]): Promise<Map<number, unknown>> {
  if (personIds.length === 0) return new Map();
  const rows = await rowsOf<{ person_id: number; bio_items: unknown }>(
    publicDb().from("public_person_bio").select("person_id, bio_items").in("person_id", [...personIds]),
    "승인 약력",
  );
  return new Map(rows.map((r) => [num(r.person_id), r.bio_items]));
}

/** 현재 동의서 범위 — 없거나 철회·만료면 빈 목록 */
export async function consentScopes(personIds: readonly number[]): Promise<Map<number, ConsentScope[]>> {
  if (personIds.length === 0) return new Map();
  const rows = await rowsOf<{ person_id: number; scope: ConsentScope[] }>(
    publicDb().from("public_name_consents").select("person_id, scope").in("person_id", [...personIds]),
    "이름 동의서",
  );
  return new Map(rows.map((r) => [num(r.person_id), r.scope]));
}

export interface ReviewMark {
  reviewerName: string;
  /** 서명자 인물 페이지 — 인물 페이지를 낼 수 있을 때만 */
  reviewerHref: string | null;
  reviewedAt: string;
}

/**
 * 기사 감수 표시 (BR-03) — 최근 세무 감수 기록이 승인이고 그 뒤 실질 수정이 없을 때(state=shown)만.
 * 서명자 이름은 공개 인물의 이름이고, 현재 동의서 버전이 활성일 때만 낸다(12장 #22 — 범위 항목은 따로 두지 않음). 아니면 null
 */
export async function getArticleReviewMark(articleId: number): Promise<ReviewMark | null> {
  const db = publicDb();
  const marks = await rowsOf<{ reviewer_person_id: number | null; reviewed_at: string | null; state: string }>(
    db.from("article_review_marks").select("reviewer_person_id, reviewed_at, state").eq("article_id", articleId).limit(1),
    "감수 표시",
  );
  const m = marks[0];
  if (!m || m.state !== "shown" || m.reviewer_person_id === null || !m.reviewed_at) return null;
  const reviewer = num(m.reviewer_person_id);
  const [people, scopes, pages] = await Promise.all([
    rowsOf<{ name: string; slug: string }>(db.from("public_people").select("name, slug").eq("id", reviewer).limit(1), "감수자"),
    consentScopes([reviewer]),
    profilePageIds([reviewer]),
  ]);
  const name = people[0]?.name?.trim();
  if (!name || !scopes.has(reviewer)) return null;
  return { reviewerName: name, reviewerHref: pages.has(reviewer) ? personHref(people[0]!.slug) : null, reviewedAt: m.reviewed_at };
}

/** 감수위원이 서명한(표시가 살아 있는) 공개 기사 번호 — 인물 페이지 감수 기사 목록 */
export async function reviewedArticleIds(reviewerId: number, limit: number): Promise<number[]> {
  const rows = await rowsOf<{ article_id: number }>(
    publicDb().from("article_review_marks").select("article_id").eq("reviewer_person_id", reviewerId).eq("state", "shown").order("reviewed_at", { ascending: false }).limit(limit),
    "감수 기사",
  );
  return rows.map((r) => num(r.article_id));
}
