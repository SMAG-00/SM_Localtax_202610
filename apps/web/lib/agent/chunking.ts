// 청킹 순수 함수 (W12-a a2 - PRD-04 RAG-01, docs/dev/W12-a_설계.md). DB·네트워크·AI 없음.
// 법령은 조 단위(긴 조는 항 단위)에 "법령명 > 조" 경로, 결정례는 요지·이유 단락, 출판물·가이드는 절 단위, 쟁점 지도는 버전 요약 + 연결 표 행.
// 메타(문서 유형·세목·시행일 또는 결정일·접근 등급·권리 상태·범위 태그)가 하나라도 비면 만들지 않고 거부한다(validateChunkDraft).
// 이 파일에는 법령·세무 글이 없다 - 글은 모두 호출하는 쪽이 넘긴다.
import { createHash } from "node:crypto";

export const SOURCE_TYPES = ["law_article", "interpretation", "case_decision", "guide_version", "issue_graph_version", "publication", "article", "glossary_term"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const SCOPES = ["base", "trust_redevelopment", "inheritance", "gift"] as const;
export type ChunkScope = (typeof SCOPES)[number];
export const ACCESS_TIERS = ["public", "premium"] as const;
export const RIGHTS_STATUSES = ["confirmed", "unchecked", "restricted"] as const;

/** 원천 종류 -> 허용 문서 유형 (DB 제약 chunks_type_pair와 같다) */
export const DOC_TYPES_BY_SOURCE: Record<SourceType, readonly string[]> = {
  law_article: ["law"],
  interpretation: ["ruling", "circular", "interpretation"],
  case_decision: ["tribunal", "case"],
  guide_version: ["guide"],
  issue_graph_version: ["issue_graph"],
  publication: ["publication"],
  article: ["article"],
  glossary_term: ["glossary"],
};

/** 색인 버전 - 청킹 규칙이 바뀌면 올린다(전체 다시 색인) */
export const INDEX_VERSION = "chunk-v1";
/** 토큰 어림: 글자 수 / 2 [확인 필요: 선정된 공급자의 토크나이저로 PoC 때 보정] */
export const CHARS_PER_TOKEN = 2;
export const DEFAULT_MIN_TOKENS = 300;
export const DEFAULT_MAX_TOKENS = 800;
export const MAX_CHUNK_CHARS = 20000;

export type ChunkMeta = {
  sourceType: SourceType;
  sourceId: string;
  docType: string;
  taxItems: string[];
  /** YYYY-MM-DD: 법령 시행일 · 결정일 · 기준일 */
  validFrom: string;
  validTo?: string | null;
  accessTier: (typeof ACCESS_TIERS)[number];
  rightsStatus: (typeof RIGHTS_STATUSES)[number];
  scope: ChunkScope;
  snapshotId: number | null;
  sourceHash: string;
  supersedeKey?: string | null;
};

export type ChunkDraft = { chunkNo: number; path: string; content: string; tokenEst: number; contentHash: string };
export type ChunkResult = { ok: true; chunks: ChunkDraft[] } | { ok: false; code: string; fields?: string[] };

export type ChunkOptions = { minTokens?: number; maxTokens?: number };

export function estimateTokens(text: string): number {
  const n = text.replace(/\s+/g, "").length;
  return n === 0 ? 0 : Math.ceil(n / CHARS_PER_TOKEN);
}
export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 메타 검사 - 빈 칸이 있으면 { ok:false, code:'meta_missing', fields } (RAG-01 수용: 메타가 빈 청크는 색인 거부) */
export function validateMeta(m: Partial<ChunkMeta> | null | undefined): { ok: true } | { ok: false; code: string; fields: string[] } {
  const fields: string[] = [];
  if (!m) return { ok: false, code: "meta_missing", fields: ["meta"] };
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  if (!m.sourceType || !(SOURCE_TYPES as readonly string[]).includes(m.sourceType)) fields.push("sourceType");
  if (blank(m.sourceId)) fields.push("sourceId");
  if (blank(m.docType)) fields.push("docType");
  if (!Array.isArray(m.taxItems) || m.taxItems.length === 0 || m.taxItems.some((t) => blank(t))) fields.push("taxItems");
  if (blank(m.validFrom) || !DATE.test(m.validFrom as string)) fields.push("validFrom");
  if (!m.accessTier || !(ACCESS_TIERS as readonly string[]).includes(m.accessTier)) fields.push("accessTier");
  if (!m.rightsStatus || !(RIGHTS_STATUSES as readonly string[]).includes(m.rightsStatus)) fields.push("rightsStatus");
  if (!m.scope || !(SCOPES as readonly string[]).includes(m.scope)) fields.push("scope");
  if (blank(m.sourceHash)) fields.push("sourceHash");
  if (fields.length) return { ok: false, code: "meta_missing", fields };
  const mm = m as ChunkMeta;
  if (!DOC_TYPES_BY_SOURCE[mm.sourceType].includes(mm.docType)) return { ok: false, code: "doc_type_mismatch", fields: ["docType"] };
  if (mm.rightsStatus !== "confirmed") return { ok: false, code: "rights_not_confirmed", fields: ["rightsStatus"] };
  // RAG-06 / ASK-14: 출판물은 프리미엄 등급 + 권리 확인만
  if (mm.sourceType === "publication" && mm.accessTier !== "premium") return { ok: false, code: "publication_must_be_premium", fields: ["accessTier"] };
  if (["law_article", "interpretation", "case_decision"].includes(mm.sourceType) && (mm.snapshotId === null || mm.snapshotId === undefined)) return { ok: false, code: "snapshot_required", fields: ["snapshotId"] };
  if (mm.validTo && (!DATE.test(mm.validTo) || mm.validTo <= mm.validFrom)) return { ok: false, code: "bad_valid_range", fields: ["validTo"] };
  return { ok: true };
}

/** 청크 한 개 검사 */
export function validateChunkDraft(d: Partial<ChunkDraft>): { ok: true } | { ok: false; code: string; fields: string[] } {
  const fields: string[] = [];
  if (typeof d.path !== "string" || d.path.trim() === "") fields.push("path");
  if (typeof d.content !== "string" || d.content.trim() === "") fields.push("content");
  if (d.content && d.content.length > MAX_CHUNK_CHARS) fields.push("content");
  if (!Number.isInteger(d.chunkNo) || (d.chunkNo as number) < 0) fields.push("chunkNo");
  if (!Number.isInteger(d.tokenEst) || (d.tokenEst as number) <= 0) fields.push("tokenEst");
  if (typeof d.contentHash !== "string" || !/^[0-9a-f]{64}$/.test(d.contentHash)) fields.push("contentHash");
  return fields.length ? { ok: false, code: "meta_missing", fields } : { ok: true };
}

const SENTENCE_END = /(?<=[.!?。]|다\.)\s+/u;

/** 글을 최대 토큰 이하 조각으로 나눈다 - 문단 -> 문장 -> 글자 순으로 쪼개고, 이웃 조각을 최대까지 채워 붙인다. 마지막 조각이 최소보다 작으면 앞 조각에 붙을 수 있을 때 붙인다 */
export function splitByTokens(text: string, opts: ChunkOptions = {}): string[] {
  const min = opts.minTokens ?? DEFAULT_MIN_TOKENS;
  const max = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxChars = max * CHARS_PER_TOKEN;
  const units: string[] = [];
  for (const para of text.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean)) {
    if (estimateTokens(para) <= max) {
      units.push(para);
      continue;
    }
    for (const sent of para.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)) {
      if (estimateTokens(sent) <= max) units.push(sent);
      else for (let i = 0; i < sent.length; i += maxChars) units.push(sent.slice(i, i + maxChars));
    }
  }
  const out: string[] = [];
  let cur = "";
  for (const u of units) {
    const next = cur ? `${cur}\n${u}` : u;
    if (cur && estimateTokens(next) > max) {
      out.push(cur);
      cur = u;
    } else cur = next;
  }
  if (cur) {
    if (out.length && estimateTokens(cur) < min && estimateTokens(`${out[out.length - 1]}\n${cur}`) <= max) out[out.length - 1] = `${out[out.length - 1]}\n${cur}`;
    else out.push(cur);
  }
  return out;
}

