import { parseCategoryInput, reservedSlugBlocked, slugChangeBlocked } from "@/lib/admin/category-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadCategory, updateCategory } from "@/lib/server/admin/backoffice";
import { categoryCopyChecks } from "@/lib/server/admin/copy-checks";
import { findingsError, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, parseId, readJson } from "@/lib/server/http";

// 하위 분야 고치기 (CAT-01) — 이름·주소·소개·순서·공개·면책 대상·「지방세로 읽기」 필수. 분야(허브)는 바꿀 수 없다(422).
// 발행 판정이 주소로 찾는 하위 분야(지방세 > 개정 트래커)의 주소는 바꿀 수 없다(409). 감사 로그에 바뀐 칸의 전후 값.
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id, "하위 분야");
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.category(id);
  const denied = await authorize(viewer, "category.edit", target);
  if (denied) return denied;
  const parsed = parseCategoryInput(await readJson(request), "patch");
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const columns = parsed.value;

  const db = serviceDb();
  const before = await loadCategory(db, id);
  if (typeof columns.slug === "string") {
    const blocked = slugChangeBlocked(before, columns.slug);
    if (blocked) return errorJson(409, blocked);
    const reserved = columns.slug !== before.slug ? reservedSlugBlocked(before.section, columns.slug) : null;
    if (reserved) return errorJson(409, reserved);
  }
  const copy = await categoryCopyChecks(db, columns);
  if (copy.blocked.length > 0) return findingsError("하위 분야 이름·소개에 쓸 수 없는 표현이 있습니다 (UX-01·UX-03)", copy.blocked);

  const changed = Object.keys(columns).filter((k) => before[k as keyof typeof before] !== columns[k]);
  if (changed.length === 0) return json({ category: before, unchanged: true, checks: copy.warnings });
  const after = await updateCategory(db, id, Object.fromEntries(changed.map((k) => [k, columns[k]])));
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "category.update",
    target,
    before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before] ?? null])),
    after: Object.fromEntries(changed.map((k) => [k, after[k as keyof typeof after] ?? null])),
    reason: `하위 분야 고치기 (${changed.join(", ")})`,
  });
  return json({ category: after, changed, checks: copy.warnings });
}, { revalidatesPublic: true });
