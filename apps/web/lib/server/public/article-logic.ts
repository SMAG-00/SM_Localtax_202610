// 기사 상세 규칙 (ART-02 · ART-05 · ART-06 · CORE-01 · CAT-04 · TX-08) — 순수 함수 (시험 article-logic.test.ts)
import type { StoredBlock, StoredTaxLens } from "../articles/content";
import { isoToKstDate } from "@/lib/admin/form-utils";
import type { ArticleListItem } from "./cards";
import { LIMITS, NEXT_ACTION_LABELS, isBlockedPath, type Features, type NextActionKey, type SectionKey } from "./constants";
import type { CorrectionRow, RevisionRow } from "./rows";

// ── 비슷한 사례 (ART-06) ─────────────────────────────────

export interface SimilarCase {
  id: number;
  href: string;
  title: string;
  /** 해결 사례 · 기사 */
  kind: "해결 사례" | "기사";
}

/**
 * 비슷한 사례 3건 — 해결 사례(상담·해결 사례)를 먼저, 같은 태그 수 → 같은 분야 → 최신 순 (ART-06).
 * 자기 자신·광고·금주 핫뉴스 0. candidates는 읽을 수 있는(공개) 기사만, sharedTags는 기사 번호 → 지금 기사와 겹치는 태그 수
 */
export function selectSimilarCases(
  current: { id: number; section: SectionKey },
  candidates: readonly ArticleListItem[],
  sharedTags: ReadonlyMap<number, number>,
): SimilarCase[] {
  const seen = new Set<number>([current.id]);
  const pool = candidates.filter((c) => {
    if (seen.has(c.id) || c.contentType === null || c.contentType === "sponsored" || c.contentType === "digest") return false;
    seen.add(c.id);
    return true;
  });
  const solved = (c: ArticleListItem) => (c.subtype === "solved_case" ? 1 : 0);
  const tags = (c: ArticleListItem) => sharedTags.get(c.id) ?? 0;
  const sameSection = (c: ArticleListItem) => (c.section === current.section ? 1 : 0);
  // 관련 없는 기사(태그 0 · 다른 분야)는 후보가 아니다
  const related = pool.filter((c) => tags(c) > 0 || sameSection(c) === 1);
  related.sort(
    (a, b) =>
      solved(b) - solved(a) ||
      tags(b) - tags(a) ||
      sameSection(b) - sameSection(a) ||
      Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") ||
      b.id - a.id,
  );
  return related.slice(0, LIMITS.similarCases).map((c) => ({ id: c.id, href: c.href, title: c.title, kind: c.subtype === "solved_case" ? "해결 사례" : "기사" }));
}

/** 관련 기사 — 같은 개정안 → 같은 하위 분야 → 같은 분야 최신, 자기 자신·비슷한 사례와 겹침 0, 광고·금주 핫뉴스 0 (설계 8장 #15) */
export function selectRelated(
  current: { id: number; section: SectionKey; categoryId: number | null; amendmentId: number | null },
  candidates: readonly ArticleListItem[],
  exclude: ReadonlySet<number>,
): ArticleListItem[] {
  const pool = candidates.filter((c) => c.id !== current.id && !exclude.has(c.id) && c.contentType !== null && c.contentType !== "sponsored" && c.contentType !== "digest");
  const rank = (c: ArticleListItem) =>
    current.amendmentId !== null && c.amendmentId === current.amendmentId ? 3 : current.categoryId !== null && c.categoryId === current.categoryId ? 2 : c.section === current.section ? 1 : 0;
  const unique = [...new Map(pool.map((c) => [c.id, c])).values()].filter((c) => rank(c) > 0);
  unique.sort((a, b) => rank(b) - rank(a) || Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? "") || b.id - a.id);
  return unique.slice(0, LIMITS.related);
}

// ── 다음 행동 띠 버튼 (ART-06 · UX-05) ───────────────────

export interface NextAction {
  key: NextActionKey;
  label: string;
  href: string;
  /** 별도 사이트 — 새 창 (SM 계산기) */
  external: boolean;
}

/** 버튼 후보 — 키마다 갈 곳(없으면 그 버튼은 열리지 않은 것) */
export type ActionTargets = Partial<Record<NextActionKey, { href: string; external?: boolean } | null>>;

/** 기능 키가 있어야 열리는 버튼 (settings.feature_flags) — 나머지(상황·같은 분야)는 데이터만 있으면 열린다 */
const ACTION_FEATURE: Partial<Record<NextActionKey, keyof Features>> = {
  local_news: "region_hubs",
  sm_calculator: "sm_calculator",
  expert_finder: "expert_finder",
  self_calculator: "self_calculator",
  taxbot: "taxbot",
};

/** 우선순위 순서로 열린 버튼 중 앞의 2개 — 닫힌 기능·갈 곳 없는 버튼·숨긴 경로는 렌더하지 않는다 (ART-06) */
export function selectNextActions(priority: readonly NextActionKey[], targets: ActionTargets, features: Features): NextAction[] {
  const out: NextAction[] = [];
  for (const key of priority) {
    const target = targets[key];
    const feature = ACTION_FEATURE[key];
    if (!target || (feature && !features[feature])) continue;
    if (!target.external && isBlockedPath(target.href)) continue;
    out.push({ key, label: NEXT_ACTION_LABELS[key], href: target.href, external: target.external === true });
    if (out.length === LIMITS.nextActions) break;
  }
  return out;
}

// ── 「지방세로 읽기」 자리 (CORE-01) ─────────────────────

export interface TaxLensView {
  topics: string[];
  points: string[];
  links: { kind: string; label: string; href: string; external: boolean }[];
  /** 법령 기준일 */
  basisDate: string | null;
  /** 감수자 이름 — 공개 칸이 아직 없다 (설계 8장 #13) */
  reviewer: string | null;
}

