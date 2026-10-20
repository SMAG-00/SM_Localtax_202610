import { CODE_MESSAGES, checkFillToken, parseSignupInput, type SignupCode } from "@/lib/auth/signup-input";
import { normalizeEmailKey, throttleKey } from "@/lib/auth/throttle-key";
import { readAuthLimits, readMemberSettings, requestIp, requireGuardSecret, signupOpen, throttleHit } from "@/lib/server/auth-guard";
import { isSameSiteRequest } from "@/lib/server/dal";
import { HttpError, errorJson, handle, json } from "@/lib/server/http";
import { sendMail } from "@/lib/server/mail";
import { siteBase } from "@/lib/server/site-base";
import { adminClient } from "@/lib/server/supabase";

// 가입 (W2-e 설계 4.3 · 4.5) — 앱이 auth.admin.generateLink로 일회용 토큰을 받아 자기 메일 모듈로 보낸다(Supabase 기본 메일을 쓰지 않는다).
//  · 닫혀 있으면(members 기능 키 꺼짐 또는 메일 설정 없음) 404
//  · 순서: 같은 사이트(Origin 필수) → 숨은 칸·폼 열림 토큰(최소 작성 시간·유효 시간) → 입력 검사 → signup_ip·signup_email 횟수 → 계정 만들기 → 프로필·동의 → 메일
//  · 가입 요청의 역할·메타데이터는 읽지 않는다(알려진 칸만 읽고, generateLink에 data를 주지 않는다). 이미 가입된 이메일이면 계정을 만들지 않고 안내 메일만 — 응답은 두 경우 같은 문장
//  · 메일을 못 보내면 만든 임시 계정을 지우고 503 (로그인은 메일과 무관)
//  · 일반 HTML 폼(JS 없이 동작)이면 303으로 /signup 화면에 돌아가고, JSON이면 JSON으로 답한다
export const dynamic = "force-dynamic";

const STATUS: Partial<Record<SignupCode, number>> = { bot: 422, too_many: 429, mail_down: 503 };

async function readBody(request: Request, isForm: boolean): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 20_000) throw new HttpError(413, "요청 본문이 너무 큽니다");
  if (isForm) {
    const params = new URLSearchParams(text);
    return {
      email: params.get("email") ?? "",
      password: params.get("password") ?? "",
      displayName: params.get("displayName") ?? "",
      agreeTerms: params.get("agreeTerms") ?? "",
      agreePrivacy: params.get("agreePrivacy") ?? "",
      interests: params.getAll("interests"),
      regionCodes: params.getAll("regionCodes"),
      website: params.get("website") ?? "",
      fill: params.get("fill") ?? "",
    };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // 아래에서 400
  }
  throw new HttpError(400, "요청 본문이 JSON 객체가 아닙니다");
}

export const POST = handle(async (request: Request) => {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm = contentType.startsWith("application/x-www-form-urlencoded");
  if (!isForm && !contentType.startsWith("application/json")) return errorJson(415, "요청 본문은 application/json 또는 폼이어야 합니다");
  if (request.headers.get("origin") === null || !isSameSiteRequest(request)) return errorJson(403, "다른 사이트에서 온 요청은 받지 않습니다");

  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  if (!(await signupOpen(db))) return errorJson(404, "찾을 수 없습니다");
  const secret = requireGuardSecret();

  const reply = (code: SignupCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => {
    if (isForm) return new Response(null, { status: 303, headers: { location: code === "sent" ? "/signup?sent=1" : `/signup?e=${code}`, ...headers } });
    const status = code === "sent" ? 200 : (STATUS[code] ?? 422);
    const response = status === 200 ? json({ ok: true, message: CODE_MESSAGES[code] }) : errorJson(status, CODE_MESSAGES[code], { code, ...extra });
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const raw = await readBody(request, isForm);
  if ((typeof raw.website === "string" && raw.website !== "") || checkFillToken(secret, raw.fill, Date.now()) !== "ok") return reply("bot");

  const [limits, member] = await Promise.all([readAuthLimits(db), readMemberSettings(db)]);
  const parsed = parseSignupInput(raw, {
    password: { minChars: member.passwordMinChars, maxBytes: member.passwordMaxBytes },
    displayNameChars: member.displayNameChars,
    interestMax: member.interestMax,
    interestRegionLimit: member.interestRegionLimit,
  });
  if (!parsed.ok) return reply(parsed.code, { field: parsed.field });
  const { email, password, displayName, interests, regionCodes } = parsed.value;

  const hits = await Promise.all([
    throttleHit(db, "signup_ip", throttleKey(secret, "signup_ip", requestIp(request)), limits.signup_ip),
    throttleHit(db, "signup_email", throttleKey(secret, "signup_email", normalizeEmailKey(email)), limits.signup_email),
  ]);
  const blocked = hits.filter((h) => !h.allowed);
  if (blocked.length > 0) {
    const wait = Math.max(...blocked.map((h) => h.retryAfter));
    return reply("too_many", { retry_after_seconds: wait }, { "retry-after": String(wait) });
  }

  const base = siteBase(request);
  if (!base) {
    console.error("[signup] 사이트 주소를 정할 수 없습니다 (NEXT_PUBLIC_SITE_URL)");
    return reply("mail_down");
  }

  // 이미 계정이 있으면 generateLink를 부르지 않는다 — generateLink(signup)는 있는 이메일에도 오류 없이 그 계정을 돌려주므로,
  // 부르면 기존 계정을 건드리거나 실패 정리 때 지울 수 있다. 안내 메일만 보내고 응답은 새 가입과 같은 문장.
  const state = await db.rpc("auth_email_state", { p_email: email });
  if (state.error || typeof state.data !== "string") {
    console.error("[signup] 계정 상태 확인 실패:", state.error?.code);
    return reply("mail_down");
  }
  if (state.data !== "none") {
    const sent = await sendMail({ to: email, template: "signup_exists_notice", vars: { loginUrl: `${base}/login` } });
    return reply(sent.ok ? "sent" : "mail_down");
  }

  // 메타데이터(data)는 주지 않는다 — 가입 요청이 보낸 역할·권한 값은 어디에도 들어가지 않는다 (ACC-04)
  const { data, error } = await db.auth.admin.generateLink({ type: "signup", email, password });
  if (error || !data?.user || !data.properties?.hashed_token) {
    console.error("[signup] 계정 만들기 실패:", error?.code, error?.status);
    return reply("mail_down");
  }
  const userId = data.user.id;
  const undo = () => db.auth.admin.deleteUser(userId).catch(() => undefined);

  const profile = await db.from("profiles").insert({ id: userId, display_name: displayName, interests, interest_region_codes: regionCodes });
  if (profile.error) {
    await undo();
    console.error("[signup] 프로필 저장 실패:", profile.error.code);
    return reply(["22023", "23514", "P0001"].includes(profile.error.code) ? "interests" : "mail_down");
  }
  const consent = await db.from("consents").insert({ user_id: userId, kind: "signup", channel: "web_signup" });
  if (consent.error) {
    await undo();
    console.error("[signup] 동의 기록 실패:", consent.error.code);
    return reply("mail_down");
  }

  const link = `${base}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=signup`;
  const sent = await sendMail({ to: email, template: "signup_confirm", vars: { link } });
  if (!sent.ok) {
    await undo();
    return reply("mail_down");
  }
  return reply("sent");
});

