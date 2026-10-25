import { actorOf, writeAudit } from "@/lib/server/audit";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 결제·디지털 구독 관리 (W10-f - PAY-01·BIZ-04, docs/dev/W10-f_설계.md). 모든 쓰기는 감사 로그.
//  · GET - 보드 (billing.manage: 스토어·구독 담당·관리자). 상품·요금제·유료 본문 목록(본문 글자는 길이만)·실결제 준비 기록·최근 주문 수.
//  · POST op=product        디지털 구독 상품 등록·고치기 (billing.manage). 판매 상태 on_sale은 확인일·근거가 있어야 - DB가 거부
//  · POST op=plan           요금제 등록·고치기 (billing.manage). 금액·기간은 이 요청의 값이 데이터가 된다 (코드에 가격 상수 0)
//  · POST op=paid_body      유료 본문 등록·고치기 (billing.manage). 판매 권리 확인(sale_allowed)은 근거·확인일이 있어야 - DB가 거부
//  · POST op=readiness      실결제 준비 확인 기록 추가 (billing.readiness - 관리자만, 거부 시도도 감사) / op=readiness_revoke 철회
// 유료 본문 글자는 어떤 응답에도 되돌려 보내지 않는다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const fail = (error: { code?: string; message?: string }, context: string): Response => {
  if (error.code === "23514") return invalid([error.message ?? "저장 규칙에 맞지 않습니다"]);
  if (error.code === "23505") return errorJson(409, "이미 같은 값이 있습니다");
  if (error.code === "23503") return invalid(["참조하는 값이 없습니다 (상품·기사 번호를 확인하세요)"]);
  throw dbError(error, context);
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const OPS = ["product", "plan", "paid_body", "readiness", "readiness_revoke"] as const;

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "billing.manage", "billing:board");
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const [products, plans, bodies, readiness, orders, flags] = await Promise.all([
    db.from("products").select("id, slug, title, status, verified_on, verified_ref").eq("kind", "digital_subscription").order("id"),
    db.from("product_plans").select("id, product_id, plan_key, title, period_months, amount, status, sort_order").order("product_id").order("sort_order"),
    db.from("paid_bodies").select("id, kind, ref_key, article_id, title, preview, sale_allowed, rights_ref, sale_confirmed_on, updated_at").order("id", { ascending: false }).limit(200),
    db.from("commerce_readiness").select("id, confirmed_by, confirmed_on, revoked_at, created_at").order("id", { ascending: false }),
    db.from("orders").select("id", { count: "exact", head: true }),
    db.from("settings").select("value").eq("key", "feature_flags").maybeSingle(),
  ]);
  for (const r of [products, plans, bodies, readiness, orders, flags]) if (r.error) throw dbError(r.error, "billing 보드 읽기");
  const f = ((flags.data as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  return json({
    flags: { billing: f.billing === true, digital_subscription: f.digital_subscription === true, paywall: f.paywall === true },
    products: products.data,
    plans: plans.data,
    paidBodies: bodies.data,
    readiness: readiness.data,
    orderCount: orders.count ?? 0,
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(OPS as readonly string[]).includes(op)) return invalid([`op: ${OPS.join("·")} 중 하나입니다`]);
  const action = op === "readiness" || op === "readiness_revoke" ? "billing.readiness" : "billing.manage";
  const denied = await authorize(viewer, action, `billing:${op}`);
  if (denied) return denied;
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  const actor = actorOf(viewer);
  const audit = (a: string, target: string, before: unknown, after: unknown, reason: string) => writeAudit(db, { actor, action: a, target, before, after, reason });

  if (op === "product") {
    const row = {
      slug: str(body.slug),
      title: str(body.title),
      summary: typeof body.summary === "string" ? body.summary : "",
      status: str(body.status) ?? "draft",
      verified_on: str(body.verified_on),
      verified_ref: str(body.verified_ref),
      kind: "digital_subscription",
      order_mode: "pg",
      billing_mode: "pg",
      edited_by: actor,
    };
    if (!row.slug || !row.title) return invalid(["slug·title: 필수입니다"]);
    const id = int(body.id);
    if (id === null) {
      const { data, error } = await db.from("products").insert(row).select("id, slug, status").single();
      if (error) return fail(error, "products 추가");
      await audit("billing.product.create", `products:${(data as { id: number }).id}`, null, { slug: row.slug }, "디지털 구독 상품 등록");
      return json({ product: data }, 201);
    }
    const { data: before } = await db.from("products").select("*").eq("id", id).eq("kind", "digital_subscription").maybeSingle();
    if (!before) return errorJson(404, "그런 상품이 없습니다");
    const { data, error } = await db.from("products").update(row).eq("id", id).select("id, slug, status").single();
    if (error) return fail(error, "products 수정");
    await audit("billing.product.update", `products:${id}`, before, data, "디지털 구독 상품 고치기");
    return json({ product: data });
  }

  if (op === "plan") {
    const row = {
      product_id: int(body.product_id),
      plan_key: str(body.plan_key),
      title: str(body.title),
      period_months: int(body.period_months),
      amount: int(body.amount),
      status: str(body.status) ?? "draft",
      sort_order: int(body.sort_order) ?? 0,
      edited_by: actor,
    };
    if (row.product_id === null || !row.plan_key || !row.title || row.period_months === null || row.amount === null) {
      return invalid(["product_id·plan_key·title·period_months·amount: 필수입니다 (정수)"]);
    }
    const id = int(body.id);
    if (id === null) {
      const { data, error } = await db.from("product_plans").insert(row).select("id, plan_key, status, amount").single();
      if (error) return fail(error, "product_plans 추가");
      await audit("billing.plan.create", `product_plans:${(data as { id: number }).id}`, null, { plan_key: row.plan_key, amount: row.amount, period_months: row.period_months }, "요금제 등록");
      return json({ plan: data }, 201);
    }
    const { data: before } = await db.from("product_plans").select("*").eq("id", id).maybeSingle();
    if (!before) return errorJson(404, "그런 요금제가 없습니다");
    const { data, error } = await db.from("product_plans").update(row).eq("id", id).select("id, plan_key, status, amount").single();
    if (error) return fail(error, "product_plans 수정");
    await audit("billing.plan.update", `product_plans:${id}`, before, data, "요금제 고치기 (금액이 바뀌면 갱신 전에 사전 고지 기록이 새로 필요합니다)");
    return json({ plan: data });
  }

  if (op === "paid_body") {
    const kind = str(body.kind);
    const row = {
      kind,
      ref_key: str(body.ref_key),
      article_id: int(body.article_id),
      title: str(body.title),
      preview: str(body.preview),
      body: typeof body.body === "string" ? body.body : null,
      sale_allowed: body.sale_allowed === true,
      rights_ref: str(body.rights_ref),
      sale_confirmed_on: str(body.sale_confirmed_on),
      edited_by: actor,
    };
    if (!row.kind || !row.ref_key || !row.preview || !row.body) return invalid(["kind·ref_key·preview·body: 필수입니다"]);
    const { data: existing } = await db.from("paid_bodies").select("id, sale_allowed").eq("kind", row.kind).eq("ref_key", row.ref_key).maybeSingle();
    const q = existing ? db.from("paid_bodies").update(row).eq("id", (existing as { id: number }).id) : db.from("paid_bodies").insert(row);
    const { data, error } = await q.select("id, kind, ref_key, sale_allowed").single();
    if (error) return fail(error, "paid_bodies 저장");
    await audit(existing ? "billing.paid_body.update" : "billing.paid_body.create", `paid_bodies:${(data as { id: number }).id}`, existing ?? null, { kind: row.kind, ref_key: row.ref_key, sale_allowed: row.sale_allowed }, "유료 본문 저장 (본문 글자는 감사 기록에 넣지 않음)");
    return json({ paidBody: data }, existing ? 200 : 201);
  }

  if (op === "readiness") {
    const row = {
      contract_ref: str(body.contract_ref),
      business_report_ref: str(body.business_report_ref),
      policy_ref: str(body.policy_ref),
      vat_review_ref: str(body.vat_review_ref),
      confirmed_by: str(body.confirmed_by),
      confirmed_on: str(body.confirmed_on),
    };
    if (Object.values(row).some((v) => v === null)) return invalid(["contract_ref·business_report_ref·policy_ref·vat_review_ref·confirmed_by·confirmed_on: 모두 필수입니다"]);
    const { data, error } = await db.from("commerce_readiness").insert(row).select("id").single();
    if (error) return fail(error, "commerce_readiness 추가");
    await audit("billing.readiness.create", `commerce_readiness:${(data as { id: number }).id}`, null, { confirmed_by: row.confirmed_by, confirmed_on: row.confirmed_on }, "실결제 준비 확인 기록 추가");
    return json({ readiness: data }, 201);
  }

  const id = int(body.id);
  if (id === null) return invalid(["id: 필수입니다"]);
  const { data, error } = await db.from("commerce_readiness").update({ revoked_at: new Date().toISOString() }).eq("id", id).is("revoked_at", null).select("id").maybeSingle();
  if (error) return fail(error, "commerce_readiness 철회");
  if (!data) return errorJson(404, "철회할 기록이 없습니다 (이미 철회됐거나 없는 번호)");
  await audit("billing.readiness.revoke", `commerce_readiness:${id}`, null, { revoked: true }, "실결제 준비 확인 기록 철회");
  return json({ revoked: id });
});
