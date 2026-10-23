import "server-only";
import type { BreadcrumbView } from "@ltr/structured-data";
import type { DevMethodEntry, DevMethodId } from "@ltr/ui";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { siteUrl } from "../env";
import type { ArticleListItem } from "./cards";
import {
  DEV_METHOD_PUBLIC_LIMITS,
  PUBLIC_COMPARE_COLUMNS,
  PUBLIC_FACT_COLUMNS,
  PUBLIC_METHOD_COLUMNS,
  comparisonMethods,
  specialLawView,
  type SpecialLawView,
  devMethodBreadcrumb,
  devMethodCrumbs,
  methodLens,
  projectTypeKeys,
  publicMethods,
  reviewLine,
  type DevMethodCrumb,
  type PublicCompareRow,
  type PublicFactRow,
  type PublicMethod,
  type PublicMethodRow,
} from "./dev-methods-logic";
import { publicDb, rowsOf } from "./db";
import { PROJECT_PUBLIC_LIMITS, PUBLIC_PROJECT_COLUMNS, projectCard, projectRegion, relatedArticleIds, sortProjects, type ProjectCard, type ProjectLinkRow, type PublicProjectRow, type StageLensView } from "./project-logic";
import { readArticleList, readPublicSettings, readRegions } from "./reads";
import type { PublicLinkRow } from "./regional-links-logic";

// 개발방법 비교 공개 화면 데이터 (W4 19단계 — 규칙은 dev-methods-logic.ts). 공개 뷰 public_dev_methods · public_dev_method_compare · public_dev_method_facts(…52)만 anon 키로 읽는다.
// 기능 키 dev_methods가 꺼져 있으면 null → 목록 /realestate/development-methods는 하위 분야 목록(W3 12장 #20과 같은 방식), 방법 상세는 404.
// 관련 프로젝트·기사는 화면의 덧붙임이라 읽지 못하면 0으로 그리고 서버 기록에만 남긴다(방법 화면은 그대로 — 15·16단계와 같은 방식).

export type { SpecialLawView };

export interface DevMethodsListView {
  specialLaw: SpecialLawView | null;
  methods: PublicMethod[];
  comparison: Partial<Record<DevMethodId, DevMethodEntry>>;
  review: { reviewers: string[]; reviewedOn: string } | null;
  crumbs: DevMethodCrumb[];
  breadcrumb: BreadcrumbView | null;
}

export interface DevMethodDetailView {
  specialLaw: SpecialLawView | null;
  method: PublicMethod;
  lens: StageLensView | null;
  /** 다른 방법 — 고정 편집 순서 */
  others: { slug: string; name: string; href: string }[];
  projects: ProjectCard[];
  articles: ArticleListItem[];
  crumbs: DevMethodCrumb[];
  breadcrumb: BreadcrumbView | null;
}

async function readAll(): Promise<{ methods: PublicMethod[]; compare: PublicCompareRow[]; facts: PublicFactRow[]; law: { promulgation_url: string | null; promulgated_on: string | null }[]; features: Awaited<ReturnType<typeof readPublicSettings>>["features"] } | null> {
  const settings = await readPublicSettings();
  if (!settings.features.dev_methods) return null;
  const db = publicDb();
  const [m, c, f, law] = await Promise.all([
    rowsOf<PublicMethodRow>(db.from("public_dev_methods").select(PUBLIC_METHOD_COLUMNS).order("sort"), "공개 개발방법"),
    rowsOf<PublicCompareRow>(db.from("public_dev_method_compare").select(PUBLIC_COMPARE_COLUMNS).order("sort").order("item_position"), "공개 개발방법 비교 항목"),
    rowsOf<PublicFactRow>(db.from("public_dev_method_facts").select(PUBLIC_FACT_COLUMNS).order("sort").order("fact_key"), "공개 개발방법 숫자 요건"),
    rowsOf<{ promulgation_url: string | null; promulgated_on: string | null }>(db.from("public_special_law").select("promulgation_url, promulgated_on").limit(1), "공개 특례법 공포 확인"),
  ]);
  const methods = publicMethods(m, c, f);
  return methods.length === 0 ? null : { methods, compare: c, facts: f, law, features: settings.features };
}

