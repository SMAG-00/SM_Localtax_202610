// 근거 문서·인용 처리 - 순수 (W12-b b2, PRD-04 6.5 · ASK-03 · 4단계 설계 4.3).
// 재순위를 거친 청크를 문서 블록으로 넣고(제목 = source_id), 모델 인용을 source_id에 대응시킨다.
// 인용 칩의 번호·일자는 검색 결과(DB 원문 메타)에서만 만든다 - 모델 문장에서 가져오지 않는다.
import type { ContentBlock, TextBlock } from "../assistant/anthropic";

export type EvidenceSourceType = "law_article" | "interpretation" | "case_decision" | "guide_version" | "issue_graph_version" | "publication" | "article" | "glossary_term" | "live_snapshot";

export interface EvidenceDoc {
  sourceId: string;
  sourceType: EvidenceSourceType;
  docType: string;
  /** 경로 메타 - "법령명 > 제N조" · "발행처 문서번호 > 요지" (조문·사건번호 대조의 기준) */
  path: string;
  content: string;
  taxItems: string[];
  validFrom: string;
  validTo: string | null;
  scope: string;
  accessTier: string;
  chunkId: number | null;
  snapshotId: number | null;
  /** 실시간 조회 원문 - 스냅샷이 저장되고 해시가 맞아야 인용으로 인정 (V2) */
  isLive: boolean;
  snapshotOk: boolean;
  fetchedAt: string | null;
  /** 쟁점 지도 인용에 붙일 서명 버전·감수일 */
  mapVersion: string | null;
  reviewedOn: string | null;
  score: number;
}

export interface Chip {
  kind: string;
  label: string;
  sourceId: string;
  sourceType: EvidenceSourceType;
  validFrom: string;
  live: boolean;
  /** 실시간 원문 - 패널에 `실시간 · 미검수 · 조회 시각` */
  unreviewed: boolean;
  fetchedAt: string | null;
  mapNote: string | null;
  premium: boolean;
}

const CHIP_KIND: Record<string, string> = { law: "법", ruling: "규", circular: "규", interpretation: "해", tribunal: "심", case: "판", publication: "책", guide: "가이드", issue_graph: "지도", article: "기사", glossary: "용어" };

export function renderChip(doc: EvidenceDoc): Chip {
  const kind = doc.isLive ? (CHIP_KIND[doc.docType] ?? "원문") : (CHIP_KIND[doc.docType] ?? "자료");
  return {
    kind,
    label: `${kind} ${doc.path}`,
    sourceId: doc.sourceId,
    sourceType: doc.sourceType,
    validFrom: doc.validFrom,
    live: doc.isLive,
    unreviewed: doc.isLive,
    fetchedAt: doc.fetchedAt,
    mapNote: doc.sourceType === "issue_graph_version" && doc.mapVersion ? `${doc.mapVersion} · 감수 ${doc.reviewedOn ?? "확인 필요"}` : null,
    premium: doc.accessTier === "premium",
  };
}

// ── 조문·사건번호 추출 (V2) ──────────────────────

const ARTICLE = /제\s?(\d{1,4})\s?조(?:\s?의\s?(\d{1,3}))?/gu;
const CASE_NO = /\d{2,4}\s?(?:헌[가-힣]|[두누다도구합허지재후나라마바사아자차카타파하고노])\s?\d{2,7}/gu;

/** 글 속 조문("제3조"·"제3조의2")과 사건번호("2023두12345")를 정규형으로 뽑는다. 항·호는 보지 않는다 */
export function extractRefs(text: string): string[] {
  const t = text.normalize("NFKC");
  const out = new Set<string>();
  for (const m of t.matchAll(ARTICLE)) out.add(`제${m[1]}조${m[2] ? `의${m[2]}` : ""}`);
  for (const m of t.matchAll(CASE_NO)) out.add(m[0].replace(/\s+/gu, ""));
  return [...out];
}

/** 문서 메타의 조문·사건번호 (경로에서만 - 본문 안의 다른 조문 언급은 메타가 아니다) */
export const docRefs = (doc: EvidenceDoc): string[] => extractRefs(doc.path);

// ── 문서 블록 · 컨텍스트 ──────────────────────

/** 토큰 어림 - 글자 수 / 2 (W12-a 청킹과 같은 어림) */
export const approxTokens = (s: string): number => Math.ceil(Array.from(s).length / 2);

export function selectContext(docs: readonly EvidenceDoc[], limits: { contextChunks: number; contextTokens: number }): EvidenceDoc[] {
  const out: EvidenceDoc[] = [];
  let tokens = 0;
  for (const d of docs) {
    if (out.length >= limits.contextChunks) break;
    const t = approxTokens(d.content);
    if (tokens + t > limits.contextTokens && out.length > 0) break;
    tokens += t;
    out.push(d);
  }
  return out;
}

export interface DocumentBlock {
  type: "document";
  source: { type: "text"; media_type: "text/plain"; data: string };
  title: string;
  context: string;
  citations: { enabled: true };
}

export const buildDocumentBlocks = (docs: readonly EvidenceDoc[]): DocumentBlock[] =>
  docs.map((d) => ({
    type: "document",
    source: { type: "text", media_type: "text/plain", data: d.content },
    title: d.sourceId,
    context: `${d.path} | ${d.validFrom}${d.validTo ? `~${d.validTo}` : ""}${d.isLive ? " | 실시간 미검수" : ""}`,
    citations: { enabled: true },
  }));

// ── 응답 → 문단 + 인용 ─────────────────────────

export interface AgentParagraph {
  text: string;
  cited: EvidenceDoc[];
}

const isText = (b: ContentBlock): b is TextBlock => b.type === "text" && typeof (b as TextBlock).text === "string";

/** 인용 한 건이 가리키는 문서 - document_index 우선, 없으면 document_title(= source_id) */
export function citationsOf(block: TextBlock, docs: readonly EvidenceDoc[]): EvidenceDoc[] {
  const found: EvidenceDoc[] = [];
  for (const c of block.citations ?? []) {
    const r = c as unknown as { document_index?: unknown; document_title?: unknown };
    let doc: EvidenceDoc | undefined;
    if (typeof r.document_index === "number") doc = docs[r.document_index];
    if (!doc && typeof r.document_title === "string") doc = docs.find((d) => d.sourceId === r.document_title);
    if (doc && !found.includes(doc)) found.push(doc);
  }
  return found;
}

/** 응답 블록 → 문단 (빈 줄로 나누고, 인용은 그 글 블록의 문단에 붙인다) */
export function paragraphsFromContent(content: readonly ContentBlock[], docs: readonly EvidenceDoc[], maxParagraphs = 8): AgentParagraph[] {
  const paras: Array<{ text: string; cited: EvidenceDoc[] }> = [{ text: "", cited: [] }];
  for (const b of content) {
    if (!isText(b)) continue;
    const cites = citationsOf(b, docs);
    b.text.split(/\n{2,}/u).forEach((part, i) => {
      if (i > 0) paras.push({ text: "", cited: [] });
      const cur = paras[paras.length - 1]!;
      cur.text += part;
      if (part.trim() !== "") for (const d of cites) if (!cur.cited.includes(d)) cur.cited.push(d);
    });
  }
  return paras.filter((p) => p.text.trim() !== "").slice(0, maxParagraphs).map((p) => ({ text: p.text.trim(), cited: p.cited }));
}
