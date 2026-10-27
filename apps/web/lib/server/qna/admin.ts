import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "@/lib/server/http";

// 라운지·계정 연결 관리 읽기 (W13-g, service_role). 글 본문은 가림이 끝난 값뿐이다. 회원 이메일은 읽지 않는다(계정 번호만).
type Db = SupabaseClient;

export interface LinkRow {
  id: number;
  user_id: string;
  expert_profile_id: number;
  profile_name: string;
  status: "active" | "revoked" | "expired";
  linked_by: string;
  linked_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
}

export async function loadLinkBoard(db: Db): Promise<{ links: LinkRow[]; publishedProfiles: { id: number; name: string; slug: string }[] }> {
  const [links, profiles] = await Promise.all([
    db.from("expert_verifications").select("id, user_id, expert_profile_id, status, linked_by, linked_at, expires_at, ended_at, ended_reason").order("id", { ascending: false }).limit(200),
    db.from("expert_profiles").select("id, name, slug").eq("status", "published").order("name").limit(200),
  ]);
  if (links.error) throw dbError(links.error, "expert_verifications 조회");
  if (profiles.error) throw dbError(profiles.error, "expert_profiles 조회");
  const names = new Map(((profiles.data ?? []) as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const missing = ((links.data ?? []) as { expert_profile_id: number }[]).map((l) => l.expert_profile_id).filter((id) => !names.has(id));
  if (missing.length > 0) {
    const more = await db.from("expert_profiles").select("id, name").in("id", [...new Set(missing)]);
    if (more.error) throw dbError(more.error, "expert_profiles 조회");
    for (const p of (more.data ?? []) as { id: number; name: string }[]) names.set(p.id, p.name);
  }
  return {
    links: ((links.data ?? []) as Omit<LinkRow, "profile_name">[]).map((l) => ({ ...l, profile_name: names.get(l.expert_profile_id) ?? `#${l.expert_profile_id}` })),
    publishedProfiles: (profiles.data ?? []) as { id: number; name: string; slug: string }[],
  };
}

export interface HeldItem {
  type: "question" | "answer";
  id: number;
  text: string;
  hold_reason: string;
  created_at: string;
}
export interface ReportItem {
  id: number;
  target_type: "question" | "answer";
  target_id: number;
  reason: string;
  note: string;
  due_at: string;
  created_at: string;
}
export interface SanctionItem {
  id: number;
  user_id: string;
  reason: string;
  started_at: string;
  ends_at: string | null;
}

export async function loadModerationBoard(db: Db): Promise<{ held: HeldItem[]; reports: ReportItem[]; sanctions: SanctionItem[] }> {
  const [hq, ha, rs, ss] = await Promise.all([
    db.from("qna_questions").select("id, title, body, hold_reason, created_at").eq("status", "held").order("created_at").limit(100),
    db.from("qna_answers").select("id, body, hold_reason, created_at").eq("status", "held").order("created_at").limit(100),
    db.from("qna_reports").select("id, target_type, target_id, reason, note, due_at, created_at").eq("status", "received").order("due_at").limit(200),
    db.from("qna_sanctions").select("id, user_id, reason, started_at, ends_at").is("lifted_at", null).order("started_at", { ascending: false }).limit(100),
  ]);
  for (const r of [hq, ha, rs, ss]) if (r.error) throw dbError(r.error, "라운지 관리 조회");
  const held: HeldItem[] = [
    ...((hq.data ?? []) as { id: number; title: string; body: string; hold_reason: string; created_at: string }[]).map((q) => ({ type: "question" as const, id: q.id, text: `${q.title}\n${q.body}`, hold_reason: q.hold_reason, created_at: q.created_at })),
    ...((ha.data ?? []) as { id: number; body: string; hold_reason: string; created_at: string }[]).map((a) => ({ type: "answer" as const, id: a.id, text: a.body, hold_reason: a.hold_reason, created_at: a.created_at })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    held,
    reports: (rs.data ?? []) as ReportItem[],
    sanctions: ((ss.data ?? []) as SanctionItem[]).filter((s) => s.ends_at === null || new Date(s.ends_at).getTime() > Date.now()),
  };
}
