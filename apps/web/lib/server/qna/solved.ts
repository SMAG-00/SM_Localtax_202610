import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 해결 사례·분류 큐 관리 읽기 (W13-h, service_role). 질문 본문은 가림이 끝난 값뿐이고 작성자 번호는 읽지 않는다.
type Db = SupabaseClient;

export interface CandidateRow {
  question_id: number;
  tax_type: string;
  title: string;
  body: string;
  accepted_at: string | null;
  case_id: number | null;
  case_status: "draft" | "approved" | "unpublished" | null;
  situation: string;
  issue: string;
  result: string;
  lesson: string;
}
export interface ClassifyRow {
  id: number;
  question_id: number;
  proposed_tax_types: string[];
  pii_suspected: boolean;
  title: string;
  created_at: string;
}

export async function loadSolvedBoard(db: Db): Promise<{ candidates: CandidateRow[]; queue: ClassifyRow[] }> {
  const [qs, cs, ks] = await Promise.all([
    // 후보 = 동의한 질문 ∧ 공개 ∧ 채택됨
    db.from("qna_questions").select("id, tax_type, title, body, accepted_at").eq("solved_consent", true).eq("status", "open").not("accepted_answer_id", "is", null).order("accepted_at", { ascending: false }).limit(100),
    db.from("qna_solved_cases").select("id, question_id, situation, issue, result, lesson, status").limit(500),
    db.from("qna_classifications").select("id, question_id, proposed_tax_types, pii_suspected, created_at").eq("status", "proposed").order("created_at").limit(100),
  ]);
  for (const r of [qs, cs, ks]) if (r.error) throw dbError(r.error, "해결 사례 관리 조회");
  const cases = new Map(((cs.data ?? []) as { id: number; question_id: number; situation: string; issue: string; result: string; lesson: string; status: CandidateRow["case_status"] }[]).map((c) => [c.question_id, c]));
  const candidates = ((qs.data ?? []) as { id: number; tax_type: string; title: string; body: string; accepted_at: string | null }[]).map((q) => {
    const c = cases.get(q.id);
    return { question_id: q.id, tax_type: q.tax_type, title: q.title, body: q.body, accepted_at: q.accepted_at, case_id: c?.id ?? null, case_status: c?.status ?? null, situation: c?.situation ?? "", issue: c?.issue ?? "", result: c?.result ?? "", lesson: c?.lesson ?? "" };
  });
  const rows = (ks.data ?? []) as Omit<ClassifyRow, "title">[];
  const titles = new Map<number, string>();
  if (rows.length > 0) {
    const t = await db.from("qna_questions").select("id, title").in("id", rows.map((r) => r.question_id));
    if (t.error) throw dbError(t.error, "분류 큐 질문 조회");
    for (const q of (t.data ?? []) as { id: number; title: string }[]) titles.set(q.id, q.title);
  }
  return { candidates, queue: rows.map((r) => ({ ...r, title: titles.get(r.question_id) ?? "" })) };
}
