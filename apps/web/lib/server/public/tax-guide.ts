import "server-only";
import { parseTableByKind } from "@ltr/tax-engine";
import type { FeatureKey } from "./constants";
import type { ArticleListItem } from "./cards";
import { publicDb, rowsOf } from "./db";
import { financeOpen, getFinanceCase, getFinanceInterestLine } from "./finance";
import { readArticleList, readPublicSettings } from "./reads";
import { guidesForSurface, SURFACE_FEATURE, type PlacedGuide, type PlacementRow, type PlacementSurface, type PublicGuideRow } from "@/lib/tax-guide/placements";
import { PROJECT_TAX_KINDS, PROJECT_TAX_TYPES, type ProjectTaxKind } from "@/lib/tax-guide/determination-run";
import { screenTextProblems } from "@/lib/tax-guide/screen-text";

// W11-c 공개 읽기 - 공개 뷰 public_guides · public_guide_placements · public_determination_tables · public_requirement_dictionary(+ 단계 카드 진입 종류)만, anon 키로.
// 서명 전 가이드·판정표는 뷰가 0행이라 여기서도 아무것도 나오지 않는다. 기능 키가 꺼지면 빈 값 - 호출하는 화면은 아무것도 그리지 않는다("준비 중" 0).

const GUIDE_COLUMNS = "hub, topic, slug, version, title, tax_scope, last_reviewed_at, body_sha256";
const PLACEMENT_COLUMNS = "surface, target_key, sort, hub, topic, slug, version, body_sha256";

export async function featureOn(key: FeatureKey): Promise<boolean> {
  return (await readPublicSettings()).features[key] === true;
}

/** 한 화면에 붙은 공개 가이드 목록 (같은 해설은 public_guides 한 곳 - 배치는 slug만 가진다) */
export async function getPlacedGuides(surface: PlacementSurface, targetKey: string): Promise<PlacedGuide[]> {
  const features = (await readPublicSettings()).features;
  if (features[SURFACE_FEATURE[surface]] !== true) return [];
  const db = publicDb();
  const rows = await rowsOf<PlacementRow>(db.from("public_guide_placements").select(PLACEMENT_COLUMNS).eq("surface", surface).eq("target_key", targetKey).order("sort"), "가이드 배치");
  if (rows.length === 0) return [];
  const guides = await rowsOf<PublicGuideRow>(db.from("public_guides").select(GUIDE_COLUMNS).in("slug", rows.map((r) => r.slug)), "공개 가이드");
  return guidesForSurface(rows, guides, surface, targetKey, features);
}

/** 한 화면 종류에 붙은 모든 가이드 (허브 목록용) - target_key마다 묶는다 */
export async function getPlacedGuidesBySurface(surface: PlacementSurface): Promise<Map<string, PlacedGuide[]>> {
  const features = (await readPublicSettings()).features;
  const out = new Map<string, PlacedGuide[]>();
  if (features[SURFACE_FEATURE[surface]] !== true) return out;
  const db = publicDb();
  const rows = await rowsOf<PlacementRow>(db.from("public_guide_placements").select(PLACEMENT_COLUMNS).eq("surface", surface).order("sort"), "가이드 배치 목록");
  if (rows.length === 0) return out;
  const guides = await rowsOf<PublicGuideRow>(db.from("public_guides").select(GUIDE_COLUMNS).in("slug", [...new Set(rows.map((r) => r.slug))]), "공개 가이드");
  for (const key of new Set(rows.map((r) => r.target_key))) out.set(key, guidesForSurface(rows, guides, surface, key, features));
  return out;
}

