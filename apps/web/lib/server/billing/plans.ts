import "server-only";
import { anonClient } from "@/lib/server/supabase";

// 공개 요금표 읽기 (W10-f, PAY-01) - 공개 뷰 public_digital_plans(기능 키 billing·digital_subscription 켜짐 + 판매 중 상품 + 활성 요금제 + 판매 권리 확인 본문 있음).
// 요청마다 읽는다(공유 캐시 0). 금액·기간은 모두 DB 데이터이고 이 파일에 가격 상수가 없다.
export interface PublicPlan {
  planId: number;
  planKey: string;
  planTitle: string;
  periodMonths: number;
  amount: number;
  currency: string;
  productTitle: string;
  productSummary: string;
}

export async function getPublicPlans(): Promise<PublicPlan[] | null> {
  const db = anonClient();
  if (!db) return null;
  const { data, error } = await db
    .from("public_digital_plans")
    .select("plan_id, plan_key, plan_title, period_months, amount, currency, product_title, summary, sort_order")
    .order("sort_order")
    .order("period_months");
  if (error) {
    console.error("[billing] 요금표 읽기 실패:", error.code);
    return null;
  }
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    planId: Number(r.plan_id),
    planKey: String(r.plan_key),
    planTitle: String(r.plan_title),
    periodMonths: Number(r.period_months),
    amount: Number(r.amount),
    currency: String(r.currency),
    productTitle: String(r.product_title),
    productSummary: String(r.summary ?? ""),
  }));
}
