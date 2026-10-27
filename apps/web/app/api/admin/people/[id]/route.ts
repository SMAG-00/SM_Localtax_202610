import { parsePersonInput } from "@/lib/admin/people-rules";
import { PEOPLE_COLUMNS, loadPersonRow, personView, type PersonRegistryRow } from "@/lib/server/admin/people-store";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { HttpError, dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 인물 고치기·계정 연결/해제 (F2 · NAV-19) — 관리자만(people.manage). 보낸 칸만 바뀐다.
// staff_user_id에 계정 ID를 보내면 연결(이미 다른 인물에 연결된 계정이면 409), null을 보내면 해제. 모든 변경은 감사 로그에 전후 값과 함께 남는다.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "인물");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "people.manage", `people:${id}`);
  if (denied) return denied;
  return json({ person: await loadPersonRow(serviceDb(), id) });
});

export const PATCH = handle(
  async (request: Request, { params }: Ctx) => {
    const id = parseId((await params).id, "인물");
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const target = `people:${id}`;
    const denied = await authorize(viewer, "people.manage", target);
    if (denied) return denied;
    const parsed = parsePersonInput(await readJson(request), "patch");
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const columns = parsed.value;

    const db = serviceDb();
    const before = await loadPersonRow(db, id);
    const { data, error } = await db.from("people").update(columns).eq("id", id).select(PEOPLE_COLUMNS).maybeSingle();
    if (error) throw dbError(error, "people 수정");
    if (!data) throw new HttpError(404, "인물을 찾을 수 없습니다");
    const after = personView(data as unknown as PersonRegistryRow);
    const changed = Object.keys(columns) as (keyof PersonRegistryRow)[];
    const link = "staff_user_id" in columns;
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: link ? (columns.staff_user_id ? "people.link_account" : "people.unlink_account") : "people.update",
      target,
      before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      after: Object.fromEntries(changed.map((k) => [k, after[k] ?? null])),
      reason: link ? `인물 계정 ${columns.staff_user_id ? "연결" : "해제"} — ${after.name}` : `인물 정보 고치기 — ${after.name}`,
    });
    return json({ person: after });
  },
  { revalidatesPublic: true },
);
