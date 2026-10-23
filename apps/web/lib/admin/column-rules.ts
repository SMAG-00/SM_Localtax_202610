// 칼럼 필자 체계 관리 입력 검사 (순수 모듈 — W3 6단계, TX-14~17). 서버 API·시험이 같은 함수를 쓴다.
// 필자 증빙·계약 내용·이해관계 문구는 편집국이 입력한다 — 여기서 만들어 채우는 값은 없다.
import { isRealDate } from "./amendment-rules";

export const COLUMN_OPS = ["verify", "contract", "meta", "interest_items"] as const;
/** 시그니처 연재 쓰기 (W3 8단계) — 권한 작업 column.signature */
export const SIGNATURE_OPS = ["signature", "then_now", "series_title", "cadence"] as const;
export type ColumnOp = (typeof COLUMN_OPS)[number];
export const EVIDENCE_KINDS = ["license", "registration", "affiliation", "other"] as const;
export const REUSE_SCOPES = ["print", "online", "book", "external"] as const;
export const AI_INDEX_SCOPES = ["allow", "deny"] as const;
/** 재검증 기한 설정이 없을 때만 쓰는 값 (settings.column_reverify_days 초기값과 같다 — 설계 2.2) */
export const DEFAULT_REVERIFY_DAYS = 365;

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[1-9]\d{0,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.map(str).filter((s) => s !== ""))] : []);

export interface VerifyInput {
  personId: number;
  evidenceKind: (typeof EVIDENCE_KINDS)[number];
  evidenceRef: string;
  /** 비면 verified_at + 재검증 기한(설정) */
  expiresAt: string | null;
}
export function parseVerify(body: Record<string, unknown>): Result<VerifyInput> {
  const errors: string[] = [];
  const personId = posInt(body.personId);
  if (personId === null) errors.push("personId: 필자 번호를 확인하세요");
  const kind = str(body.evidenceKind);
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) errors.push("evidenceKind: license·registration·affiliation·other 중 하나입니다");
  const ref = str(body.evidenceRef);
  if (ref === "") errors.push("evidenceRef: 증빙 위치(참조)를 입력하세요");
  const expiresAt = str(body.expiresAt) || null;
  if (expiresAt !== null && !(Number.isFinite(Date.parse(expiresAt)) && /^\d{4}-\d{2}-\d{2}/.test(expiresAt))) errors.push("expiresAt: 날짜를 YYYY-MM-DD로 입력하세요");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { personId: personId!, evidenceKind: kind as VerifyInput["evidenceKind"], evidenceRef: ref, expiresAt } };
}

export interface ContractInput {
  personId: number;
  docRef: string;
  signedOn: string;
  reuseScope: string[];
  aiIndexScope: "allow" | "deny";
  bookTitles: string[];
}
export function parseContract(body: Record<string, unknown>): Result<ContractInput> {
  const errors: string[] = [];
  const personId = posInt(body.personId);
  if (personId === null) errors.push("personId: 필자 번호를 확인하세요");
  const docRef = str(body.docRef);
  if (docRef === "") errors.push("docRef: 계약 문서 위치(참조)를 입력하세요");
  const signedOn = str(body.signedOn);
  if (!isRealDate(signedOn)) errors.push("signedOn: 서명일을 YYYY-MM-DD로 입력하세요");
  const reuse = list(body.reuseScope);
  if (reuse.length === 0) errors.push("reuseScope: 재수록 범위를 1개 이상 고르세요");
  else if (reuse.some((r) => !(REUSE_SCOPES as readonly string[]).includes(r))) errors.push("reuseScope: print·online·book·external만 가능합니다");
  const ai = str(body.aiIndexScope);
  if (ai !== "allow" && ai !== "deny") errors.push("aiIndexScope: allow·deny 중 하나입니다 (필수)");
  const books = list(body.bookTitles);
  if (books.length > 0 && !reuse.includes("book")) errors.push("bookTitles: 재수록 범위에 book이 없으면 도서 수록 목록을 저장할 수 없습니다");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { personId: personId!, docRef, signedOn, reuseScope: reuse, aiIndexScope: ai as "allow" | "deny", bookTitles: books } };
}

