// W9 기존 기사 이관 — 중간 형식(JSON)과 분류 대응표 (docs/dev/W9_설계.md 2장)
//  · 중간 형식 = 어떤 현 사이트 내보내기든 어댑터가 이 모양으로 바꾼 뒤 같은 검증·변환·주소 매핑을 거친다
//  · 분류 대응은 DB의 legacy_category_map(마이그레이션 20261018000002)과 같다 — 시험 migration-format.test.mjs가 그 SQL을 읽어 대조한다
//  · 현 사이트(엔디소프트 뉴스솔루션 계열, 2026-10-25 공개 쪽 조사)의 분류 코드 S1N1~S1N8

export const FORMAT_ID = "ltr-legacy-articles";
export const FORMAT_VERSION = 1;

export const SECTIONS = ["tax", "realestate", "finance", "local"];
/** 새 사이트 분야 이름 (PRD-00 5.3) */
export const SECTION_LABELS = { tax: "지방세·부동산세금", realestate: "부동산재테크", finance: "부동산금융", local: "지자체뉴스" };
/** 기사 slug로 쓸 수 없는 이름 (articles check · ART-01) */
export const RESERVED_SLUGS = ["video", "photo", "popular"];

/**
 * 현 사이트 8개 분류 → 새 4대 분야
 * code = 현 사이트 분류 코드(sc_section_code) · dbName = legacy_category_map.legacy_name · aliases = 내보내기에서 올 수 있는 표기
 * category = 새 하위 분야 slug(없으면 분야에만) · tag = 이관 때 붙이는 태그 · listPath = 옛 목록 주소가 가는 새 목록
 */
export const LEGACY_CATEGORIES = [
  { code: "S1N1", dbName: "지자체 소식", aliases: ["지자체소식", "지자체 소식"], section: "local", category: "reporting", tag: null, subtype: "general", needsReclassify: false, listPath: "/local" },
  { code: "S1N2", dbName: "유권 해석", aliases: ["유권해석", "유권 해석"], section: "tax", category: "interpretations", tag: null, subtype: "general", needsReclassify: false, listPath: "/tax/interpretations" },
  { code: "S1N3", dbName: "판례 분석", aliases: ["판례소개", "판례 분석", "판례분석"], section: "tax", category: "interpretations", tag: null, subtype: "general", needsReclassify: false, listPath: "/tax/interpretations" },
  { code: "S1N4", dbName: "법령 개정", aliases: ["법령개정", "법령 개정"], section: "tax", category: "amendments", tag: null, subtype: "general", needsReclassify: false, listPath: "/tax/amendments" },
  { code: "S1N5", dbName: "부동산 정보", aliases: ["부동산 정보", "부동산정보"], section: "realestate", category: null, tag: null, subtype: "general", needsReclassify: true, listPath: "/realestate" },
  { code: "S1N6", dbName: "전문가 칼럼", aliases: ["전문가 칼럼", "전문가칼럼"], section: "tax", category: "columns", tag: null, subtype: "general", needsReclassify: true, listPath: "/tax/columns" },
  { code: "S1N7", dbName: "교육 및 포럼", aliases: ["교육, 포럼, 행사", "교육 및 포럼", "교육포럼"], section: "tax", category: null, tag: "교육", subtype: "general", needsReclassify: false, listPath: "/tax" },
  { code: "S1N8", dbName: "상담 사례", aliases: ["상담사례", "상담 사례"], section: "tax", category: "interpretations", tag: null, subtype: "solved_case", needsReclassify: false, listPath: "/tax/interpretations" },
];

const squash = (s) => String(s ?? "").replace(/[\s,·]/g, "");

/** 분류 코드 또는 이름으로 대응 찾기 — 없으면 null (미배정 → 검증 오류) */
export function findCategory(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const byCode = LEGACY_CATEGORIES.find((c) => c.code === v.toUpperCase());
  if (byCode) return byCode;
  const key = squash(v);
  return LEGACY_CATEGORIES.find((c) => squash(c.dbName) === key || c.aliases.some((a) => squash(a) === key)) ?? null;
}

/** 옛 주소 이전 대상이 되는 정적 쪽 (현 사이트 /com/*). newPath가 null이면 PO 결정 전 — 주소 매핑 검사가 '미결정'으로 센다 */
export const STATIC_PAGES = [
  { old: "/com/com-1.html", label: "회사소개", newPath: "/about" },
  { old: "/com/service.html", label: "이용약관", newPath: null },
  { old: "/com/privacy.html", label: "개인정보처리방침", newPath: null },
  { old: "/com/copyright.html", label: "저작권보호정책", newPath: null },
  { old: "/com/emailno.html", label: "이메일무단수집거부", newPath: null },
  { old: "/com/youthpolicy.html", label: "청소년보호정책", newPath: null },
];

/** 상태값 — 중간 형식의 status */
export const RECORD_STATUSES = ["published", "hidden", "deleted"];
/** 이관 때 새 기사에 줄 수 있는 상태 — 기본 draft(리허설), published는 전환 당일 델타·최종 실행만 */
export const TARGET_STATUSES = ["draft", "published"];
/** 이 사이트 slug 규칙 (articles_slug check와 같다) */
export const SLUG_PATTERN = /^[^\s/]+$/;
