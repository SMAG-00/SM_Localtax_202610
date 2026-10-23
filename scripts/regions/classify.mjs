// 2.6 3 분류 — 코드 모양으로 행을 나눈다. **이 규칙은 가설이다** [확인 필요 — 2단계에서 실제 원본으로 확인, 분류별 수를 보고서에 낸다]
//  · 뒤 8자리 0 → sido
//  · 뒤 5자리 0이고 3~5자리 ≠ 000 → 시·군·구 후보
//      그중 5번째 자리 ≠ 0 → 일반구 모양: 앞 4자리 + 0인 시 코드가 있으면 general_gu, 없으면 중단(일반구의 상위 시 없음)
//        단 2단계 실제 원본(국토교통부 20260729)에서 확인한 예외 — 상위 시가 없는 5번째 자리 ≠ 0 코드는 '일반구'가 아니라 시·도 바로 아래 시·군·구다
//        (서울 광진구 11215·강북구 11305·금천구 11545, 인천 연수구 28185 등 광역시의 구, 충남 태안군 44825 등 군). 상위 시 없음으로 멈추는 것은
//        '도' 아래에 시를 거치지 않고 붙은 구(시·도 이름이 '도'로 끝나고 이름 끝이 '구')뿐이다 — 일반구는 반드시 시 아래에 있다
//      나머지 → sigungu
//  · 나머지 → sub_district (넣지 않음)
// 이름: 원본 이름이 '상위 이름 + 공백 + 자기 이름' 모양이면 상위 이름을 뗀 자기 이름을 쓴다(시·군·구 = '종로구' 모양)
import { ROW_CLASSES } from "./config.mjs";
import { problem, stopIf } from "./stop.mjs";

export const sidoCodeOf = (code) => `${code.slice(0, 2)}00000000`;
export const cityCodeOf = (code) => `${code.slice(0, 4)}000000`;

/** 코드 하나의 분류. codes = 원본의 모든 코드(Set) — 일반구의 상위 시 확인용. 상위 시가 없는 일반구 모양은 null */
export function classOf(code, codes) {
  if (/^[0-9]{2}0{8}$/.test(code)) return "sido";
  if (code.endsWith("00000") && code.slice(2, 5) !== "000") {
    if (code[4] !== "0") return codes.has(cityCodeOf(code)) ? "general_gu" : null;
    return "sigungu";
  }
  return "sub_district";
}

/**
 * 시·도의 줄임 이름 + '시'인 하위 행 — 국토교통부 CSV는 세종특별자치시의 유일한 하위 행을 '세종시'로 적는다(code.go.kr 옛 파일은 시·도와 같은 이름).
 * 12장 #5의 '시·도와 같은 이름의 하위 행'과 같게 다룬다. 좁게: 시·도의 유일한 시·군·구 행(제주시·서귀포시처럼 둘이면 해당 없음)이고, 3글자 이상, '시'로 끝나고, 시·도 이름이 그 낱말(시 뺀 것)로 시작할 때만
 */
const isShortOfSido = (local, sidoName) => local.length >= 3 && local.endsWith("시") && sidoName.startsWith(local.slice(0, -1)) && sidoName !== local;

/** '상위 이름 + 공백'으로 시작하면 뗀다 */
function stripPrefix(name, prefix) {
  if (prefix && name.startsWith(`${prefix} `)) return name.slice(prefix.length + 1);
  return name;
}

/**
 * rows(parseSource 결과) → { rows: [...{ rowClass, name, sidoCode, cityCode?, sameNameAsSido? }], counts, problems }
 * counts = { sido: { active, retired, total }, ... } (2.1 row_class 4개 모두)
 */
export function classifyRows(rows) {
  const codes = new Set(rows.map((r) => r.code));
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const problems = [];
  const out = [];
  // 시·도마다 시·군·구 모양 코드 수 — 시·도 줄임 이름(세종시) 하위 행 판단에 쓴다
  const sigunguPerSido = new Map();
  for (const r of rows) if (classOf(r.code, codes) === "sigungu") sigunguPerSido.set(sidoCodeOf(r.code), (sigunguPerSido.get(sidoCodeOf(r.code)) ?? 0) + 1);
  for (const r of rows) {
    let rowClass = classOf(r.code, codes);
    if (rowClass === "general_gu") {
      // 일반구 = 시 아래의 구. 앞 4자리 + 0이 있어도 그 행이 '시'가 아니거나 자기 이름이 '구'로 끝나지 않으면 일반구가 아니다
      // (충북 증평군 43745 — 4374 + 0은 음성군) → 시·도 바로 아래 시·군·구
      const city = byCode.get(cityCodeOf(r.code));
      if (!city.fullName.endsWith("시") || !r.fullName.endsWith("구")) rowClass = "sigungu";
    }
    if (rowClass === null) {
      const sidoOf = byCode.get(sidoCodeOf(r.code))?.fullName ?? "";
      const lastWord = r.fullName.split(" ").at(-1);
      if (!sidoOf.endsWith("도") || !lastWord.endsWith("구")) rowClass = "sigungu";
    }
    if (rowClass === null) {
      problems.push(problem("GENERAL_GU_NO_CITY", `${r.code} ${r.fullName} — 상위 시 ${cityCodeOf(r.code)} 없음`, r.line));
      continue;
    }
    const sidoCode = sidoCodeOf(r.code);
    const sidoName = byCode.get(sidoCode)?.fullName;
    const row = { ...r, rowClass, sidoCode };
    if (rowClass === "sido") row.name = r.fullName;
    else if (rowClass === "sigungu") {
      row.name = stripPrefix(r.fullName, sidoName);
      if (sidoName && (r.fullName === sidoName || (sigunguPerSido.get(sidoCode) === 1 && isShortOfSido(row.name, sidoName)))) row.sameNameAsSido = true;
    } else if (rowClass === "general_gu") {
      row.cityCode = cityCodeOf(r.code);
      const cityLocal = stripPrefix(byCode.get(row.cityCode).fullName, sidoName);
      row.cityName = cityLocal;
      row.name = stripPrefix(stripPrefix(r.fullName, sidoName), cityLocal);
    } else row.name = r.fullName;
    out.push(row);
  }
  const counts = Object.fromEntries(ROW_CLASSES.map((c) => [c, { active: 0, retired: 0, total: 0 }]));
  for (const r of out) {
    counts[r.rowClass][r.status] += 1;
    counts[r.rowClass].total += 1;
  }
  return { rows: out, counts, problems };
}

/** 분류 수가 0인 분류가 있으면 문제 (원본 전체에 대한 검사 — 2.6 3) */
export function classCountProblems(counts) {
  return ROW_CLASSES.filter((c) => counts[c].total === 0).map((c) => problem("CLASS_EMPTY", `${c} 0행`));
}

/** 분류 + 멈추는 조건 */
export function classify(rows) {
  const r = classifyRows(rows);
  stopIf([...r.problems, ...classCountProblems(r.counts)]);
  return r;
}

/** DB region_import_runs.class_counts 모양 — 분류별 전체 행 수 (합 = rows_total) */
export const classCountsJson = (counts) => Object.fromEntries(ROW_CLASSES.map((c) => [c, counts[c].total]));
