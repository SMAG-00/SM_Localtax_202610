import { isoToKstDate } from "@/lib/admin/form-utils";
import { idOf, parseCreateProject, parseEventRequest, parseProjectLink, parsePublish, projectPublishErrors, stageKeysOf, type ProjectEventRow } from "@/lib/admin/project-rules";
import { snapshotHash } from "@/lib/source-review/fetch";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { EVENT_COLUMNS, PROJECT_COLUMNS, listProjects, loadProject, loadProjectSettings, type ProjectRow } from "@/lib/server/projects/board";
import { runLinkOp } from "@/lib/server/regional-links/ops";

// 프로젝트 관리 (W4 14단계 — PRD-01B PR-02 · PR-03 · PR-05, docs/dev/W4_설계.md 1장 14단계 · 4장 `/api/admin/projects` · 6장 · 12장 110번~).
// 모두 편집 책임자·관리자(PO)만(project.manage — 기자·감수위원·광고·협찬·브랜드 담당 등은 입력을 보기 전에 403 + 거부 감사).
// 칸 이름은 DB 칸 이름(snake_case)과 같고, 규칙 위반은 칸마다 "칸: 문장"(422 errors). 서비스를 건너뛴 쓰기는 DB 제약·트리거가 막는다(설계 8장).
// 가격·분양가·분담금·수익률·시세는 받는 칸이 없다 — 그런 이름의 칸을 보내면 422(PR-05). 메모의 숫자 + 원·%는 저장하고 warnings로 알린다.
//  · GET — 사업 유형 준비(usable — 비면 만들 수 없다는 안내)·프로젝트 목록 / GET ?id=N — 프로젝트 하나(단계 목록·기록 전부·`검토 중`·공개 조건 미달 사유)
//  · POST op=create { slug, name, region_code, project_type, landmark?, summary?, source_name? } — 초안으로 만든다. 감사 project.create
//  · POST op=event { project_id, kind?(stage·not_applicable), stage, notice_no, notice_date, issuer, source_url, snapshot_payload | snapshot_id, license_type, note?, public?, reason? }
//      — 단계 기록(고시 6칸 필수)·해당 없는 단계(사유 필수). 같은 단계·앞 순서 거부. 감사 project.record_event
//  · POST op=correct { project_id, correction_of, reason, stage?, (단계가 있으면 고시 6칸), public?, note? } — 정정은 사유 + 한 번만(바꿔 적기·거두기). 감사 project.correct_event
//  · POST op=publish { project_id, status(public·hidden), source_name?, verified? } — 공개(공개 단계 1건 + 데이터 출처 + 정보 확인일)·내리기. 감사 project.publish
//  · POST op=link { project_id, linkOp(suggest·create·confirm·remove), … } — 13단계 지역 연결과 같은 작업(출발 = 그 프로젝트, lib/server/regional-links/ops.ts)
// 공개 전환·단계 기록은 공개 뷰(public_projects · public_project_events)에 바로 반영되므로 공개 데이터 캐시를 만료한다.
export const dynamic = "force-dynamic";

const todayKst = () => isoToKstDate(nowIso());

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const raw = new URL(request.url).searchParams.get("id");
  const denied = await authorize(viewer, "project.manage", raw ? targetOf.project(raw.slice(0, 20)) : "projects:list");
  if (denied) return denied;
  const db = serviceDb();
  const settings = await loadProjectSettings(db);
  if (raw !== null) {
    const id = idOf(raw);
    if (id === null) return errorJson(404, "프로젝트를 찾을 수 없습니다");
    const detail = await loadProject(db, id, settings);
    return detail ? json(detail) : errorJson(404, "프로젝트를 찾을 수 없습니다");
  }
  return json({ usableTypes: settings.usable, projects: await listProjects(db, settings) });
});

async function projectOf(db: ReturnType<typeof serviceDb>, id: number): Promise<ProjectRow | null> {
  const { data, error } = await db.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "projects 하나");
  return data ? ({ ...(data as ProjectRow), id: Number((data as ProjectRow).id) } as ProjectRow) : null;
}

