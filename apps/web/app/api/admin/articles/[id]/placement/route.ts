import { checkHotPin } from "@/lib/analytics/ranking";
import { parseCheckedSettings } from "@/lib/analytics/settings";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { loadArticle } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";
import { articleSummary, updateArticle } from "@/lib/server/articles/writes";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, parseId, readJson } from "@/lib/server/http";
import { HOT_CATEGORY } from "@/lib/server/public/constants";

// 기사 정렬·HOT 고정·뉴스 전송 후보 선정 (PRD-00 6장 편집 행위 — 편집 책임자만, 관리자도 editor 필요)
//  · hotPinUntil — HOT 고정 종료 시각(ISO 8601) 또는 null(해제). 상담 사례 분야(HOT_CATEGORY) 기사만, 지금 고정 중인 다른 기사가
//    설정 hot_weights.max_pins건이면 409 (HOME-05 '고정은 최대 2건 — 3번째 고정은 막힌다', 판정 lib/analytics/ranking.ts checkHotPin)
//  · navCandidate — 뉴스 전송 후보. 편집 승인된 보도기사(reported_news)만 (NAV-02)
//  · 편집국 외 역할의 시도는 403 + 감사 로그 (NAV-06)
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export const POST = handle(async (request: Request, { params }: Ctx) => {
  const id = parseId((await params).id);
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const target = targetOf.article(id);
  const denied = await authorize(viewer, "article.sort", target);
  if (denied) return denied;

  const raw = await readJson(request);
  const unknown = Object.keys(raw).filter((k) => k !== "hotPinUntil" && k !== "navCandidate");
  if (unknown.length) return errorJson(422, `모르는 칸입니다: ${unknown.join(", ")}`);
  const columns: Record<string, unknown> = {};
  if (raw.hotPinUntil !== undefined) {
    const hotDenied = await authorize(viewer, "article.hot", target);
    if (hotDenied) return hotDenied;
    if (raw.hotPinUntil !== null && (typeof raw.hotPinUntil !== "string" || !ISO_WITH_ZONE.test(raw.hotPinUntil) || Number.isNaN(Date.parse(raw.hotPinUntil)))) {
      return errorJson(422, "hotPinUntil은 시간대가 붙은 ISO 8601 시각이거나 null이어야 합니다");
    }
    columns.hot_pin_until = raw.hotPinUntil;
  }
  if (raw.navCandidate !== undefined) {
    if (typeof raw.navCandidate !== "boolean") return errorJson(422, "navCandidate는 true/false여야 합니다");
    columns.nav_candidate = raw.navCandidate;
  }
  if (Object.keys(columns).length === 0) return errorJson(422, "hotPinUntil 또는 navCandidate가 필요합니다");

  const db = serviceDb();
  const before = await loadArticle(db, id);
  if (before.status !== "published") return errorJson(409, "발행된 기사만 정렬·HOT·후보로 지정할 수 있습니다");
  if (typeof columns.hot_pin_until === "string") {
    const denied = await hotPinDenied(db, id, before.section, before.category_id, Date.parse(columns.hot_pin_until));
    if (denied) return denied;
  }
  if (columns.nav_candidate === true && (before.content_type !== "reported_news" || before.editorial_status !== "approved")) {
    return errorJson(422, "뉴스 전송 후보는 편집 승인된 보도기사(reported_news)만 됩니다 (NAV-02)");
  }
  const article = await updateArticle(db, before, columns, "articles 배치");
  await writeAudit(db, {
    actor: actorOf(viewer),
    action: "article.placement",
    target,
    before: { hotPinUntil: before.hot_pin_until, navCandidate: before.nav_candidate },
    after: { hotPinUntil: article.hot_pin_until, navCandidate: article.nav_candidate },
    reason: "기사 배치 변경",
  });
  return json({ article: { ...articleSummary(article), hotPinUntil: article.hot_pin_until, navCandidate: article.nav_candidate } });
}, { revalidatesPublic: true });

type ServiceDb = ReturnType<typeof serviceDb>;

/** HOT 고정 판정 — 상담 사례 분야인가 · 지금 고정 중인 다른 공개 기사 수 · 설정 상한(max_pins). 막히면 응답, 되면 null */
async function hotPinDenied(db: ServiceDb, id: number, section: string, categoryId: number | null, until: number): Promise<Response | null> {
  const now = new Date();
  const { data: settings, error: settingsError } = await db.from("settings").select("key, value").eq("key", "hot_weights");
  if (settingsError) throw dbError(settingsError, "HOT 가중치 설정");
  const parsed = parseCheckedSettings((settings ?? []) as { key: string; value: unknown }[], ["hot_weights"] as const);
  if (!parsed.ok) return errorJson(503, "HOT 설정(hot_weights)을 읽지 못해 고정할 수 없습니다 — 운영 설정을 확인해 주세요");
  const { data: cats, error: catError } = await db.from("categories").select("id").eq("section", HOT_CATEGORY.section).eq("slug", HOT_CATEGORY.slug).limit(1);
  if (catError) throw dbError(catError, "상담 사례 분야");
  const hotCategory = cats?.[0] ? Number(cats[0].id) : null;
  const inHotCategory = hotCategory !== null && section === HOT_CATEGORY.section && categoryId !== null && Number(categoryId) === hotCategory;
  let otherActivePins = 0;
  if (inHotCategory) {
    const { count, error } = await db
      .from("articles")
      .select("id", { count: "exact", head: true })
      .eq("status", "published")
      .eq("category_id", hotCategory)
      .gt("hot_pin_until", now.toISOString())
      .neq("id", id);
    if (error) throw dbError(error, "HOT 고정 수");
    otherActivePins = count ?? 0;
  }
  const r = checkHotPin({ inHotCategory, until, now: now.getTime(), otherActivePins, maxPins: parsed.values.hot_weights.max_pins });
  return r.ok ? null : errorJson(r.status, r.message);
}
