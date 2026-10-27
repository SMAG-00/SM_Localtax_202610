import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { throttleKey } from "@/lib/auth/throttle-key";
import { classifyQuestion } from "@/lib/qna/classify";
import { parseAnswerInput, parseQuestionInput, parseReportInput, reportDueAt } from "@/lib/qna/logic";
import { readAuthLimits, requireGuardSecret, throttleHit } from "@/lib/server/auth-guard";
import { requireViewer } from "@/lib/server/dal";
import { HttpError, errorJson, json, readJson } from "@/lib/server/http";
import { adminClient } from "@/lib/server/supabase";

// 라운지 회원 쓰기 (W13-g QNA-01·02·05, docs/dev/W13-g_설계.md) - 로그인한 회원 번호를 서버가 확인한 뒤 service_role로 쓴다.
//  · 라운지가 열려 있지 않으면(기능 키 qna ∧ 중립성 고지 승인) 404. 사용자별 쓰기 횟수 제한(form_ip 한도, 키는 회원 번호 해시)
//  · 본문은 가림이 끝난 글만 저장하고, 가림이 일어난 글은 게시 보류(pii). DB 트리거가 한 번 더 본다(개인정보 모양·배지·제재)
//  · 답변 배지 종류는 서버가 정한다: 유효한 SM 전문가 연결 -> expert, 인증 공공기관 메일 -> gov, 그 밖 member. 전문가 신청 경로는 없다
//  · 이 경로에 모델 호출 0, 질문 원문은 이벤트·로그에 남기지 않는다

interface Ctx {
  db: SupabaseClient;
  userId: string;
  body: Record<string, unknown>;
}

async function guarded(request: Request, run: (ctx: Ctx) => Promise<Response>): Promise<Response> {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const db = adminClient();
  if (!db) throw new HttpError(503, "서버 설정이 끝나지 않았습니다");
  const open = await db.rpc("qna_is_open");
  if (open.error) throw new HttpError(503, "라운지 상태를 확인하지 못했습니다");
  if (open.data !== true) return errorJson(404, "찾을 수 없습니다");
  const limits = await readAuthLimits(db);
  const hit = await throttleHit(db, "form_ip", throttleKey(requireGuardSecret(), "form_ip", `qna:${viewer.userId}`), limits.form_ip);
  if (!hit.allowed) return errorJson(429, "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요", { retry_after_seconds: hit.retryAfter });
  const body = await readJson(request);
  return run({ db, userId: viewer.userId, body });
}

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
function failWrite(error: { code?: string; message?: string }): Response {
  if (error.code === "23514") return errorJson(422, error.message ?? "저장 규칙에 맞지 않습니다");
  if (error.code === "23503") return errorJson(404, "대상을 찾을 수 없습니다");
  console.error("[qna] 쓰기 실패:", error.code);
  throw new HttpError(500, "저장하지 못했습니다 - 잠시 뒤 다시 시도하세요");
}

export const postQuestion = (request: Request) =>
  guarded(request, async ({ db, userId, body }) => {
    const parsed = parseQuestionInput(body);
    if (!parsed.ok) return invalid(parsed.errors);
    const v = parsed.value;
    const { data, error } = await db
      .from("qna_questions")
      .insert({
        author_id: userId,
        tax_type: v.taxType,
        title: v.title.text,
        body: v.body.text,
        masked_kinds: v.maskedKinds,
        status: v.held ? "held" : "open",
        hold_reason: v.held ? "pii" : null,
        solved_consent: v.solvedConsent,
      })
      .select("id, status")
      .single();
    if (error) return failWrite(error);
    // O5 분류 제안 (AIOPS-15) - 정규식만. 큐에 넣지 못해도 등록은 성공이다
    const q = data as { id: number };
    const c = classifyQuestion(v.title.text, v.body.text, v.maskedKinds);
    const prop = await db.rpc("qna_classify_propose", { p_question: q.id, p_tax_types: c.taxTypes, p_pii_suspected: c.piiSuspected });
    if (prop.error) console.error("[qna] 분류 제안 실패:", prop.error.code);
    return json({ question: data }, 201);
  });

