import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplyPublishErrors, type SupplyStatus } from "@/lib/admin/supply-rules";
import { dbError } from "../http";

// 분양 정보 관리 화면 읽기 (W4 17단계 — PRD-01B PR-04, docs/dev/W4_설계.md 1장 17단계 · 5장 `/admin/supply`) — service_role로 표를 읽는다.
// 관리 API(GET)와 관리 화면이 같은 함수를 쓴다. 가격 칸은 표에 없으므로 읽지도 보이지도 않는다(PR-05).

export const SUPPLY_COLUMNS =
  "id, name, region_code, project_id, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url, verified_at, license_type, status, created_by, updated_by, created_at, updated_at";
const LIST_LIMIT = 200;

export interface SupplyRow {
  id: number;
  name: string;
  region_code: string;
  project_id: number | null;
  supply_scale: string | null;
  apply_start: string;
  apply_end: string;
  notice_date: string;
  notice_issuer: string;
  official_notice_url: string;
  verified_at: string | null;
  license_type: string;
  status: SupplyStatus;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface SupplyBoardItem extends SupplyRow {
  region_name: string | null;
  project_name: string | null;
  /** 공개 조건 미달 사유 (칸마다 "칸: 문장") — 비면 공개할 수 있다 */
  publish_problems: string[];
}

const toRow = (r: SupplyRow): SupplyRow => ({ ...r, id: Number(r.id), project_id: r.project_id === null ? null : Number(r.project_id) });

async function decorate(db: SupabaseClient, rows: SupplyRow[]): Promise<SupplyBoardItem[]> {
  const codes = [...new Set(rows.map((r) => r.region_code))];
  const projectIds = [...new Set(rows.flatMap((r) => (r.project_id === null ? [] : [r.project_id])))];
  const [regions, projects] = await Promise.all([
    codes.length ? db.from("regions").select("code, name, parent_code").in("code", codes) : null,
    projectIds.length ? db.from("projects").select("id, name").in("id", projectIds) : null,
  ]);
  if (regions?.error) throw dbError(regions.error, "regions 읽기");
  if (projects?.error) throw dbError(projects.error, "projects 읽기");
  const regionName = new Map(((regions?.data ?? []) as { code: string; name: string }[]).map((r) => [r.code, r.name]));
  const projectName = new Map(((projects?.data ?? []) as { id: number; name: string }[]).map((p) => [Number(p.id), p.name]));
  return rows.map((r) => ({
    ...r,
    region_name: regionName.get(r.region_code) ?? null,
    project_name: r.project_id === null ? null : (projectName.get(r.project_id) ?? null),
    publish_problems: supplyPublishErrors(r),
  }));
}

/** 목록 — 최근 고친 순 200건 */
export async function listSupply(db: SupabaseClient): Promise<SupplyBoardItem[]> {
  const { data, error } = await db.from("supply_notices").select(SUPPLY_COLUMNS).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw dbError(error, "supply_notices 목록");
  return decorate(db, ((data ?? []) as SupplyRow[]).map(toRow));
}

/** 하나 — 없으면 null */
export async function loadSupply(db: SupabaseClient, id: number): Promise<SupplyBoardItem | null> {
  const { data, error } = await db.from("supply_notices").select(SUPPLY_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "supply_notices 하나");
  if (!data) return null;
  const [item] = await decorate(db, [toRow(data as SupplyRow)]);
  return item ?? null;
}
