// 공개 목록 카드 · 개정 트래커 상태 — 읽은 공개 행 → 화면 값. 순수 함수 (시험 cards.test.ts).
import { resolveProgressStage, PROGRESS_STAGE_ORDER, type ProgressStageEvent, type ProgressStageKey } from "@ltr/ui";
import { sponsorLabelText } from "@ltr/structured-data";
import { isoToKstDate } from "@/lib/admin/form-utils";
import { sponsorshipOf } from "../articles/mapping";
import { CONTENT_TYPE_NAMES, SECTION_INFO, isSectionKey, newsHref, personHref, type SectionKey } from "./constants";
import type { AmendmentEventRow, AmendmentRow, PublicArticleListRow, PublicCategoryRow, PublicPartnerRow, PublicPersonRow, RegionRow } from "./rows";

/** 목록 카드가 참조하는 표 — 읽을 수 있는 행만 들어 있다(RLS) */
export interface Lookups {
  categories: ReadonlyMap<number, PublicCategoryRow>;
  people: ReadonlyMap<number, PublicPersonRow>;
  partners: ReadonlyMap<number, PublicPartnerRow>;
  regions: ReadonlyMap<string, RegionRow>;
}

export const emptyLookups = (): Lookups => ({ categories: new Map(), people: new Map(), partners: new Map(), regions: new Map() });

export interface ArticleListItem {
  id: number;
  slug: string;
  /** 기사 상세 — 분야와 상관없이 /news/[slug] (ART-02) */
  href: string;
  title: string;
  summary: string;
  section: SectionKey;
  sectionName: string;
  /** 하위 분야 이름 (분야 칩 "부동산 › 정비사업") */
  subsection: string | null;
  contentType: string | null;
  /** 기사 유형 배지 글자 (content_type과 1:1) */
  typeLabel: string | null;
  /** 형식 — 일반이면 null (배지 0, HOME-03) */
  format: string | null;
  /** 제휴 배지 글자 — 광고 · 공동 기획 ○○ (ART-10) */
  sponsorBadge: string | null;
  subtype: string;
  /** 최초 발행일 (한국 날짜) */
  publishedOn: string;
  /** 실질 수정일 (한국 날짜) — 오탈자 수정은 바꾸지 않는다 */
  modifiedOn: string | null;
  publishedAt: string | null;
  authorName: string | null;
  authorHref: string | null;
  /** 지역 태그 첫 코드 (예: 서울특별시 성동구) */
  regionLabel: string | null;
  regionCodes: string[];
  editorialField: string | null;
  categoryId: number | null;
  amendmentId: number | null;
  /** 편집 승인된 보도기사 (HOME-04 · 뉴스 전체 — 계산 칸 reported_approved) */
  reportedApproved: boolean;
}

/** 목록에 내는 기사 — 유형이 있고(이관 미분류 제외 — ART-01) 금주 핫뉴스(주간 페이지 경로 — ART-02)가 아님 */
export function isListable(row: Pick<PublicArticleListRow, "content_type">): boolean {
  return row.content_type !== null && row.content_type !== "digest";
}

export function regionLabel(codes: readonly string[], regions: ReadonlyMap<string, RegionRow>): string | null {
  const r = codes.length ? regions.get(codes[0]!) : undefined;
  if (!r) return null;
  const parent = r.parent_code ? regions.get(r.parent_code) : undefined;
  return parent ? `${parent.name} ${r.name}` : r.name;
}

export function sponsorBadgeOf(label: string, partnerName: string | null | undefined): string | null {
  const s = sponsorshipOf(label, partnerName);
  return s ? sponsorLabelText(s) : null;
}

export function toListItem(row: PublicArticleListRow, lk: Lookups): ArticleListItem | null {
  if (!isSectionKey(row.section)) return null;
  const category = row.category_id === null ? undefined : lk.categories.get(row.category_id);
  const author = row.author_id === null ? undefined : lk.people.get(row.author_id);
  const partner = row.partner_id === null ? undefined : lk.partners.get(row.partner_id);
  return {
    id: Number(row.id),
    slug: row.slug,
    href: newsHref(row.slug),
    title: row.title,
    summary: row.summary ?? "",
    section: row.section,
    sectionName: SECTION_INFO[row.section].name,
    subsection: category?.name ?? null,
    contentType: row.content_type,
    typeLabel: row.content_type ? (CONTENT_TYPE_NAMES[row.content_type] ?? null) : null,
    format: row.format && row.format !== "general" ? row.format : null,
    sponsorBadge: sponsorBadgeOf(row.label, partner?.name),
    subtype: row.subtype,
    publishedOn: isoToKstDate(row.first_published_at),
    modifiedOn: row.substantive_updated_at ? isoToKstDate(row.substantive_updated_at) : null,
    publishedAt: row.first_published_at,
    authorName: author?.name ?? null,
    authorHref: author ? personHref(author.slug) : null,
    regionLabel: regionLabel(row.region_codes ?? [], lk.regions),
    regionCodes: row.region_codes ?? [],
    editorialField: row.editorial_field,
    categoryId: row.category_id === null ? null : Number(row.category_id),
    amendmentId: row.amendment_id === null ? null : Number(row.amendment_id),
    reportedApproved: row.reported_approved === true,
  };
}

