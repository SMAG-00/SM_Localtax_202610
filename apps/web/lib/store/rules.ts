// 스토어 입력 규칙 (W8 - PRD-01C BIZ-01·02·03, docs/dev/W8_설계.md 2장). 순수 모듈 - DB 트리거(…75_w8_store_products)가 같은 규칙을 다시 강제한다.
// 오류 문장은 "칸: 문장" 모양이라 폼이 칸 옆에 보인다. 상품 내용은 PO가 실사 자료를 보고 직접 적는다 - 이 모듈에 채워 넣는 기본값은 없다.

export const PRODUCT_KINDS = ["book", "education", "subscription"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const ORDER_MODES = ["existing_channel", "request_form"] as const;
export type OrderMode = (typeof ORDER_MODES)[number];
export const PRODUCT_STATUSES = ["draft", "on_sale", "stopped"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export const LINK_PLACEMENTS = ["article", "home"] as const;
export type LinkPlacement = (typeof LINK_PLACEMENTS)[number];
export const STORE_OPS = ["product", "product_status", "link_propose", "link_approve", "link_revoke", "domains", "subscription_review"] as const;
export type StoreOp = (typeof STORE_OPS)[number];

export const KIND_LABEL: Record<ProductKind, string> = { book: "도서", education: "교육", subscription: "구독 신청" };
export const ORDER_MODE_LABEL: Record<OrderMode, string> = { existing_channel: "바깥 판매처 링크", request_form: "문의함(신청서)" };
export const STATUS_LABEL: Record<ProductStatus, string> = { draft: "초안(비공개)", on_sale: "판매 중", stopped: "판매 중지" };
export const LINK_STATUS_LABEL: Record<string, string> = { proposed: "제안", approved: "승인", revoked: "철회" };

/** 화면에서 누른 위치 - 이벤트·주소 쿼리가 쓰는 값 */
export type SourcePlacement = "article" | "home" | "store";

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });

/** 할인·가격 표기 - DB 트리거 products_guard와 같은 모양 (도서정가제 감수 전 BIZ-01) */
export const PRICE_TEXT = /(할인|최저가|특가|[0-9][0-9,]*\s*원|[0-9]+\s*%)/;
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_URL = /^https:\/\/[a-z0-9][a-z0-9.-]*(:[0-9]+)?(\/[^\s]*)?$/i;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : str(v).split(/\r?\n/).map((s) => s.trim())).filter((s) => s !== "");

export const parseId = (body: Record<string, unknown>, name = "id"): Parsed<number> => {
  const id = int(body[name]);
  return id ? { ok: true, value: id } : fail([`${name}: 1 이상의 번호가 필요합니다`]);
};

