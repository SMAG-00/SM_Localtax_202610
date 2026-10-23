import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { R8_THRESHOLDS, regionalState } from "@ltr/editorial";
import { dbError } from "../http";
import { readChecklists, readStoredBody, readStoredSolvedCase, readStoredTaxLens } from "./content";
import { toArticleForPublish } from "./mapping";
import { loadArticleGraph, loadOfficialSourceTypes, loadRegionalJudgeFields } from "./repository";
import type { ArticleRow } from "./rows";
import { articleSummary } from "./writes";

// 편집 화면용 기사 한 판 — GET /api/admin/articles/[id]와 백오피스 편집기(서버 컴포넌트)가 같은 모양을 쓴다.
// 비공개 취재 근거(evidence·재현 정보·인터뷰 기록)가 들어 있다 — 편집국 접근 판정을 통과한 뒤에만 부른다.

export interface RevisionBrief {
  id: number;
  version: number;
  edited_by: string;
  edited_at: string;
  reason: string | null;
  update_kind: string | null;
}

export interface CorrectionView {
  id: number;
  kind: string;
  reason: string;
  readerNotice: string | null;
  decidedBy: string;
  publishedAt: string | null;
  createdAt: string;
  before: { revisionId: number; version: number; title: string; body: unknown } | null;
  after: { revisionId: number; version: number; title: string; body: unknown } | null;
}

export async function loadEditorView(db: SupabaseClient, row: ArticleRow) {
  // 공식 자료 종류 허용 목록 — 출처 칸의 고르기 목록 (W4 5단계 REG1-07, 운영 설정)
  const [graph, officialSourceTypes, regionalJudgeFields] = await Promise.all([loadArticleGraph(db, row), loadOfficialSourceTypes(db), loadRegionalJudgeFields(db)]);
  // 지역 기사 판정 상태 (REG1-17 — 발행 판정과 같은 검사, 편집 화면 '지역 기사 판정' 줄)
  const regional = regionalState(toArticleForPublish(graph), {
    today: new Date().toISOString().slice(0, 10),
    dictionaries: { forbiddenPhrases: [], fearPhrases: [], jargonTerms: [] },
    thresholds: R8_THRESHOLDS,
    seoLint: null,
    similarity: null,
    regionalJudgeFields,
  });
  const [revisionsRes, correctionsRes] = await Promise.all([
    db.from("article_revisions").select("id, version, edited_by, edited_at, reason, update_kind").eq("article_id", row.id).order("version"),
    db
      .from("article_corrections")
      .select("id, kind, reason, reader_notice, before_revision_id, after_revision_id, decided_by, published_at, created_at")
      .eq("article_id", row.id)
      .order("created_at")
      .order("id"),
  ]);
  if (revisionsRes.error) throw dbError(revisionsRes.error, "article_revisions 읽기");
  if (correctionsRes.error) throw dbError(correctionsRes.error, "article_corrections 읽기");
  const revisions = (revisionsRes.data ?? []) as RevisionBrief[];
  const correctionRows = (correctionsRes.data ?? []) as {
    id: number;
    kind: string;
    reason: string;
    reader_notice: string | null;
    before_revision_id: number | null;
    after_revision_id: number | null;
    decided_by: string;
    published_at: string | null;
    created_at: string;
  }[];

  // 정정 전후 버전의 제목·본문 (NAV-06 — 전후 버전을 보인다)
  const revisionIds = [...new Set(correctionRows.flatMap((c) => [c.before_revision_id, c.after_revision_id]).filter((x): x is number => x !== null))];
  const bodies = new Map<number, { id: number; version: number; title: string; body: unknown }>();
  if (revisionIds.length > 0) {
    const { data, error } = await db.from("article_revisions").select("id, version, title, body").in("id", revisionIds);
    if (error) throw dbError(error, "article_revisions 읽기");
    for (const r of (data ?? []) as { id: number; version: number; title: string; body: unknown }[]) bodies.set(r.id, r);
  }
  const revisionOf = (id: number | null) => {
    const r = id === null ? undefined : bodies.get(id);
    return r ? { revisionId: r.id, version: r.version, title: r.title, body: r.body } : null;
  };
  const corrections: CorrectionView[] = correctionRows.map((c) => ({
    id: c.id,
    kind: c.kind,
    reason: c.reason,
    readerNotice: c.reader_notice,
    decidedBy: c.decided_by,
    publishedAt: c.published_at,
    createdAt: c.created_at,
    before: revisionOf(c.before_revision_id),
    after: revisionOf(c.after_revision_id),
  }));

  return {
    article: {
      ...articleSummary(row),
      summary: row.summary,
      body: readStoredBody(row.body),
      format: row.format,
      reportingMethod: row.reporting_method,
      categoryId: row.category_id,
      subtype: row.subtype,
      solvedCase: readStoredSolvedCase(row.solved_case),
      label: row.label,
      partnerId: row.partner_id,
      authorId: row.author_id,
      storyAssignmentId: row.story_assignment_id,
      leadMediaId: row.lead_media_id,
      legalBasisDate: row.legal_basis_date,
      taxLens: readStoredTaxLens(row.tax_lens),
      amendmentId: row.amendment_id,
      regionCodes: row.region_codes,
      editorialField: row.editorial_field,
      publicQuestion: row.public_question,
      subjectKind: row.subject_kind ?? "general",
      relationTypes: row.relation_types ?? [],
      editorialJudgement: row.editorial_judgement ?? null,
      judgedBy: row.judged_by ?? null,
      judgedAt: row.judged_at ?? null,
      coveredPartnerIds: row.covered_partner_ids ?? [],
      interestDisclosure: row.interest_disclosure ?? null,
      coversBillStatus: row.covers_bill_status === true,
      seriesTitle: row.series_title ?? null,
      seriesEpisode: row.series_episode ?? null,
      navCandidate: row.nav_candidate,
      hotPinUntil: row.hot_pin_until,
      checklists: readChecklists(row.check_log),
    },
    author: graph.author,
    sources: graph.sources,
    officialSourceTypes,
    regional,
    regionalJudgeFields,
    evidence: graph.evidence.map((e) => ({
      ...e,
      dataset: graph.datasets.find((d) => d.evidence_id === e.id) ?? null,
      interview: graph.interviews.find((i) => i.evidence_id === e.id) ?? null,
    })),
    reviews: graph.reviews,
    revisions,
    corrections,
  };
}

export type EditorView = Awaited<ReturnType<typeof loadEditorView>>;
