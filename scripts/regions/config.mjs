// 행정구역 적재 도구 기본 설정 (docs/dev/W4_설계.md 2.6·2.7·12장) — PO 결정에 따라 바뀔 수 있는 값은 모두 여기에 모은다.
// 결정이 나면 이 파일의 값(또는 명령 인자)만 바꾼다. 각 값 옆에 12장 번호를 적는다.
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DESIGN_DOC = path.join(ROOT, "docs", "dev", "W4_설계.md");
export const MIGRATIONS_DIR = path.join(ROOT, "packages", "db", "supabase", "migrations");
/** W2-b 시·도 17 씨앗이 든 마이그레이션 — 검증(2.6 4)의 기준 */
export const SIDO_SEED_MIGRATION = path.join(MIGRATIONS_DIR, "20261018000009_regions.sql");

// 2.1 값 목록 (시험이 설계 문서 표와 대조한다)
export const ROW_CLASSES = Object.freeze(["sido", "sigungu", "general_gu", "sub_district"]);
export const CHANGES = Object.freeze(["added", "renamed", "retired", "unchanged"]);
export const RUN_STATUSES = Object.freeze(["dry_run", "applied", "rejected"]);
export const REDIRECT_REASONS = Object.freeze(["retired", "renamed"]);

/** W2-b regions.slug 예약 이름 — DB check(20261018000009)와 같다 (DB 시험이 대조) */
export const RESERVED_SLUGS = Object.freeze(["events", "weekly", "places", "festivals", "food", "life"]);
/** W2-b regions.slug 형식 — DB check와 같다 */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 원본 파일 형식 (12장 #1·#176) — 형식마다 열 머리·구분자·이름을 만드는 방법이 다르다. 모르는 형식은 바로 중단.
 *  · code-go-kr = 행정표준코드관리시스템 「법정동코드 전체자료」 (열 머리·구분자는 아래 DEFAULTS header·delimiter — 기존 동작)
 *  · molit-csv = 공공데이터포털 「국토교통부_전국 법정동」 CSV (UTF-8 BOM·쉼표). 법정동명 = 시도명·시군구명·읍면동명·리명 중 빈 칸을 뺀 것을 공백으로 이은 것
 *    (code.go.kr 파일이 이름을 짓는 방식과 같다). '존재' 코드만 들어 있어 폐지여부 열이 없다 — 모든 행을 존재로 본다
 */
export const SOURCE_FORMATS = Object.freeze({
  "code-go-kr": Object.freeze({ kind: "tabular" }),
  "molit-csv": Object.freeze({
    kind: "molit",
    header: Object.freeze(["법정동코드", "시도명", "시군구명", "읍면동명", "리명", "순번", "생성일자"]),
    delimiter: "comma",
    nameColumns: 4,
  }),
});

export const DEFAULTS = Object.freeze({
  /** 원본 파일 형식 — SOURCE_FORMATS 키 */
  format: "code-go-kr",
  // 12장 #1 — 원본 파일 형식 [확인 필요 — 파일 이름·묶음·인코딩·열·배포일은 2단계에서 실제 파일로 확인]
  header: Object.freeze(["법정동코드", "법정동명", "폐지여부"]),
  delimiter: "tab",
  /** 폐지여부 2값 → 내부 상태 */
  statusValues: Object.freeze({ 존재: "active", 폐지: "retired" }),
  // 12장 #3 — 시·군·구 slug 모양: 'suffix' = 로마자 + `-si`·`-gun`·`-gu` (권고안) / 'plain' = 접미 없음
  slugStyle: "suffix",
  // 12장 #4 — 일반구: 'parent_alias' = 행을 넣지 않고 상위 시의 별칭으로 (권고안)
  generalGu: "parent_alias",
  // 12장 #5 — 시·도와 이름이 같은 하위 행(세종 등): 'sido_alias' = 넣지 않고 시·도 별칭으로 (권고안) / 'sigungu' = 시·군·구 행으로 넣음
  sameNameChild: "sido_alias",
  /** 짧은 별칭·일반구 별칭의 최소 글자 수 (2.3) */
  minAliasLength: 2,
});

export const DELIMITERS = Object.freeze({ tab: "\t", comma: "," });
/** 단위 글자 → slug 접미 (2.7) */
export const UNIT_SUFFIX = Object.freeze({ 시: "si", 군: "gun", 구: "gu" });
/** --encoding 값 → TextDecoder 이름 (CP949 = WHATWG euc-kr, windows-949) */
export const ENCODINGS = Object.freeze({ cp949: "euc-kr", "euc-kr": "euc-kr", "utf-8": "utf-8", utf8: "utf-8" });

/** 설정 합치기 — 모르는 선택지는 바로 오류 (조용히 기본값으로 바꾸지 않는다) */
export function resolveOptions(over = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(over).filter(([, v]) => v !== undefined)) };
  if (!SOURCE_FORMATS[o.format]) throw new Error(`--format은 ${Object.keys(SOURCE_FORMATS).join("·")} 중 하나입니다: ${o.format}`);
  if (!DELIMITERS[o.delimiter]) throw new Error(`--delimiter는 ${Object.keys(DELIMITERS).join("·")} 중 하나입니다: ${o.delimiter}`);
  if (!["suffix", "plain"].includes(o.slugStyle)) throw new Error(`slug 모양은 suffix·plain 중 하나입니다: ${o.slugStyle}`);
  if (o.generalGu !== "parent_alias") throw new Error(`일반구 처리는 지금 parent_alias만 됩니다(12장 #4 — 일반구 허브는 regions 단계 변경이 필요): ${o.generalGu}`);
  if (!["sido_alias", "sigungu"].includes(o.sameNameChild)) throw new Error(`같은 이름 하위 행 처리는 sido_alias·sigungu 중 하나입니다: ${o.sameNameChild}`);
  return o;
}

/** 한국 날짜 YYYY-MM-DD */
export const kstToday = (now = new Date()) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