/** 해결 사례 소개 동의 철회 (HOME-11) - 질문자 본인만. 철회하면 홈 해결 사례는 다음 요청부터 빠진다 */
export const postConsentWithdraw = (request: Request) =>
  guarded(request, async ({ db, userId, body }) => {
    const q = body.question_id;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1) return invalid(["question_id: 1 이상의 정수입니다"]);
    const { data, error } = await db.rpc("qna_solved_consent_withdraw", { p_question: q, p_user: userId });
    if (error) return failWrite(error);
    const r = data as { ok: boolean; code?: string };
    if (r.ok) return json({ withdrawn: true });
    return errorJson(r.code === "not_author" ? 403 : r.code === "no_consent" ? 409 : 404, "철회할 수 없습니다", { code: r.code });
  });

export const postAnswer = (request: Request) =>
  guarded(request, async ({ db, userId, body }) => {
    const qid = body.question_id;
    if (typeof qid !== "number" || !Number.isInteger(qid) || qid < 1) return invalid(["question_id: 1 이상의 정수입니다"]);
    const parsed = parseAnswerInput(body);
    if (!parsed.ok) return invalid(parsed.errors);
    const badge = await db.rpc("expert_badge_valid", { p_user: userId });
    if (badge.error) throw new HttpError(503, "배지 상태를 확인하지 못했습니다");
    const profileId = typeof badge.data === "number" ? badge.data : null;
    let kind: "expert" | "gov" | "member" = profileId !== null ? "expert" : "member";
    if (kind === "member") {
      const gov = await db.rpc("qna_gov_verified", { p_user: userId });
      if (gov.error) throw new HttpError(503, "인증 상태를 확인하지 못했습니다");
      if (gov.data === true) kind = "gov";
    }
    const v = parsed.value.body;
    const { data, error } = await db
      .from("qna_answers")
      .insert({
        question_id: qid,
        author_id: userId,
        author_kind: kind,
        expert_profile_id: kind === "expert" ? profileId : null,
        body: v.text,
        masked_kinds: v.maskedKinds,
        status: v.held ? "held" : "published",
        hold_reason: v.held ? "pii" : null,
      })
      .select("id, status")
      .single();
    if (error) return failWrite(error);
    return json({ answer: data, by_expert: kind === "expert" }, 201);
  });

export const postAccept = (request: Request) =>
  guarded(request, async ({ db, userId, body }) => {
    const q = body.question_id;
    const a = body.answer_id;
    if (typeof q !== "number" || typeof a !== "number" || !Number.isInteger(q) || !Number.isInteger(a) || q < 1 || a < 1) return invalid(["question_id·answer_id: 1 이상의 정수입니다"]);
    const { data, error } = await db.rpc("qna_accept", { p_question: q, p_answer: a, p_user: userId });
    if (error) return failWrite(error);
    const r = data as { ok: boolean; code?: string };
    if (r.ok) return json({ accepted: true });
    const status = r.code === "not_author" || r.code === "self_accept" ? 403 : r.code === "already_accepted" ? 409 : 404;
    return errorJson(status, "채택할 수 없습니다", { code: r.code });
  });

export const postReport = (request: Request) =>
  guarded(request, async ({ db, userId, body }) => {
    const parsed = parseReportInput(body);
    if (!parsed.ok) return invalid(parsed.errors);
    const v = parsed.value;
    const hol = await db.from("settings").select("value").eq("key", "business_holidays").maybeSingle();
    const holidays = Array.isArray(hol.data?.value) ? (hol.data!.value as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const { data, error } = await db.rpc("qna_report_create", {
      p_reporter: userId,
      p_type: v.targetType,
      p_target: v.targetId,
      p_reason: v.reason,
      p_note: v.note,
      p_due_at: reportDueAt(new Date(), holidays).toISOString(),
    });
    if (error) return failWrite(error);
    const r = data as { ok: boolean; code?: string };
    if (r.ok) return json({ reported: true }, 201);
    const status = r.code === "duplicate" ? 409 : r.code === "target_not_found" ? 404 : 422;
    return errorJson(status, "신고할 수 없습니다", { code: r.code });
  });