export interface MetaInput {
  articleId: number;
  personId: number;
  contractId: number | null;
  interestState: "declared" | "none_confirmed";
  interestText: string | null;
  /** none_confirmed일 때 필자 확인을 받은 사람 */
  confirmedBy: string | null;
}
export function parseMeta(body: Record<string, unknown>): Result<MetaInput> {
  const errors: string[] = [];
  const articleId = posInt(body.articleId);
  if (articleId === null) errors.push("articleId: 기사 번호를 확인하세요");
  const personId = posInt(body.personId);
  if (personId === null) errors.push("personId: 필자 번호를 확인하세요");
  const contractId = body.contractId === undefined || body.contractId === null || body.contractId === "" ? null : posInt(body.contractId);
  if (body.contractId !== undefined && body.contractId !== null && body.contractId !== "" && contractId === null) errors.push("contractId: 계약 번호를 확인하세요");
  const state = str(body.interestState);
  const text = str(body.interestText) || null;
  const confirmedBy = str(body.confirmedBy) || null;
  if (state !== "declared" && state !== "none_confirmed") errors.push("interestState: declared·none_confirmed 중 하나입니다");
  else if (state === "declared" && text === null) errors.push("interestText: 이해관계 내용을 입력하세요");
  else if (state === "none_confirmed" && confirmedBy === null) errors.push("confirmedBy: '없음'은 필자 확인을 받은 사람을 기록해야 합니다");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: { articleId: articleId!, personId: personId!, contractId, interestState: state as MetaInput["interestState"], interestText: state === "declared" ? text : null, confirmedBy: state === "none_confirmed" ? confirmedBy : null },
  };
}

/** 검증 만료 시각 — 직접 준 값이 있으면 그것, 없으면 기준 시각 + 기한(일) */
export function verificationExpiry(verifiedAt: Date, days: number, explicit: string | null): Date {
  if (explicit !== null) return new Date(explicit);
  return new Date(verifiedAt.getTime() + days * 86_400_000);
}

// 부동산 칼럼 이해관계 3항목 (W4 21단계 — PR-14). 조합·시공사·신탁사 자문 관계, 항목마다 declared(내용) 또는 none_confirmed(필자 확인자)
export const INTEREST_ITEM_KEYS = ["union", "contractor", "trust_company"] as const;
export type InterestItemKey = (typeof INTEREST_ITEM_KEYS)[number];
export interface InterestItemInput {
  item: InterestItemKey;
  state: "declared" | "none_confirmed";
  interestText: string | null;
  confirmedBy: string | null;
}
export interface InterestItemsInput {
  articleId: number;
  items: InterestItemInput[];
}
/** body = { articleId, items: [{ item, state, interestText?, confirmedBy? }, …] } — 한 번에 1~3항목(같은 항목 두 번 0). 3항목을 다 채웠는지는 발행 검사가 본다 */
export function parseInterestItems(body: Record<string, unknown>): Result<InterestItemsInput> {
  const errors: string[] = [];
  const articleId = posInt(body.articleId);
  if (articleId === null) errors.push("articleId: 기사 번호를 확인하세요");
  const raw = Array.isArray(body.items) ? body.items : null;
  if (raw === null || raw.length < 1 || raw.length > INTEREST_ITEM_KEYS.length) errors.push(`items: 항목을 1~${INTEREST_ITEM_KEYS.length}개 보내세요 (${INTEREST_ITEM_KEYS.join("·")})`);
  const items: InterestItemInput[] = [];
  const seen = new Set<string>();
  (raw ?? []).forEach((r, i) => {
    const o = typeof r === "object" && r !== null && !Array.isArray(r) ? (r as Record<string, unknown>) : {};
    const item = str(o.item);
    const state = str(o.state);
    const text = str(o.interestText) || null;
    const by = str(o.confirmedBy) || null;
    if (!(INTEREST_ITEM_KEYS as readonly string[]).includes(item)) return void errors.push(`items[${i}].item: ${INTEREST_ITEM_KEYS.join("·")} 중 하나입니다`);
    if (seen.has(item)) return void errors.push(`items[${i}].item: 같은 항목을 두 번 보낼 수 없습니다 (${item})`);
    seen.add(item);
    if (state !== "declared" && state !== "none_confirmed") return void errors.push(`items[${i}].state: declared·none_confirmed 중 하나입니다`);
    if (state === "declared" && text === null) return void errors.push(`items[${i}].interestText: 자문 관계 내용을 입력하세요`);
    if (state === "none_confirmed" && by === null) return void errors.push(`items[${i}].confirmedBy: '없음'은 필자 확인을 받은 사람을 기록해야 합니다`);
    items.push({ item: item as InterestItemKey, state, interestText: state === "declared" ? text : null, confirmedBy: state === "none_confirmed" ? by : null });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { articleId: articleId!, items } };
}
