import { parseDomains, parseId, parseLinkPropose, parseProduct, parseProductStatus, parseSubscriptionReview, STORE_OPS } from "@/lib/store/rules";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadStoreBoard } from "@/lib/server/store/board";

// 스토어 관리 (W8 - PRD-01C BIZ-01·02·03, docs/dev/W8_설계.md 1장 3단계). 모든 쓰기는 감사 로그와 공개 캐시 만료.
//  · GET - 보드 (상품 담당·관리자). 상품·연결·허용 도메인·구독 확인 기록.
//  · POST op=product {id?,...}          상품 등록·고치기 (product.manage). 판매 상태는 건드리지 않는다
//  · POST op=product_status {id,status} 판매 상태 변경 (product.manage). 판매 중은 확인일·근거(·도서는 판차·목차)가 있어야 - DB가 거부
//  · POST op=link_propose {product_id,placement,article_id?} 자사 상품 카드 연결 제안 (product.manage)
//  · POST op=link_approve {id} / link_revoke {id} 승인·철회 (product.approve - 편집 책임자·관리자. 상품 담당은 403 + 거부 감사)
//  · POST op=domains {domains} 바깥 주문 허용 도메인 / subscription_review {...} 구독 확인 기록 (settings.edit - 관리자만)
// 가격·결제 칸은 없다. 허용 도메인 밖 주소·할인 표기·기사당 두 번째 승인은 DB 트리거·색인이 거부한다 (check_violation 422 · unique 409).
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다 (주소 이름이 겹치거나, 이 자리에 이미 승인된 연결이 있습니다 - 먼저 철회하세요)");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (상품·기사 번호를 확인하세요)"]);
  throw dbError(error, context);
};

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "product.manage", "store:list");
  if (denied) return denied;
  return json(await loadStoreBoard(serviceDb()));
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    if (!(STORE_OPS as readonly string[]).includes(op)) return invalid([`op: ${STORE_OPS.join("·")} 중 하나입니다`]);
    const action = op === "link_approve" || op === "link_revoke" ? "product.approve" : op === "domains" || op === "subscription_review" ? "settings.edit" : "product.manage";
    const denied = await authorize(viewer, action, `store:${op}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);
    const audit = (a: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action: a, target, before, after, reason });

    if (op === "product") {
      const p = parseProduct(body);
      if (!p.ok) return invalid(p.errors);
      if (p.value.id === null) {
        const { data, error } = await db.from("products").insert({ ...p.value.row, edited_by: actor }).select("id, slug, status").single();
        if (error) return fail(error, "products 추가");
        await audit("store.product.create", `products:${(data as { id: number }).id}`, null, { slug: p.value.row.slug, kind: p.value.row.kind, order_mode: p.value.row.order_mode }, "상품 등록(초안)");
        return json({ product: data }, 201);
      }
      const { data: before, error: be } = await db.from("products").select("*").eq("id", p.value.id).maybeSingle();
      if (be) throw dbError(be, "products 조회");
      if (!before) return errorJson(404, "그런 상품이 없습니다");
      const { data, error } = await db.from("products").update({ ...p.value.row, edited_by: actor }).eq("id", p.value.id).select("id, slug, status").single();
      if (error) return fail(error, "products 수정");
      await audit("store.product.update", `products:${p.value.id}`, before, data, "상품 고치기");
      return json({ product: data });
    }

    if (op === "product_status") {
      const p = parseProductStatus(body);
      if (!p.ok) return invalid(p.errors);
      const { data: before, error: be } = await db.from("products").select("id, status").eq("id", p.value.id).maybeSingle();
      if (be) throw dbError(be, "products 조회");
      if (!before) return errorJson(404, "그런 상품이 없습니다");
      const { data, error } = await db.from("products").update({ status: p.value.status, edited_by: actor }).eq("id", p.value.id).select("id, slug, status").single();
      if (error) return fail(error, "products 상태 변경");
      await audit("store.product.status", `products:${p.value.id}`, before, { status: p.value.status }, `판매 상태 변경 -> ${p.value.status}`);
      return json({ product: data });
    }

    if (op === "link_propose") {
      const p = parseLinkPropose(body);
      if (!p.ok) return invalid(p.errors);
      const { data, error } = await db
        .from("product_links")
        .insert({ product_id: p.value.productId, placement: p.value.placement, article_id: p.value.articleId, proposed_by: actor })
        .select("id, placement, status")
        .single();
      if (error) return fail(error, "product_links 제안");
      await audit("store.link.propose", `product_links:${(data as { id: number }).id}`, null, { product_id: p.value.productId, placement: p.value.placement, article_id: p.value.articleId }, "자사 상품 카드 연결 제안");
      return json({ link: data }, 201);
    }

    if (op === "link_approve" || op === "link_revoke") {
      const id = parseId(body);
      if (!id.ok) return invalid(id.errors);
      const approve = op === "link_approve";
      const patch = approve ? { status: "approved", approved_by: actor, approved_at: new Date().toISOString() } : { status: "revoked" };
      const from = approve ? ["proposed"] : ["proposed", "approved"];
      const { data: before } = await db.from("product_links").select("id, status, placement, article_id").eq("id", id.value).maybeSingle();
      if (!before) return errorJson(404, "그런 연결이 없습니다");
      const { data, error } = await db.from("product_links").update(patch).eq("id", id.value).in("status", from).select("id, placement, status").maybeSingle();
      if (error) return fail(error, "product_links 변경");
      if (!data) return errorJson(409, approve ? "제안 상태의 연결만 승인할 수 있습니다" : "이미 철회된 연결입니다");
      await audit(approve ? "store.link.approve" : "store.link.revoke", `product_links:${id.value}`, before, { status: patch.status }, approve ? "자사 상품 카드 연결 승인" : "자사 상품 카드 연결 철회");
      return json({ link: data });
    }

    if (op === "domains") {
      const p = parseDomains(body);
      if (!p.ok) return invalid(p.errors);
      const { data: cur } = await db.from("settings").select("value").eq("key", "store_order_domains").maybeSingle();
      const { error } = await db.from("settings").update({ value: p.value, updated_by: actor }).eq("key", "store_order_domains");
      if (error) return fail(error, "settings store_order_domains");
      await audit("store.domains.update", "settings:store_order_domains", (cur as { value?: unknown } | null)?.value ?? null, p.value, "바깥 주문 허용 도메인 변경");
      return json({ domains: p.value });
    }

    // subscription_review
    const p = parseSubscriptionReview(body);
    if (!p.ok) return invalid(p.errors);
    const { data: cur } = await db.from("settings").select("value").eq("key", "store_subscription_review").maybeSingle();
    const { error } = await db.from("settings").update({ value: p.value, updated_by: actor }).eq("key", "store_subscription_review");
    if (error) return fail(error, "settings store_subscription_review");
    await audit("store.subscription_review", "settings:store_subscription_review", (cur as { value?: unknown } | null)?.value ?? null, p.value, p.value.approved ? "구독 확인 기록 승인" : "구독 확인 기록 저장(미승인)");
    return json({ subscriptionReview: p.value });
  },
  { revalidatesPublic: true },
);
