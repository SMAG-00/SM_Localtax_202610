// 멈추는 조건 목록 (docs/dev/W4_설계.md 2.6 표 '멈추는 조건' 칸) — 시험이 설계 문서 표를 읽어 모든 조건이 여기에 있는지 본다.
// step = 2.6 차례 번호, doc = 설계 문서 글자 그대로. doc가 없는 항목은 설계 표에 없는 보조 조건(도구가 더 엄격하게 멈춤).
// action: 'stop' = 멈춤 · 'rewrite' = 멈추지 않고 고쳐 쓰고 보고서에 남김 (2.6 7 '후속이 또 폐지(연쇄 — 최종 지역으로 바꿔 쓴다)')
export const STOPS = Object.freeze({
  RECEIPT_HASH_MISSING: { step: 1, doc: "해시 기록 없음", action: "stop", text: "받을 때 기록한 SHA-256이 없습니다 (--sha256)" },
  RECEIPT_HASH_MISMATCH: { step: 1, action: "stop", text: "받을 때 기록한 SHA-256과 파일의 SHA-256이 다릅니다" },
  RECEIPT_DATE_MISSING: { step: 1, action: "stop", text: "배포일(--file-date YYYY-MM-DD)이 없거나 형식이 다릅니다" },
  DECODE_FAILED: { step: 2, action: "stop", text: "지정한 인코딩으로 읽을 수 없는 바이트가 있습니다 (--encoding 확인)" },
  HEADER_UNKNOWN: { step: 2, doc: "모르는 열 머리", action: "stop", text: "열 머리가 설정과 다릅니다" },
  ROW_SHAPE: { step: 2, action: "stop", text: "칸 수가 열 머리와 다릅니다" },
  CODE_FORMAT: { step: 2, doc: "코드가 10자리 숫자 아님", action: "stop", text: "코드가 10자리 숫자가 아닙니다" },
  NAME_EMPTY: { step: 2, doc: "이름 빈 값", action: "stop", text: "이름이 비어 있습니다" },
  STATUS_UNKNOWN: { step: 2, doc: "폐지여부가 2값 밖", action: "stop", text: "폐지여부가 정한 2값 밖입니다" },
  CODE_DUPLICATE: { step: 2, doc: "같은 코드 두 번", action: "stop", text: "같은 코드가 두 번 나옵니다" },
  CLASS_EMPTY: { step: 3, doc: "분류 수가 0인 분류가 있음", action: "stop", text: "행이 하나도 없는 분류가 있습니다 — 분류 규칙(가설)이 원본과 맞지 않을 수 있습니다" },
  GENERAL_GU_NO_CITY: { step: 3, doc: "일반구의 상위 시 없음", action: "stop", text: "일반구 모양의 코드인데 상위 시(앞 4자리 + 0) 행이 없습니다" },
  PARENT_MISSING: { step: 4, doc: "하나라도 어긋남", action: "stop", text: "'존재' 시·군·구의 앞 2자리 '존재' 시·도가 없습니다" },
  GENERAL_GU_CITY_RETIRED: { step: 4, doc: "하나라도 어긋남", action: "stop", text: "'존재' 일반구의 상위 시가 '존재'가 아닙니다" },
  SEED_MISMATCH: { step: 4, doc: "하나라도 어긋남", action: "stop", text: "W2-b 시·도 17 씨앗과 코드·이름이 다릅니다" },
  SLUG_DUPLICATE: { step: 5, doc: "같은 부모 안 slug 중복", action: "stop", text: "같은 시·도 안에 같은 slug가 있습니다 (숫자를 자동으로 붙이지 않습니다 — 검토 파일에서 고치세요)" },
  SLUG_RESERVED: { step: 5, doc: "예약 이름", action: "stop", text: "예약 이름은 slug로 쓸 수 없습니다" },
  SLUG_FORMAT: { step: 5, doc: "형식 밖", action: "stop", text: "slug 형식(영문 소문자·숫자·'-') 밖이거나 만들 수 없습니다" },
  ALIAS_FORMAT: { step: 5, action: "stop", text: "검토 파일의 별칭이 규칙 밖입니다 (2글자 미만)" },
  REVIEW_UNKNOWN_CODE: { step: 5, action: "stop", text: "검토 파일에 이번 원본의 시·군·구가 아닌 코드가 있습니다" },
  REVIVED: { step: 6, action: "stop", text: "지금 DB에서 폐지된 코드가 원본에서 '존재'입니다 — 사람이 확인해야 합니다" },
  SUCCESSOR_MISSING: { step: 7, doc: "후속 코드 없는 폐지", action: "stop", text: "폐지되는 지역의 후속 코드(사람 입력, 근거 고시)가 없습니다" },
  SUCCESSOR_CHAIN: { step: 7, doc: "후속이 또 폐지", action: "rewrite", text: "후속 지역도 폐지되어 최종 지역으로 바꿔 썼습니다" },
  SUCCESSOR_UNKNOWN: { step: 7, action: "stop", text: "후속 코드가 적용 뒤 유효한 지역이 아닙니다" },
  SUCCESSOR_CYCLE: { step: 7, action: "stop", text: "후속 코드가 돌고 돕니다 (순환)" },
  SUCCESSOR_INPUT: { step: 7, action: "stop", text: "후속 입력 파일의 칸이 규칙 밖입니다 (폐지일 YYYY-MM-DD·근거 고시 필수)" },
  APPROVAL_MISSING: { step: 7, action: "stop", text: "데이터 마이그레이션은 PO 승인자(--approved-by)가 있어야 만듭니다" },
});

export const STEP_NAMES = { 1: "받기", 2: "읽기", 3: "분류", 4: "검증", 5: "slug·별칭", 6: "차이 보고", 7: "적용" };

/** 문제 하나 — { code, step, line?, detail } */
export function problem(code, detail, line) {
  if (!STOPS[code]) throw new Error(`모르는 문제 코드 ${code}`);
  return line === undefined ? { code, step: STOPS[code].step, detail } : { code, step: STOPS[code].step, line, detail };
}

export function formatProblem(p) {
  const s = STOPS[p.code];
  const where = p.line === undefined ? "" : ` — ${Array.isArray(p.line) ? p.line.join("·") : p.line}번째 줄`;
  return `[${s.action === "stop" ? "중단" : "고쳐 씀"}] ${p.step} ${STEP_NAMES[p.step]} · ${s.doc ?? s.text}${where}: ${p.detail}`;
}

/** 멈추는 문제가 있으면 던진다 */
export class RegionImportError extends Error {
  constructor(problems) {
    super(problems.map(formatProblem).join("\n"));
    this.name = "RegionImportError";
    this.problems = problems;
  }
}

export function stopIf(problems) {
  const stops = problems.filter((p) => STOPS[p.code].action === "stop");
  if (stops.length) throw new RegionImportError(stops);
}
