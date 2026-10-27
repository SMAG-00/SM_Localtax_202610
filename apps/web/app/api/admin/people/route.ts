import { parsePersonInput } from "@/lib/admin/people-rules";
import { PEOPLE_COLUMNS, listPeople, personView, type PersonRegistryRow } from "@/lib/server/admin/people-store";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 기자·기고자 등록부 (F2 · NAV-19) — 관리자만(people.manage). 목록(GET)·등록(POST).
// 등록 칸: name · slug · roles[] · employment · affiliation · beat · conflicts · visibility(기본 hidden) · staff_user_id(편집국 계정 연결, 한 계정에 인물 하나 — 이미 연결된 계정이면 409).
// registered_at은 서버가 정한다. 약력·동의서는 받지 않는다(/api/admin/brand). 모든 변경은 감사 로그에 남는다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "people.manage", "people:list");
  if (denied) return denied;
  return json({ people: await listPeople(serviceDb()) });
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const denied = await authorize(viewer, "people.manage", "people:new");
    if (denied) return denied;
    const parsed = parsePersonInput(await readJson(request), "create");
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const db = serviceDb();
    const { data, error } = await db.from("people").insert(parsed.value).select(PEOPLE_COLUMNS).single();
    if (error || !data) throw dbError(error ?? {}, "people 추가");
    const row = personView(data as unknown as PersonRegistryRow);
    await writeAudit(db, {
      actor: actorOf(viewer),
      action: "people.create",
      target: `people:${row.id}`,
      before: null,
      after: { slug: row.slug, name: row.name, roles: row.roles, employment: row.employment, visibility: row.visibility, staff_user_id: row.staff_user_id },
      reason: `인물 등록 — ${row.name}`,
    });
    return json({ person: row }, 201);
  },
  { revalidatesPublic: true },
);
