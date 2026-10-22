import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveFeatures } from "@/lib/policy/feature-open";
import { mailEnv } from "../env";
import { mailConfigured } from "../mail/config";
import { toListItems, type ArticleListItem, type Lookups } from "./cards";
import type { LocalTopic } from "@ltr/ui";
import { LOCAL_TOPICS, PUBLIC_SETTING_KEYS, type SectionKey } from "./constants";
import { pageOf, publicDb, rowsOf } from "./db";
import {
  ARTICLE_LIST_COLUMNS,
  CATEGORY_COLUMNS,
  PERSON_COLUMNS,
  REGION_COLUMNS,
  num,
  type PublicArticleListRow,
  type PublicCategoryRow,
  type PublicPersonRow,
  type RegionRow,
} from "./rows";
import { parsePublicSettings, type PublicSettings } from "./settings";

// 공개 데이터 함수가 같이 쓰는 읽기 — 한 요청 안에서는 한 번만 읽는다(React cache). 모두 anon 키 — RLS가 공개 행만 준다.

type Db = SupabaseClient;

/** 게시본이 있는 정책 문서 (뷰 public_policy_versions의 published) */
export const readPublishedDocKeys = cache(async (): Promise<ReadonlySet<string>> => {
  const rows = await rowsOf<{ doc_key: string }>(publicDb().from("public_policy_versions").select("doc_key").eq("status", "published"), "정책 게시본");
  return new Set(rows.map((r) => r.doc_key));
});

/** 바닥글 회사 정보 줄의 원본 (settings.company_info — 없으면 null) */
export const readCompanyInfo = cache(async (): Promise<unknown> => {
  const rows = await rowsOf<{ key: string; value: unknown }>(publicDb().from("settings").select("key, value").eq("key", "company_info"), "회사 정보");
  return rows[0]?.value ?? null;
});

// 기능 키는 '켜짐'이 아니라 의존(게시본·메일 설정)까지 채운 '실제로 열린' 값으로 내보낸다 (W2-e 6.3) — 링크와 화면이 같은 판정을 쓴다
export const readPublicSettings = cache(async (): Promise<PublicSettings> => {
  const [rows, published] = await Promise.all([
    rowsOf<{ key: string; value: unknown }>(publicDb().from("settings").select("key, value").in("key", [...PUBLIC_SETTING_KEYS]), "공개 설정"),
    readPublishedDocKeys(),
  ]);
  const s = parsePublicSettings(rows);
  return { ...s, features: effectiveFeatures(s.features, published, mailConfigured(mailEnv())) };
});

/** 공개 분야 (RLS — visible만) */
export const readCategories = cache(async (): Promise<PublicCategoryRow[]> =>
  rowsOf<PublicCategoryRow>(publicDb().from("categories").select(CATEGORY_COLUMNS).order("section").order("sort").order("id"), "분야"),
);

/** 하위 분야별 공개 목록 기사 수 (뷰 public_category_article_counts) */
export const readCategoryCounts = cache(async (): Promise<Map<number, number>> => {
  const rows = await rowsOf<{ category_id: number; article_count: number }>(
    publicDb().from("public_category_article_counts").select("category_id, article_count"),
    "분야별 기사 수",
  );
  return new Map(rows.map((r) => [num(r.category_id), num(r.article_count)]));
});

/**
 * 지자체뉴스 편집 분야별 공개 목록 기사 수 (`/local` 허브 탭·하위 메뉴 — 기사 0건인 분야는 숨긴다, CAT-02).
 * 분야마다 수만 센다(head 요청 — 행을 받지 않는다). 목록 기사 규칙은 readArticleList와 같다(유형 있음 · digest 제외)
 */
export const readTopicCounts = cache(async (): Promise<Map<LocalTopic, number>> => {
  const db = publicDb();
  const counts = await Promise.all(
    LOCAL_TOPICS.map(async ({ topic }) => {
      const { total } = await pageOf(
        db.from("public_articles").select("id", { count: "exact", head: true }).eq("section", "local").eq("editorial_field", topic).not("content_type", "is", null).neq("content_type", "digest"),
        "지자체뉴스 분야별 기사 수",
      );
      return [topic, total] as const;
    }),
  );
  return new Map(counts);
});

export const readRegions = cache(async (): Promise<RegionRow[]> => rowsOf<RegionRow>(publicDb().from("regions").select(REGION_COLUMNS).order("code"), "행정구역"));