export async function getDevMethodsList(): Promise<DevMethodsListView | null> {
  const all = await readAll();
  if (!all) return null;
  const crumbs = devMethodCrumbs();
  return { specialLaw: specialLawView(all.law, all.methods, all.compare, all.facts), methods: all.methods, comparison: comparisonMethods(all.methods), review: reviewLine(all.methods), crumbs, breadcrumb: devMethodBreadcrumb(crumbs, siteUrl()) };
}

export async function getDevMethod(slug: string): Promise<DevMethodDetailView | null> {
  const all = await readAll();
  const method = all?.methods.find((m) => m.slug === slug);
  if (!all || !method) return null;
  const { projects, articles } = await relatedOf(method);
  const crumbs = devMethodCrumbs({ name: method.name, href: method.href });
  return {
    specialLaw: specialLawView(all.law, all.methods, all.compare, all.facts, slug),
    method,
    lens: methodLens(method, all.features),
    others: all.methods.filter((m) => m.slug !== slug).map((m) => ({ slug: m.slug, name: m.name, href: m.href })),
    projects,
    articles,
    crumbs,
    breadcrumb: devMethodBreadcrumb(crumbs, siteUrl()),
  };
}

/** 관련 프로젝트(그 방법의 사업 유형 키를 쓰는 공개 프로젝트)와 그 프로젝트에 확인된 연결로 이은 기사. 읽지 못하면 0 */
async function relatedOf(method: PublicMethod): Promise<{ projects: ProjectCard[]; articles: ArticleListItem[] }> {
  const keys = projectTypeKeys(method);
  if (keys.length === 0) return { projects: [], articles: [] };
  try {
    const settings = await readPublicSettings();
    if (!settings.features.realestate_projects) return { projects: [], articles: [] };
    const db = publicDb();
    const today = isoToKstDate(new Date().toISOString());
    const [rows, regions] = await Promise.all([
      rowsOf<PublicProjectRow>(db.from("public_projects").select(PUBLIC_PROJECT_COLUMNS).in("project_type", keys).order("id", { ascending: false }).limit(PROJECT_PUBLIC_LIMITS.list), "개발방법 관련 프로젝트"),
      readRegions(),
    ]);
    const projects = sortProjects(rows.flatMap((r) => projectCard(r, projectRegion(r.region_code, regions, today, settings.features.region_hubs)) ?? [])).slice(0, DEV_METHOD_PUBLIC_LIMITS.projects);
    if (projects.length === 0) return { projects: [], articles: [] };
    const ids = projects.map((p) => String(p.id));
    const [fromRows, toRows] = await Promise.all([
      rowsOf<PublicLinkRow>(
        db.from("public_regional_links").select("id, from_type, from_id, to_type, to_id, relation, confirmed_at").eq("from_type", "project").eq("to_type", "article").in("from_id", ids).limit(100),
        "개발방법 관련 프로젝트 → 기사 연결",
      ),
      rowsOf<PublicLinkRow>(
        db.from("public_regional_links").select("id, from_type, from_id, to_type, to_id, relation, confirmed_at").eq("from_type", "article").eq("to_type", "project").in("to_id", ids).limit(100),
        "개발방법 관련 기사 → 프로젝트 연결",
      ),
    ]);
    const links = [...fromRows, ...toRows] as ProjectLinkRow[];
    const articleIds = [...new Set(projects.flatMap((p) => relatedArticleIds(links, p.id)))].slice(0, DEV_METHOD_PUBLIC_LIMITS.articles);
    const list = await readArticleList(db, { ids: articleIds, limit: DEV_METHOD_PUBLIC_LIMITS.articles });
    const order = new Map(articleIds.map((x, i) => [x, i]));
    return { projects, articles: [...list.items].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) };
  } catch (err) {
    console.error("[public] 개발방법 관련 프로젝트·기사를 읽지 못해 0으로 그립니다:", err instanceof Error ? err.message : String(err));
    return { projects: [], articles: [] };
  }
}
