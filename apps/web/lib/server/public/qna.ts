import "server-only";
import { parseStripCriteria, selectStrip, type ActivityRow, type StripCriteria } from "@/lib/qna/logic";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 라운지 W13-g 공개 읽기 (QNA-01·02·04·06·08). 공개 뷰 public_qna_* · public_expert_activity만 anon 키로 읽는다.
// 열림 판정은 뷰 한 곳: 기능 키 qna ∧ 중립성 고지 승인 - 닫혀 있으면 고지 뷰가 0행이라 화면은 404다.
// 작성자 번호·연락처·사무소는 어떤 뷰에도 없다. 전문가 연결은 1단계 두 링크(/experts · /experts/request)뿐이다.

export interface QnaNotice {
  version: string;
  text: string;
  answerFooter: string;
}
export interface QnaLinks {
  /** 1단계 SM 전문가 소개 */
  expertsHref: "/experts";
  /** 1단계 SM 전문가 연락 요청 - 기능 키 expert_requests가 켜져 있을 때만 */
  requestHref: "/experts/request" | null;
}

async function readNotice(): Promise<QnaNotice | null> {
  const rows = await rowsOf<{ version: string; text: string; answer_footer: string }>(publicDb().from("public_qna_notice").select("version, text, answer_footer"), "라운지 고지");
  const r = rows[0];
  return r ? { version: r.version, text: r.text, answerFooter: r.answer_footer } : null;
}

async function links(): Promise<QnaLinks> {
  const features = (await readPublicSettings()).features;
  return { expertsHref: "/experts", requestHref: features.expert_requests ? "/experts/request" : null };
}

export interface StripItem {
  expertProfileId: number;
  name: string;
  answeredCount: number;
  acceptedCount: number;
  profileHref: string | null;
}

async function readActivity(): Promise<{ rows: (ActivityRow & { profileSlug: string | null })[]; criteria: StripCriteria | null; rawCriteria: Record<string, unknown> }> {
  const [acts, crit] = await Promise.all([
    rowsOf<{ expert_profile_id: number; name: string; answered_count: number; accepted_count: number; acceptance_rate: number | string; profile_slug: string | null }>(
      publicDb().from("public_expert_activity").select("expert_profile_id, name, answered_count, accepted_count, acceptance_rate, profile_slug").limit(500),
      "활동 전문가",
    ),
    rowsOf<{ criteria: unknown }>(publicDb().from("public_qna_criteria").select("criteria"), "활동 기준"),
  ]);
  const raw = crit[0]?.criteria;
  return {
    rows: acts.map((a) => ({
      expertProfileId: a.expert_profile_id,
      name: a.name,
      answeredCount: a.answered_count,
      acceptedCount: a.accepted_count,
      acceptanceRate: Number(a.acceptance_rate),
      profileSlug: a.profile_slug,
    })),
    criteria: parseStripCriteria(raw),
    rawCriteria: typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {},
  };
}

export interface QuestionItem {
  id: number;
  taxType: string;
  title: string;
  createdAt: string;
  resolved: boolean;
  answerCount: number;
}
export interface QnaListView {
  open: boolean;
  notice: QnaNotice | null;
  links: QnaLinks;
  strip: StripItem[];
  questions: QuestionItem[];
}

export async function getQnaList(): Promise<QnaListView> {
  const notice = await readNotice();
  const l = await links();
  if (!notice) return { open: false, notice: null, links: l, strip: [], questions: [] };
  const [act, qs] = await Promise.all([
    readActivity(),
    rowsOf<{ id: number; tax_type: string; title: string; created_at: string; resolved: boolean; answer_count: number }>(
      publicDb().from("public_qna_questions").select("id, tax_type, title, created_at, resolved, answer_count").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50),
      "라운지 질문",
    ),
  ]);
  const slugOf = new Map(act.rows.map((r) => [r.expertProfileId, r.profileSlug]));
  return {
    open: true,
    notice,
    links: l,
    strip: selectStrip(act.rows, act.criteria).map((r) => ({
      expertProfileId: r.expertProfileId,
      name: r.name,
      answeredCount: r.answeredCount,
      acceptedCount: r.acceptedCount,
      profileHref: slugOf.get(r.expertProfileId) ? `/experts/profile/${encodeURIComponent(slugOf.get(r.expertProfileId)!)}` : null,
    })),
    questions: qs.map((q) => ({ id: q.id, taxType: q.tax_type, title: q.title, createdAt: q.created_at, resolved: q.resolved, answerCount: q.answer_count })),
  };
}

