// 판정 결과 항목(Finding)과 규칙 목록 — 항목 ID마다 근거 PRD와 등급(차단·경고)이 하나로 정해진다.
// 규칙 목록 순서가 결과 정렬 순서다 (결정론). README의 규칙 표도 이 목록과 같다.

export type FindingLevel = "block" | "warn";

/** 걸린 위치 — field는 title · summary · blocks · taxLens · solvedCase.<칸> · leadImage · interviews · perspectives · seoLint · copy:<ID> 등 */
export interface FindingLocation {
  field: string;
  blockIndex?: number;
  sentenceIndex?: number;
  phrase?: string;
}

export interface Finding {
  id: string;
  level: FindingLevel;
  /** 근거 PRD 요구사항 ID (예: "NAV-10") */
  ruleRef: string;
  /** 편집자에게 보이는 쉬운 한국어 문장 */
  message: string;
  location?: FindingLocation;
}

export interface RuleDef {
  id: string;
  ruleRef: string;
  level: FindingLevel;
  /** 규칙 이름 — 패널·README 표에 쓴다 */
  title: string;
}

export const RULES = [
  // ART-01 기사 CMS 기본
  { id: "art01.section-required", ruleRef: "ART-01", level: "block", title: "분야(section) 없음" },
  { id: "art01.content-type-required", ruleRef: "ART-01", level: "block", title: "기사 유형(content_type) 없음" },
  { id: "art01.reporting-method-required", ruleRef: "ART-01", level: "block", title: "보도기사에 취재 방식 없음" },
  { id: "art01.reporting-method-not-allowed", ruleRef: "ART-01", level: "block", title: "보도기사가 아닌데 취재 방식 지정" },
  { id: "art01.sponsored-label-required", ruleRef: "ART-01", level: "block", title: "광고·협찬 기사에 표기 없음" },
  { id: "art01.digest-link-required", ruleRef: "ART-01", level: "block", title: "금주 핫뉴스에 주간 회차 연결 없음" },
  { id: "art01.reserved-slug", ruleRef: "ART-01", level: "block", title: "예약된 slug(video·photo·popular)" },
  // ART-03 카드뉴스
  { id: "art03.slide-count", ruleRef: "ART-03", level: "block", title: "카드뉴스가 5~7장이 아님" },
  { id: "art03.slide-alt", ruleRef: "ART-03", level: "block", title: "카드뉴스 장에 대체 텍스트 없음" },
  { id: "art03.slide-text", ruleRef: "ART-03", level: "block", title: "카드뉴스 장에 글자 없음" },
  { id: "art03.slide-outside-cardnews", ruleRef: "ART-03", level: "block", title: "카드뉴스가 아닌 기사에 카드뉴스 장" },
  // ART-07 인포그래픽
  { id: "art07.infographic-required", ruleRef: "ART-07", level: "block", title: "인포그래픽 형식 기사에 인포그래픽 블록 없음" },
  { id: "art07.infographic-alt", ruleRef: "ART-07", level: "block", title: "인포그래픽에 대체 텍스트 없음" },
  { id: "art07.infographic-data", ruleRef: "ART-07", level: "block", title: "인포그래픽에 같은 내용의 표·목록 없음" },
  // ART-08 동영상
  { id: "art08.video-required", ruleRef: "ART-08", level: "block", title: "동영상 형식 기사에 동영상 블록 없음" },
  { id: "art08.embed-url", ruleRef: "ART-08", level: "block", title: "동영상 주소가 youtube-nocookie 임베드 주소가 아님" },
  { id: "art08.summary-required", ruleRef: "ART-08", level: "block", title: "동영상 요약 텍스트 없음" },
  { id: "art08.captions-unconfirmed", ruleRef: "ART-08", level: "block", title: "'자막 있음' 확인 안 함" },
  { id: "art08.thumbnail-required", ruleRef: "ART-08", level: "block", title: "동영상 썸네일 없음" },
  { id: "art08.thumbnail-ratio", ruleRef: "ART-08", level: "block", title: "썸네일이 16:9가 아니거나 크기를 모름" },
  // ART-09 포토
  { id: "art09.photos-required", ruleRef: "ART-09", level: "block", title: "포토 기사에 사진 없음" },
  { id: "art09.photo-credit", ruleRef: "ART-09", level: "block", title: "사진 출처(media.credit) 없음" },
  { id: "art09.photo-license", ruleRef: "ART-09", level: "block", title: "사진 이용 조건(media.license) 없음" },
  { id: "art09.photo-alt", ruleRef: "ART-09", level: "block", title: "사진 대체 텍스트 없음" },
  // NAV-02 유형 구분
  { id: "nav02.press-release-only", ruleRef: "NAV-02", level: "block", title: "출처가 보도자료뿐인 보도기사" },
  // NAV-03 기록·승인 분리
  { id: "nav03.author-required", ruleRef: "NAV-03", level: "block", title: "작성 기자 없음" },
  { id: "nav03.desk-edit-required", ruleRef: "NAV-03", level: "block", title: "편집 승인 없음" },
  { id: "nav03.tax-review-required", ruleRef: "NAV-03", level: "block", title: "세무 감수 서명 없음(대상 기사)" },
  // NAV-04 자체 취재 증거
  { id: "nav04.sources-required", ruleRef: "NAV-04", level: "block", title: "보도기사에 출처 없음" },
  { id: "nav04.own-evidence-required", ruleRef: "NAV-04", level: "block", title: "자체 취재 근거 없음" },
  { id: "nav04.image-rights", ruleRef: "NAV-04", level: "block", title: "사진 권리 미확인" },
  // REG1-07·REG1-09·PR-07 공식 자료·공공누리 (01B — W4 5단계)
  { id: "reg1_07.source-type", ruleRef: "REG1-07", level: "block", title: "공식 자료 종류가 허용 목록 밖(교통·관광·음식점·생활 안내 차단)" },
  { id: "reg1_09.official-fields", ruleRef: "REG1-09", level: "block", title: "공식 자료의 발표일·기준일·지역 단위·수집일·확인일 빔" },
  { id: "pr07.license-required", ruleRef: "PR-07", level: "block", title: "공식 자료·보도자료·사진 출처에 공공누리 유형 없음" },
  { id: "pr07.photo-license", ruleRef: "PR-07", level: "block", title: "게시하지 않는 공공누리 유형의 사진(제4유형·미표시·법률 검토 전 제2·3유형)" },
  { id: "pr07.full-text", ruleRef: "PR-07", level: "block", title: "공공 자료 원문 본문을 그대로 옮김" },
  // NAV-10 정량형 필수 7묶음 + 인과 단정 없음
  { id: "nav10.source-data", ruleRef: "NAV-10", level: "block", title: "원자료(파일/URL·제공기관·수집일·이용권리) 빔" },
  { id: "nav10.indicator-definition", ruleRef: "NAV-10", level: "block", title: "지표 정의(정의·기간·단위·지역 단위·분모·제외값) 빔" },
  { id: "nav10.calculation", ruleRef: "NAV-10", level: "block", title: "계산 과정(수식·재현 파일) 빔" },
  { id: "nav10.source-cross-check", ruleRef: "NAV-10", level: "block", title: "원자료 대조 기록 빔" },
  { id: "nav10.chart-labels", ruleRef: "NAV-10", level: "block", title: "그래프·표의 축/단위/출처 빔" },
  { id: "nav10.limitations", ruleRef: "NAV-10", level: "block", title: "수치의 한계 빔" },
  { id: "nav10.related-party-check", ruleRef: "NAV-10", level: "block", title: "관련 기관·전문가 확인 빔" },
  { id: "nav10.no-causal-claim", ruleRef: "NAV-10", level: "block", title: "'인과 단정 없음' 미확인" },
  // NAV-11 정성형
  { id: "nav11.interview-questions", ruleRef: "NAV-11", level: "block", title: "취재 질문 기록 없음" },
  { id: "nav11.field-record", ruleRef: "NAV-11", level: "block", title: "현장 확인 기록 없음" },
  { id: "nav11.independent-sources", ruleRef: "NAV-11", level: "block", title: "서로 독립적인 근거 2건 미만" },
  { id: "nav11.counter-perspective", ruleRef: "NAV-11", level: "block", title: "반대/보완 관점 기록 없음" },
  { id: "nav11.document-evidence", ruleRef: "NAV-11", level: "block", title: "문서 근거 없음" },
  { id: "nav11.conflicts-of-interest", ruleRef: "NAV-11", level: "block", title: "이해관계 확인 기록 없음" },
  { id: "nav11.quote-record", ruleRef: "NAV-11", level: "block", title: "인용에 인터뷰 기록·문서 근거 없음" },
  { id: "nav11.anonymity-reason", ruleRef: "NAV-11", level: "block", title: "익명 취재원에 익명 사유 없음" },
  { id: "nav11.unverified-evidence", ruleRef: "NAV-11", level: "block", title: "미확인 인터뷰·현장 기록" },
  { id: "nav11.legal-basis-date", ruleRef: "NAV-11", level: "block", title: "세금 쟁점에 법령 기준일 없음" },
  { id: "nav11.perspective", ruleRef: "NAV-11", level: "block", title: "지역 정책 쟁점의 관점 기록 없음" },
  { id: "nav11.original-text-check", ruleRef: "NAV-11", level: "block", title: "지역 정책 쟁점의 원문 대조 기록 없음" },
  { id: "nav11.inheritance-consent", ruleRef: "NAV-11", level: "block", title: "상속·증여 사례 동의 미확인" },
  { id: "nav11.inheritance-deidentified", ruleRef: "NAV-11", level: "block", title: "상속·증여 사례 비식별 검토 미확인" },
  // NAV-12 독립 편집
  { id: "nav12.self-desk-edit", ruleRef: "NAV-12", level: "block", title: "작성 기자 본인의 편집 승인" },
  // CORE-01 「지방세로 읽기」
  { id: "core01.box-or-reason", ruleRef: "CORE-01", level: "block", title: "대상 기사에 박스도 생략 사유도 없음" },
  { id: "core01.topics-required", ruleRef: "CORE-01", level: "block", title: "박스의 관련 세목 0개" },
  { id: "core01.points-count", ruleRef: "CORE-01", level: "block", title: "박스 핵심 포인트가 1~3줄이 아님" },
  { id: "core01.links-required", ruleRef: "CORE-01", level: "block", title: "박스 링크 0개" },
  { id: "core01.tax-amount", ruleRef: "CORE-01", level: "block", title: "박스에 세액 표현(숫자 + 원)" },
  { id: "core01.forbidden-phrase", ruleRef: "CORE-01", level: "block", title: "박스에 감면 단정 등 금지 표현" },
  { id: "core01.box-unreviewed", ruleRef: "CORE-01", level: "block", title: "세무 감수 안 된 박스" },
  { id: "core01.box-re-review", ruleRef: "CORE-01", level: "block", title: "박스 재감수 필요" },
  // CAT-04 개정 브리핑
  { id: "cat04.tracker-required", ruleRef: "CAT-04", level: "block", title: "개정 브리핑에 연결 트래커 없음" },
  // CAT-05 해결 사례
  { id: "cat05.cell-empty", ruleRef: "CAT-05", level: "block", title: "해결 사례 4칸 중 빈 칸" },
  { id: "cat05.result-evidence", ruleRef: "CAT-05", level: "block", title: "결과 근거(사건번호·해석 번호 + 링크) 0개" },
  { id: "cat05.conclusion-missing", ruleRef: "CAT-05", level: "block", title: "결과의 결론 배지(인용·일부 인용·기각·각하·해석) 없음" },
  { id: "cat05.pii", ruleRef: "CAT-05", level: "block", title: "개인정보 형식(주민등록번호·전화·이메일·상세 주소)" },
  { id: "cat05.real-name", ruleRef: "CAT-05", level: "warn", title: "실명으로 보이는 표현" },
  // UX-01 쉬운 말
  { id: "ux01.forbidden-phrase", ruleRef: "UX-01", level: "block", title: "금지 표현" },
  { id: "ux01.jargon-unexplained", ruleRef: "UX-01", level: "warn", title: "풀이 없는 전문 용어 첫 등장" },
  { id: "ux01.guide-sentence-long", ruleRef: "UX-01", level: "warn", title: "안내 문장 기준 글자 수 초과" },
  { id: "ux01.box-too-many-sentences", ruleRef: "UX-01", level: "warn", title: "한 상자 기준 문장 수 초과" },
  // UX-03 압박 완화
  { id: "ux03.fear-phrase", ruleRef: "UX-03", level: "block", title: "공포 표현" },
  { id: "ux03.action-not-written", ruleRef: "UX-03", level: "block", title: "'기한'·'가산세' 블록의 '할 일을 함께 썼다' 미확인" },
  { id: "ux03.rose-box-title", ruleRef: "UX-03", level: "block", title: "rose 상자 제목이 '자주 틀리는 점'이 아님" },
  // ART-10 제휴 콘텐츠
  { id: "art10.label-requires-sponsored", ruleRef: "ART-10", level: "block", title: "표기가 있는데 sponsored가 아님" },
  { id: "art10.co-planned-partner-required", ruleRef: "ART-10", level: "block", title: "공동 기획에 제휴사(이름) 없음 — 배지 '공동 기획 ○○'를 만들 수 없음" },
  { id: "art10.partner-requires-label", ruleRef: "ART-10", level: "block", title: "제휴사를 지정했는데 표기 없음" },
  { id: "art10.partner-contract-expired", ruleRef: "ART-10", level: "block", title: "계약이 끝난 제휴사를 새 기사에 지정" },
  // ART-05 수정 표시
  { id: "art05.update-kind-required", ruleRef: "ART-05", level: "block", title: "수정 종류 없음" },
  { id: "art05.reason-required", ruleRef: "ART-05", level: "block", title: "수정 사유 없음" },
  // OPT-03 · OPT-06 바깥 점검 결과
  { id: "opt03.seo-lint-missing", ruleRef: "OPT-03", level: "block", title: "최적화 점검 결과 없음" },
  { id: "opt03.seo-lint-blocker", ruleRef: "OPT-03", level: "block", title: "최적화 점검 차단 항목" },
  { id: "opt03.seo-lint-warning", ruleRef: "OPT-03", level: "warn", title: "최적화 점검 경고 항목" },
  { id: "opt06.similarity-missing", ruleRef: "OPT-06", level: "block", title: "유사도 검사 결과 없음" },
  { id: "opt06.similarity-blocked", ruleRef: "OPT-06", level: "block", title: "유사도 기준 초과" },
  { id: "opt06.similarity-unverified", ruleRef: "OPT-06", level: "warn", title: "유사도 비교 대상 없음" },
] as const satisfies readonly RuleDef[];