/** 주문 주소의 호스트 (https만, 사용자 정보·다른 호스트 속임수 없음) - 맞지 않으면 null */
export function orderHost(url: string): string | null {
  if (url.length > 500 || !ORDER_URL.test(url)) return null;
  const m = /^https:\/\/([^/?#:@]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

export interface ProductRow {
  slug: string;
  title: string;
  kind: ProductKind;
  summary: string;
  audience: string;
  edition: string | null;
  toc: string[];
  order_mode: OrderMode;
  order_url: string | null;
  verified_on: string | null;
  verified_ref: string | null;
}

/** 상품 등록·고치기 (op=product) - 상태는 별도 op(product_status)로만 바꾼다 */
export function parseProduct(body: Record<string, unknown>): Parsed<{ id: number | null; row: ProductRow }> {
  const errors: string[] = [];
  const slug = str(body.slug);
  const title = str(body.title);
  const summary = str(body.summary);
  const audience = str(body.audience);
  const edition = str(body.edition);
  const toc = lines(body.toc);
  const orderUrl = str(body.order_url);
  const verifiedOn = str(body.verified_on);
  const verifiedRef = str(body.verified_ref);
  const kind = str(body.kind);
  const mode = str(body.order_mode);
  const hasId = body.id !== undefined && body.id !== null && body.id !== "";
  const idRaw = hasId ? int(body.id) : null;
  if (hasId && idRaw === null) errors.push("id: 1 이상의 번호여야 합니다");
  if (!SLUG.test(slug) || slug.length > 60) errors.push("slug: 영문 소문자·숫자·-로 60자 이하");
  if (title.length < 1 || title.length > 80) errors.push("title: 1~80자로 적어 주세요");
  if (!(PRODUCT_KINDS as readonly string[]).includes(kind)) errors.push(`kind: ${PRODUCT_KINDS.join("·")} 중 하나`);
  if (summary.length > 200) errors.push("summary: 200자 이하");
  if (audience.length > 80) errors.push("audience: 80자 이하");
  if (edition.length > 100) errors.push("edition: 100자 이하");
  if (toc.length > 60 || toc.some((t) => t.length > 100)) errors.push("toc: 항목 60개 이하, 각 100자 이하 (줄마다 하나)");
  if (!(ORDER_MODES as readonly string[]).includes(mode)) errors.push(`order_mode: ${ORDER_MODES.join("·")} 중 하나`);
  if (mode === "existing_channel" && orderHost(orderUrl) === null) errors.push("order_url: 바깥 판매처 링크는 https 주소여야 합니다 (허용 도메인만)");
  if (mode === "request_form" && orderUrl !== "") errors.push("order_url: 문의함(신청서) 방식에는 주소를 적지 않습니다");
  if (verifiedOn !== "" && !DATE.test(verifiedOn)) errors.push("verified_on: YYYY-MM-DD");
  if (verifiedRef.length > 200) errors.push("verified_ref: 200자 이하");
  if (PRICE_TEXT.test([title, summary, audience, edition, ...toc].join(" "))) errors.push("summary: 할인·가격 표기는 쓸 수 없습니다 (전자상거래법·도서정가제 감수 전)");
  if (errors.length) return fail(errors);
  return {
    ok: true,
    value: {
      id: idRaw,
      row: {
        slug,
        title,
        kind: kind as ProductKind,
        summary,
        audience,
        edition: edition || null,
        toc,
        order_mode: mode as OrderMode,
        order_url: mode === "existing_channel" ? orderUrl : null,
        verified_on: verifiedOn || null,
        verified_ref: verifiedRef || null,
      },
    },
  };
}

export function parseProductStatus(body: Record<string, unknown>): Parsed<{ id: number; status: ProductStatus }> {
  const id = parseId(body);
  const status = str(body.status);
  const errors = [...(id.ok ? [] : id.errors), ...((PRODUCT_STATUSES as readonly string[]).includes(status) ? [] : [`status: ${PRODUCT_STATUSES.join("·")} 중 하나`])];
  return errors.length || !id.ok ? fail(errors) : { ok: true, value: { id: id.value, status: status as ProductStatus } };
}

export function parseLinkPropose(body: Record<string, unknown>): Parsed<{ productId: number; placement: LinkPlacement; articleId: number | null }> {
  const errors: string[] = [];
  const productId = int(body.product_id);
  const placement = str(body.placement);
  const articleId = int(body.article_id);
  if (!productId) errors.push("product_id: 상품 번호가 필요합니다");
  if (!(LINK_PLACEMENTS as readonly string[]).includes(placement)) errors.push(`placement: ${LINK_PLACEMENTS.join("·")} 중 하나`);
  if (placement === "article" && !articleId) errors.push("article_id: 기사 연결에는 기사 번호가 필요합니다");
  if (placement === "home" && body.article_id !== undefined && body.article_id !== null && body.article_id !== "") errors.push("article_id: 홈 연결에는 기사 번호를 적지 않습니다");
  if (errors.length) return fail(errors);
  return { ok: true, value: { productId: productId!, placement: placement as LinkPlacement, articleId: placement === "article" ? articleId : null } };
}

/** 허용 도메인 목록 (op=domains) - 줄바꿈·쉼표·공백으로 구분한 소문자 호스트 */
export function parseDomains(body: Record<string, unknown>): Parsed<string[]> {
  const raw = Array.isArray(body.domains) ? body.domains.map(str) : str(body.domains).split(/[\s,]+/);
  const list = raw.filter((s) => s !== "");
  const bad = list.filter((h) => !HOST.test(h) || h.length > 253);
  if (list.length > 30) return fail(["domains: 30개 이하"]);
  if (bad.length) return fail([`domains: 소문자 호스트 이름만 적습니다 (예: shop.example.test) - ${bad.join(", ")}`]);
  if (new Set(list).size !== list.length) return fail(["domains: 같은 도메인이 겹칩니다"]);
  return { ok: true, value: list };
}

export function parseSubscriptionReview(body: Record<string, unknown>): Parsed<{ approved: boolean; ref: string; reviewed_by: string | null; reviewed_on: string | null }> {
  const approved = body.approved === true;
  const ref = str(body.ref);
  const by = str(body.reviewed_by);
  const on = str(body.reviewed_on);
  const errors: string[] = [];
  if (ref.length > 200) errors.push("ref: 200자 이하");
  if (on !== "" && !DATE.test(on)) errors.push("reviewed_on: YYYY-MM-DD");
  if (approved && (ref === "" || by === "" || on === "")) errors.push("ref: 승인에는 근거 위치·확인자·확인일이 모두 필요합니다");
  return errors.length ? fail(errors) : { ok: true, value: { approved, ref, reviewed_by: by || null, reviewed_on: on || null } };
}

/** 수익 대시보드 기간 (일) - 7·30·90만 */
export function parseDays(raw: string | null | undefined): number {
  return raw === "7" || raw === "90" ? Number(raw) : 30;
}

/** 상세 주소 쿼리 `?from=` - 기사 `a12`, 홈 `h`, 그 밖은 스토어. 카드를 누른 출발 위치를 주문 링크 측정까지 잇는다 (개인 정보 없음) */
export function parseFrom(raw: string | null | undefined): { placement: SourcePlacement; articleId: number | null } {
  const v = (raw ?? "").trim();
  const m = /^a([1-9][0-9]{0,11})$/.exec(v);
  if (m) return { placement: "article", articleId: Number(m[1]) };
  if (v === "h") return { placement: "home", articleId: null };
  return { placement: "store", articleId: null };
}

export function fromParam(placement: SourcePlacement, articleId: number | null): string | null {
  if (placement === "article" && articleId) return `a${articleId}`;
  if (placement === "home") return "h";
  return null;
}

export const storeDetailHref = (slug: string, from: string | null = null) => `/store/${encodeURIComponent(slug)}${from ? `?from=${from}` : ""}`;
/** 신청서(request_form) 방식의 도착 - 기존 문의함의 구독 문의 (스토어·구독 담당이 읽는다, 설계 12장 #2) */
export const STORE_INQUIRY_HREF = "/help/subscribe";
