// 계정과목 연결 (LINK-02) - 순수 모듈. 회계기준 본문은 다루지 않는다: std_ref는 기준 이름+조항 번호용 짧은 칸이다.
export type AccountTargetType = "law_provision" | "legal_doc" | "pub_node";
export const ACCOUNT_TARGET_LABELS: Readonly<Record<AccountTargetType, string>> = { law_provision: "지방세 조문", legal_doc: "결정례·해석", pub_node: "지식창고 해설" };
export const ACCOUNT_RELATION_LABELS: Readonly<Record<string, string>> = { related: "관련", applies: "적용", explains: "해설" };

export const ACCOUNT_CODE = /^[a-z][a-z0-9_]{1,39}$/;
export const isAccountCode = (v: unknown): v is string => typeof v === "string" && ACCOUNT_CODE.test(v);

/** std_ref 모양: 1~80자, 문장(마침표·물음표 뒤 공백)으로 이어진 글 거부 - DB 제약과 같은 규칙 */
export function isStdRef(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length >= 1 && Array.from(t).length <= 80 && !/[.。!?]\s/.test(t);
}

export interface AccountMappingRow {
  id: number;
  account_code: string;
  account_name: string;
  target_type: AccountTargetType;
  target_id: number;
  target_article_no: number | null;
  target_branch_no: number | null;
  relation: string;
  std_ref: string | null;
  version: number;
  signed_at: string | null;
}

/** 서명된 행만, 계정과목마다 가장 높은 서명 버전만 (DB 뷰와 같은 규칙) */
export function publicMappings(rows: readonly AccountMappingRow[]): AccountMappingRow[] {
  const signed = rows.filter((r) => r.signed_at !== null);
  const top = new Map<string, number>();
  for (const r of signed) top.set(r.account_code, Math.max(top.get(r.account_code) ?? 0, r.version));
  return signed.filter((r) => r.version === top.get(r.account_code));
}

/** 계정과목 목록 (코드 → 이름), 이름 가나다순 */
export function accountList(rows: readonly AccountMappingRow[]): { code: string; name: string }[] {
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.account_code)) m.set(r.account_code, r.account_name);
  return [...m.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