export type RuleId = (typeof RULES)[number]["id"];

const RULE_INDEX = new Map<string, number>(RULES.map((r, i) => [r.id, i]));

/** 규칙 목록에서 등급·근거를 읽어 항목 하나를 만든다 */
export function finding(id: RuleId, message: string, location?: FindingLocation): Finding {
  const rule = RULES[RULE_INDEX.get(id)!]!;
  return location === undefined
    ? { id, level: rule.level, ruleRef: rule.ruleRef, message }
    : { id, level: rule.level, ruleRef: rule.ruleRef, message, location };
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  return (a ?? -1) - (b ?? -1);
}

function compareText(a: string | undefined, b: string | undefined): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * 결정론 정렬 — 차단 먼저, 다음은 규칙 목록 순서(목록 밖 ID는 뒤로, ID 글자순), 위치(field · 블록 · 문장 · 표현), 문구.
 * 검사 함수의 실행 순서와 상관없이 같은 입력이면 같은 순서다.
 */
export function compareFindings(a: Finding, b: Finding): number {
  if (a.level !== b.level) return a.level === "block" ? -1 : 1;
  const ia = RULE_INDEX.get(a.id) ?? RULES.length;
  const ib = RULE_INDEX.get(b.id) ?? RULES.length;
  if (ia !== ib) return ia - ib;
  return (
    compareText(a.id, b.id) ||
    compareText(a.location?.field, b.location?.field) ||
    compareNumber(a.location?.blockIndex, b.location?.blockIndex) ||
    compareNumber(a.location?.sentenceIndex, b.location?.sentenceIndex) ||
    compareText(a.location?.phrase, b.location?.phrase) ||
    compareText(a.message, b.message)
  );
}

/** 정렬하고, ID·위치·문구가 모두 같은 항목은 하나로 */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const key = JSON.stringify([f.id, f.location?.field, f.location?.blockIndex, f.location?.sentenceIndex, f.location?.phrase, f.message]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.sort(compareFindings);
}

/** 저장 검사 결과 — 차단 항목이 하나라도 있으면 저장 거부(ok false). 경고는 저장을 막지 않는다 */
export interface SaveValidation {
  ok: boolean;
  findings: Finding[];
}

export function toSaveValidation(findings: readonly Finding[]): SaveValidation {
  const sorted = sortFindings(findings);
  return { ok: sorted.every((f) => f.level !== "block"), findings: sorted };
}
