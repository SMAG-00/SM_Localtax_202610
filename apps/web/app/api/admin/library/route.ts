import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { loadLibraryBoard } from "@/lib/server/library/board";
import { DIGITIZE_STAGES, TARGET_KINDS, type TargetKind } from "@/lib/server/library/stages";

// 지식창고 이관·권리 관리 (W13-a a2 - AIOPS-16·LIB-06). 권한: 이관 만들기·단계 이동 library.edit / 승인 digitize.approve / 권리 library.rights.
//  · GET -> 보드  · POST op=create|advance|approve|rights  - 모두 DB 함수가 상태기계·권리·오류율을 다시 검사하고 거부는 409 + 감사 1행
// 이 경로는 AI·OCR을 부르지 않는다. 추출 결과는 사람이 넣은 텍스트다.
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const intFrom = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const posInt = (v: unknown): number | null => {
  const n = intFrom(v);
  return n !== null && n >= 1 ? n : null;
};
const RIGHT_FIELDS = ["rights_public", "rights_index", "rights_summary", "rights_sale", "rights_pdf"] as const;
const RIGHT_VALUES = ["unchecked", "confirmed", "restricted"] as const;

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "library.edit", "library:board");
  if (denied) return denied;
  return json(await loadLibraryBoard(serviceDb()));
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const actor = actorOf(viewer);
  const db = serviceDb();

  if (op === "create") {
    const denied = await authorize(viewer, "library.edit", "library:create");
    if (denied) return denied;
    const kind = String(body.target_kind) as TargetKind;
    const target = posInt(body.target_id);
    const file = typeof body.source_file === "string" ? body.source_file.trim() : "";
    const errors: string[] = [];
    if (!TARGET_KINDS.includes(kind)) errors.push(`target_kind: ${TARGET_KINDS.join("|")} 중 하나입니다`);
    if (target === null) errors.push("target_id: 1 이상 정수입니다");
    if (file === "" || file.length > 300) errors.push("source_file: 1~300자입니다");
    if (errors.length > 0) return invalid(errors);
    const { data, error } = await db.rpc("digitize_create", { p_kind: kind, p_target: target, p_source_file: file, p_actor: actor });
    if (error) throw dbError(error, "이관 작업 만들기");
    const r = data as { ok: boolean; code: string; jobId?: number };
    return r.ok ? json({ created: { id: r.jobId } }, 201) : errorJson(409, "이관 작업을 만들 수 없습니다", { code: r.code });
  }

  if (op === "advance") {
    const denied = await authorize(viewer, "library.edit", "library:advance");
    if (denied) return denied;
    const job = posInt(body.job_id);
    const to = String(body.to);
    if (job === null || !(DIGITIZE_STAGES as readonly string[]).includes(to)) return invalid(["job_id: 1 이상 정수, to: 단계 이름입니다"]);
    const { data, error } = await db.rpc("digitize_advance", { p_job: job, p_to: to, p_actor: actor });
    if (error) throw dbError(error, "이관 단계 이동");
    const r = data as { ok: boolean; code: string };
    return r.ok ? json({ updated: { id: job, stage: to } }) : errorJson(409, "단계를 옮길 수 없습니다", { code: r.code });
  }

  if (op === "approve") {
    const denied = await authorize(viewer, "digitize.approve", "library:approve");
    if (denied) return denied;
    const job = posInt(body.job_id);
    const size = posInt(body.sample_size);
    const errs = intFrom(body.sample_errors);
    if (job === null || size === null || errs === null) return invalid(["job_id·sample_size: 1 이상 정수, sample_errors: 0 이상 정수입니다"]);
    const { data, error } = await db.rpc("digitize_approve", { p_job: job, p_sample_size: size, p_sample_errors: errs, p_actor: actor });
    if (error) throw dbError(error, "이관 승인");
    const r = data as { ok: boolean; code: string; rate?: number };
    return r.ok ? json({ approved: { id: job, rate: r.rate } }) : errorJson(409, r.code === "error_rate" ? "표본 오류율이 상한을 넘어 승인할 수 없습니다" : "승인할 수 없습니다", { code: r.code, rate: r.rate });
  }

  if (op === "rights") {
    const denied = await authorize(viewer, "library.rights", "library:rights");
    if (denied) return denied;
    const kind = String(body.item_kind);
    const id = posInt(body.item_id);
    const field = String(body.field);
    const value = String(body.value);
    const errors: string[] = [];
    if (!["node", "issue", "issue_article"].includes(kind)) errors.push("item_kind: node|issue|issue_article 입니다");
    if (id === null) errors.push("item_id: 1 이상 정수입니다");
    if (!(RIGHT_FIELDS as readonly string[]).includes(field)) errors.push(`field: ${RIGHT_FIELDS.join("|")} 중 하나입니다`);
    if (!(RIGHT_VALUES as readonly string[]).includes(value)) errors.push(`value: ${RIGHT_VALUES.join("|")} 중 하나입니다`);
    if (errors.length > 0) return invalid(errors);
    const { data, error } = await db.rpc("library_rights_set", {
      p_kind: kind,
      p_id: id,
      p_field: field,
      p_value: value,
      p_ref: typeof body.rights_ref === "string" ? body.rights_ref : null,
      p_confirmed_on: typeof body.rights_confirmed_on === "string" && body.rights_confirmed_on !== "" ? body.rights_confirmed_on : null,
      p_actor: actor,
    });
    if (error) throw dbError(error, "권리 기록");
    const r = data as { ok: boolean; code: string };
    return r.ok ? json({ updated: { id, field, value } }) : errorJson(409, "권리를 기록할 수 없습니다", { code: r.code });
  }
  return invalid(["op: create|advance|approve|rights 입니다"]);
});