function finish(meta: ChunkMeta, parts: { path: string; content: string }[]): ChunkResult {
  const v = validateMeta(meta);
  if (!v.ok) return v;
  const chunks: ChunkDraft[] = [];
  for (const p of parts) {
    const content = p.content.trim();
    if (!content) continue;
    chunks.push({ chunkNo: chunks.length, path: p.path, content, tokenEst: estimateTokens(content), contentHash: sha256Hex(`${p.path}\n${content}`) });
  }
  for (const c of chunks) {
    const r = validateChunkDraft(c);
    if (!r.ok) return r;
  }
  return { ok: true, chunks };
}

const CIRCLED = /^[①-⑳]/; // ① ~ ⑳

/** 법령 조문 - 조 단위, 길면 항 단위(①②… 시작 줄). 경로: 법령명 > (장) > 제N조(제목) [> 제k항] */
export function chunkLawArticle(
  a: { lawName: string; articleNo: number; branchNo?: number; title?: string | null; body: string; chapterPath?: string[] },
  meta: ChunkMeta,
  opts: ChunkOptions = {},
): ChunkResult {
  const label = `제${a.articleNo}조${a.branchNo && a.branchNo > 0 ? `의${a.branchNo}` : ""}${a.title ? `(${a.title})` : ""}`;
  const base = [a.lawName, ...(a.chapterPath ?? []), label].join(" > ");
  const max = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (estimateTokens(a.body) <= max) return finish(meta, [{ path: base, content: a.body }]);
  // 항 나누기: 첫 항 앞 도입 글은 첫 항에 붙인다
  const lines = a.body.split("\n");
  const paras: { no: number | null; text: string }[] = [];
  const pre: string[] = [];
  for (const ln of lines) {
    if (CIRCLED.test(ln.trim())) paras.push({ no: ln.trim().codePointAt(0)! - 0x2460 + 1, text: ln.trim() });
    else if (paras.length) paras[paras.length - 1].text += `\n${ln}`;
    else pre.push(ln);
  }
  if (paras.length && pre.join("").trim()) paras[0].text = `${pre.join("\n").trim()}\n${paras[0].text}`;
  if (!paras.length) paras.push({ no: null, text: a.body });
  const parts: { path: string; content: string }[] = [];
  for (const p of paras) {
    const path = p.no ? `${base} > 제${p.no}항` : base;
    for (const piece of splitByTokens(p.text, opts)) parts.push({ path, content: piece });
  }
  return finish(meta, parts);
}