/** 목록 카드가 참조하는 인물·분야·지역 — 읽을 수 있는 행만. 공동 기획 배지의 제휴사 이름은 기사 행이 들고 있다(partner_badge_name — 제휴사 표를 읽지 않는다) */
export async function lookupsFor(db: Db, rows: readonly { author_id: number | null }[]): Promise<Lookups> {
  const authorIds = [...new Set(rows.flatMap((r) => (r.author_id === null ? [] : [num(r.author_id)])))];
  const [categories, regions, people, profilePages] = await Promise.all([
    readCategories(),
    readRegions(),
    authorIds.length ? rowsOf<PublicPersonRow>(db.from("public_people").select(PERSON_COLUMNS).in("id", authorIds), "기자") : Promise.resolve([]),
    authorIds.length
      ? rowsOf<{ person_id: number }>(db.from("public_profile_pages").select("person_id").in("person_id", authorIds), "인물 페이지 동의")
      : Promise.resolve([]),
  ]);
  return {
    categories: new Map(categories.map((c) => [num(c.id), c])),
    regions: new Map(regions.map((r) => [r.code, r])),
    people: new Map(people.map((p) => [num(p.id), p])),
    profilePages: new Set(profilePages.map((p) => num(p.person_id))),
  };
}

export interface ListFilter {
  section?: SectionKey;
  contentType?: string;
  /** 기사 유형 가운데 하나 (W4 9단계 — 감수 해설·지역 기사 API) */
  contentTypes?: readonly string[];
  /** 편집 분야가 있는 기사만 (W4 9단계 — 지역 기사, REG1-17) */
  hasEditorialField?: boolean;
  /** 지역 태그가 하나라도 있는 기사만 (W4 9단계 — /local 전국 공식 자료) */
  regionTagged?: boolean;
  /** 편집 승인된 보도기사만 (HOME-04 · 뉴스 전체) */
  reportedApproved?: boolean;
  categoryId?: number;
  /** 지자체뉴스 편집 분야 가운데 하나 (editorial_field) */
  editorialFields?: readonly string[];
  authorId?: number;
  amendmentId?: number;
  subtype?: string;
  /** 기사 형식 (W2-c 4단계 — 동영상·포토 목록, ART-08 · ART-09) */
  format?: string;
  /** 제휴사 (W2-c 4단계 — 제휴사 프로필의 기사 목록, ART-10) */
  partnerId?: number;
  ids?: readonly number[];
  /** 이 지역 코드 가운데 하나라도 태그된 기사 */
  regionCodes?: readonly string[];
  limit: number;
  offset?: number;
  count?: boolean;
}

/** 공개 목록 기사 (유형 있음 · digest 제외) — 최신 발행 순 */
export async function readArticleList(db: Db, f: ListFilter): Promise<{ items: ArticleListItem[]; total: number }> {
  if (f.ids && f.ids.length === 0) return { items: [], total: 0 };
  let q = db
    .from("public_articles")
    .select(ARTICLE_LIST_COLUMNS, f.count ? { count: "exact" } : undefined)
    .not("content_type", "is", null)
    .neq("content_type", "digest");
  if (f.section) q = q.eq("section", f.section);
  if (f.contentType) q = q.eq("content_type", f.contentType);
  if (f.contentTypes?.length) q = q.in("content_type", [...f.contentTypes]);
  if (f.hasEditorialField) q = q.filter("editorial_field", "not.is", null);
  if (f.regionTagged) q = q.filter("region_codes", "neq", "{}");
  if (f.reportedApproved) q = q.eq("reported_approved", true);
  if (f.categoryId !== undefined) q = q.eq("category_id", f.categoryId);
  if (f.editorialFields?.length) q = q.in("editorial_field", [...f.editorialFields]);
  if (f.authorId !== undefined) q = q.eq("author_id", f.authorId);
  if (f.amendmentId !== undefined) q = q.eq("amendment_id", f.amendmentId);
  if (f.subtype) q = q.eq("subtype", f.subtype);
  if (f.format) q = q.eq("format", f.format);
  if (f.partnerId !== undefined) q = q.eq("partner_id", f.partnerId);
  if (f.ids) q = q.in("id", [...f.ids]);
  if (f.regionCodes?.length) q = q.overlaps("region_codes", [...f.regionCodes]);
  const from = f.offset ?? 0;
  const { rows, total } = await pageOf<PublicArticleListRow>(
    q.order("first_published_at", { ascending: false }).order("id", { ascending: false }).range(from, from + f.limit - 1),
    "기사 목록",
  );
  const lk = await lookupsFor(db, rows);
  return { items: toListItems(rows, lk), total: f.count ? total : rows.length };
}
