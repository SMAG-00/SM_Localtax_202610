// 기사 상세의 출처 화면 값 (W4 5단계 — PRD-01B REG1-07 · REG1-09 · REG1-13 · PR-07, docs/dev/W4_설계.md 1장 5단계) — 순수 함수 (시험 source-cards.test.ts)
//  · 공식 자료 카드(원문 블록) — 발표기관이 낸 원자료의 사실만(자료 종류·제목·발표기관·발표일·기준일·지역 단위·확인일·공공누리 유형·원문 링크).
//    기자의 해석(기사 본문 블록)과 다른 구역에 그린다 — 카드에 본문 글자를 넣지 않는다 (REG1-07 '원문 블록 ≠ 해석')
//  · 카드가 되는 공식 자료 = 원문 URL(http/https)·발표기관·기준일·확인일·공공누리 유형이 모두 있는 것만 (REG1-07 '원문 URL·발표기관·기준일 중 하나가 없는
//    공식 자료는 공개 0' · REG1-13 '누락된 전문 자료는 공개 렌더 0'). 칸이 빈 옛 공식 자료(W4 전 법령 인용)는 카드가 아니라 아래 출처 줄에 이름만 남는다
//  · 출처 줄 — 공식 자료 카드가 아닌 출처. 공공누리 유형이 있으면 유형 글자를 함께 (PR-07 '자료 카드에 유형별 출처 표시')
//  · 원본 스냅샷 글자는 어디에도 그리지 않는다 (링크만 — W4 12장 #19)
//  · 검토 중 (W4 6단계 — REG1-13) — 원문이 바뀌었거나 확인일이 오래돼 편집국이 다시 확인하는 출처. 카드·줄에 '검토 중' 글자를 붙인다(원문 블록 쪽 —
//    기자의 해석인 본문 블록에는 붙이지 않는다). 값은 열린 검수 항목이 있는지뿐(사유·해시 0)
import { licenseBadge, sourceTypeLabel } from "@/lib/admin/official-source-rules";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HTTP = /^https?:\/\//i;
const OFFICIAL = new Set(["official_doc", "dataset"]);

export interface SourceCardInput {
  id: number;
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  provider: string | null;
  last_verified_at: string | null;
  published_on: string | null;
  reference_date: string | null;
  license_type?: string | null;
  source_type?: string | null;
  region_unit?: string | null;
  /** 열린 원문 검수 항목이 있음 (W4 6단계) */
  under_review?: boolean;
}

/** 검토 중 글자 (REG1-13 — 기사 화면 표시) */
export const UNDER_REVIEW_LABEL = "검토 중";
export const UNDER_REVIEW_NOTE = "원문이 바뀌었거나 확인한 지 오래되어 편집국이 이 자료를 다시 확인하고 있습니다.";

export interface OfficialSourceCard {
  id: number;
  /** 자료 종류 글자 — 비면 '공식 자료' */
  typeLabel: string;
  title: string;
  href: string;
  issuer: string;
  provider: string | null;
  publishedOn: string | null;
  referenceDate: string;
  regionUnit: string | null;
  /** 확인일 (한국 날짜) */
  verifiedOn: string;
  license: string;
  underReview: boolean;
}

export interface SourceLine {
  id: number;
  text: string;
  href: string | null;
  issuer: string | null;
  license: string | null;
  underReview: boolean;
}

const filled = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

function kstDate(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 공식 자료 카드 하나 — 카드 칸이 하나라도 비면 null */
export function officialCard(s: SourceCardInput): OfficialSourceCard | null {
  if (!OFFICIAL.has(s.kind)) return null;
  const license = licenseBadge(s.license_type);
  const verifiedOn = filled(s.last_verified_at) ? kstDate(s.last_verified_at) : null;
  if (!filled(s.source_url) || !HTTP.test(s.source_url.trim()) || !filled(s.source_name) || !filled(s.reference_date) || !verifiedOn || !license) return null;
  return {
    id: s.id,
    typeLabel: filled(s.source_type) ? sourceTypeLabel(s.source_type.trim()) : "공식 자료",
    title: filled(s.title) ? s.title.trim() : s.source_name.trim(),
    href: s.source_url.trim(),
    issuer: s.source_name.trim(),
    provider: filled(s.provider) && s.provider.trim() !== s.source_name.trim() ? s.provider.trim() : null,
    publishedOn: filled(s.published_on) ? s.published_on : null,
    referenceDate: s.reference_date,
    regionUnit: filled(s.region_unit) ? s.region_unit.trim() : null,
    verifiedOn,
    license,
    underReview: s.under_review === true,
  };
}

/** 출처 화면 값 — 공식 자료 카드(원문 블록)와 나머지 출처 줄. 이름도 제목도 없는 출처는 0 */
export function sourceCards(sources: readonly SourceCardInput[]): { official: OfficialSourceCard[]; lines: SourceLine[] } {
  const official: OfficialSourceCard[] = [];
  const lines: SourceLine[] = [];
  for (const s of sources) {
    const card = officialCard(s);
    if (card) {
      official.push(card);
      continue;
    }
    const text = filled(s.title) ? s.title.trim() : filled(s.source_name) ? s.source_name.trim() : null;
    if (!text) continue;
    lines.push({
      id: s.id,
      text,
      href: filled(s.source_url) && HTTP.test(s.source_url.trim()) ? s.source_url.trim() : null,
      issuer: filled(s.title) && filled(s.source_name) ? s.source_name.trim() : null,
      license: licenseBadge(s.license_type),
      underReview: s.under_review === true,
    });
  }
  return { official, lines };
}
