import "server-only";
import { KIND_LABEL, fromParam, parseFrom, storeDetailHref, type OrderMode, type ProductKind, type SourcePlacement } from "@/lib/store/rules";
import { publicDb, rowsOf } from "./db";
import type { Features } from "./constants";
import { readPublicSettings } from "./reads";

// 스토어 W8 공개 읽기 (BIZ-01·02·03). 공개 뷰 public_store_products · public_product_links 만 anon 키로 읽는다 - 공개 조건(기능 키 store + 판매 중 + 확인일·근거 +
// 허용 도메인 + 구독 확인 기록)은 뷰 한 곳에 있다. 신청서 방식 상품은 문의함(page_help)이 실제로 열려 있을 때만 보인다 (닫힌 문의함으로 가는 링크 0).
// 결제·가격은 없다. 판매 중지·키 끄기는 다음 요청부터 모든 자리에서 0.

export const AD_POLICY_HREF = "/about/ad-policy";
/** 광고 정책 링크 (BIZ-08 훅) - 정책 페이지가 실제로 열려 있을 때만. 문구는 정책 페이지가 정한다 */
export const adPolicyHref = (features: Features): string | null => (features.page_ad_policy ? AD_POLICY_HREF : null);

export interface StoreProductView {
  id: number;
  slug: string;
  title: string;
  kind: ProductKind;
  kindLabel: string;
  summary: string;
  audience: string;
  edition: string | null;
  toc: string[];
  orderMode: OrderMode;
  orderUrl: string | null;
  verifiedOn: string;
}

interface Row {
  id: number | string;
  slug: string;
  title: string;
  kind: ProductKind;
  summary: string;
  audience: string;
  edition: string | null;
  toc: string[] | null;
  order_mode: OrderMode;
  order_url: string | null;
  verified_on: string;
  placement?: "article" | "home";
  article_id?: number | string | null;
}
const PRODUCT_COLUMNS = "id, slug, title, kind, summary, audience, edition, toc, order_mode, order_url, verified_on";

function view(r: Row): StoreProductView {
  return {
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    kindLabel: KIND_LABEL[r.kind] ?? r.kind,
    summary: r.summary,
    audience: r.audience,
    edition: r.edition,
    toc: r.toc ?? [],
    orderMode: r.order_mode,
    orderUrl: r.order_url,
    verifiedOn: r.verified_on,
  };
}
/** 신청서 방식은 문의함이 열려 있을 때만 주문 경로가 있다 */
const orderable = (p: Row, features: Features) => p.order_mode === "existing_channel" || features.page_help;

export interface StoreListView {
  open: boolean;
  products: StoreProductView[];
  adPolicyHref: string | null;
}

export async function getStoreList(): Promise<StoreListView> {
  const { features } = await readPublicSettings();
  if (!features.store) return { open: false, products: [], adPolicyHref: null };
  const rows = await rowsOf<Row>(publicDb().from("public_store_products").select(PRODUCT_COLUMNS).order("id").limit(200), "스토어 상품");
  return { open: true, products: rows.filter((r) => orderable(r, features)).map(view), adPolicyHref: adPolicyHref(features) };
}

export interface StoreDetailView {
  open: boolean;
  product: StoreProductView | null;
  /** 누른 출발 위치 (?from= - 기사 a12 · 홈 h · 그 밖은 스토어) */
  source: { placement: SourcePlacement; articleId: number | null };
  adPolicyHref: string | null;
}

export async function getStoreProduct(slug: string, from: string | null): Promise<StoreDetailView> {
  const source = parseFrom(from);
  const { features } = await readPublicSettings();
  const closed: StoreDetailView = { open: false, product: null, source, adPolicyHref: null };
  if (!features.store) return closed;
  const rows = await rowsOf<Row>(publicDb().from("public_store_products").select(PRODUCT_COLUMNS).eq("slug", slug).limit(1), "스토어 상품 상세");
  const row = rows[0];
  if (!row || !orderable(row, features)) return { ...closed, open: true };
  return { open: true, product: view(row), source, adPolicyHref: adPolicyHref(features) };
}

/** 기사·홈 하단의 '자사 상품' 카드 (BIZ-03) - 승인된 연결만, 기사 하나(또는 홈)에 1개 이하 */
export interface OwnCardView {
  id: number;
  title: string;
  summary: string;
  detailHref: string;
  placement: "article" | "home";
  articleId: number | null;
  adPolicyHref: string | null;
}

async function ownCard(features: Features, placement: "article" | "home", articleId: number | null): Promise<OwnCardView | null> {
  if (!features.store) return null;
  let q = publicDb().from("public_product_links").select(`${PRODUCT_COLUMNS}, placement, article_id`).eq("placement", placement);
  q = placement === "article" ? q.eq("article_id", articleId as number) : q.is("article_id", null);
  const rows = (await rowsOf<Row>(q.order("link_id").limit(1), "자사 상품 연결")).filter((r) => orderable(r, features));
  const row = rows[0];
  if (!row) return null;
  const from = fromParam(placement, articleId);
  return { id: Number(row.id), title: row.title, summary: row.summary, detailHref: storeDetailHref(row.slug, from), placement, articleId, adPolicyHref: adPolicyHref(features) };
}

export const getArticleProduct = (features: Features, articleId: number) => ownCard(features, "article", articleId);
export const getHomeProduct = (features: Features) => ownCard(features, "home", null);
