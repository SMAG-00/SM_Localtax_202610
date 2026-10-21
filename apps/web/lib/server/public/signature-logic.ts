// 시그니처 연재 틀 — 공개 화면 규칙 (W3 8단계 — PRD-01C BR-01·04, docs/dev/W3_설계.md 2.6) — 순수 함수 (시험 signature-logic.test.ts)
//  · 연재 제목은 공개 뷰 public_signature_series가 낸 값만 쓴다(막히면 null → 틀째 숨김)
//  · 제목에 경력 연수 표기('50년' 등)가 있으면 근거 링크(인물 페이지의 그 증빙 약력 줄)가 있을 때만 틀을 낸다 — 링크 없는 표기 0 (뷰가 이미 거르지만 한 번 더)
//  · 회차 글은 기사 연재 이름 칸 대신 틀의 제목·회차를 쓴다. 틀이 없으면(기능 키 꺼짐·제목 막힘) 연재 줄 없이 칼럼으로만 보인다
//  · 홈 칼럼 영역: 연재마다 가장 큰 회차 1편(필자 동의서 범위에 home), 회차 0이면 영역째 없음(빈 카드 0)
import { hasClaimToken, isSeriesKey, type SeriesKey } from "@/lib/brand/claim";
import type { ArticleListItem } from "./cards";
import { personHref } from "./constants";

export interface SeriesRow {
  series_key: string;
  ord: number;
  title: string | null;
  claim_shown: boolean | null;
  basis_person_slug: string | null;
  basis_evidence_id: number | string | null;
  cadence: string | null;
  episodes: number | string | null;
}

export interface SignatureFrame {
  key: SeriesKey;
  title: string;
  /** 제목에 경력 연수 표기가 있을 때만 — 인물 페이지의 근거 증빙 약력 줄 */
  basisHref: string | null;
  cadence: string | null;
  episodes: number;
}

export interface EpisodeRef {
  seriesKey: SeriesKey;
  episode: number;
}

/** 인물 페이지 약력 줄의 앵커 — 근거 링크가 가리킨다 */
export const evidenceAnchor = (evidenceId: number | string) => `evidence-${evidenceId}`;

export function framesFrom(rows: readonly SeriesRow[]): Map<SeriesKey, SignatureFrame> {
  const out = new Map<SeriesKey, SignatureFrame>();
  for (const r of [...rows].sort((a, b) => Number(a.ord) - Number(b.ord))) {
    if (!isSeriesKey(r.series_key)) continue;
    const title = (r.title ?? "").trim();
    if (!title) continue;
    let basisHref: string | null = null;
    if (hasClaimToken(title)) {
      const id = r.basis_evidence_id === null ? "" : String(r.basis_evidence_id).trim();
      if (!r.claim_shown || !r.basis_person_slug || !/^\d+$/.test(id)) continue; // 근거 링크 없는 연수 표기 0
      basisHref = `${personHref(r.basis_person_slug)}#${evidenceAnchor(id)}`;
    }
    const cadence = (r.cadence ?? "").trim();
    out.set(r.series_key, { key: r.series_key, title, basisHref, cadence: cadence || null, episodes: Number(r.episodes ?? 0) || 0 });
  }
  return out;
}

/** 목록 카드에 연재 틀을 입힌다 — 회차 글은 틀의 제목·회차·근거 링크, 틀이 없으면 연재 줄 없음 */
export function applySignature(items: readonly ArticleListItem[], episodes: ReadonlyMap<number, EpisodeRef>, frames: ReadonlyMap<SeriesKey, SignatureFrame>): ArticleListItem[] {
  return items.map((a) => {
    const ep = episodes.get(a.id);
    if (!ep) return a;
    const frame = frames.get(ep.seriesKey);
    return frame
      ? { ...a, seriesTitle: frame.title, seriesEpisode: ep.episode, seriesBasisHref: frame.basisHref }
      : { ...a, seriesTitle: null, seriesEpisode: null, seriesBasisHref: null };
  });
}

export interface SignatureHomeItem {
  seriesKey: SeriesKey;
  seriesTitle: string;
  basisHref: string | null;
  cadence: string | null;
  episode: number;
  article: ArticleListItem;
}

/**
 * 홈 칼럼 영역 — 연재 순서(시그니처 → 그때와 지금)대로, 연재마다 가장 큰 회차 1편.
 * candidates = 연재별 공개 회차(큰 회차부터), homeAllowed = 필자의 현재 동의서 범위에 home이 있는 기사인가
 */
export function homeColumnItems(
  frames: ReadonlyMap<SeriesKey, SignatureFrame>,
  candidates: readonly { seriesKey: SeriesKey; episode: number; article: ArticleListItem | undefined }[],
  homeAllowed: (a: ArticleListItem) => boolean,
): SignatureHomeItem[] {
  const out: SignatureHomeItem[] = [];
  for (const frame of frames.values()) {
    if (frame.episodes < 1) continue;
    const pick = candidates
      .filter((c) => c.seriesKey === frame.key && c.article && c.article.contentType === "opinion" && homeAllowed(c.article))
      .sort((x, y) => y.episode - x.episode)[0];
    if (!pick?.article) continue;
    out.push({ seriesKey: frame.key, seriesTitle: frame.title, basisHref: frame.basisHref, cadence: frame.cadence, episode: pick.episode, article: { ...pick.article, seriesTitle: frame.title, seriesEpisode: pick.episode, seriesBasisHref: frame.basisHref } });
  }
  return out;
}

export interface ThenNowView {
  position: number;
  label: string | null;
  thenText: string;
  nowText: string;
  source: string;
  sourceUrl: string | null;
  baseYear: number;
}

/** 「그때와 지금」 비교 항목 — 출처·기준연도가 둘 다 있는 줄만(뷰가 거른 뒤 한 번 더), 자리 순서 */
export function thenNowViews(rows: readonly { position: number; label: string | null; then_text: string; now_text: string; source: string | null; source_url: string | null; base_year: number | null }[]): ThenNowView[] {
  return rows
    .filter((r) => (r.source ?? "").trim() !== "" && Number.isInteger(Number(r.base_year)) && r.base_year !== null)
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((r) => ({
      position: Number(r.position),
      label: r.label?.trim() || null,
      thenText: r.then_text,
      nowText: r.now_text,
      source: r.source!.trim(),
      sourceUrl: r.source_url && /^https?:\/\//.test(r.source_url) ? r.source_url : null,
      baseYear: Number(r.base_year),
    }));
}
