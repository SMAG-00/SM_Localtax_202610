// 해석 원문(legal_docs) 관리 입력 검사 (순수 모듈 — W3 5단계, TX-09). 서버 API·시험이 같은 함수를 쓴다.
// 원문·해설 내용은 편집국이 입력한다 — 여기서 만들어 채우는 값은 없다.
import { isHttpUrl, isRealDate } from "./amendment-rules";

export const LEGAL_DOC_TYPES = ["ruling", "circular", "interpretation", "tribunal", "case"] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];
export const LEGAL_DOC_TYPE_LABELS: Readonly<Record<LegalDocType, string>> = { ruling: "예규", circular: "통칙", interpretation: "유권해석", tribunal: "심판", case: "판례" };
export const RIGHTS_STATUSES = ["unchecked", "confirmed", "restricted"] as const;
export const LEGAL_DOC_OPS = ["create", "update", "link", "unlink", "mark", "unmark", "resolve"] as const;
export type LegalDocOp = (typeof LEGAL_DOC_OPS)[number];

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[1-9]\d{0,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(str).filter((s) => s !== ""))] : []);

export interface LegalDocInput {
  docType: LegalDocType;
  issuer: string | null;
  docNo: string | null;
  decidedOn: string | null;
  taxKinds: string[];
  provisions: string[];
  sourceUrl: string | null;
  rightsStatus: (typeof RIGHTS_STATUSES)[number];
  anonymityCheck: "unchecked" | "confirmed";
  /** 이미 있는 원본 스냅샷 번호 — 또는 snapshotPayload(붙여 넣은 원문 글자)로 새로 만든다 */
  snapshotId: number | null;
  snapshotPayload: string | null;
}

export function parseLegalDoc(body: Record<string, unknown>): Result<LegalDocInput> {
  const errors: string[] = [];
  const docType = str(body.docType);
  if (!(LEGAL_DOC_TYPES as readonly string[]).includes(docType)) errors.push("docType: 예규·통칙·유권해석·심판·판례 중 하나입니다");
  const decidedOn = str(body.decidedOn) || null;
  if (decidedOn !== null && !isRealDate(decidedOn)) errors.push("decidedOn: 결정일을 YYYY-MM-DD로 입력하세요");
  const sourceUrl = str(body.sourceUrl) || null;
  if (sourceUrl !== null && !isHttpUrl(sourceUrl)) errors.push("sourceUrl: 원문 주소는 http·https만 가능합니다");
  const rights = str(body.rightsStatus) || "unchecked";
  if (!(RIGHTS_STATUSES as readonly string[]).includes(rights)) errors.push("rightsStatus: unchecked·confirmed·restricted 중 하나입니다");
  const anon = str(body.anonymityCheck) || "unchecked";
  if (anon !== "unchecked" && anon !== "confirmed") errors.push("anonymityCheck: unchecked·confirmed 중 하나입니다");
  const snapshotId = body.snapshotId === undefined || body.snapshotId === "" || body.snapshotId === null ? null : posInt(body.snapshotId);
  if (body.snapshotId !== undefined && body.snapshotId !== "" && body.snapshotId !== null && snapshotId === null) errors.push("snapshotId: 번호를 확인하세요");
  const snapshotPayload = str(body.snapshotPayload) || null;
  if (snapshotId !== null && snapshotPayload !== null) errors.push("snapshot: 스냅샷 번호와 원문 글자 중 하나만 입력하세요");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      docType: docType as LegalDocType,
      issuer: str(body.issuer) || null,
      docNo: str(body.docNo) || null,
      decidedOn,
      taxKinds: list(body.taxKinds),
      provisions: list(body.provisions),
      sourceUrl,
      rightsStatus: rights as LegalDocInput["rightsStatus"],
      anonymityCheck: anon as LegalDocInput["anonymityCheck"],
      snapshotId,
      snapshotPayload,
    },
  };
}

/** 공개에 필요한 칸 중 빠진 것 — DB 함수 legal_doc_public과 같은 기준 (편집 화면 안내용) */
export function missingForPublic(d: {
  docType: string;
  issuer: string | null;
  docNo: string | null;
  decidedOn: string | null;
  taxKinds: readonly string[];
  sourceUrl: string | null;
  hasSnapshot: boolean;
  rightsStatus: string;
  anonymityCheck: string;
}): string[] {
  const m: string[] = [];
  if (!d.issuer) m.push("발행 기관");
  if (!d.docNo) m.push("문서 번호");
  if (!d.decidedOn) m.push("결정일");
  if (d.taxKinds.length === 0) m.push("세목");
  if (!d.sourceUrl) m.push("원문 주소");
  if (!d.hasSnapshot) m.push("원본 스냅샷");
  if (d.rightsStatus !== "confirmed") m.push("권리 확인");
  if ((d.docType === "tribunal" || d.docType === "case") && d.anonymityCheck !== "confirmed") m.push("비실명 확인");
  return m;
}

export function parseDocLink(body: Record<string, unknown>): Result<{ articleId: number; legalDocId: number; role: "subject" | "related" }> {
  const articleId = posInt(body.articleId);
  const legalDocId = posInt(body.legalDocId);
  const role = str(body.role) || "subject";
  const errors: string[] = [];
  if (articleId === null) errors.push("articleId: 기사 번호를 확인하세요");
  if (legalDocId === null) errors.push("legalDocId: 원문 번호를 확인하세요");
  if (role !== "subject" && role !== "related") errors.push("role: subject·related 중 하나입니다");
  if (errors.length || articleId === null || legalDocId === null) return { ok: false, errors };
  return { ok: true, value: { articleId, legalDocId, role: role as "subject" | "related" } };
}

export function parseId(body: Record<string, unknown>, key: string): Result<number> {
  const n = posInt(body[key]);
  return n === null ? { ok: false, errors: [`${key}: 번호를 확인하세요`] } : { ok: true, value: n };
}
