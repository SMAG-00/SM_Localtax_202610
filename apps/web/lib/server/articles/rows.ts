// DB 행 모양 — packages/db/supabase/migrations/20261018*.sql의 칸 이름 그대로 (서버가 service_role로 읽는다)

export interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  body: unknown;
  format: string;
  section: string;
  content_type: string | null;
  reporting_method: string | null;
  origin: string;
  category_id: number | null;
  subtype: string;
  solved_case: unknown;
  label: string;
  partner_id: number | null;
  author_id: number | null;
  story_assignment_id: number | null;
  lead_media_id: number | null;
  lead_media_cleared: boolean;
  editorial_status: string;
  tax_review_status: string;
  status: string;
  version: number;
  publish_at: string | null;
  first_published_at: string | null;
  substantive_updated_at: string | null;
  updated_reason: string | null;
  update_kind: string | null;
  legal_basis_date: string | null;
  tax_lens: unknown;
  digest_id: number | null;
  region_codes: string[];
  editorial_field: string | null;
  public_question: string | null;
  amendment_id: number | null;
  nav_candidate: boolean;
  hot_pin_until: string | null;
  is_paid: boolean;
  check_log: unknown;
  created_at: string;
  updated_at: string;
}

export interface PersonRow {
  id: number;
  slug: string;
  name: string;
  staff_user_id: string | null;
}

export interface CategoryRow {
  id: number;
  section: string;
  slug: string;
  name: string;
  needs_disclaimer: boolean;
  needs_tax_lens: boolean;
}

export interface PartnerRow {
  id: number;
  name: string;
  contract_from: string | null;
  contract_to: string | null;
}

export interface MediaRow {
  id: number;
  path: string;
  alt: string | null;
  rights_status: string;
}

export interface SourceRow {
  id: number;
  article_id: number;
  version: number;
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  provider: string | null;
  last_verified_at: string | null;
  license_status: string | null;
  snapshot_id: number | null;
  supersedes_id: number | null;
}

export interface SnapshotRow {
  id: number;
  payload: string;
}

export interface EvidenceRow {
  id: number;
  article_id: number;
  article_version: number;
  evidence_type: string;
  location: string;
  rights_status: string;
  verified_at: string | null;
  owner_id: number | null;
  retention_until: string | null;
  verification_status: string;
}

export interface DatasetRow {
  evidence_id: number;
  definition: string | null;
  period: string | null;
  unit: string | null;
  region_unit: string | null;
  denominator: string | null;
  exclusions: string | null;
  transform: string | null;
  repro_file_hash: string | null;
  provider: string | null;
  source_url: string | null;
  collected_at: string | null;
  license: string | null;
}

export interface InterviewRow {
  evidence_id: number;
  subject_role: string;
  contacted_at: string | null;
  record_location: string | null;
  quote_consent: string;
  anonymity: string;
  anonymity_reason: string | null;
}

export interface ReviewRow {
  id: number;
  article_id: number;
  version: number;
  kind: string;
  reviewer_id: number;
  decision: string;
  checklist: unknown;
  reason: string | null;
  at: string;
}

/** 발행 판정에 필요한 기사 한 판의 연결 기록 전부 */
export interface ArticleGraph {
  article: ArticleRow;
  author: PersonRow | null;
  category: CategoryRow | null;
  partner: PartnerRow | null;
  /** 대표 이미지와 본문 이미지·인포그래픽 블록이 가리키는 media 행 */
  media: MediaRow[];
  /** 대체되지 않은(최신) 공개 출처 */
  sources: SourceRow[];
  /** 출처가 가리키는 원본 스냅샷 (유사도 비교 원문) */
  snapshots: SnapshotRow[];
  evidence: EvidenceRow[];
  datasets: DatasetRow[];
  interviews: InterviewRow[];
  /** 시각 순서 */
  reviews: ReviewRow[];
}