/** 그 프로젝트의 기록 전부 — 순서·같은 단계·정정 한 번·공개 조건 검사용 */
async function eventsOf(db: ReturnType<typeof serviceDb>, id: number): Promise<ProjectEventRow[]> {
  const { data, error } = await db.from("project_events").select("id, kind, stage, public, correction_of, recorded_at").eq("project_id", id).order("id");
  if (error) throw dbError(error, "project_events 읽기");
  return ((data ?? []) as ProjectEventRow[]).map((e) => ({ ...e, id: Number(e.id), correction_of: e.correction_of === null ? null : Number(e.correction_of) }));
}

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const projectId = idOf(body.project_id);
  // 역할만으로 먼저 판정 — 편집국 외 역할은 입력을 보기 전에 거부하고 감사 로그에 남긴다
  const denied = await authorize(viewer, "project.manage", projectId ? targetOf.project(projectId) : "projects:write");
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);

  if (op === "create") {
    const settings = await loadProjectSettings(db);
    const code = typeof body.region_code === "string" && /^[0-9]{10}$/.test(body.region_code) ? body.region_code : null;
    let region = null;
    if (code) {
      const { data, error } = await db.from("regions").select("code, valid_from, valid_to").eq("code", code).maybeSingle();
      if (error) throw dbError(error, "regions 하나");
      region = data as { valid_from: string | null; valid_to: string | null } | null;
    }
    const parsed = parseCreateProject(body, { types: settings.types, lists: settings.lists, region, today: todayKst() });
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const { data, error } = await db
      .from("projects")
      .insert({ ...parsed.value, status: "draft", created_by: actor })
      .select(PROJECT_COLUMNS)
      .single();
    if (error?.code === "23505") return errorJson(409, "이미 있는 주소(slug)입니다", { errors: ["slug: 이미 있는 주소입니다 — 다른 주소를 쓰세요"] });
    if (error || !data) throw dbError(error ?? {}, "projects 만들기");
    const row = data as ProjectRow;
    await writeAudit(db, { actor, action: "project.create", target: targetOf.project(row.id), before: null, after: row, reason: "프로젝트 만들기(초안 — 공개는 단계 기록·데이터 출처·확인일 뒤)" });
    return json({ project: row }, 201);
  }

  if (op === "event" || op === "correct") {
    if (projectId === null) return errorJson(422, "입력값을 확인하세요", { errors: ["project_id: 프로젝트 번호가 필요합니다"] });
    const project = await projectOf(db, projectId);
    if (!project) return errorJson(404, "프로젝트를 찾을 수 없습니다");
    const settings = await loadProjectSettings(db);
    const events = await eventsOf(db, projectId);
    const parsed = parseEventRequest(op, body, { stageKeys: stageKeysOf(settings.lists, project.project_type), events });
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const v = parsed.value;
    let snapshotId = v.input.snapshot_id as number | null;
    let madeSnapshot: number | null = null;
    if (v.evidence && snapshotId !== null) {
      const { data, error } = await db.from("raw_snapshots").select("id").eq("id", snapshotId).limit(1);
      if (error) throw dbError(error, "raw_snapshots 조회");
      if (!data?.length) return errorJson(422, "입력값을 확인하세요", { errors: ["snapshot_id: 그런 원본 스냅샷이 없습니다 — 번호를 확인하거나 원문 글자를 붙여 넣으세요"] });
    }
    if (v.evidence && v.snapshotPayload !== null) {
      const { data, error } = await db
        .from("raw_snapshots")
        .insert({ source: "프로젝트 단계 원문", url: v.input.source_url, content_hash: snapshotHash(new TextEncoder().encode(v.snapshotPayload)), payload: v.snapshotPayload })
        .select("id")
        .single();
      if (error || !data) throw dbError(error ?? {}, "raw_snapshots 추가");
      snapshotId = madeSnapshot = Number((data as { id: number }).id);
    }
    const row = {
      project_id: projectId,
      kind: v.input.kind,
      stage: v.input.stage,
      notice_no: v.input.notice_no,
      notice_date: v.input.notice_date,
      issuer: v.input.issuer,
      source_url: v.input.source_url,
      snapshot_id: v.evidence ? snapshotId : null,
      license_type: v.input.license_type,
      note: v.input.note,
      correction_of: v.input.correction_of,
      reason: v.input.reason,
      public: v.input.public,
      recorded_by: actor,
      recorded_at: nowIso(),
    };
    const { data, error } = await db.from("project_events").insert(row).select(EVENT_COLUMNS).single();
    if (error || !data) {
      if (madeSnapshot !== null) await db.from("raw_snapshots").delete().eq("id", madeSnapshot);
      // DB 규칙(같은 단계·앞 순서·이미 정정된 기록 — 동시에 들어온 기록) = 충돌. 서비스 검사와 같은 문장
      if (error?.code === "23514" || error?.code === "23505") return errorJson(409, error.message);
      throw dbError(error ?? {}, "project_events 추가");
    }
    const saved = data as { id: number };
    const action = op === "correct" ? "project.correct_event" : "project.record_event";
    await writeAudit(db, {
      actor,
      action,
      target: targetOf.projectEvent(saved.id),
      before: null,
      after: data,
      reason: op === "correct" ? `프로젝트 단계 정정 — ${String(v.input.reason)}` : v.input.kind === "not_applicable" ? `해당 없는 단계 — ${String(v.input.reason)}` : "프로젝트 단계 기록",
    });
    return json({ event: data, warnings: v.warnings }, 201);
  }

  if (op === "publish") {
    const parsed = parsePublish(body);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const v = parsed.value;
    const project = await projectOf(db, v.projectId);
    if (!project) return errorJson(404, "프로젝트를 찾을 수 없습니다");
    const columns: Record<string, unknown> = { status: v.status };
    if (v.status === "public") {
      const settings = await loadProjectSettings(db);
      const events = await eventsOf(db, project.id);
      const merged = { source_name: v.source_name ?? project.source_name, last_verified_at: v.verified ? nowIso() : project.last_verified_at };
      const errors = projectPublishErrors(merged, events, stageKeysOf(settings.lists, project.project_type));
      if (errors.length) return errorJson(422, "공개할 수 없습니다 — 아래 사유를 채우세요", { errors });
      // 이미 공개이고 바뀌는 것이 없으면 그대로 (감사 0)
      if (project.status === "public" && merged.source_name === project.source_name && !v.verified) return json({ project, unchanged: true });
      columns.source_name = merged.source_name;
      columns.last_verified_at = merged.last_verified_at;
    } else if (project.status !== "public") {
      return errorJson(409, "공개 중인 프로젝트만 내립니다");
    }
    const { data, error } = await db.from("projects").update(columns).eq("id", project.id).eq("status", project.status).select(PROJECT_COLUMNS).maybeSingle();
    if (error) {
      if (error.code === "23514") return errorJson(409, error.message);
      throw dbError(error, "projects 공개 전환");
    }
    if (!data) return errorJson(409, "다른 사람이 먼저 바꿨습니다 — 화면을 새로 고치세요");
    const after = data as ProjectRow;
    await writeAudit(db, {
      actor,
      action: "project.publish",
      target: targetOf.project(project.id),
      before: { status: project.status, source_name: project.source_name, last_verified_at: project.last_verified_at },
      after: { status: after.status, source_name: after.source_name, last_verified_at: after.last_verified_at },
      reason: v.status === "public" ? (project.status === "public" ? "공개 프로젝트 확인일 다시 적기" : "프로젝트 공개") : "프로젝트 내리기",
    });
    return json({ project: after });
  }

  if (op === "link") {
    const parsed = parseProjectLink(body);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const project = await projectOf(db, parsed.value.projectId);
    if (!project) return errorJson(404, "프로젝트를 찾을 수 없습니다");
    // 지역 연결은 13단계와 같은 권한(regional_link.confirm — 편집 책임자·관리자)과 같은 작업
    const linkDenied = await authorize(viewer, "regional_link.confirm", targetOf.regionalLinkFrom("project", String(project.id)));
    if (linkDenied) return linkDenied;
    return runLinkOp(db, actor, parsed.value.linkOp, body, { type: "project", id: String(project.id) });
  }

  return errorJson(422, "op는 create·event·correct·publish·link 중 하나입니다");
}, { revalidatesPublic: true });
