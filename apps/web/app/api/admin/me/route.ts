import { allowedActions } from "@/lib/access";
import { personForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { requireViewer } from "@/lib/server/dal";
import { handle, json } from "@/lib/server/http";

// 로그인한 편집국 계정 — 역할(staff_roles)·관리자 여부(ADMIN_EMAILS)·허용 작업. 백오피스 역할별 메뉴(ADM-01)가 쓴다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const person = await personForUser(serviceDb(), viewer.userId);
  return json({
    userId: viewer.userId,
    email: viewer.email,
    isAdmin: viewer.isAdmin,
    roles: viewer.roles,
    person: person ? { id: person.id, slug: person.slug, name: person.name } : null,
    actions: allowedActions(viewer),
  });
});
