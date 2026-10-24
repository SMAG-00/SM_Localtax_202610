import { throttleKey } from "@/lib/auth/throttle-key";
import { isSameSiteRequest } from "@/lib/server/dal";
import { readAuthLimits, requestIp, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { parseFeatures } from "@/lib/server/public/settings";
import { adminClient } from "@/lib/server/supabase";

// SM 전문가 연락 요청 철회 (W7c - PRD-01C EXPL-21) - POST /api/experts/requests/withdraw {receipt, contact}
//  · 접수 번호 + 요청 때 적은 이메일 또는 전화로 본인을 확인하면 상태를 '이용자 철회'로 종결하고 이름·연락처·요약을 바로 지운다 (DB 함수 expert_request_withdraw)
//  · 맞지 않으면 이유를 구별하지 않고 같은 답 (접수 번호 추측 방지). 횟수 제한은 form_ip
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isJson = contentType.startsWith("application/json");
  const isForm = contentType.startsWith("application/x-www-form-urlencoded") || contentType.startsWith("multipart/form-data");
  if (!isJson && !isForm) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const flags = await db.from("settings").select("value").eq("key", "feature_flags").maybeSingle();
  const features = parseFeatures(flags.data?.value);
  if (!features.experts || !features.expert_requests) return errorJson(404, "찾을 수 없습니다");

  const fields: Record<string, unknown> = {};
  if (isJson) {
    try {
      const v: unknown = JSON.parse(await request.text());
      if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not object");
      Object.assign(fields, v);
    } catch {
      throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
    }
  } else {
    for (const [k, v] of (await request.formData()).entries()) if (typeof v === "string") fields[k] = v;
  }
  const done = (ok: boolean, status: number): Response =>
    isJson ? (ok ? json({ ok: true }) : errorJson(status, status === 429 ? "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요" : "접수 번호나 연락처가 맞지 않습니다")) : new Response(null, { status: 303, headers: { location: `/experts/request?withdrawn=${ok ? "ok" : "fail"}` } });

  const limits = await readAuthLimits(db);
  const hit = await throttleHit(db, "form_ip", throttleKey(requireGuardSecret(), "form_ip", requestIp(request)), limits.form_ip);
  if (!hit.allowed) return done(false, 429);
  const receipt = typeof fields.receipt === "string" ? fields.receipt.trim() : "";
  const contact = typeof fields.contact === "string" ? fields.contact.trim() : "";
  if (receipt === "" || contact === "" || receipt.length > 20 || contact.length > 120) return done(false, 422);
  const r = await db.rpc("expert_request_withdraw", { p_receipt: receipt, p_contact: contact });
  if (r.error) {
    console.error("[experts] 철회 실패:", r.error.code);
    return done(false, 422);
  }
  return done(r.data === true, 422);
});
