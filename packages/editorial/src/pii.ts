// 개인정보 형식 검사 (CAT-05) — 주민등록번호 · 전화번호 · 이메일 · 지번까지 적은 주소, 실명으로 보이는 표현(성+이름+'씨'·'님')
// 형식만 본다(실제 존재 여부는 모른다). 기업 대표번호(15xx·16xx·18xx)는 개인 번호가 아니라 잡지 않는다.

export type PiiKind = "resident_id" | "phone" | "email" | "address";

export const PII_KIND_LABELS: Record<PiiKind, string> = {
  resident_id: "주민등록번호",
  phone: "전화번호",
  email: "이메일",
  address: "상세 주소",
};

export interface PiiMatch {
  kind: PiiKind;
  match: string;
  index: number;
}

/** 생년월일 6자리(월·일 범위 검사) + 하이픈(앞뒤 공백·전각 허용) + 성별 1~8 + 6자리(가림 *·x 허용) */
const RESIDENT_ID = /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s*[-–—‐]?\s*[1-8](?:\d{6}|[*＊xX]{6})(?!\d)/g;

/** 휴대전화 — 01x(국가번호 +82 허용), 구분자 하이픈·점·공백 또는 붙여 씀 */
const MOBILE = /(?:\+82[-.\s]?(?:\(0\))?|(?<!\d)0)1[016789][-.\s)]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;

/** 지역번호·인터넷 전화(02 · 0[3-6][1-5] · 070) — 구분자가 있는 형식만(숫자 덩어리 오인 방지), 괄호 지역번호 허용 */
const LANDLINE = /(?:\(0(?:2|[3-6][1-5]|70)\)\s?|(?<!\d)0(?:2|[3-6][1-5]|70)[-.\s])\d{3,4}[-.\s]\d{4}(?!\d)/g;

/** 이메일 — 전각 골뱅이, (at)·[at] 표기 허용. 도메인에 점 + 2글자 이상 끝이 있어야 한다 */
const EMAIL = /[A-Za-z0-9._%+-]+\s*(?:@|＠|\(at\)|\[at\])\s*[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** 지번·건물번호 바로 뒤에 오면 주소가 아닌 수량 표현(3곳 · 2개 · 3년 · 101동 …) */
const NOT_LOT_AHEAD = String.raw`(?![\d개건곳명년월일원만억천배가차세%위층호평㎡분시대채회동주])`;
/** 지번 — (산) + 본번(-부번)(번지) */
const LOT = String.raw`\s*(?:산\s*)?\d{1,5}(?:\s*-\s*\d{1,5})?(?:\s*번지)?`;

const ADDRESS_PATTERNS = [
  // 시·군·구 + (읍·면) + 동·리·가 + 지번
  new RegExp(String.raw`[가-힣]+(?:시|군|구)\s+(?:[가-힣\d]+(?:읍|면)\s+)?[가-힣\d]+(?:동|리|가)${LOT}${NOT_LOT_AHEAD}`, "g"),
  // 동·리·가 + 지번(부번 또는 '번지'가 있어야 — '공동 2' 같은 오인을 줄인다)
  new RegExp(
    String.raw`(?<![가-힣\d])[가-힣\d]+(?:동|리|가)\s*(?:산\s*)?\d{1,5}(?:\s*-\s*\d{1,5}(?:\s*번지)?|\s*번지)${NOT_LOT_AHEAD}`,
    "g",
  ),
  // 시·군·구 + 도로명 + 건물번호
  new RegExp(String.raw`[가-힣]+(?:시|군|구)\s+[가-힣\d]+(?:로|길)\s*\d{1,4}(?:\s*-\s*\d{1,4})?${NOT_LOT_AHEAD}`, "g"),
];

const PATTERNS: readonly [PiiKind, RegExp][] = [
  ["resident_id", RESIDENT_ID],
  ["phone", MOBILE],
  ["phone", LANDLINE],
  ["email", EMAIL],
  ...ADDRESS_PATTERNS.map((re) => ["address", re] as [PiiKind, RegExp]),
];

/** 글에서 개인정보 형식을 찾는다 — 나온 순서대로, 겹치면 먼저·길게 잡힌 것 하나만 */
export function detectPii(text: string): PiiMatch[] {
  const source = text.normalize("NFC");
  const found: PiiMatch[] = [];
  for (const [kind, pattern] of PATTERNS) {
    for (const m of source.matchAll(pattern)) found.push({ kind, match: m[0], index: m.index });
  }
  found.sort((a, b) => a.index - b.index || b.match.length - a.match.length);
  const kept: PiiMatch[] = [];
  let lastEnd = -1;
  for (const m of found) {
    if (m.index < lastEnd) continue;
    kept.push(m);
    lastEnd = m.index + m.match.length;
  }
  return kept;
}

// ── 실명으로 보이는 표현 ────────────────────────────────────

const TWO_SYLLABLE_SURNAMES = ["남궁", "황보", "제갈", "선우", "독고", "사공", "서문"];
const ONE_SYLLABLE_SURNAMES =
  "김이박최정강조윤장임한오서신권황안송전홍유류고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제탁국";

/** 성 + 이름(1~2글자) + ('씨'|'님') — 앞이 한글이면 낱말 중간이라 보지 않는다 */
const REAL_NAME = new RegExp(
  String.raw`(?<![가-힣])(${TWO_SYLLABLE_SURNAMES.join("|")}|[${ONE_SYLLABLE_SURNAMES}])([가-힣]{1,2})(\s?)(씨|님)`,
  "g",
);

/** 성+이름 자리에 오지만 사람 이름이 아닌 낱말(호칭·직함·일반 명사) */
const NOT_NAMES = new Set([
  "고객", "고문", "선생", "선배", "선수", "이장", "이사", "박사", "석사", "원장", "소장", "반장", "국장", "차장",
  "구청장", "조합장", "조합원", "구민", "주민", "주임", "주무관", "주인", "기사", "기자", "강사", "변호사", "노무사",
  "하나", "하사", "임금", "임대인", "임차인", "도련", "도사", "도우미", "공주", "공무원", "왕자", "위원", "연구원",
  "신부", "신청자", "신고인", "지사", "진행자", "전무", "전문가", "전도사", "권사", "장로", "장인", "한의사", "여사",
  "소위", "소방관", "방장", "마음", "옥수수", "민원인", "심사관", "남편", "유가족", "구독자", "국민",
]);

/** 실명으로 보이는 표현 — 찾은 글자 그대로("김민수 씨"). '김모 씨'처럼 가린 이름과 호칭 명사는 뺀다 */
export function detectRealNames(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize("NFC").matchAll(REAL_NAME)) {
    const surname = m[1]!;
    const given = m[2]!;
    if (given === "모" || NOT_NAMES.has(surname + given)) continue;
    out.push(m[0]);
  }
  return out;
}
