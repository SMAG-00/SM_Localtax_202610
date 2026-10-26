// 고정 안내 문구 자리와 범위 안내 응답 표 - 순수 (W12-b, 4단계 설계 4.4 · PRD-04 6.4 범위 안내 응답).
// 문구는 PO 승인 입력이다(설계 5장 #11). 이 파일은 빈 칸으로 출하하고, 시험에서만 `시험용` 문구를 채워 쓴다.
// 범위 안내 응답은 한 줄 안내(고정 문구) + 링크 2~3개 + 하단 고정으로만 구성되고 모델 문장이 들어가지 않는다.

export const COPY_KEYS = [
  "investment",
  "prediction",
  "tourism",
  "transfer_amount",
  "inherit_gift_amount",
  "scope_pending",
  "out_of_scope",
  "no_evidence",
  "outage",
  "budget",
  "verification_failed",
  "high_risk_banner",
  "assumption_note",
  "ai_footer",
] as const;
export type CopyKey = (typeof COPY_KEYS)[number];
export type FixedCopy = Readonly<Record<CopyKey, string>>;

export const FIXED_COPY_VERSION = "pending-po-input";
/** 출하 기본값 - 모두 빈 칸. 비어 있으면 공개 단계 승인 전 점검에서 걸린다(copyReady) */
export const EMPTY_COPY: FixedCopy = Object.fromEntries(COPY_KEYS.map((k) => [k, ""])) as unknown as FixedCopy;

export const copyReady = (c: FixedCopy): boolean => COPY_KEYS.every((k) => c[k].trim() !== "");
export const missingCopy = (c: FixedCopy): CopyKey[] => COPY_KEYS.filter((k) => c[k].trim() === "");

/** 시험용 문구 - 시험 파일에서만 쓴다 (세무 내용 0, 길 안내 모양) */
export const testCopy = (): FixedCopy => Object.fromEntries(COPY_KEYS.map((k) => [k, `[시험용] ${k} 안내`])) as unknown as FixedCopy;

// ── 링크 지정 - 서버가 official_links·wetax_links·toolLinkFor에서만 읽어 주소를 채운다. 질문·입력값·세션 ID를 주소에 붙이지 않는다 ──

export type LinkSpec =
  | { kind: "site"; label: string; href: string }
  | { kind: "official"; key: string }
  | { kind: "tool"; key: string };

export type ScopeBlockReason = "investment" | "tourism" | "transfer_amount" | "inherit_gift_amount" | "scope_pending" | "out_of_scope";

export interface ScopeResponseSpec {
  copyKey: CopyKey;
  links: readonly LinkSpec[];
  /** 전문가 버튼 분야 코드 (null이면 전문가 버튼 0) */
  expertField: string | null;
}

// 사이트 안 링크는 분야 허브뿐이다(지역 허브·관광 링크 0). 이름은 packages/ui brand가 아니라 분야 이름이며 사이트 이름이 아니다.
const FIELD_HUBS: readonly LinkSpec[] = [
  { kind: "site", label: "지방세·부동산세금", href: "/tax" },
  { kind: "site", label: "부동산재테크", href: "/realestate" },
];

export const SCOPE_RESPONSES: Readonly<Record<ScopeBlockReason, ScopeResponseSpec>> = {
  investment: { copyKey: "investment", links: [...FIELD_HUBS], expertField: "appraisal-law" },
  tourism: { copyKey: "tourism", links: [...FIELD_HUBS], expertField: null },
  transfer_amount: { copyKey: "transfer_amount", links: [{ kind: "official", key: "transfer" }, { kind: "official", key: "nts" }], expertField: "local-tax" },
  inherit_gift_amount: { copyKey: "inherit_gift_amount", links: [{ kind: "tool", key: "inheritance_gift_calculator" }, { kind: "official", key: "inheritance_gift" }, { kind: "official", key: "nts" }], expertField: "inheritance-gift" },
  scope_pending: { copyKey: "scope_pending", links: [{ kind: "official", key: "wetax" }, ...FIELD_HUBS], expertField: "local-tax" },
  out_of_scope: { copyKey: "out_of_scope", links: [...FIELD_HUBS], expertField: "local-tax" },
};

/** 예측성 질문이면 prediction 문구, 아니면 investment 문구 */
export const investmentCopyKey = (topic: "recommendation" | "prediction"): CopyKey => (topic === "prediction" ? "prediction" : "investment");
