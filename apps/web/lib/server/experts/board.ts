import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { dbError } from "@/lib/server/http";
import { parseFeatures } from "@/lib/server/public/settings";

// 전문가 관리 보드 (W7c - /admin/experts, /api/admin/experts GET). service_role로 읽는다.
// 요청의 이름·연락처·요약은 목록에 싣지 않고, 관리자가 상세를 열 때만(열람 감사 1행) 읽는다 (EXPL-19).

type Db = SupabaseClient;

export interface BoardCategory {
  code: string;
  name: string;
  sort_order: number;
  active: boolean;
}
export interface BoardProfile {
  id: number;
  slug: string;
  name: string;
  category_codes: string[];
  specialties: string[];
  office_name: string;
  regions: string[];
  contact_links: { label: string; url: string }[];
  interests: string;
  intro: string;
  house_relation: string;
  photo_media_id: number | null;
  status: "draft" | "published" | "withdrawn";
  consent_version: string | null;
  consent_on: string | null;
  consent_doc_ref: string | null;
  published_by: string | null;
  withdrawn_reason: string | null;
  updated_at: string;
}
export interface BoardRequest {
  id: number;
  receipt_no: string;
  source: string;
  category_code: string;
  status: "received" | "contacted" | "closed";
  close_reason: string | null;
  due_at: string;
  first_contact_at: string | null;
  created_at: string;
  purged: boolean;
  /** 목표 시간이 지났는데 첫 연락 기록이 없다 (EXPL-18 - 경보 표시) */
  overdue: boolean;
}

export interface ExpertBoard {
  flags: { experts: boolean; expert_requests: boolean };
  notice: Record<string, unknown>;
  policy: Record<string, unknown>;
  categories: BoardCategory[];
  profiles: BoardProfile[];
  requests: BoardRequest[];
  /** 목표 시간 안 연락률 = 마감 전 첫 연락 / 접수 (EXPL-18 - 분모·분자 표시) */
  contactRate: { onTime: number; total: number };
}

const PROFILE_COLUMNS =
  "id, slug, name, category_codes, specialties, office_name, regions, contact_links, interests, intro, house_relation, photo_media_id, status, consent_version, consent_on, consent_doc_ref, published_by, withdrawn_reason, updated_at";
const REQUEST_COLUMNS = "id, receipt_no, source, category_code, status, close_reason, due_at, first_contact_at, created_at, purged_at";

async function setting(db: Db, key: string): Promise<Record<string, unknown>> {
  const { data, error } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  if (error) throw dbError(error, `settings ${key} 읽기`);
  const v = (data as { value?: unknown } | null)?.value;
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function loadExpertBoard(db: Db, opts: { withRequests: boolean; now?: Date }): Promise<ExpertBoard> {
  const now = opts.now ?? new Date();
  const [flagsRow, notice, policy, cats, profs] = await Promise.all([
    setting(db, "feature_flags"),
    setting(db, "expert_notice"),
    setting(db, "expert_request_policy"),
    db.from("expert_categories").select("code, name, sort_order, active").order("sort_order").order("code"),
    db.from("expert_profiles").select(PROFILE_COLUMNS).order("id"),
  ]);
  if (cats.error) throw dbError(cats.error, "expert_categories 읽기");
  if (profs.error) throw dbError(profs.error, "expert_profiles 읽기");
  const features = parseFeatures(flagsRow);
  let requests: BoardRequest[] = [];
  let contactRate = { onTime: 0, total: 0 };
  if (opts.withRequests) {
    const { data, error } = await db.from("expert_requests").select(REQUEST_COLUMNS).order("id", { ascending: false }).limit(300);
    if (error) throw dbError(error, "expert_requests 읽기");
    requests = ((data ?? []) as (Omit<BoardRequest, "purged" | "overdue"> & { purged_at: string | null })[]).map((r) => {
      const { purged_at, ...rest } = r;
      const overdue = r.status === "received" && new Date(r.due_at).getTime() < now.getTime();
      return { ...rest, purged: purged_at !== null, overdue };
    });
    const total = requests.filter((r) => r.close_reason !== "withdrawn").length;
    const onTime = requests.filter((r) => r.first_contact_at !== null && new Date(r.first_contact_at).getTime() <= new Date(r.due_at).getTime()).length;
    contactRate = { onTime, total };
  }
  return {
    flags: { experts: features.experts, expert_requests: features.expert_requests },
    notice,
    policy,
    categories: (cats.data ?? []) as BoardCategory[],
    profiles: (profs.data ?? []) as BoardProfile[],
    requests,
    contactRate,
  };
}

export interface RequestDetail {
  id: number;
  receipt_no: string;
  source: string;
  category_code: string;
  summary: string | null;
  summary_origin: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  preferred_time: string | null;
  deadline_urgent: boolean;
  consent_version: string;
  consented_at: string;
  performing_entity: string | null;
  scope_noted: boolean;
  status: "received" | "contacted" | "closed";
  close_reason: string | null;
  first_contact_at: string | null;
  due_at: string;
  retention_until: string;
  purged_at: string | null;
  created_at: string;
  events: { from_status: string | null; to_status: string; actor: string; note: string | null; at: string }[];
}

/** 요청 상세 - 열 때마다 열람 감사 1행 (EXPL-19: 누가·언제·어느 요청). 없으면 null */
export async function openRequestDetail(db: Db, id: number, viewer: { userId: string }): Promise<RequestDetail | null> {
  const { data, error } = await db.from("expert_requests").select("*").eq("id", id).maybeSingle();
  if (error) throw dbError(error, "expert_requests 읽기");
  if (!data) return null;
  const ev = await db.from("expert_request_events").select("from_status, to_status, actor, note, at").eq("request_id", id).order("id");
  if (ev.error) throw dbError(ev.error, "expert_request_events 읽기");
  const row = data as Omit<RequestDetail, "events">;
  await writeAudit(db, { actor: actorOf(viewer), action: "expert.request.view", target: `expert_requests:${id}`, before: null, after: { receipt_no: row.receipt_no }, reason: "전문가 연락 요청 열람" });
  return { ...row, events: (ev.data ?? []) as RequestDetail["events"] };
}
