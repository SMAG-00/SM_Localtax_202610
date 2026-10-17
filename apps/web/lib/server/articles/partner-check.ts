import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finding } from "@ltr/editorial";
import { newPartnerBlocked } from "@/lib/admin/partner-rules";
import { dbError } from "../http";
import { kstDate } from "./gate";
import { findingsError } from "./service";

/**
 * 계약이 끝난 제휴사를 새로 지정하는 저장 거부 (ART-10 "계약 종료일이 지난 제휴사는 새 기사에 지정할 수 없고, 기존 기사 배지는 남는다").
 * 발행 판정도 같은 항목(art10.partner-contract-expired)으로 막지만, 저장 때 먼저 막아 고르는 자리에서 알린다.
 * 부르는 쪽이 '새로 지정'인지(첫 발행 전 + 제휴사 번호가 바뀜) 정한다. 지정할 수 있으면 null.
 */
export async function expiredPartnerError(db: SupabaseClient, partnerId: number, now: string): Promise<Response | null> {
  const { data, error } = await db.from("partners").select("id, name, contract_to").eq("id", partnerId).maybeSingle();
  if (error) throw dbError(error, "partners 읽기");
  if (!data) return null; // 없는 번호는 외래 키가 422로 막는다
  const partner = data as { id: number; name: string; contract_to: string | null };
  const reason = newPartnerBlocked(partner, kstDate(now));
  if (!reason) return null;
  return findingsError("계약이 끝난 제휴사는 새로 지정할 수 없습니다 (ART-10)", [
    finding("art10.partner-contract-expired", reason, { field: "partner", phrase: String(partner.id) }),
  ]);
}
