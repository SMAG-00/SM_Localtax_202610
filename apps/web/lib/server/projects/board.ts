import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  currentStage,
  parseProjectTypes,
  parseStageLists,
  projectPublishErrors,
  stageKeysOf,
  usableProjectTypes,
  type ProjectEventKind,
  type ProjectEventRow,
  type ProjectTypes,
  type StageItem,
  type StageLists,
} from "@/lib/admin/project-rules";
import { readSetting } from "../admin/backoffice";
import { dbError } from "../http";

// 프로젝트 관리 화면 읽기 (W4 14단계 — PRD-01B PR-02 · PR-03, docs/dev/W4_설계.md 1장 14단계 · 5장 `/admin/projects`) — service_role로 표를 읽는다.
// 관리 API(GET)와 관리 화면이 같은 함수를 쓴다. 가격·분담금·수익률 칸은 표에 없으므로 읽지도 보이지도 않는다(PR-05).
//  · 사업 유형·단계 목록(운영 설정) — 비면 만들 수 없다는 안내(12장 #10)
//  · 목록 — 프로젝트마다 지역 이름·유형 글자·현재 단계(정정되지 않은 공개 단계 기록 중 가장 늦은 순서)·기록 수·상태
//  · 한 프로젝트 — 단계 기록 전부(정정 관계·메모·사유·기록자 — 편집 화면만), 기록마다 원문 검수 중(`검토 중`) 여부, 공개 조건 미달 사유

export const PROJECT_COLUMNS = "id, slug, name, region_code, project_type, landmark, summary, status, source_name, last_verified_at, created_by, created_at, updated_at";
export const EVENT_COLUMNS = "id, project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type, note, correction_of, reason, public, recorded_by, recorded_at";
const LIST_LIMIT = 200;

export interface ProjectRow {
  id: number;
  slug: string;
  name: string;
  region_code: string;
  project_type: string;
  landmark: boolean;
  summary: string | null;
  status: "draft" | "public" | "hidden";
  source_name: string | null;
  last_verified_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface EventRow extends ProjectEventRow {
  project_id: number;
  notice_no: string | null;
  notice_date: string | null;
  issuer: string | null;
  source_url: string | null;
  snapshot_id: number | null;
  license_type: string | null;
  note: string | null;
  reason: string | null;
  recorded_by: string;
}

export interface ProjectSettings {
  types: ProjectTypes | null;
  lists: StageLists | null;
  /** 단계 목록이 있는 유형 [키, 글자] — 비면 만들기 막음 */
  usable: [string, string][];
}

export interface ProjectListItem extends ProjectRow {
  region_name: string | null;
  type_label: string;
  current_stage: string | null;
  current_stage_label: string | null;
  events: number;
}

export interface EventView extends EventRow {
  stage_label: string | null;
  /** 이 기록을 정정한 기록 번호 (없으면 null) */
  corrected_by: number | null;
  /** 원문 검수 큐에 열린 항목이 있다 — `검토 중` */
  under_review: boolean;
}

export interface ProjectDetail {
  project: ProjectListItem;
  stages: StageItem[];
  events: EventView[];
  /** 지금 공개 전환을 막는 사유 (칸: 문장) — 빈 목록이면 공개할 수 있다 */
  publishBlockers: string[];
}

export async function loadProjectSettings(db: SupabaseClient): Promise<ProjectSettings> {
  const [t, l] = await Promise.all([readSetting(db, "project_types"), readSetting(db, "project_stage_lists")]);
  const types = parseProjectTypes(t?.value ?? null);
  const lists = parseStageLists(l?.value ?? null);
  return { types, lists, usable: usableProjectTypes(types, lists) };
}

const num = <T extends { id: unknown }>(r: T) => ({ ...r, id: Number(r.id) });
const eventRow = (e: Record<string, unknown>): EventRow =>
  ({
    ...e,
    id: Number(e.id),
    project_id: Number(e.project_id),
    snapshot_id: e.snapshot_id === null ? null : Number(e.snapshot_id),
    correction_of: e.correction_of === null ? null : Number(e.correction_of),
    kind: e.kind as ProjectEventKind,
  }) as EventRow;

function decorate(p: ProjectRow, settings: ProjectSettings, regionNames: Map<string, string>, events: readonly EventRow[]): ProjectListItem {
  const stages = settings.lists?.[p.project_type] ?? [];
  const keys = stages.map((s) => s.key);
  const current = currentStage(events, keys);
  return {
    ...p,
    region_name: regionNames.get(p.region_code) ?? null,
    type_label: settings.types?.[p.project_type]?.label ?? p.project_type,
    current_stage: current?.stage ?? null,
    current_stage_label: current ? (stages.find((s) => s.key === current.stage)?.label ?? current.stage) : null,
    events: events.length,
  };
}

async function regionNames(db: SupabaseClient, codes: readonly string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const { data, error } = await db.from("regions").select("code, name").in("code", [...new Set(codes)]);
  if (error) throw dbError(error, "regions 이름");
  return new Map(((data ?? []) as { code: string; name: string }[]).map((r) => [r.code, r.name]));
}

/** 목록 — 최근 고친 순 200건 */
export async function listProjects(db: SupabaseClient, settings: ProjectSettings): Promise<ProjectListItem[]> {
  const { data, error } = await db.from("projects").select(PROJECT_COLUMNS).order("updated_at", { ascending: false }).order("id", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw dbError(error, "projects 목록");
  const projects = ((data ?? []) as ProjectRow[]).map(num);
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [ev, names] = await Promise.all([db.from("project_events").select(EVENT_COLUMNS).in("project_id", ids).order("id"), regionNames(db, projects.map((p) => p.region_code))]);
  if (ev.error) throw dbError(ev.error, "project_events 목록");
  const events = ((ev.data ?? []) as Record<string, unknown>[]).map(eventRow);
  return projects.map((p) => decorate(p, settings, names, events.filter((e) => e.project_id === p.id)));
}

/** 프로젝트 하나 — 없으면 null */
export async function loadProject(db: SupabaseClient, id: number, settings: ProjectSettings): Promise<ProjectDetail | null> {
  const { data, error } = await db.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "projects 하나");
  if (!data) return null;
  const project = num(data as ProjectRow);
  const ev = await db.from("project_events").select(EVENT_COLUMNS).eq("project_id", id).order("id");
  if (ev.error) throw dbError(ev.error, "project_events 하나");
  const events = ((ev.data ?? []) as Record<string, unknown>[]).map(eventRow);
  const eventIds = events.map((e) => e.id);
  const [names, queue] = await Promise.all([
    regionNames(db, [project.region_code]),
    eventIds.length
      ? db.from("source_review_queue").select("target_id").eq("target_type", "project_event").eq("status", "open").in("target_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (queue.error) throw dbError(queue.error, "source_review_queue 단계 기록");
  const reviewing = new Set(((queue.data ?? []) as { target_id: number | string }[]).map((r) => Number(r.target_id)));
  const stages = settings.lists?.[project.project_type] ?? [];
  const correctedBy = new Map(events.flatMap((e) => (e.correction_of === null ? [] : [[e.correction_of, e.id] as [number, number]])));
  const keys = stageKeysOf(settings.lists, project.project_type);
  return {
    project: decorate(project, settings, names, events),
    stages,
    events: events.map((e) => ({
      ...e,
      stage_label: e.stage === null ? null : (stages.find((s) => s.key === e.stage)?.label ?? e.stage),
      corrected_by: correctedBy.get(e.id) ?? null,
      under_review: reviewing.has(e.id),
    })),
    publishBlockers: projectPublishErrors(project, events, keys),
  };
}
