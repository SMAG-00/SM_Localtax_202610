import { CURATION_KIND_LABELS, CURATION_LIMITS, capacityError, duplicateTargetError, nextSort, parseCurationInput } from "@/lib/admin/home-curation-rules";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import {
  CURATION_COLUMNS,
  describeCurations,
  listCurationRows,
  storyTargets,
  targetIdOf,
  trackerTargets,
  type CurationRow,
} from "@/lib/server/admin/home-curations";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { PublicDataError, getHomeAmendments } from "@/lib/server/public";

// 홈 배치 (HOME-03 · ADM-01 홈 큐레이션 — W2-a에서 미룬 것, docs/dev/W2-b_설계.md 6장). 편집 책임자만(article.home — 관리자도 editor 필요).
// 거부는 403 + 감사 로그(article.home.denied). 같은 날 상한(트래커 3·스토리 6)과 같은 대상 겹침은 서버가 먼저 409로 막고 DB 트리거가 마지막에 막는다.
// GET은 '지금 홈에 보이는 모습'(공개 데이터 함수 — anon 키·RLS)을 함께 준다: 끝난 카드 0, 지정이 모자라면 자동 채움.
export const dynamic = "force-dynamic";

const UNSTORYABLE = new Set(["sponsored", "digest"]);

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "article.home", "home_curations:list");
  if (denied) return denied;
  const db = serviceDb();
  const today = kstDate(nowIso());
  const [rows, trackers, stories] = await Promise.all([listCurationRows(db), trackerTargets(db), storyTargets(db)]);
  let preview = null;
  try {
    preview = (await getHomeAmendments()).section;
  } catch (err) {
    if (!(err instanceof PublicDataError)) throw err;
  }
  return json({
    today,
    limits: CURATION_LIMITS,
    curations: await describeCurations(db, rows, today),
    candidates: { trackers, stories },
    preview,
  });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const denied = await authorize(viewer, "article.home", "home_curations:new");
  if (denied) return denied;
  const today = kstDate(nowIso());
  const parsed = parseCurationInput(await readJson(request), "create", today);
  if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
  const input = parsed.value;
  const db = serviceDb();

  // 대상 — 트래커는 공개 개정안, 스토리는 발행된 기사(광고·금주 핫뉴스 제외)
  if (input.kind === "tracker") {
    const [t] = await trackerTargets(db, [input.targetId]);
    if (!t) return errorJson(422, "그런 개정 트래커가 없습니다", { errors: ["curation.targetId: 개정 트래커 번호를 확인하세요"] });
    if (t.status !== "public") return errorJson(422, "공개된 개정 트래커만 홈에 둘 수 있습니다", { errors: [`curation.targetId: ‘${t.title}’은 공개 전입니다`] });
  } else {
    const [s] = await storyTargets(db, [input.targetId]);
    if (!s) return errorJson(422, "그런 기사가 없습니다", { errors: ["curation.targetId: 기사 번호를 확인하세요"] });
    if (s.status !== "published") return errorJson(422, "발행된 기사만 해설 스토리 카드로 둘 수 있습니다", { errors: [`curation.targetId: ‘${s.title}’은 발행 전입니다`] });
    if (s.contentType === null || UNSTORYABLE.has(s.contentType)) {
      return errorJson(422, "광고·금주 핫뉴스·유형 미분류 기사는 해설 스토리 카드로 둘 수 없습니다 (HOME-03 · 원칙 ⑥)", { errors: ["curation.targetId: 다른 기사를 고르세요"] });
    }
  }

  const all = await listCurationRows(db);
  const sameKind = all.filter((r) => r.kind === input.kind).map((r) => ({ id: r.id, starts_on: r.starts_on, ends_on: r.ends_on, targetId: targetIdOf(r) }));
  const period = { starts_on: input.starts_on, ends_on: input.ends_on };
  const full = capacityError(input.kind, sameKind, period);
  if (full) return errorJson(409, full);
  const dup = duplicateTargetError(sameKind, input.targetId, period);
  if (dup) return errorJson(409, dup);

  const actor = actorOf(viewer);
  const { data, error } = await db
    .from("home_curations")
    .insert({
      kind: input.kind,
      ...(input.kind === "tracker" ? { amendment_id: input.targetId } : { article_id: input.targetId }),
      starts_on: input.starts_on,
      ends_on: input.ends_on,
      sort: input.sort ?? nextSort(all.filter((r) => r.kind === input.kind)),
      created_by: actor,
      updated_by: actor,
    })
    .select(CURATION_COLUMNS)
    .single();
  if (error || !data) throw dbError(error ?? {}, "home_curations 추가");
  const row = data as CurationRow;
  await writeAudit(db, {
    actor,
    action: "home_curation.create",
    target: targetOf.homeCuration(row.id),
    before: null,
    after: row,
    reason: `홈 배치 더하기 — ${CURATION_KIND_LABELS[input.kind]}`,
  });
  const [item] = await describeCurations(db, [row], today);
  return json({ curation: item }, 201);
});
