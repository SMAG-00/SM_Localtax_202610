import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "../http";

// 개발금융 관리 읽기 (W5 — docs/dev/W5_설계.md 1장 3단계). 관리 API(GET)와 관리 화면이 같은 함수를 쓴다. service_role로 표를 읽는다.

type Db = SupabaseClient;

export interface StructureBoardRow {
  id: number;
  slug: string;
  structure_type: string;
  title: string;
  summary: string | null;
  diagram: { alt: string; nodes: { key: string; label: string }[]; edges: { from: string; to: string; label: string }[] } | null;
  notes: string[];
  lens: Record<string, unknown> | null;
  lens_omit_reason: string | null;
  drafted_by: string;
  updated_at: string;
  legal_checked_by: string | null;
  legal_checked_at: string | null;
  approved_version: number | null;
  approved_at: string | null;
  review_status: "draft" | "approved" | "rereview_needed";
}
export interface IndicatorAdminRow {
  id: number;
  indicator_key: string;
  label: string;
  value: number | string;
  unit: string;
  as_of: string;
  collected_on: string;
  provider: string;
  source_url: string;
}
export interface RegulationAdminRow {
  id: number;
  reg_key: string;
  title: string;
  stage: string;
  effective_on: string;
  provider: string;
  source_url: string;
}
export interface FinanceArticleRow {
  id: number;
  title: string;
  status: string;
  content_type: string | null;
  category_slug: string | null;
  case: {
    structure_type: string;
    issues: string[];
    outcome: string | null;
    named_company: boolean;
    rebuttal_requested_at: string | null;
    rebuttal_method: string | null;
    rebuttal_status: string | null;
    rebuttal_note: string | null;
    judgment_quoted: boolean;
    anonymized_checked: boolean;
  } | null;
  interest: { item: string; state: string; interest_text: string | null; confirmed_by: string | null }[];
}
export interface FinanceBoard {
  featureOn: boolean;
  legalReview: unknown;
  blockedDomains: string[];
  rebuttalWaitDays: number | null;
  structures: StructureBoardRow[];
  indicators: IndicatorAdminRow[];
  regulations: RegulationAdminRow[];
  articles: FinanceArticleRow[];
}

export const STRUCTURE_BOARD_COLUMNS =
  "id, slug, structure_type, title, summary, diagram, notes, lens, lens_omit_reason, drafted_by, updated_at, legal_checked_by, legal_checked_at, approved_version, approved_at, review_status";

async function list<T>(q: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>, ctx: string): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw dbError(error, ctx);
  return (data ?? []) as T[];
}

export async function loadStructure(db: Db, slug: string): Promise<StructureBoardRow | null> {
  const [row] = await list<StructureBoardRow>(db.from("finance_structure_board").select(STRUCTURE_BOARD_COLUMNS).eq("slug", slug).limit(1), "finance_structure_board 읽기");
  return row ?? null;
}

export async function loadFinanceBoard(db: Db): Promise<FinanceBoard> {
  const [settings, structures, indicators, regulations, arts] = await Promise.all([
    list<{ key: string; value: unknown }>(db.from("settings").select("key, value").in("key", ["feature_flags", "finance_legal_review", "finance_blocked_domains", "finance_rebuttal_wait_days"]), "settings 읽기"),
    list<StructureBoardRow>(db.from("finance_structure_board").select(STRUCTURE_BOARD_COLUMNS).order("slug"), "finance_structure_board 읽기"),
    list<IndicatorAdminRow>(db.from("finance_indicators").select("id, indicator_key, label, value, unit, as_of, collected_on, provider, source_url").order("id", { ascending: false }).limit(50), "finance_indicators 읽기"),
    list<RegulationAdminRow>(db.from("finance_regulations").select("id, reg_key, title, stage, effective_on, provider, source_url").order("id", { ascending: false }).limit(50), "finance_regulations 읽기"),
    list<{ id: number; title: string; status: string; content_type: string | null; categories: { slug: string } | { slug: string }[] | null }>(
      db.from("articles").select("id, title, status, content_type, categories(slug)").eq("section", "finance").order("id", { ascending: false }).limit(50),
      "articles 읽기",
    ),
  ]);
  const ids = arts.map((a) => a.id);
  const [cases, items] = ids.length
    ? await Promise.all([
        list<NonNullable<FinanceArticleRow["case"]> & { article_id: number }>(
          db.from("finance_cases").select("article_id, structure_type, issues, outcome, named_company, rebuttal_requested_at, rebuttal_method, rebuttal_status, rebuttal_note, judgment_quoted, anonymized_checked").in("article_id", ids),
          "finance_cases 읽기",
        ),
        list<FinanceArticleRow["interest"][number] & { article_id: number }>(
          db.from("finance_column_interest_items").select("article_id, item, state, interest_text, confirmed_by").in("article_id", ids).order("item"),
          "finance_column_interest_items 읽기",
        ),
      ])
    : [[], []];
  const get = (key: string) => settings.find((s) => s.key === key)?.value;
  const flags = get("feature_flags") as { finance?: unknown } | undefined;
  const wait = get("finance_rebuttal_wait_days");
  const articles: FinanceArticleRow[] = arts.map((a) => {
    const cat = Array.isArray(a.categories) ? a.categories[0] : a.categories;
    const c = cases.find((x) => x.article_id === a.id);
    return {
      id: a.id,
      title: a.title,
      status: a.status,
      content_type: a.content_type,
      category_slug: cat?.slug ?? null,
      case: c ? { ...c } : null,
      interest: items.filter((i) => i.article_id === a.id),
    };
  });
  return {
    featureOn: flags?.finance === true,
    legalReview: get("finance_legal_review") ?? {},
    blockedDomains: Array.isArray(get("finance_blocked_domains")) ? (get("finance_blocked_domains") as string[]) : [],
    rebuttalWaitDays: typeof wait === "number" ? wait : null,
    structures,
    indicators,
    regulations,
    articles,
  };
}