/** 결정례·해석 본문을 요지/이유 단락으로 나눈다. 머리말(요지·이유·주문·판단)이 한 줄에 단독으로 있을 때만 구분 [확인 필요: 실제 원문 형식은 실원문 확보 뒤 보정] */
export function splitDecisionBody(body: string, labels: { summary: string[]; reasoning: string[] } = { summary: ["요지", "판결요지", "결정요지"], reasoning: ["이유", "판단", "주문"] }): { summary: string; reasoning: string } {
  const head = (s: string) => s.trim().replace(/^[\[【(]\s*|\s*[\]】)]$/g, "").replace(/^\d+[.)]\s*/, "");
  let mode: "summary" | "reasoning" = "reasoning";
  const sum: string[] = [];
  const rea: string[] = [];
  for (const ln of body.split("\n")) {
    const h = head(ln);
    if (labels.summary.includes(h)) mode = "summary";
    else if (labels.reasoning.includes(h)) mode = "reasoning";
    else (mode === "summary" ? sum : rea).push(ln);
  }
  return { summary: sum.join("\n").trim(), reasoning: rea.join("\n").trim() };
}

/** 결정례·해석 - 요지와 이유 단락. 경로: 발행처 문서번호 > 요지|이유 */
export function chunkDecision(d: { issuer: string; docNo: string; summary?: string; reasoning?: string }, meta: ChunkMeta, opts: ChunkOptions = {}): ChunkResult {
  const root = `${d.issuer} ${d.docNo}`.trim();
  const parts: { path: string; content: string }[] = [];
  for (const piece of splitByTokens(d.summary ?? "", opts)) parts.push({ path: `${root} > 요지`, content: piece });
  for (const piece of splitByTokens(d.reasoning ?? "", opts)) parts.push({ path: `${root} > 이유`, content: piece });
  return finish(meta, parts);
}

/** 출판물 - 절 단위 + 목차 경로. 권리 확인(rightsStatus confirmed)과 프리미엄이 아니면 validateMeta가 거부한다 */
export function chunkPublication(p: { title: string; tocPath?: string[]; sections: { heading: string; text: string }[] }, meta: ChunkMeta, opts: ChunkOptions = {}): ChunkResult {
  const parts: { path: string; content: string }[] = [];
  for (const s of p.sections) for (const piece of splitByTokens(s.text, opts)) parts.push({ path: [p.title, ...(p.tocPath ?? []), s.heading].join(" > "), content: piece });
  return finish(meta, parts);
}

/** 가이드 버전 - 절 단위. 경로: 가이드 제목 > 절 제목 */
export function chunkGuide(g: { title: string; sections: { heading: string; body: string }[] }, meta: ChunkMeta, opts: ChunkOptions = {}): ChunkResult {
  const parts: { path: string; content: string }[] = [];
  for (const s of g.sections) for (const piece of splitByTokens(s.body, opts)) parts.push({ path: `${g.title} > ${s.heading}`, content: piece });
  return finish(meta, parts);
}

/** 쟁점 지도 버전 - 버전 요약 1건 + 연결 표 행(한 줄씩 묶음). 노드 이름은 호출하는 쪽이 원문 DB에서 읽어 넘긴다 */
export function chunkIssueGraph(
  g: { title: string; version: number; summary?: string | null; nodeRows: { nodeId: string; kind: string; label: string | null }[]; edgeRows: { from: string; to: string; relation: string; note?: string }[] },
  meta: ChunkMeta,
  opts: ChunkOptions = {},
): ChunkResult {
  const label = new Map(g.nodeRows.map((n) => [n.nodeId, n.label ?? n.nodeId]));
  const parts: { path: string; content: string }[] = [];
  const root = `${g.title} (지도 v${g.version})`;
  if (g.summary?.trim()) parts.push({ path: `${root} > 요약`, content: g.summary });
  const lines = g.edgeRows.map((e) => `${label.get(e.from) ?? e.from} -[${e.relation}]-> ${label.get(e.to) ?? e.to}${e.note ? ` (${e.note})` : ""}`);
  for (const piece of splitByTokens(lines.join("\n"), opts)) parts.push({ path: `${root} > 연결`, content: piece });
  return finish(meta, parts);
}

/** 임베딩 입력 글 - 경로 + 본문 */
export const embeddingText = (c: Pick<ChunkDraft, "path" | "content">): string => `${c.path}\n${c.content}`;
