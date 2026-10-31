// 시험용 기사 한 판 — DB 행 모양 그대로(칸 이름 snake_case). 가상 도시 가온시 정량형 보도기사, 발행 판정 통과 상태.
// mapping·gate·plan 시험이 한 곳만 바꿔 쓴다. 시험 전용 (*.test.ts만 가져온다)
import type { ArticleGraph, ArticleRow, MediaRow } from "./rows";
import type { GateSettings } from "./gate";
import { INTERNAL_SIMILARITY_RULES } from "@ltr/similarity";

export const AUTHOR_PERSON = 11;
export const EDITOR_PERSON = 22;
export const REVIEWER_PERSON = 33;

export function articleRow(over: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 101,
    slug: "gaon-acquisition-tax-2026h1",
    title: "가온시 상반기 취득세 18.4% 감소",
    summary: "가온시의 올해 상반기 취득세 징수액이 1년 전보다 18.4% 줄었습니다.",
    body: {
      blocks: [
        { type: "key_summary", lines: ["취득세 징수액은 1,284억 원입니다.", "거래는 21.6% 줄었습니다.", "거래 감소만으로 설명할 수 없습니다."] },
        { type: "paragraph", text: "편집국이 징수 실적을 집계해 보니 올해 1~6월 취득세 징수액은 1,284억 원이었다." },
        {
          type: "table",
          caption: "구별 취득세 징수액",
          rows: [["구", "억 원"], ["한빛구", "512"]],
          chart: { axis: "구", unit: "억 원", source: "가온시 세목별 징수 실적" },
        },
      ],
      claims: [{ id: "claim-1", text: "올해 1~6월 징수액은 1,284억 원이다.", kind: "fact", evidenceIds: ["ev:7"], blockIndex: 1 }],
    },
    format: "general",
    section: "local",
    content_type: "reported_news",
    reporting_method: "quantitative",
    origin: "new",
    category_id: 5,
    subtype: "general",
    solved_case: null,
    label: "none",
    partner_id: null,
    author_id: AUTHOR_PERSON,
    story_assignment_id: null,
    lead_media_id: null,
    lead_media_cleared: true,
    editorial_status: "approved",
    tax_review_status: "not_required",
    status: "approved",
    version: 3,
    publish_at: null,
    first_published_at: null,
    substantive_updated_at: null,
    updated_reason: null,
    update_kind: null,
    legal_basis_date: null,
    tax_lens: { topics: [], points: [], links: [], skip_reason: "세금 영향은 후속 기사에서", reviewed: false, reviewed_for_version: null, reviewed_by: null, reviewed_at: null },
    digest_id: null,
    // 지역 기사 게이트 (REG1-17 — W4 7단계): 지자체뉴스 기사는 지역 태그 + 편집 분야 + 공익적 질문 (가상 코드 접두 99)
    region_codes: ["9900100000"],
    editorial_field: "local_finance",
    public_question: "거래 감소가 가온시 취득세 세수에 어떤 영향을 주는가",
    amendment_id: null,
    series_title: null,
    series_episode: null,
    nav_candidate: false,
    hot_pin_until: null,
    is_paid: false,
    check_log: {
      checklists: {
        quantitative: { sourceCrossCheck: "재정공시 화면과 대조", limitations: "상관관계만 확인", relatedPartyCheck: "세정과 전화 확인" },
      },
    },
    created_at: "2026-10-10T00:00:00+00:00",
    updated_at: "2026-10-12T00:00:00+00:00",
    ...over,
  };
}

/** media 행 — 출처·이용 조건·크기는 비운 사진 (시험이 한 칸씩 채운다) */
export function mediaRow(over: Partial<MediaRow> & Pick<MediaRow, "id">): MediaRow {
  return { path: `media/${over.id}.jpg`, alt: null, rights_status: "unconfirmed", credit: null, photographer: null, license: null, kind: "photo", width: null, height: null, license_type: "not_applicable", crop_allowed: true, ...over };
}

export function graph(over: Partial<ArticleGraph> = {}, article: Partial<ArticleRow> = {}): ArticleGraph {
  return {
    article: articleRow(article),
    author: { id: AUTHOR_PERSON, slug: "reporter-kim", name: "견본 기자", staff_user_id: "u-reporter" },
    category: { id: 5, section: "local", slug: "reporting", name: "자체 취재", needs_disclaimer: false, needs_tax_lens: true },
    partner: null,
    media: [],
    sources: [
      {
        id: 3,
        article_id: 101,
        version: 1,
        kind: "dataset",
        title: "가온시 세목별 징수 실적",
        source_url: "https://www.gaon-si.example/open-data/collection",
        source_name: "가온시 세정과",
        provider: null,
        last_verified_at: "2026-10-07T01:00:00+00:00",
        license_status: "공공누리 제1유형",
        snapshot_id: null,
        supersedes_id: null,
        // W4 5단계 — 공식 자료 필수 칸 (REG1-09 · PR-07)
        license_type: "kogl_1",
        source_type: "local_tax_revenue",
        published_on: "2026-07-15",
        reference_date: "2026-06-30",
        region_unit: "시·구",
        collected_at: "2026-10-07T01:00:00+00:00",
      },
    ],
    snapshots: [],
    evidence: [
      {
        id: 7,
        article_id: 101,
        article_version: 1,
        evidence_type: "dataset",
        location: "편집국 자료실/징수실적.xlsx",
        rights_status: "confirmed",
        verified_at: "2026-10-09T01:00:00+00:00",
        owner_id: AUTHOR_PERSON,
        retention_until: "2031-10-09",
        verification_status: "verified",
      },
    ],
    datasets: [
      {
        evidence_id: 7,
        definition: "취득세 징수액",
        period: "1~6월",
        unit: "억 원",
        region_unit: "시·구",
        denominator: "전년 같은 기간 징수액",
        exclusions: "지방교육세",
        transform: "(올해 − 지난해) ÷ 지난해",
        repro_file_hash: "sha256:abc",
        provider: "가온시 세정과",
        source_url: "https://www.gaon-si.example/open-data/collection",
        collected_at: "2026-10-07T00:00:00+00:00",
        license: "공공누리 제1유형",
      },
    ],
    interviews: [],
    reviews: [
      {
        id: 1,
        article_id: 101,
        version: 3,
        kind: "desk_edit",
        reviewer_id: EDITOR_PERSON,
        decision: "approve",
        checklist: { noCausalClaim: true, evidence: true, relation: true, ad_independence: true },
        reason: null,
        at: "2026-10-12T07:00:00+00:00",
      },
    ],
    ...over,
  };
}

export const SETTINGS: GateSettings = {
  dictionaries: { forbiddenPhrases: ["절세 보장", "놓치면 끝"], fearPhrases: ["놓치면 끝", "세금 폭탄"], jargonTerms: [] },
  similarity: INTERNAL_SIMILARITY_RULES,
};

/** 규칙 대응 시험은 strict(규칙 목록 등급 그대로) — 간편 발행 정책은 SIMPLE_GATE_OPTIONS로 따로 본다 */
export const GATE_OPTIONS = { now: "2026-10-17T03:00:00.000Z", siteUrl: "https://e2e.example.test", publisherName: "견본 매체", peers: [], policy: "strict" as const };
export const SIMPLE_GATE_OPTIONS = { ...GATE_OPTIONS, policy: "simple" as const };
