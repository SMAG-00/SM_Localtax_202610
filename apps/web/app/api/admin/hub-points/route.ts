import { can } from "@/lib/access";
import {
  HUB_POINT_SECTIONS,
  isHubPointSection,
  parseHubPointDraft,
  pointState,
  readStoredPoints,
  withDraft,
  withReview,
  withoutSection,
  type HubPointSection,
  type StoredHubPoints,
} from "@/lib/admin/hub-point-rules";
import { readSetting, writeSetting } from "@/lib/server/admin/backoffice";
import { actorOf, writeAudit } from "@/lib/server/audit";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { errorJson, handle, json, readJson } from "@/lib/server/http";

// 허브 "이 분야의 지방세 포인트" (01B CORE-02 · W3 9단계 — docs/dev/W3_설계.md 2.2 · 2.3 · 2.8). settings.hub_tax_points 한 곳.
//  · op = draft(초안 저장 — 편집 책임자, hub_point.edit) | review(세무 감수 서명 — 세무 감수위원, review.tax_review) | clear(분야 지우기 — 편집 책임자)
//  · 초안: 분야·문구 1~3줄(4줄 422 lines)·기준일·지방세 해설 링크 1~3개, 세액 표현·금지 표현·경력 연수 표기 0. 저장하면 그 분야의 서명은 지워진다
//  · 서명: 저장된 초안에만. 서명 전 분야는 공개 뷰에 없다(블록째 숨김). DB 트리거(…37)가 같은 규칙을 다시 막는다
//  · 쓰기는 공개 데이터 캐시를 바로 만료한다 — 다음 요청부터 허브·홈 카드에 반영. 모든 변경은 감사 로그, 권한 밖은 403 + 감사
export const dynamic = "force-dynamic";

const KEY = "hub_tax_points";
const OPS = ["draft", "review", "clear"] as const;
type Db = ReturnType<typeof serviceDb>;

/** 금지 표현 사전 — 없으면 null(닫힌 쪽: 초안을 저장하지 않는다) */
async function forbiddenPhrases(db: Db): Promise<string[] | null> {
  const row = await readSetting(db, "forbidden_phrases");
  const v = row?.value as { phrases?: unknown } | undefined;
  return v && Array.isArray(v.phrases) ? v.phrases.filter((p): p is string => typeof p === "string" && p.trim() !== "") : null;
}

const view = (points: StoredHubPoints) => HUB_POINT_SECTIONS.map((section) => ({ section, state: pointState(points[section]), point: points[section] ?? null }));

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  // 편집 책임자(초안)와 세무 감수위원(서명) 모두 본다 — 둘 다 아니면 403 + 감사
  if (!can(viewer, "hub_point.edit") && !can(viewer, "review.tax_review")) {
    const denied = await authorize(viewer, "hub_point.edit", "hub_points:list");
    if (denied) return denied;
  }
  const current = await readSetting(serviceDb(), KEY);
  return json({ sections: view(readStoredPoints(current?.value)), updatedAt: current?.updated_at ?? null });
});

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  if (!(OPS as readonly string[]).includes(op)) return errorJson(422, `op는 ${OPS.join("·")} 중 하나입니다`);
  const section = body.section;
  const denied = await authorize(viewer, op === "review" ? "review.tax_review" : "hub_point.edit", `hub_points:${op}:${isHubPointSection(section) ? section : "invalid"}`);
  if (denied) return denied;

  const db = serviceDb();
  const actor = actorOf(viewer);
  const current = await readSetting(db, KEY);
  if (!current) return errorJson(503, "허브 지방세 포인트 설정이 없습니다 — 마이그레이션 …37을 적용하세요");
  const before = readStoredPoints(current.value);

  let next: StoredHubPoints;
  let target: HubPointSection;
  if (op === "draft") {
    const phrases = await forbiddenPhrases(db);
    if (!phrases) return errorJson(503, "금지 표현 사전(forbidden_phrases)이 없어 저장하지 않습니다");
    const p = parseHubPointDraft(body, { forbiddenPhrases: phrases });
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    target = p.value.section;
    next = withDraft(before, p.value, actor, nowIso());
  } else {
    if (!isHubPointSection(section)) return errorJson(422, "입력값을 확인하세요", { errors: [`section: ${HUB_POINT_SECTIONS.join("·")} 중 하나여야 합니다`] });
    target = section;
    if (op === "review") {
      const r = withReview(before, section, actor, nowIso());
      if (!r.ok) return errorJson(422, "입력값을 확인하세요", { errors: r.errors });
      next = r.value;
    } else {
      next = withoutSection(before, section);
    }
  }
  if (next === before || (op === "clear" && !before[target])) return json({ section: target, state: pointState(before[target]), point: before[target] ?? null, unchanged: true });

  const saved = await writeSetting(db, current, next, actor);
  if (!saved) return errorJson(409, "다른 사람이 먼저 고쳤습니다 — 새로 불러온 뒤 다시 저장하세요");
  const after = readStoredPoints(saved.value)[target] ?? null;
  const action = op === "draft" ? "hub_point.edit" : op === "review" ? "hub_point.review" : "hub_point.clear";
  const reason = op === "draft" ? "허브 지방세 포인트 초안 저장 (감수 서명 지움)" : op === "review" ? "허브 지방세 포인트 세무 감수 서명" : "허브 지방세 포인트 지우기";
  await writeAudit(db, { actor, action, target: `settings:${KEY}:${target}`, before: before[target] ?? null, after, reason });
  return json({ section: target, state: pointState(after ?? undefined), point: after });
}, { revalidatesPublic: true });