export function toListItems(rows: readonly PublicArticleListRow[], lk: Lookups): ArticleListItem[] {
  return rows.flatMap((r) => (isListable(r) ? (toListItem(r, lk) ?? []) : []));
}

// ── 개정 트래커 상태 (TX-07 · TX-08 · CAT-04) ─────────────────

export interface TrackerState {
  current: ProgressStageKey | null;
  /** 화면 글자 — 시행일 전이면 "시행 예정" */
  label: string;
  /** 확정 기준 단계(settings)에 이르렀는지 — false면 `확정 아님` 칩 */
  confirmed: boolean;
  effectivePending: boolean;
  /** 현재 단계의 날짜 (한국 날짜) */
  currentOn: string | null;
  /** 현재 단계 기록의 원문 */
  sourceUrl: string | null;
  /** 현재 단계를 기록한 시각 — 갱신 배너가 기사 수정 시각과 비교한다 */
  recordedAt: string | null;
  /** 단계 배지 컴포넌트에 그대로 넘기는 기록 */
  events: ProgressStageEvent[];
}

/** 정정되지 않은 기록만 — 정정 기록(correction_of)이 앞 기록을 대신한다 (DB 뷰 amendment_current_stages와 같은 규칙) */
export function validEvents(rows: readonly AmendmentEventRow[]): AmendmentEventRow[] {
  const corrected = new Set(rows.filter((r) => r.correction_of !== null).map((r) => Number(r.correction_of)));
  return rows.filter((r) => !corrected.has(Number(r.id)));
}

const isStage = (v: string): v is ProgressStageKey => (PROGRESS_STAGE_ORDER as readonly string[]).includes(v);

export function trackerState(rows: readonly AmendmentEventRow[], confirmStage: ProgressStageKey, today: string): TrackerState {
  const valid = validEvents(rows)
    .filter((r) => isStage(r.stage))
    .sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at) || Number(a.id) - Number(b.id));
  const events: ProgressStageEvent[] = valid.map((r) => ({
    stage: r.stage as ProgressStageKey,
    occurredOn: r.occurred_on ?? "",
    ...(r.source_url ? { sourceUrl: r.source_url } : {}),
    ...(r.skipped ? { skipped: true, ...(r.skip_reason ? { skipReason: r.skip_reason } : {}) } : {}),
  }));
  const resolved = resolveProgressStage(events, { today, confirmStage });
  const currentRow = resolved.current ? [...valid].reverse().find((r) => r.stage === resolved.current && !r.skipped) : undefined;
  return {
    current: resolved.current,
    label: resolved.currentLabel,
    confirmed: resolved.confirmed,
    effectivePending: resolved.effectivePending,
    currentOn: currentRow?.occurred_on ?? null,
    sourceUrl: currentRow?.source_url ?? null,
    recordedAt: currentRow?.recorded_at ?? null,
    events,
  };
}

export interface TrackerSource {
  amendment: AmendmentRow;
  state: TrackerState;
}

/** 현재 단계가 가장 최근에 바뀐 트래커 — 현재 단계 날짜, 같으면 늦게 기록된 것, 같으면 번호가 큰 것 (설계 8장 #10) */
export function latestChangedTracker(sources: readonly TrackerSource[]): TrackerSource | null {
  const withStage = sources.filter((s) => s.state.current !== null && s.state.currentOn);
  withStage.sort(
    (a, b) =>
      (b.state.currentOn ?? "").localeCompare(a.state.currentOn ?? "") ||
      Date.parse(b.state.recordedAt ?? "") - Date.parse(a.state.recordedAt ?? "") ||
      Number(b.amendment.id) - Number(a.amendment.id),
  );
  return withStage[0] ?? null;
}