export interface AnswerItem {
  id: number;
  body: string;
  createdAt: string;
  accepted: boolean;
  kind: "expert" | "gov" | "member";
  expertName: string | null;
  expertProfileId: number | null;
}
export interface QnaQuestionView {
  open: boolean;
  notice: QnaNotice | null;
  links: QnaLinks;
  question: (QuestionItem & { body: string }) | null;
  answers: AnswerItem[];
}

export async function getQnaQuestion(id: number): Promise<QnaQuestionView> {
  const notice = await readNotice();
  const l = await links();
  if (!notice) return { open: false, notice: null, links: l, question: null, answers: [] };
  const [qs, as] = await Promise.all([
    rowsOf<{ id: number; tax_type: string; title: string; body: string; created_at: string; resolved: boolean; answer_count: number }>(
      publicDb().from("public_qna_questions").select("id, tax_type, title, body, created_at, resolved, answer_count").eq("id", id).limit(1),
      "라운지 질문",
    ),
    rowsOf<{ id: number; body: string; created_at: string; accepted: boolean; display_kind: "expert" | "gov" | "member"; expert_name: string | null; expert_profile_id: number | null }>(
      publicDb().from("public_qna_answers").select("id, body, created_at, accepted, display_kind, expert_name, expert_profile_id").eq("question_id", id).order("created_at").order("id").limit(200),
      "라운지 답변",
    ),
  ]);
  const q = qs[0];
  return {
    open: true,
    notice,
    links: l,
    question: q ? { id: q.id, taxType: q.tax_type, title: q.title, body: q.body, createdAt: q.created_at, resolved: q.resolved, answerCount: q.answer_count } : null,
    answers: as.map((a) => ({ id: a.id, body: a.body, createdAt: a.created_at, accepted: a.accepted, kind: a.display_kind, expertName: a.expert_name, expertProfileId: a.expert_profile_id })),
  };
}

export interface QnaCriteriaView {
  open: boolean;
  notice: QnaNotice | null;
  /** 설정 qna_criteria 그대로 (비어 있으면 {}) */
  criteria: Record<string, unknown>;
  configured: boolean;
}

export async function getQnaCriteria(): Promise<QnaCriteriaView> {
  const notice = await readNotice();
  if (!notice) return { open: false, notice: null, criteria: {}, configured: false };
  const act = await readActivity();
  return { open: true, notice, criteria: act.rawCriteria, configured: act.criteria !== null };
}

export interface QnaExpertView {
  open: boolean;
  notice: QnaNotice | null;
  links: QnaLinks;
  expert: { id: number; name: string; answeredCount: number; acceptedCount: number; acceptanceRate: number; profileHref: string | null } | null;
}

/** 라운지 전문가 프로필 (QNA-04) - 자격 배지·답변 수·채택률과 1단계 프로필 링크뿐. 연락처·사무소·외부 링크 0 */
export async function getQnaExpert(profileId: number): Promise<QnaExpertView> {
  const notice = await readNotice();
  const l = await links();
  if (!notice) return { open: false, notice: null, links: l, expert: null };
  const act = await readActivity();
  const r = act.rows.find((x) => x.expertProfileId === profileId);
  return {
    open: true,
    notice,
    links: l,
    expert: r
      ? { id: r.expertProfileId, name: r.name, answeredCount: r.answeredCount, acceptedCount: r.acceptedCount, acceptanceRate: r.acceptanceRate, profileHref: r.profileSlug ? `/experts/profile/${encodeURIComponent(r.profileSlug)}` : null }
      : null,
  };
}
