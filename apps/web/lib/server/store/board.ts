import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";
import { parseFeatures } from "@/lib/server/public/settings";

// 스토어 관리 보드 (W8 - /admin/store, /api/admin/store GET)와 클릭 집계 (수익 대시보드). service_role로 읽는다. 금액 칸은 없다.

type Db = SupabaseClient;

export interface BoardProduct {
  id: number;
  slug: string;
  title: string;
  kind: string;
  summary: string;
  audience: string;
  edition: string | null;
  toc: string[];
  order_mode: string;
  order_url: string | null;
  verified_on: string | null;
  verified_ref: string | null;
  status: "draft" | "on_sale" | "stopped";
  updated_at: string;
}
export interface BoardLink {
  id: number;
  product_id: number;
  product_title: string;
  placement: "article" | "home";
  article_id: number | null;
  article_title: string | null;
  status: "proposed" | "approved" | "revoked";
  proposed_by: string;
  approved_by: string | null;
  approved_at: string | null;
}
export interface StoreBoard {
  flags: { store: boolean };
  domains: string[];
  subscriptionReview: Record<string, unknown>;
  products: BoardProduct[];
  links: BoardLink[];
}

const PRODUCT_COLUMNS = "id, slug, title, kind, summary, audience, edition, toc, order_mode, order_url, verified_on, verified_ref, status, updated_at";
const num = (v: unknown) => Number(v);

async function setting(db: Db, key: string): Promise<unknown> {
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw dbError(error, `settings ${key} 읽기`);
  return (data as { value?: unknown } | null)?.value ?? null;
}

export async function loadStoreBoard(db: Db): Promise<StoreBoard> {
  const [flags, domains, review, products, links] = await Promise.all([
    setting(db, "feature_flags"),
    setting(db, "store_order_domains"),
    setting(db, "store_subscription_review"),
    db.from("products").select(PRODUCT_COLUMNS).order("id"),
    db.from("product_links").select("id, product_id, placement, article_id, status, proposed_by, approved_by, approved_at").order("id", { ascending: false }).limit(300),
  ]);
  if (products.error) throw dbError(products.error, "products 읽기");
  if (links.error) throw dbError(links.error, "product_links 읽기");
  const prows = ((products.data ?? []) as unknown as BoardProduct[]).map((p) => ({ ...p, id: num(p.id) }));
  const lrows = (links.data ?? []) as unknown as Array<Omit<BoardLink, "product_title" | "article_title">>;
  const articleIds = [...new Set(lrows.flatMap((l) => (l.article_id === null ? [] : [num(l.article_id)])))];
  const titles = new Map<number, string>();
  if (articleIds.length) {
    const { data, error } = await db.from("articles").select("id, title").in("id", articleIds);
    if (error) throw dbError(error, "articles 제목 읽기");
    for (const a of (data ?? []) as { id: number; title: string }[]) titles.set(num(a.id), a.title);
  }
  const productTitle = new Map(prows.map((p) => [p.id, p.title]));
  return {
    flags: { store: parseFeatures(flags).store },
    domains: Array.isArray(domains) ? (domains as string[]) : [],
    subscriptionReview: typeof review === "object" && review !== null && !Array.isArray(review) ? (review as Record<string, unknown>) : {},
    products: prows,
    links: lrows.map((l) => ({
      ...l,
      id: num(l.id),
      product_id: num(l.product_id),
      article_id: l.article_id === null ? null : num(l.article_id),
      product_title: productTitle.get(num(l.product_id)) ?? "",
      article_title: l.article_id === null ? null : (titles.get(num(l.article_id)) ?? null),
    })),
  };
}

export interface RevenueRow {
  product_id: number;
  product_title: string;
  placement: "article" | "home" | "store";
  article_id: number | null;
  article_title: string | null;
  card_clicks: number;
  order_clicks: number;
}
export interface RevenueReport {
  days: number;
  from: string;
  to: string;
  rows: RevenueRow[];
  /** 상품별 합계 - 금액·공헌이익은 1단계에 없다 (결제 없음) */
  totals: { product_id: number; product_title: string; card_clicks: number; order_clicks: number }[];
}

/** 클릭 집계 (BIZ-09) - 최근 N일. 봇·편집국 세션은 DB 함수가 뺀다 */
export async function loadRevenue(db: Db, days: number, now: Date = new Date()): Promise<RevenueReport> {
  const to = new Date(now.getTime() + 60_000);
  const from = new Date(now.getTime() - days * 86_400_000);
  const { data, error } = await db.rpc("store_click_summary", { p_from: from.toISOString(), p_to: to.toISOString() });
  if (error) throw dbError(error, "store_click_summary");
  const raw = (data ?? []) as Array<{ product_id: number | string; placement: RevenueRow["placement"]; article_id: number | string | null; card_clicks: number | string; order_clicks: number | string }>;
  const productIds = [...new Set(raw.map((r) => num(r.product_id)))];
  const articleIds = [...new Set(raw.flatMap((r) => (r.article_id === null ? [] : [num(r.article_id)])))];
  const [products, articles] = await Promise.all([
    productIds.length ? db.from("products").select("id, title").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    articleIds.length ? db.from("articles").select("id, title").in("id", articleIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (products.error) throw dbError(products.error, "products 제목 읽기");
  if (articles.error) throw dbError(articles.error, "articles 제목 읽기");
  const pt = new Map(((products.data ?? []) as { id: number; title: string }[]).map((p) => [num(p.id), p.title]));
  const at = new Map(((articles.data ?? []) as { id: number; title: string }[]).map((a) => [num(a.id), a.title]));
  const rows: RevenueRow[] = raw.map((r) => ({
    product_id: num(r.product_id),
    product_title: pt.get(num(r.product_id)) ?? `(삭제된 상품 ${num(r.product_id)})`,
    placement: r.placement,
    article_id: r.article_id === null ? null : num(r.article_id),
    article_title: r.article_id === null ? null : (at.get(num(r.article_id)) ?? null),
    card_clicks: num(r.card_clicks),
    order_clicks: num(r.order_clicks),
  }));
  const totals = new Map<number, RevenueReport["totals"][number]>();
  for (const r of rows) {
    const t = totals.get(r.product_id) ?? { product_id: r.product_id, product_title: r.product_title, card_clicks: 0, order_clicks: 0 };
    t.card_clicks += r.card_clicks;
    t.order_clicks += r.order_clicks;
    totals.set(r.product_id, t);
  }
  return { days, from: from.toISOString(), to: to.toISOString(), rows, totals: [...totals.values()].sort((a, b) => a.product_id - b.product_id) };
}
