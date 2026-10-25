import { parseCategoryInput, reservedSlugBlocked } from "@/lib/admin/category-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { listCategoryRows, type CategoryRow } from "@/lib/server/admin/backoffice";
import { categoryCopyChecks } from "@/lib/server/admin/copy-checks";
import { findingsError, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";

// 분야 체계 (CAT-01) — 허브 = 4대 분야(section, 고정) > 하위 분야(categories 행). 편집 책임자·관리자(category.edit).
//  · GET  — 하위 분야 전부 (분야·순서 순)
//  · POST — 하위 분야 더하기. 순서를 주지 않으면 그 분야 맨 끝. 이름·소개는 화면 문구 검사(UX-01·UX-03)를 거친다
//    (금지·공포 표현은 저장 거부 422, 긴 문장·풀이 없는 용어는 경고만 checks로 돌려준다)
// 모든 변경은 감사 로그(전후 값)에 남는다. 배포 없이 다음 화면부터 메뉴·허브에 반영된다.
export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "category.edit", "categories:list");
  if (denied) return denied;
  return json({ categories: await listCategoryRows(serviceDb()) });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "category.edit", "categories:new");
  if (denied) return denied;
  const parsed = parseCategoryInput(await readJson(request), "create");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;
  const reserved = reservedSlugBlocked(String(columns.section), String(columns.slug));
  if (reserved) return errorJson(422, "입력값을 확인하세요", { errors: [`category.slug: ${reserved}`] });

  const db = serviceDb();
  const copy = await categoryCopyChecks(db, columns);
  if (copy.blocked.length > 0) return findingsError("하위 분야 이름·소개에 쓸 수 없는 표현이 있습니다 (UX-01·UX-03)", copy.blocked);
  if (columns.sort === undefined) {
    const siblings = await listCategoryRows(db, String(columns.section));
    columns.sort = siblings.reduce((max, c) => Math.max(max, c.sort), 0) + 10;
  }
  const { data, error } = await db.from("categories").insert(columns).select("id, section, slug, name, intro, sort, visible, needs_disclaimer, needs_tax_lens").single();
  if (error || !data) throw dbError(error ?? {}, "categories 추가");
  const row = data as CategoryRow;
  await writeAudit(db, { actor: actorOf(viewer), action: "category.create", target: targetOf.category(row.id), before: null, after: row, reason: "하위 분야 더하기" });
  return json({ category: row, checks: copy.warnings }, 201);
}, { revalidatesPublic: true });