const LINK_FEATURE: Record<string, keyof Features | null> = { explainer: null, calculator: "sm_calculator", book: "store", expert: "expert_finder" };
const MAX_POINTS = 3;

/**
 * 박스를 보일지 — 내용이 있고, 생략 사유가 없고, 현재 버전이 감수됐을 때만. 아니면 null(박스 요소 0 — 생략 사유 기사·감수 전 박스).
 * 링크는 열린 기능만(계산기·도서·전문가), 사이트 안 링크는 숨긴 경로가 아닌 것만. 링크가 하나도 안 남으면 박스도 없다
 */
export function taxLensSlot(stored: StoredTaxLens | null, articleVersion: number, legalBasisDate: string | null, features: Features): TaxLensView | null {
  if (!stored || stored.skip_reason !== null) return null;
  if (!stored.reviewed || stored.reviewed_for_version !== articleVersion) return null;
  const topics = stored.topics.filter((t) => t.trim() !== "");
  const points = stored.points.filter((p) => p.trim() !== "");
  if (topics.length === 0 || points.length === 0 || points.length > MAX_POINTS) return null;
  const links = stored.links.flatMap((l) => {
    const feature = LINK_FEATURE[l.kind];
    if (feature === undefined || (feature !== null && !features[feature])) return [];
    const external = /^https?:\/\//i.test(l.url);
    if (!external && (!l.url.startsWith("/") || isBlockedPath(l.url))) return [];
    return [{ kind: l.kind, label: l.label, href: l.url, external }];
  });
  if (links.length === 0) return null;
  return { topics, points, links, basisDate: legalBasisDate, reviewer: null };
}

// ── 정정 이력 · 업데이트 표시 (NAV-06 · ART-05) ───────────

export interface CorrectionEntry {
  id: number;
  kind: string;
  /** 게재 시각 */
  date: string;
  /** 무엇을 고쳤는지 (독자 표시 — 없으면 종류 이름) */
  what: string;
  /** 왜 고쳤는지 */
  why: string;
}

const CORRECTION_NAMES: Record<string, string> = { correction: "정정", rebuttal: "반론", follow_up: "추후보도", title_change: "제목 변경", deletion: "삭제" };

/** 정정 이력 — 게재된 것, 날짜 순(오래된 것부터). 삭제 기록은 기사 화면에 보이지 않는다 (삭제된 기사는 공개 0) */
export function correctionEntries(rows: readonly CorrectionRow[]): CorrectionEntry[] {
  return rows
    .filter((r) => r.kind !== "deletion" && r.published_at)
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || Number(a.id) - Number(b.id))
    .map((r) => ({ id: Number(r.id), kind: r.kind, date: r.published_at, what: r.reader_notice?.trim() || CORRECTION_NAMES[r.kind] || r.kind, why: r.reason }));
}

export interface UpdateEntry {
  version: number;
  /** 한국 날짜 */
  date: string;
  reason: string;
}

/** 업데이트 표시 "수정 2026-10-20: 무엇을 고쳤는지" — 실질 수정 기록만, 날짜 순 (ART-05 — 정정과 다른 라벨, 오탈자는 0) */
export function updateEntries(rows: readonly RevisionRow[]): UpdateEntry[] {
  return rows
    .filter((r) => r.update_kind === "substantive" && r.reason && r.reason.trim() !== "")
    .sort((a, b) => a.version - b.version)
    .map((r) => ({ version: r.version, date: isoToKstDate(r.edited_at), reason: r.reason!.trim() }));
}

// ── 본문 블록 ────────────────────────────────────────────

/** 이미지·인포그래픽 블록은 읽을 수 있는(권리 확인·공개) media만 — 아니면 블록을 뺀다 (NAV-04 · REG1-09) */
export function publicBlocks(blocks: readonly StoredBlock[], readableMedia: ReadonlySet<string>): StoredBlock[] {
  return blocks.filter((b) => (b.type === "image" || b.type === "infographic" ? readableMedia.has(String(b.mediaId)) : true));
}

export function blockMediaIds(blocks: readonly StoredBlock[]): string[] {
  return [...new Set(blocks.flatMap((b) => (b.type === "image" || b.type === "infographic" ? [String(b.mediaId)] : [])))];
}

// ── 개정 브리핑 갱신 배너 (TX-08) ──────────────────────────

/**
 * 기사의 마지막 실질 수정(없으면 최초 발행)보다 늦게 기록된 현재 단계가 있으면 배너. 편집자가 실질 수정하면 사라진다.
 * 배너는 dateModified를 바꾸지 않는다 (OPT-07) — 이 함수는 화면 값만 만든다
 */
export function stageBanner(
  stage: { current: string | null; label: string; recordedAt: string | null },
  article: { firstPublishedAt: string | null; substantiveUpdatedAt: string | null },
): { stageLabel: string; changedAt: string } | null {
  if (!stage.current || !stage.recordedAt) return null;
  const base = article.substantiveUpdatedAt ?? article.firstPublishedAt;
  if (!base) return null;
  return Date.parse(stage.recordedAt) > Date.parse(base) ? { stageLabel: stage.label, changedAt: stage.recordedAt } : null;
}

// ── 인물 약력 ─────────────────────────────────────────────

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** 공개 약력 글자 — 증빙 있는 항목(DB 계산 칸)만 오고, 이메일이 섞인 줄은 뺀다 (평문 이메일 0 — HELP-03) */
export function publicBio(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((b) => {
    const item = typeof b === "object" && b !== null ? (b as { item?: unknown }).item : undefined;
    return typeof item === "string" && item.trim() !== "" && !EMAIL.test(item) ? [item.trim()] : [];
  });
}
