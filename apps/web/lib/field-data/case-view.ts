import { licenseBadge } from "@/lib/admin/official-source-rules";

// 금융 사례 DB 공개 화면 값 (W10-h h4 - PRD-02 DF-07). 순수 함수 (시험 case-view.test.ts).
// 공개 뷰 public_finance_case_entries 한 행 -> 카드에 그릴 값. 수익률·투자 권유·가입 링크 요소는 만들지 않는다.

export const STRUCTURE_LABELS: Readonly<Record<string, string>> = { trust: "신탁 유형", completion_guarantee: "책임준공", pf_stage: "PF 단계", reit: "리츠" };

export interface CaseEntryRow {
  id: number;
  slug: string;
  title: string;
  structure_type: string;
  issues: string[];
  outcome: string | null;
  as_of: string;
  sources: unknown;
  companies: string[];
  rebuttal_requested_on: string | null;
  rebuttal_status: string | null;
  article_ids: number[];
  license_type: string | null;
  source_name: string | null;
  checked_on: string | null;
}

export interface CaseEntryCard {
  id: number;
  slug: string;
  title: string;
  structureType: string;
  structureLabel: string;
  issues: string[];
  outcome: string | null;
  asOf: string;
  sources: { label: string; url: string }[];
  companies: string[];
  /** 실명 기업이 있을 때만 - 요청일과 회신 또는 '회신 없음' */
  rebuttalLine: string | null;
  /** 데이터 출처 줄: 원천 이름 · 확인일 · 공공누리 유형 (연동 항목만) */
  sourceLine: string | null;
}

const REBUTTAL_LABELS: Readonly<Record<string, string>> = { answered: "회신 있음", no_response: "회신 없음", declined: "답변 거절" };

/** 공개 출처 목록 - 이름이 있고 http(s) 주소인 것만 */
export function publicSources(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { label: string; url: string } => !!x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string" && typeof (x as { url?: unknown }).url === "string")
    .map((x) => ({ label: x.label.trim(), url: x.url.trim() }))
    .filter((x) => x.label !== "" && /^https?:\/\/[^\s]+$/i.test(x.url));
}

export function rebuttalLine(companies: readonly string[], requestedOn: string | null, status: string | null): string | null {
  if (companies.length === 0 || !requestedOn || !status || !REBUTTAL_LABELS[status]) return null;
  return `반론 요청 ${requestedOn} · ${REBUTTAL_LABELS[status]}`;
}

export function caseSourceLine(sourceName: string | null, checkedOn: string | null, licenseType: string | null): string | null {
  if (!sourceName) return null;
  const parts = [`출처 ${sourceName}`];
  if (checkedOn) parts.push(`확인일 ${checkedOn}`);
  const license = licenseBadge(licenseType);
  if (license) parts.push(license);
  return parts.join(" · ");
}

export function caseEntryCard(r: CaseEntryRow): CaseEntryCard {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    structureType: r.structure_type,
    structureLabel: STRUCTURE_LABELS[r.structure_type] ?? r.structure_type,
    issues: r.issues,
    outcome: r.outcome,
    asOf: r.as_of,
    sources: publicSources(r.sources),
    companies: r.companies,
    rebuttalLine: rebuttalLine(r.companies, r.rebuttal_requested_on, r.rebuttal_status),
    sourceLine: caseSourceLine(r.source_name, r.checked_on, r.license_type),
  };
}