export interface GuideSection {
  heading: string;
  body: string;
}
export interface GuideSource {
  label: string;
  url: string | null;
}
export interface GuideView extends PlacedGuide {
  sections: GuideSection[];
  sources: GuideSource[];
  asOf: string | null;
  /** 금지 사전·금액 검사에 걸려 그리지 않은 절 수 (편집 검수 신호) */
  heldSections: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** 가이드 본문 한 건 (배치로 열린 slug만 - 호출 쪽이 배치 확인 뒤 부른다). 걸린 절은 그리지 않는다 */
export async function getGuideBody(placed: PlacedGuide): Promise<GuideView | null> {
  const [row] = await rowsOf<{ sections: unknown; sources: unknown; as_of: string | null; version: number; body_sha256: string }>(
    publicDb().from("public_guides").select("sections, sources, as_of, version, body_sha256").eq("slug", placed.slug).limit(1),
    "공개 가이드 본문",
  );
  if (!row || row.version !== placed.version || row.body_sha256 !== placed.bodySha256) return null;
  const rawSections = Array.isArray(row.sections) ? row.sections : [];
  const sections: GuideSection[] = [];
  let held = 0;
  for (const s of rawSections) {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const heading = str(o.heading);
    const body = str(o.body);
    if (!heading || !body) continue;
    if (screenTextProblems(`${heading} ${body}`).length > 0) {
      held += 1;
      continue;
    }
    sections.push({ heading, body });
  }
  const sources: GuideSource[] = [];
  for (const s of Array.isArray(row.sources) ? row.sources : []) {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const label = str(o.label) ?? str(o.title);
    const url = str(o.url);
    if (label) sources.push({ label, url: url && /^https:\/\//.test(url) ? url : null });
  }
  return { ...placed, sections, sources, asOf: row.as_of, heldSections: held };
}

// ─────────────────────────────────────────────────────────────
// 판정표 · 요건 사전 (판정은 브라우저 - 표는 렌더 때 함께 내려보낸다)
// ─────────────────────────────────────────────────────────────
export interface DictionaryField {
  id: string;
  kind: "yesno" | "count" | "date" | "choice" | "text";
  options: string[];
}
export interface DeterminationBundle {
  /** 활성(서명 + 승인) 판정표가 있는 종류 → 본문(zod 검증 통과분만) */
  tables: Partial<Record<ProjectTaxKind, unknown>>;
  /** 요건 사전 칸(id → 질문 모양). 사전에 없는 칸은 글자 입력 */
  fields: Record<string, DictionaryField>;
}

const FIELD_KINDS = ["yesno", "count", "date", "choice", "text"] as const;

function parseFields(bodies: unknown[]): Record<string, DictionaryField> {
  const out: Record<string, DictionaryField> = {};
  for (const body of bodies) {
    const fields = body && typeof body === "object" ? (body as { fields?: unknown }).fields : null;
    if (!Array.isArray(fields)) continue;
    for (const f of fields) {
      const o = f && typeof f === "object" ? (f as Record<string, unknown>) : {};
      const id = str(o.id);
      if (!id || !/^[a-z][a-z0-9_]{1,39}$/.test(id)) continue;
      const kind = (FIELD_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as DictionaryField["kind"]) : "text";
      const options = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string" && x !== "").slice(0, 30) : [];
      out[id] = { id, kind, options };
    }
  }
  return out;
}

/** 요청한 판정 종류 중 활성 판정표가 있고 기능 키가 열린 것만. 표가 모양에 맞지 않으면 그 종류는 뺀다 */
export async function getDeterminationBundle(kinds: readonly ProjectTaxKind[]): Promise<DeterminationBundle> {
  const features = (await readPublicSettings()).features;
  const open = kinds.filter((k) => (k.startsWith("trust_") ? features.trust_tax_guide : features.redevelopment_tax) === true);
  if (open.length === 0 || features.tax_determination !== true) return { tables: {}, fields: {} };
  const db = publicDb();
  const [tables, dict] = await Promise.all([
    rowsOf<{ kind: string; version: string; body: unknown }>(db.from("public_determination_tables").select("kind, version, body").in("kind", [...open]), "공개 판정표"),
    rowsOf<{ topic: string; body: unknown }>(db.from("public_requirement_dictionary").select("topic, body"), "공개 요건 사전"),
  ]);
  const ok: Partial<Record<ProjectTaxKind, unknown>> = {};
  for (const t of tables) {
    if (!(PROJECT_TAX_KINDS as readonly string[]).includes(t.kind)) continue;
    try {
      parseTableByKind(t.kind, t.body);
      ok[t.kind as ProjectTaxKind] = t.body;
    } catch {
      console.error("[public] 판정표 모양 불일치 - 이 종류는 진입하지 않음", t.kind);
    }
  }
  return { tables: ok, fields: parseFields(dict.map((d) => d.body)) };
}

/** 판정 종류 id 중 활성 판정표가 있는 것만 */
export function availableTypeIds(bundle: DeterminationBundle, allowed: readonly string[]): string[] {
  return PROJECT_TAX_TYPES.filter((t) => allowed.includes(t.id) && bundle.tables[t.kind] !== undefined).map((t) => t.id);
}

// ─────────────────────────────────────────────────────────────
// 단계 카드 진입 종류 (c6·c8)
// ─────────────────────────────────────────────────────────────
export interface StageEntry {
  projectType: string;
  stage: string;
  stageLabel: string;
  position: number;
  topics: string[];
  points: string[];
  determinationKind: ProjectTaxKind | null;
}

export async function getStageEntries(projectTypes: readonly string[]): Promise<StageEntry[]> {
  const features = (await readPublicSettings()).features;
  if (features.redevelopment_tax !== true || projectTypes.length === 0) return [];
  const db = publicDb();
  const [lists, lenses] = await Promise.all([
    rowsOf<{ project_type: string; stage_position: number; stage: string; stage_label: string }>(db.from("public_project_stage_lists").select("project_type, stage_position, stage, stage_label").in("project_type", [...projectTypes]).order("stage_position"), "단계 목록"),
    rowsOf<{ project_type: string; stage: string; topics: string[] | null; points: string[] | null; determination_kind: string | null }>(
      db.from("public_project_stage_lenses").select("project_type, stage, topics, points, determination_kind").in("project_type", [...projectTypes]),
      "단계 카드",
    ),
  ]);
  const lensOf = new Map(lenses.map((l) => [`${l.project_type}|${l.stage}`, l]));
  return lists.map((s) => {
    const l = lensOf.get(`${s.project_type}|${s.stage}`);
    const kind = l?.determination_kind;
    return {
      projectType: s.project_type,
      stage: s.stage,
      stageLabel: s.stage_label,
      position: s.stage_position,
      topics: l?.topics ?? [],
      points: (l?.points ?? []).filter((p) => screenTextProblems(p).length === 0),
      determinationKind: kind && (PROJECT_TAX_KINDS as readonly string[]).includes(kind) ? (kind as ProjectTaxKind) : null,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// TRU-06 신탁 실무 칼럼·사례 최신 글 (새 CMS 분야 0 - 1단계 개발금융 칼럼·사례의 `신탁` 태그 글을 모은다)
// ─────────────────────────────────────────────────────────────
export const TRUST_TAG_NAME = "신탁";
const TRUST_ARTICLE_LIMIT = 6;

/**
 * 태그 `신탁`이 붙은 공개 글 가운데 (1) 개발금융 칼럼은 이해관계 공개 줄(DF-09)이 있는 것만, (2) 사례는 실명이면 반론 기록(rebuttalStatus)이 있는 것만.
 * 키 trust_tax_guide·finance가 꺼졌거나 태그·글이 없으면 빈 목록 - 호출 쪽은 상자를 그리지 않는다.
 */
export async function getTrustArticles(): Promise<ArticleListItem[]> {
  const features = (await readPublicSettings()).features;
  if (features.trust_tax_guide !== true || !(await financeOpen())) return [];
  const db = publicDb();
  const [tag] = await rowsOf<{ id: number }>(db.from("tags").select("id").eq("name", TRUST_TAG_NAME).limit(1), "신탁 태그");
  if (!tag) return [];
  const links = await rowsOf<{ article_id: number }>(db.from("article_tags").select("article_id").eq("tag_id", tag.id).limit(300), "신탁 태그 글");
  if (links.length === 0) return [];
  const { items } = await readArticleList(db, { ids: links.map((l) => l.article_id), limit: 40 });
  const out: ArticleListItem[] = [];
  for (const item of items) {
    const caseView = await getFinanceCase(item.id);
    if (caseView) {
      if (caseView.named && !caseView.rebuttalStatus) continue;
    } else if (item.contentType === "opinion") {
      if (!(await getFinanceInterestLine(item.id))) continue;
    } else {
      continue;
    }
    out.push(item);
    if (out.length >= TRUST_ARTICLE_LIMIT) break;
  }
  return out;
}
