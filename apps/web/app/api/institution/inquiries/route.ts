import { isSameSiteRequest } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";
import { validateInquiry } from "@/lib/server/org/logic";
import { featureOn, submitInquiry } from "@/lib/server/org/service";
import { adminClient } from "@/lib/server/supabase";

// 기관 견적 요청 접수 (W11-f, BIZ-07) - 비회원도 낼 수 있다.
//  · 연락 동의(필수) 없음·이메일 형식 오류는 422, 소식 수신 동의는 별도(기본 해제)이고 거부해도 접수된다.
//  · 보존 기간은 설정 institution_inquiry_policy(기본 1년 [법률 검토]), 파기는 작업 institution-inquiry-purge.
//  · 기능 키 institution_inquiry·institution_subscription이 꺼져 있으면 404. 응답에는 접수번호만 담는다.
export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  if (!isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 보낸 요청은 받지 않습니다");
  const db = adminClient();
  if (!db) return errorJson(503, "서버 설정이 끝나지 않았습니다");
  if (!(await featureOn(db, "institution_inquiry"))) return errorJson(404, "찾을 수 없습니다");
  const checked = validateInquiry(await readJson(request));
  if (!checked.ok) return errorJson(422, "입력값을 확인하세요", { errors: checked.errors });
  const r = await submitInquiry(db, checked.value);
  if (!r.ok) return errorJson(r.status, r.message, { code: r.code });
  return json({ receiptNo: r.value.receiptNo }, 201);
});
